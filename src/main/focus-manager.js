const { BrowserWindow, app } = require('electron');
const path = require('path');
const { getDb } = require('./db');
const scheduler = require('./scheduler');
const popupManager = require('./popup-manager');

let focusWindow = null;

function getAsarPath(...segments) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar', ...segments);
  }
  return path.join(__dirname, '..', '..', ...segments);
}

/**
 * 打开沉浸专注刷词窗口
 */
function openFocusWindow() {
  if (focusWindow && !focusWindow.isDestroyed()) {
    focusWindow.show();
    focusWindow.focus();
    return focusWindow;
  }

  // 专注模式开启时暂隐藏常规浮窗
  try {
    if (popupManager.isVisible()) popupManager.hide();
  } catch (e) {}

  focusWindow = new BrowserWindow({
    width: 680,
    height: 540,
    center: true,
    frame: false,
    resizable: false,
    skipTaskbar: false,
    alwaysOnTop: true,
    backgroundColor: '#0F172A', // 专注暗黑夜空底色
    webPreferences: {
      preload: getAsarPath('src', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const htmlPath = getAsarPath('src', 'renderer', 'focus', 'index.html');
  focusWindow.loadFile(htmlPath);

  focusWindow.on('closed', () => {
    focusWindow = null;
    // 专注模式关闭后，刷新调度队列并恢复日常伴随
    try {
      scheduler.reloadQueue();
    } catch (e) {}
  });

  return focusWindow;
}

function closeFocusWindow() {
  if (focusWindow && !focusWindow.isDestroyed()) {
    focusWindow.close();
    focusWindow = null;
  }
}

/**
 * 获取专注模式专属学习词库
 * @param {number} count 目标词数 (20, 50, 或 0 为全部逾期词)
 * @param {string[]} wordlists
 */
function getFocusWords(count = 20, wordlists = ['cet4']) {
  try {
    const db = getDb();
    const now = Date.now();
    const placeholders = wordlists.map(() => '?').join(',');

    // 1. 到期复习词优先 (stage ASC, efactor ASC, next_review_at ASC)
    let dueWords = db.prepare(`
      SELECT w.id, w.word, w.phonetic, w.translation, w.example,
             p.stage, p.next_review_at, p.correct_count, p.wrong_count,
             p.efactor, p.interval, p.repetitions
      FROM words w
      JOIN progress p ON w.id = p.word_id
      WHERE p.next_review_at <= ? AND p.stage < 9
        AND w.id IN (SELECT word_id FROM word_wordlists WHERE wordlist IN (${placeholders}))
      ORDER BY p.stage ASC, p.efactor ASC, p.next_review_at ASC
    `).all(now, ...wordlists);

    let targetCount = count > 0 ? count : (dueWords.length > 0 ? dueWords.length : 20);

    let selected = dueWords.slice(0, targetCount);

    // 2. 如果复习词不足，补充未学新词
    if (selected.length < targetCount) {
      const remainingNeeded = targetCount - selected.length;
      const newWords = db.prepare(`
        SELECT w.id, w.word, w.phonetic, w.translation, w.example, 0 as stage,
               0 as correct_count, 0 as wrong_count, 2.5 as efactor, 0 as interval, 0 as repetitions
        FROM words w
        LEFT JOIN progress p ON w.id = p.word_id
        WHERE p.word_id IS NULL
          AND w.id IN (SELECT word_id FROM word_wordlists WHERE wordlist IN (${placeholders}))
        ORDER BY w.frequency_rank ASC, w.id ASC
        LIMIT ?
      `).all(...wordlists, remainingNeeded);

      selected = [...selected, ...newWords];
    }

    return {
      success: true,
      words: selected,
      totalDue: dueWords.length
    };
  } catch (err) {
    console.error('[FocusManager] getFocusWords error:', err.message);
    return { success: false, words: [], totalDue: 0, error: err.message };
  }
}

/**
 * 提交专注模式单个单词的学习结果
 */
function submitFocusWord(wordId, action) {
  try {
    const db = getDb();
    const now = Date.now();
    const wordIdNum = parseInt(wordId);

    const existing = db.prepare('SELECT * FROM progress WHERE word_id = ?').get(wordIdNum);
    let stage = existing ? existing.stage : 0;
    let correctCount = existing ? existing.correct_count : 0;
    let wrongCount = existing ? existing.wrong_count : 0;
    let efactor = existing ? (existing.efactor || 2.5) : 2.5;
    let interval = existing ? (existing.interval || 0) : 0;
    let repetitions = existing ? (existing.repetitions || 0) : 0;
    let masteredCount = existing ? (existing.mastered_count || 0) : 0;

    const INTERVALS_MS = [
      0,
      5 * 60 * 1000,
      30 * 60 * 1000,
      4 * 60 * 60 * 1000,
      24 * 60 * 60 * 1000,
      2 * 24 * 60 * 60 * 1000,
      4 * 24 * 60 * 60 * 1000,
      7 * 24 * 60 * 60 * 1000,
      15 * 24 * 60 * 60 * 1000
    ];

    let nextReviewAt = 0;

    if (action === 'known') {
      correctCount++;
      repetitions++;
      stage = Math.min(9, stage + 1);
      efactor = Math.min(3.0, efactor + 0.1);
      interval = INTERVALS_MS[Math.min(stage, 8)];
      nextReviewAt = now + interval;
    } else if (action === 'fuzzy') {
      wrongCount++;
      stage = Math.max(1, stage - 1);
      efactor = Math.max(1.3, efactor - 0.15);
      interval = INTERVALS_MS[Math.min(stage, 8)];
      nextReviewAt = now + interval;
    } else if (action === 'unknown') {
      wrongCount++;
      stage = Math.max(1, stage - 1);
      efactor = Math.max(1.3, efactor - 0.2);
      interval = INTERVALS_MS[Math.min(stage, 8)];
      nextReviewAt = now + interval;
    } else if (action === 'mastered') {
      stage = 9;
      masteredCount++;
      correctCount++;
      nextReviewAt = 0;
    }

    if (existing) {
      db.prepare(`
        UPDATE progress
        SET stage = ?, next_review_at = ?, last_review_at = ?, correct_count = ?,
            wrong_count = ?, efactor = ?, interval = ?, repetitions = ?, mastered_count = ?
        WHERE word_id = ?
      `).run(stage, nextReviewAt, now, correctCount, wrongCount, efactor, interval, repetitions, masteredCount, wordIdNum);
    } else {
      db.prepare(`
        INSERT INTO progress (word_id, stage, next_review_at, last_review_at, correct_count, wrong_count, efactor, interval, repetitions, mastered_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(wordIdNum, stage, nextReviewAt, now, correctCount, wrongCount, efactor, interval, repetitions, masteredCount);
    }

    // 记录今日统计
    db.prepare(`
      INSERT INTO daily_stats (date, words_reviewed, words_learned)
      VALUES (date('now','localtime'), 1, ?)
      ON CONFLICT(date) DO UPDATE SET
        words_reviewed = words_reviewed + 1,
        words_learned = words_learned + ?
    `).run(existing ? 0 : 1, existing ? 0 : 1);

    return { success: true, stage, nextReviewAt };
  } catch (err) {
    console.error('[FocusManager] submitFocusWord error:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  openFocusWindow,
  closeFocusWindow,
  getFocusWords,
  submitFocusWord
};
