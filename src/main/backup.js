const fs = require('fs');
const path = require('path');
const { dialog, BrowserWindow } = require('electron');
const { getDb, importWordlist } = require('./db');
const { loadConfig, saveConfig } = require('./config');
const scheduler = require('./scheduler');
const popupManager = require('./popup-manager');

/**
 * 生成备份数据对象
 */
function createBackupData() {
  const db = getDb();
  const config = loadConfig();

  // 1. 导出 progress (带单词英文名，方便跨数据库迁移)
  const progressRows = db.prepare(`
    SELECT w.word, p.stage, p.next_review_at, p.last_review_at,
           p.correct_count, p.wrong_count, p.efactor, p.interval,
           p.repetitions, p.mastered_count
    FROM progress p
    JOIN words w ON p.word_id = w.id
  `).all();

  // 2. 导出 daily_stats
  const statsRows = db.prepare(`
    SELECT date, words_reviewed, words_learned
    FROM daily_stats
    ORDER BY date ASC
  `).all();

  // 3. 导出自定义词库词汇 (非内置词库)
  const customWords = db.prepare(`
    SELECT word, phonetic, translation, example, wordlist, frequency_rank
    FROM words
    WHERE wordlist NOT IN ('cet4', 'cet6', 'kaoyan')
  `).all();

  // 4. 导出自定义词库映射
  const customRelations = db.prepare(`
    SELECT w.word, ww.wordlist
    FROM word_wordlists ww
    JOIN words w ON ww.word_id = w.id
    WHERE ww.wordlist NOT IN ('cet4', 'cet6', 'kaoyan')
  `).all();

  return {
    appName: 'WordPop',
    appVersion: '1.3.0',
    schemaVersion: 6,
    exportedAt: new Date().toISOString(),
    config: config,
    data: {
      progress: progressRows,
      daily_stats: statsRows,
      custom_words: customWords,
      custom_word_wordlists: customRelations
    }
  };
}

/**
 * 弹出保存对话框并导出备份文件
 */
async function handleExportBackup(parentWindow) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const defaultFilename = `wordpop-backup-${dateStr}.json`;

  const { canceled, filePath } = await dialog.showSaveDialog(parentWindow || null, {
    title: '导出 WordPop 备份数据',
    defaultPath: defaultFilename,
    filters: [
      { name: 'WordPop 备份文件 (*.json)', extensions: ['json'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });

  if (canceled || !filePath) {
    return { success: false, error: '用户取消' };
  }

  try {
    const backupObj = createBackupData();
    fs.writeFileSync(filePath, JSON.stringify(backupObj, null, 2), 'utf-8');
    return {
      success: true,
      filePath,
      counts: {
        progressCount: backupObj.data.progress.length,
        statsCount: backupObj.data.daily_stats.length,
        customWordsCount: backupObj.data.custom_words.length
      }
    };
  } catch (err) {
    console.error('[Backup] Export failed:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 恢复备份数据
 */
function restoreBackupData(backupObj) {
  if (!backupObj || backupObj.appName !== 'WordPop' || !backupObj.data) {
    throw new Error('无效的 WordPop 备份文件格式');
  }

  const db = getDb();
  const { progress = [], daily_stats = [], custom_words = [], custom_word_wordlists = [] } = backupObj.data;

  // 1. 确保内置词库已初始化 (根据选中的词库或全部基础词库)
  const configToRestore = backupObj.config || {};
  const selectedLists = configToRestore.selectedWordlists || ['cet4'];
  for (const listId of selectedLists) {
    if (['cet4', 'cet6', 'kaoyan'].includes(listId)) {
      try {
        const cnt = db.prepare('SELECT COUNT(*) c FROM word_wordlists WHERE wordlist=?').get(listId).c;
        if (cnt === 0) {
          importWordlist(listId);
        }
      } catch (e) {
        console.error('[Backup] Error ensuring wordlist:', listId, e.message);
      }
    }
  }

  let restoredProgress = 0;
  let restoredStats = 0;
  let restoredCustomWords = 0;

  const restoreTransaction = db.transaction(() => {
    // 2. 恢复自定义词条
    if (custom_words.length > 0) {
      const insertWordStmt = db.prepare(`
        INSERT OR IGNORE INTO words (word, phonetic, translation, example, wordlist, frequency_rank)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const cw of custom_words) {
        const res = insertWordStmt.run(
          cw.word.trim().toLowerCase(),
          cw.phonetic || '',
          cw.translation || '',
          cw.example || '',
          cw.wordlist || 'custom',
          cw.frequency_rank || 999999
        );
        if (res.changes > 0) restoredCustomWords++;
      }
    }

    // 3. 恢复自定义词库映射
    if (custom_word_wordlists.length > 0) {
      const getWordIdStmt = db.prepare('SELECT id FROM words WHERE word = ?');
      const insertRelStmt = db.prepare(`
        INSERT OR IGNORE INTO word_wordlists (word_id, wordlist) VALUES (?, ?)
      `);
      for (const rel of custom_word_wordlists) {
        const row = getWordIdStmt.get(rel.word.trim().toLowerCase());
        if (row && row.id) {
          insertRelStmt.run(row.id, rel.wordlist);
        }
      }
    }

    // 4. 恢复 progress
    if (progress.length > 0) {
      const getWordIdStmt = db.prepare('SELECT id FROM words WHERE word = ?');
      const upsertProgressStmt = db.prepare(`
        INSERT INTO progress (
          word_id, stage, next_review_at, last_review_at,
          correct_count, wrong_count, efactor, interval,
          repetitions, mastered_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(word_id) DO UPDATE SET
          stage = excluded.stage,
          next_review_at = excluded.next_review_at,
          last_review_at = excluded.last_review_at,
          correct_count = excluded.correct_count,
          wrong_count = excluded.wrong_count,
          efactor = excluded.efactor,
          interval = excluded.interval,
          repetitions = excluded.repetitions,
          mastered_count = excluded.mastered_count
      `);

      for (const p of progress) {
        const cleanWord = (p.word || '').trim().toLowerCase();
        let wordRow = getWordIdStmt.get(cleanWord);
        // 如果在当前库找不到该词，尝试在全内置库补充找找或新建词条
        if (!wordRow && cleanWord) {
          db.prepare(`
            INSERT OR IGNORE INTO words (word, translation, wordlist)
            VALUES (?, '（备份导入）', 'custom')
          `).run(cleanWord);
          wordRow = getWordIdStmt.get(cleanWord);
        }

        if (wordRow && wordRow.id) {
          upsertProgressStmt.run(
            wordRow.id,
            p.stage ?? 0,
            p.next_review_at ?? 0,
            p.last_review_at ?? null,
            p.correct_count ?? 0,
            p.wrong_count ?? 0,
            p.efactor ?? 2.5,
            p.interval ?? 0,
            p.repetitions ?? 0,
            p.mastered_count ?? 0
          );
          restoredProgress++;
        }
      }
    }

    // 5. 恢复 daily_stats
    if (daily_stats.length > 0) {
      const upsertStatsStmt = db.prepare(`
        INSERT INTO daily_stats (date, words_reviewed, words_learned)
        VALUES (?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET
          words_reviewed = MAX(daily_stats.words_reviewed, excluded.words_reviewed),
          words_learned = MAX(daily_stats.words_learned, excluded.words_learned)
      `);
      for (const s of daily_stats) {
        if (s.date) {
          upsertStatsStmt.run(s.date, s.words_reviewed || 0, s.words_learned || 0);
          restoredStats++;
        }
      }
    }
  });

  restoreTransaction();

  // 6. 恢复配置
  if (backupObj.config && typeof backupObj.config === 'object') {
    const configResult = saveConfig(backupObj.config);
    if (configResult.success) {
      try { scheduler.applyConfig(configResult.config); } catch (_) {}
      try { popupManager.updateConfig(configResult.config); } catch (_) {}
    }
  }

  // 7. 触发调度引擎重新加载队列
  try {
    scheduler.reloadQueue();
  } catch (e) {
    console.error('[Backup] Error reloading queue:', e.message);
  }

  // 8. 广播配置与统计变更
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) {
      w.webContents.send('config:changed', loadConfig());
      w.webContents.send('stats:updated');
    }
  });

  return {
    restoredProgress,
    restoredStats,
    restoredCustomWords
  };
}

/**
 * 弹出选择对话框并导入恢复备份文件
 */
async function handleImportBackup(parentWindow) {
  const { canceled, filePaths } = await dialog.showOpenDialog(parentWindow || null, {
    title: '选择 WordPop 备份文件',
    filters: [
      { name: 'WordPop 备份文件 (*.json)', extensions: ['json'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile']
  });

  if (canceled || !filePaths || filePaths.length === 0) {
    return { success: false, error: '用户取消' };
  }

  try {
    const raw = fs.readFileSync(filePaths[0], 'utf-8');
    const backupObj = JSON.parse(raw);
    const counts = restoreBackupData(backupObj);
    return {
      success: true,
      filePath: filePaths[0],
      counts
    };
  } catch (err) {
    console.error('[Backup] Import failed:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  createBackupData,
  restoreBackupData,
  handleExportBackup,
  handleImportBackup
};
