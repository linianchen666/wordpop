const { ipcMain, dialog, BrowserWindow, app } = require('electron');
const fs = require('fs');
const { importWordlist, getWordlistIndex, importCustomWordlist, diagnoseDatabase, repairDatabase } = require('./db');
const { handleExportBackup, handleImportBackup } = require('./backup');
const { loadConfig, saveConfig } = require('./config');
const scheduler = require('./scheduler');
const { learningRepository } = require('./learning-repository');
const { selectedWordlists } = require('./study-policy');
const popupManager = require('./popup-manager');
const { openFocusWindow, closeFocusWindow, getFocusWords, submitFocusWord } = require('./focus-manager');
const { startAutoUpdateCheck } = require('./tray');

// ═════════════════════════╗
//  日志读取 / 打开（新增）
// ═════════════════════════╝

const LOG_FILE = require('path').join(app.getPath('userData'), 'wordpop.log');

let registered = false;

function registerIpcHandlers() {
  if (registered) return;

  ipcMain.handle('app:get-logs', () => {
    try {
      return { success: true, logs: fs.readFileSync(LOG_FILE, 'utf8') };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('app:open-log-folder', async () => {
    try {
      await require('electron').shell.openPath(require('path').dirname(LOG_FILE));
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ═════════════════════════╗
  //  单词反馈
  // ═════════════════════════╝

  ipcMain.on('word:known',     () => scheduler.markKnown());
  ipcMain.on('word:unknown',   () => scheduler.markUnknown());
  ipcMain.on('word:fuzzy',     () => scheduler.markFuzzy());
  ipcMain.on('word:easy',      () => scheduler.markEasy());
  ipcMain.on('word:mastered',  () => scheduler.markMastered());
  ipcMain.on('word:undo',      () => scheduler.undo());
  ipcMain.on('popup:minimize', () => popupManager.hide());

  // ═════════════════════════╗
  //  配置
  // ═════════════════════════╝

  ipcMain.handle('config:get', () => loadConfig());

  ipcMain.handle('config:save', (_ev, config) => {
    const result = saveConfig(config);
    if (result.success) {
      scheduler.applyConfig(result.config);
      popupManager.updateConfig(result.config);
      // 同步自动检查更新状态
      if ('autoCheckUpdate' in config) {
        startAutoUpdateCheck(config.autoCheckUpdate);
      }
      BrowserWindow.getAllWindows().forEach(w => {
        if (!w.isDestroyed()) w.webContents.send('config:changed', result.config);
      });
    }
    return result;
  });

  // ═════════════════════════╗
  //  词库管理
  // ═════════════════════════╝

  ipcMain.handle('wordlists:get', () => {
    try {
      const index = getWordlistIndex();
      for (const e of index) {
        try {
          e.importedCount = learningRepository.getImportedWordlistCount(e.id);
          e.isImported = e.importedCount > 0;
        } catch (e2) {
          e.importedCount = 0;
          e.isImported = false;
        }
      }
      // 自动合并用户自定义导入的词表 (custom_*)
      try {
        const customLists = learningRepository.getCustomWordlists();
        for (const cl of customLists) {
          if (!index.some(x => x.id === cl.id)) {
            index.push({
              id: cl.id,
              name: '自定义词表 (' + cl.id + ')',
              file: '',
              count: cl.importedCount,
              importedCount: cl.importedCount,
              isImported: true
            });
          }
        }
      } catch (e3) {}

      return index;
    } catch (err) {
      console.error('[IPC] wordlists:get error:', err.message);
      return [
        { id: 'cet4', name: 'CET-4 四级', count: 4544, isImported: false },
        { id: 'cet6', name: 'CET-6 六级', count: 3991, isImported: false },
        { id: 'kaoyan', name: '考研词汇', count: 5047, isImported: false }
      ];
    }
  });

  ipcMain.handle('wordlist:import', (_ev, id) => {
    try {
      const r = importWordlist(id);
      return { success: true, ...r };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('wordlist:import-custom', async () => {
    const r = await dialog.showOpenDialog({
      title: '导入自定义词表',
      filters: [
        { name: '词表文件', extensions: ['csv','txt'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    if (r.canceled || r.filePaths.length === 0) {
      return { success: false, error: '用户取消' };
    }
    try {
      const result = importCustomWordlist(r.filePaths[0], 'custom_' + Date.now());
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ═════════════════════════╗
  //  学习进度摘要（预测用）
  // ═════════════════════════╝

  ipcMain.handle('stats:progress-summary', (_ev, wordlistIds) => {
    try {
      return learningRepository.getProgressSummary(wordlistIds);
    } catch (err) {
      console.error('[IPC] stats:progress-summary error:', err.message);
      return { totalWords: 0, learnedWords: 0, masteredWords: 0, remainingWords: 0 };
    }
  });

  // ═════════════════════════╗
  //  数据库诊断与修复
  // ═════════════════════════╝

  ipcMain.handle('db:diagnose', () => {
    return diagnoseDatabase();
  });

  ipcMain.handle('db:repair', () => {
    return repairDatabase();
  });

  // ═════════════════════════╗
  //  数据备份与恢复
  // ═════════════════════════╝

  ipcMain.handle('backup:export', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return handleExportBackup(win);
  });

  ipcMain.handle('backup:import', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return handleImportBackup(win);
  });

  // ═════════════════════════╗
  //  逾期复习平摊与动态配额
  // ═════════════════════════╝

  ipcMain.handle('reviews:smooth-overdue', (_event, days) => {
    try {
      const config = loadConfig();
      const wordlists = selectedWordlists(config);
      const res = learningRepository.smoothOverdueReviews(days, wordlists);
      if (res.success) {
        scheduler.reloadQueue();
        BrowserWindow.getAllWindows().forEach(w => {
          if (!w.isDestroyed()) w.webContents.send('stats:updated');
        });
      }
      return res;
    } catch (err) {
      console.error('[IPC] reviews:smooth-overdue error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('scheduler:quota-info', () => {
    return scheduler.getDynamicQuotaInfo();
  });

  ipcMain.handle('scheduler:trigger-next-batch', () => {
    scheduler.triggerNextBatchNow();
    return { success: true };
  });

  // ═════════════════════════╗
  //  沉浸专注刷词模式 (Focus)
  // ═════════════════════════╝

  ipcMain.handle('focus:open', () => {
    openFocusWindow();
    return { success: true };
  });

  ipcMain.handle('focus:close', () => {
    closeFocusWindow();
    return { success: true };
  });

  ipcMain.handle('focus:get-words', (_event, count) => {
    const config = loadConfig();
    const wordlists = selectedWordlists(config);
    return getFocusWords(count, wordlists);
  });

  ipcMain.handle('focus:submit-word', (_event, wordId, action) => {
    const res = submitFocusWord(wordId, action);
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) w.webContents.send('stats:updated');
    });
    return res;
  });

  // ═════════════════════════╗
  //  统计
  // ═════════════════════════╝//

  ipcMain.handle('stats:get', () => {
    try {
      const statistics = learningRepository.getStats();
      const status = scheduler.getStatus();

      return {
        ...statistics,
        todayDueCount: status.todayDueCount,
        todayNewRemaining: status.todayNewRemaining
      };
    } catch (err) {
      console.error('[IPC] stats:get error:', err.message);
      return {
        today: { words_reviewed: 0, words_learned: 0 },
        total: { words: 0, correct: 0, wrong: 0, mastered: 0 },
        streak: 0,
        todayDueCount: 0,
        todayNewRemaining: 0
      };
    }
  });

  ipcMain.handle('stats:daily', (_ev, days=7) => {
    try {
      return learningRepository.getDailyStats(days);
    } catch (err) {
      console.error('[IPC] stats:daily error:', err.message);
      return [];
    }
  });

  ipcMain.handle('stats:stubborn-words', (_ev, minWrong = 3) => {
    try {
      return learningRepository.getStubbornWords(minWrong);
    } catch (err) {
      console.error('[IPC] stats:stubborn-words error:', err.message);
      return [];
    }
  });

  ipcMain.handle('stats:stage-distribution', () => {
    try {
      return learningRepository.getStageDistribution();
    } catch (err) {
      console.error('[IPC] stats:stage-distribution error:', err.message);
      return [];
    }
  });

  // ═════════════════════════╗
  //  调度器
  // ═════════════════════════╝//

  ipcMain.handle('scheduler:status',       () => scheduler.getStatus());
  ipcMain.handle('scheduler:toggle-pause', () => {
    if (scheduler.getStatus().isPaused) {
      scheduler.resume();
      return { isPaused: false };
    } else {
      scheduler.pause();
      return { isPaused: true };
    }
  });

  // ═════════════════════════╗
  //  应用退出
  // ═════════════════════════╝//

  ipcMain.on('app:quit', () => {
    scheduler.stop();
    app.quit();
  });

  registered = true;
}

module.exports = { registerIpcHandlers };
