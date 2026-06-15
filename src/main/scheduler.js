const { getDb } = require('./db');
const { loadConfig } = require('./config');
const popupManager = require('./popup-manager');

/**
 * 艾宾浩斯遗忘曲线调度引擎
 * 
 * 9 阶段间隔（优化后，适配桌面弹窗使用场景）：
 *   Stage 0: 1分钟（首次看到后快速确认）
 *   Stage 1: 5分钟（短期记忆确认）
 *   Stage 2: 30分钟（同次使用电脑期间）
 *   Stage 3: 4小时（当天晚些时候自然弹出）
 *   Stage 4: 1天（跨天复习）
 *   Stage 5: 2天
 *   Stage 6: 4天
 *   Stage 7: 7天
 *   Stage 8: 15天（长期巩固）
 *   Stage 9: 已掌握（不再推送）
 * 
 * 「熟知」按钮：直接跳到 Stage 8（15天后才再出现，相当于不再推送）
 */

const STAGE_INTERVALS = [
  1 * 60 * 1000,           // Stage 0: 1分钟
  5 * 60 * 1000,           // Stage 1: 5分钟
  30 * 60 * 1000,          // Stage 2: 30分钟
  4 * 3600 * 1000,        // Stage 3: 4小时
  24 * 3600 * 1000,        // Stage 4: 1天
  2 * 86400 * 1000,        // Stage 5: 2天
  4 * 86400 * 1000,        // Stage 6: 4天
  7 * 86400 * 1000,        // Stage 7: 7天
  15 * 86400 * 1000,       // Stage 8: 15天
  Infinity                  // Stage 9: 已掌握
];

const MAX_STAGE = 9;
const MASTERED_STAGE = 9;  // 已掌握的 stage 值

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class Scheduler {
  constructor() {
    this.queue = [];
    this.currentWord = null;
    this.nextPopupTimer = null;
    this.isPaused = false;
    this.dailyNewWordsLimit = 20;
    this.dailyNewWordsCount = 0;
    this._onStatsUpdate = null;
    this._lastDate = null;
  }

  start() {
    try {
      const config = loadConfig();
      if (config && config.dailyNewWords) {
        this.dailyNewWordsLimit = config.dailyNewWords;
      }
    } catch (e) {
      console.error('[Scheduler] loadConfig failed, using default:', e.message);
      this.dailyNewWordsLimit = 20;
    }

    this._resetDailyCountIfNeeded();
    this.reloadQueue();

    console.log('[Scheduler] Started | daily limit:', this.dailyNewWordsLimit,
      '| daily count:', this.dailyNewWordsCount,
      '| queue size:', this.queue.length);

    this._popNext();
  }

  stop() {
    if (this.nextPopupTimer) {
      clearTimeout(this.nextPopupTimer);
      this.nextPopupTimer = null;
    }
    this.queue = [];
    this.currentWord = null;
    console.log('[Scheduler] Stopped');
  }

  pause() {
    this.isPaused = true;
    if (this.nextPopupTimer) {
      clearTimeout(this.nextPopupTimer);
      this.nextPopupTimer = null;
    }
    try { popupManager.hide(); } catch (e) {}
    console.log('[Scheduler] Paused');
  }

  resume() {
    this.isPaused = false;
    this.reloadQueue();
    console.log('[Scheduler] Resumed | queue size:', this.queue.length);

    if (this.queue.length > 0) {
      try { popupManager.restore(); } catch (e) {}
      this._popNext();
    } else {
      try { popupManager.restore(); } catch (e) {}
      this.nextPopupTimer = setTimeout(() => this._popNext(), 1000);
    }
  }

  _popNext() {
    if (this.isPaused) return;
    if (this.currentWord) return;

    this._checkDateChange();

    if (this.queue.length === 0) {
      this.reloadQueue();
    }

    const word = this.queue.shift();
    if (word) {
      this.currentWord = word;
      this._showWord(word);
      console.log('[Scheduler] Pop:', word.word, '| stage:', word.stage, '| remaining:', this.queue.length);
    } else {
      // 没有单词了，隐藏弹窗，30秒后重试
      console.log('[Scheduler] No words available, hiding popup, retry in 30s');
      try { popupManager.hide(); } catch (e) {}
      this.nextPopupTimer = setTimeout(() => this._popNext(), 30000);
    }
  }

  _showWord(word) {
    const progress = (word.stage !== undefined && word.stage !== null) ? {
      stage: word.stage,
      total: MAX_STAGE,
      correct: word.correct_count || 0,
      wrong: word.wrong_count || 0
    } : null;

    try {
      popupManager.show({
        id: word.id,
        word: word.word,
        phonetic: word.phonetic || '',
        translation: word.translation || '',
        example: word.example || '',
        isNew: word.stage === undefined || word.stage === 0,
        progress: progress,
        queueRemaining: this.queue.length
      });
    } catch (e) {
      console.error('[Scheduler] _showWord ERROR:', e.message);
    }
  }

  reloadQueue() {
    try {
      const db = getDb();
      const now = Date.now();

      // 1. 到期需复习的单词（随机排序）
      const dueReviews = db.prepare(`
        SELECT w.id, w.word, w.phonetic, w.translation, w.example,
               p.stage, p.next_review_at, p.correct_count, p.wrong_count
        FROM words w
        JOIN progress p ON w.id = p.word_id
        WHERE p.next_review_at <= ? AND p.stage < ?
        LIMIT 200
      `).all(now, MASTERED_STAGE);

      // 2. 今日配额内的新词（随机选取）
      const remaining = Math.max(0, this.dailyNewWordsLimit - this.dailyNewWordsCount);
      let newWords = [];
      if (remaining > 0) {
        newWords = db.prepare(`
          SELECT w.id, w.word, w.phonetic, w.translation, w.example, 0 as stage,
                 0 as correct_count, 0 as wrong_count
          FROM words w
          LEFT JOIN progress p ON w.id = p.word_id
          WHERE p.word_id IS NULL
          ORDER BY RANDOM()
          LIMIT ?
        `).all(remaining);
      }

      this.queue = [...shuffleArray(dueReviews), ...newWords];

      console.log('[Scheduler] Queue reloaded | due:', dueReviews.length,
        '| new:', newWords.length, '| total:', this.queue.length);
    } catch (e) {
      console.error('[Scheduler] reloadQueue ERROR:', e.message);
      this.queue = [];
    }
  }

  markKnown() {
    if (!this.currentWord) {
      console.log('[Scheduler] markKnown: no currentWord, skipping');
      return;
    }
    console.log('[Scheduler] markKnown:', this.currentWord.word);
    try {
      this._updateProgress('known');
      this._advanceToNext();
    } catch (e) {
      console.error('[Scheduler] markKnown ERROR:', e.message, e.stack);
      this.currentWord = null;
      this.nextPopupTimer = setTimeout(() => this._popNext(), 500);
    }
  }

  markUnknown() {
    if (!this.currentWord) {
      console.log('[Scheduler] markUnknown: no currentWord, skipping');
      return;
    }
    console.log('[Scheduler] markUnknown:', this.currentWord.word);
    try {
      this._updateProgress('unknown');
      this._advanceToNext();
    } catch (e) {
      console.error('[Scheduler] markUnknown ERROR:', e.message, e.stack);
      this.currentWord = null;
      this.nextPopupTimer = setTimeout(() => this._popNext(), 500);
    }
  }

  markFuzzy() {
    if (!this.currentWord) {
      console.log('[Scheduler] markFuzzy: no currentWord, skipping');
      return;
    }
    console.log('[Scheduler] markFuzzy:', this.currentWord.word);
    try {
      this._updateProgress('fuzzy');
      this._advanceToNext();
    } catch (e) {
      console.error('[Scheduler] markFuzzy ERROR:', e.message, e.stack);
      this.currentWord = null;
      this.nextPopupTimer = setTimeout(() => this._popNext(), 500);
    }
  }

  markMastered() {
    if (!this.currentWord) {
      console.log('[Scheduler] markMastered: no currentWord, skipping');
      return;
    }
    console.log('[Scheduler] markMastered:', this.currentWord.word);
    try {
      this._updateProgress('mastered');
      this._advanceToNext();
    } catch (e) {
      console.error('[Scheduler] markMastered ERROR:', e.message, e.stack);
      this.currentWord = null;
      this.nextPopupTimer = setTimeout(() => this._popNext(), 500);
    }
  }

  /**
   * 更新单词学习进度
   * @param {'known'|'unknown'|'mastered'} action
   */
  _updateProgress(action) {
    const db = getDb();
    const word = this.currentWord;
    if (!word) return;

    let existing;
    try {
      existing = db.prepare('SELECT * FROM progress WHERE word_id = ?').get(word.id);
    } catch (e) {
      console.error('[Scheduler] SELECT progress ERROR:', e.message);
      existing = null;
    }

    const currentStage = existing ? existing.stage : 0;
    let newStage;
    let isCorrect;
    let isWrong;

    if (action === 'mastered') {
      // 熟知：直接跳到已掌握阶段
      newStage = MASTERED_STAGE;
      isCorrect = 1;
      isWrong = 0;
    } else if (action === 'known') {
      isCorrect = 1;
      isWrong = 0;
      if (existing) {
        newStage = Math.min(currentStage + 1, MASTERED_STAGE);
      } else {
        newStage = 1;
        this.dailyNewWordsCount++;
      }
    } else {
      // unknown / fuzzy：回退1个阶段，保留在原来阶段附近
      isCorrect = 0;
      isWrong = 1;
      if (existing) {
        newStage = Math.max(0, currentStage - 1);
      } else {
        newStage = 0;
        this.dailyNewWordsCount++;
      }
    }

    const nextInterval = STAGE_INTERVALS[newStage];
    const nextReviewAt = Date.now() + (typeof nextInterval === 'number' && isFinite(nextInterval) ? nextInterval : 0);

    try {
      db.prepare(`
        INSERT INTO progress (word_id, stage, next_review_at, last_review_at, correct_count, wrong_count)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(word_id) DO UPDATE SET
          stage = excluded.stage,
          next_review_at = excluded.next_review_at,
          last_review_at = excluded.last_review_at,
          correct_count = progress.correct_count + excluded.correct_count,
          wrong_count = progress.wrong_count + excluded.wrong_count
      `).run(word.id, newStage, nextReviewAt, Date.now(), isCorrect, isWrong);

      db.prepare(`
        INSERT INTO daily_stats (date, words_reviewed, words_learned)
        VALUES (date('now', 'localtime'), 1, ?)
        ON CONFLICT(date) DO UPDATE SET
          words_reviewed = words_reviewed + 1,
          words_learned = words_learned + excluded.words_learned
      `).run(existing ? 0 : 1);
    } catch (e) {
      console.error('[Scheduler] _updateProgress DB ERROR:', e.message);
    }

    console.log('[Scheduler] Progress:', word.word, '| action:', action,
      '| stage:', currentStage, '→', newStage,
      '| nextReview:', new Date(nextReviewAt).toISOString());
  }

  _advanceToNext() {
    this.currentWord = null;
    if (this._onStatsUpdate) {
      try { this._onStatsUpdate(); } catch (e) {}
    }
    this.nextPopupTimer = setTimeout(() => this._popNext(), 300);
  }

  _checkDateChange() {
    const now = new Date();
    const today = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');
    if (this._lastDate && this._lastDate !== today) {
      console.log('[Scheduler] Date changed:', this._lastDate, '→', today);
      this.dailyNewWordsCount = 0;
    }
    this._lastDate = today;
  }

  _resetDailyCountIfNeeded() {
    try {
      const db = getDb();
      const todayStats = db.prepare(
        "SELECT words_learned FROM daily_stats WHERE date = date('now', 'localtime')"
      ).get();
      this.dailyNewWordsCount = todayStats ? (todayStats.words_learned || 0) : 0;
    } catch (e) {
      console.error('[Scheduler] _resetDailyCount ERROR:', e.message);
      this.dailyNewWordsCount = 0;
    }
    this._lastDate = new Date().getFullYear() + '-' +
      String(new Date().getMonth() + 1).padStart(2, '0') + '-' +
      String(new Date().getDate()).padStart(2, '0');
    console.log('[Scheduler] Daily count reset | today learned:', this.dailyNewWordsCount);
  }

  applyConfig(config) {
    if (config && config.dailyNewWords !== undefined) {
      this.dailyNewWordsLimit = config.dailyNewWords;
      console.log('[Scheduler] Daily new words limit updated to:', this.dailyNewWordsLimit);
      this.reloadQueue();
    }
  }

  getStatus() {
    return {
      isPaused: this.isPaused,
      queueSize: this.queue.length,
      currentWord: this.currentWord ? this.currentWord.word : null,
      dailyNewWordsCount: this.dailyNewWordsCount,
      dailyNewWordsLimit: this.dailyNewWordsLimit
    };
  }

  onStatsUpdate(callback) {
    this._onStatsUpdate = callback;
  }
}

const scheduler = new Scheduler();
module.exports = scheduler;
