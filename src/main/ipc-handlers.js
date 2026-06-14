const { ipcMain, dialog, BrowserWindow } = require('electron');
const { getDb, importWordlist, getWordlistIndex, importCustomWordlist } = require('./db');
const { loadConfig, saveConfig } = require('./config');
const scheduler = require('./scheduler');
const popupManager = require('./popup-manager');

/**
 * 注册所有 IPC 处理器
 */
function registerIpcHandlers(mainWindow) {

  // === 单词反馈 ===
  ipcMain.on('word:known', () => {
    scheduler.markKnown();
  });

  ipcMain.on('word:unknown', () => {
    scheduler.markUnknown();
  });

  ipcMain.on('word:pronounce', (_event, word) => {
    // 发音在主进程不做处理，由渲染进程使用 Web Speech API
    // 这里仅作为预留通道
  });

  ipcMain.on('popup:minimize', () => {
    popupManager.hide();
  });

  // === 配置 ===
  ipcMain.handle('config:get', () => {
    return loadConfig();
  });

  ipcMain.handle('config:save', (_event, config) => {
    const result = saveConfig(config);
    if (result.success) {
      // 通知调度器和弹窗管理器配置已更新
      scheduler.applyConfig(result.config);
      popupManager.updateConfig(result.config);

      // 广播配置变更到所有渲染进程
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('config:changed', result.config);
        }
      });
    }
    return result;
  });

  // === 词库管理 ===
  ipcMain.handle('wordlists:get', () => {
    const index = getWordlistIndex();
    // 标记哪些词库已导入
    const db = getDb();
    for (const entry of index) {
      const count = db.prepare(
        'SELECT COUNT(*) as count FROM words WHERE wordlist = ?'
      ).get(entry.id);
      entry.importedCount = count ? count.count : 0;
      entry.isImported = entry.importedCount > 0;
    }
    return index;
  });

  ipcMain.handle('wordlist:import', (_event, wordlistId) => {
    try {
      const result = importWordlist(wordlistId);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('wordlist:import-custom', async () => {
    const result = await dialog.showOpenDialog({
      title: '导入自定义词表',
      filters: [
        { name: '词表文件', extensions: ['csv', 'txt'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: '用户取消' };
    }

    try {
      const filePath = result.filePaths[0];
      const wordlistName = 'custom_' + Date.now();
      const importResult = importCustomWordlist(filePath, wordlistName);
      return { success: true, ...importResult };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // === 统计 ===
  ipcMain.handle('stats:get', () => {
    const db = getDb();

    // 今日数据
    const todayStats = db.prepare(
      "SELECT words_reviewed, words_learned FROM daily_stats WHERE date = date('now', 'localtime')"
    ).get() || { words_reviewed: 0, words_learned: 0 };

    // 累计数据
    const totalStats = db.prepare(`
      SELECT
        COUNT(DISTINCT p.word_id) as total_words,
        SUM(p.correct_count) as total_correct,
        SUM(p.wrong_count) as total_wrong,
        COUNT(DISTINCT CASE WHEN p.stage >= ? THEN p.word_id END) as mastered_words
      FROM progress p
    `).get(9);

    // 连续打卡天数
    const streakDays = db.prepare(`
      WITH RECURSIVE dates(d) AS (
        SELECT date('now', 'localtime')
        UNION ALL
        SELECT date(d, '-1 day') FROM dates
        WHERE d > date('now', '-365 days')
      )
      SELECT COUNT(*) as streak FROM dates
      WHERE d <= date('now', 'localtime')
        AND EXISTS (
          SELECT 1 FROM daily_stats ds WHERE ds.date = dates.d
        )
      ORDER BY d DESC
    `).get();

    return {
      today: todayStats,
      total: {
        words: totalStats.total_words || 0,
        correct: totalStats.total_correct || 0,
        wrong: totalStats.total_wrong || 0,
        mastered: totalStats.mastered_words || 0
      },
      streak: streakDays ? streakDays.streak : 0
    };
  });

  ipcMain.handle('stats:daily', (_event, days = 7) => {
    const db = getDb();
    return db.prepare(`
      SELECT date, words_reviewed, words_learned
      FROM daily_stats
      WHERE date >= date('now', 'localtime', ?)
      ORDER BY date ASC
    `).all(`-${days} days`);
  });

  ipcMain.handle('stats:stage-distribution', () => {
    const db = getDb();
    return db.prepare(`
      SELECT stage, COUNT(*) as count
      FROM progress
      WHERE stage < 9
      GROUP BY stage
      ORDER BY stage ASC
    `).all();
  });

  // === 调度器 ===
  ipcMain.handle('scheduler:status', () => {
    return scheduler.getStatus();
  });

  ipcMain.handle('scheduler:toggle-pause', () => {
    const status = scheduler.getStatus();
    if (status.isPaused) {
      scheduler.resume();
      return { isPaused: false };
    } else {
      scheduler.pause();
      return { isPaused: true };
    }
  });

  // === 应用 ===
  ipcMain.on('app:quit', () => {
    const { app } = require('electron');
    scheduler.stop();
    app.quit();
  });

  console.log('[IPC] All handlers registered');
}

module.exports = { registerIpcHandlers };
