const { ipcMain, dialog, BrowserWindow, app, fs } = require('electron');
const { getDb, importWordlist, getWordlistIndex, importCustomWordlist, getProgressSummary, diagnoseDatabase, repairDatabase } = require('./db');
const { loadConfig, saveConfig } = require('./config');
const scheduler = require('./scheduler');
const popupManager = require('./popup-manager');
const { startAutoUpdateCheck } = require('./tray');

// ═════════════════════════╗
//  日志读取 / 打开（新增）
// ═════════════════════════╝

const LOG_FILE = require('path').join(app.getPath('userData'), 'wordpop.log');

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
ipcMain.on('word:mastered',  () => scheduler.markMastered());

ipcMain.on('word:pronounce', (_ev, word) => {
  // 发音由渲染进程 Web Speech API 处理；此处为预留通道
});

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
  const index = getWordlistIndex();
  const db = getDb();
  for (const e of index) {
    const r = db.prepare('SELECT COUNT(*) c FROM words WHERE wordlist = ?').get(e.id);
    e.importedCount = r ? r.c : 0;
    e.isImported = e.importedCount > 0;
  }
  return index;
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
    return getProgressSummary(wordlistIds);
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
//  统计
// ═════════════════════════╝//

ipcMain.handle('stats:get', () => {
  try {
    const db = getDb();
    const today = db.prepare(
      "SELECT words_reviewed, words_learned FROM daily_stats WHERE date = date('now','localtime')"
    ).get() || { words_reviewed:0, words_learned:0 };

    const total = db.prepare(`
      SELECT
        COUNT(DISTINCT p.word_id) total_words,
        SUM(p.correct_count) total_correct,
        SUM(p.wrong_count)   total_wrong,
        COUNT(DISTINCT CASE WHEN p.stage >= 9 THEN p.word_id END) mastered
      FROM progress p
    `).get();

    // 连续打卡天数（从今天往前数，遇到无记录的日期即停止）
    const streak = db.prepare(`
      WITH RECURSIVE d(day) AS (
        SELECT date('now','localtime')
        UNION ALL
        SELECT date(day,'-1 day') FROM d
        WHERE day > date('now','-365 days')
          AND EXISTS (SELECT 1 FROM daily_stats ds WHERE ds.date = date(day,'-1 day'))
      )
      SELECT COUNT(*) streak FROM d
      WHERE EXISTS (SELECT 1 FROM daily_stats ds WHERE ds.date = d.day)
    `).get();

    return {
      today: today,
      total: {
        words:    total.total_words   || 0,
        correct:  total.total_correct  || 0,
        wrong:    total.total_wrong    || 0,
        mastered: total.mastered     || 0
      },
      streak: streak ? streak.streak : 0
    };
  } catch (err) {
    console.error('[IPC] stats:get error:', err.message);
    return {
      today: { words_reviewed: 0, words_learned: 0 },
      total: { words: 0, correct: 0, wrong: 0, mastered: 0 },
      streak: 0
    };
  }
});

ipcMain.handle('stats:daily', (_ev, days=7) => {
  try {
    return getDb().prepare(`
      SELECT date, words_reviewed, words_learned
      FROM daily_stats
      WHERE date >= date('now','localtime','-' || ? || ' days')
      ORDER BY date ASC
    `).all(days);
  } catch (err) {
    console.error('[IPC] stats:daily error:', err.message);
    return [];
  }
});

ipcMain.handle('stats:stubborn-words', (_ev, minWrong = 3) => {
  try {
    const db = getDb();
    return db.prepare(`
      SELECT w.id, w.word, w.phonetic, w.translation, w.example,
             p.stage, p.wrong_count, p.correct_count, p.next_review_at
      FROM words w
      JOIN progress p ON w.id = p.word_id
      WHERE p.wrong_count >= ? AND p.stage < 9
      ORDER BY p.wrong_count DESC, p.stage ASC
      LIMIT 50
    `).all(minWrong);
  } catch (err) {
    console.error('[IPC] stats:stubborn-words error:', err.message);
    return [];
  }
});

ipcMain.handle('stats:stage-distribution', () => {
  try {
    return getDb().prepare(`
      SELECT stage, COUNT(*) count
      FROM progress
      WHERE stage < 9
      GROUP BY stage
      ORDER BY stage ASC
    `).all();
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

module.exports = { registerIpcHandlers: () => {} };
