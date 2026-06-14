const { getDb } = require('./db');
const { getConfig } = require('./config');
const popupManager = require('./popup-manager');

/**
 * 艾宾浩斯调度引擎
 *
 * 9 阶段间隔：
 *   Stage 0: 新词（立即展示）
 *   Stage 1: 5 分钟
 *   Stage 2: 30 分钟
 *   Stage 3: 12 小时
 *   Stage 4: 1 天
 *   Stage 5: 2 天
 *   Stage 6: 4 天
 *   Stage 7: 7 天
 *   Stage 8: 15 天
 *   Stage 9: 已掌握（不再推送）
 */

const STAGE_INTERVALS = [
  0,                    // Stage 0: 新词，立即推送
  5 * 60 * 1000,        // Stage 1: 5 分钟
  30 * 60 * 1000,       // Stage 2: 30 分钟
  12 * 3600 * 1000,     // Stage 3: 12 小时
  24 * 3600 * 1000,     // Stage 4: 1 天
  2 * 86400 * 1000,     // Stage 5: 2 天
  4 * 86400 * 1000,     // Stage 6: 4 天
  7 * 86400 * 1000,     // Stage 7: 7 天
  15 * 86400 * 1000,    // Stage 8: 15 天
  Infinity              // Stage 9: 已掌握
];

const MAX_STAGE = 9;

class Scheduler {
  constructor() {
    this.queue = [];
    this.currentWord = null;
    this.nextPopupTimer = null;
    this.isPaused = false;
    this.dailyNewWordsLimit = 20;
    this.dailyNewWordsCount = 0;
    this.popupInterval = 300000; // 默认 5 分钟
    this._onStatsUpdate = null;
  }

  /**
   * 启动调度器
   */
  start() {
    const config = getConfig();
    this.dailyNewWordsLimit = config.dailyNewWords || 20;
    this.popupInterval = config.popupInterval || 300000;

    this._resetDailyCountIfNeeded();
    this.reloadQueue();

    console.log('[Scheduler] Started | daily limit:', this.dailyNewWordsLimit,
      '| interval:', this.popupInterval, 'ms',
      '| queue size:', this.queue.length);

    // 立即弹出第一个单词（如果有的话）
    this._popNext();
  }

  /**
   * 停止调度器
   */
  stop() {
    if (this.nextPopupTimer) {
      clearTimeout(this.nextPopupTimer);
      this.nextPopupTimer = null;
    }
    this.queue = [];
    this.currentWord = null;
    console.log('[Scheduler] Stopped');
  }

  /**
   * 暂停推送
   */
  pause() {
    this.isPaused = true;
    if (this.nextPopupTimer) {
      clearTimeout(this.nextPopupTimer);
      this.nextPopupTimer = null;
    }
    if (this.currentWord) {
      popupManager.hide();
    }
    console.log('[Scheduler] Paused');
  }

  /**
   * 恢复推送
   */
  resume() {
    this.isPaused = false;
    this.reloadQueue();
    console.log('[Scheduler] Resumed | queue size:', this.queue.length);
    // 立即弹出下一个
    this._popNext();
  }

  /**
   * 弹出下一个单词
   */
  _popNext() {
    if (this.isPaused) return;
    if (this.currentWord) return;

    // 如果队列空了，重新加载
    if (this.queue.length === 0) {
      this.reloadQueue();
    }

    const word = this.queue.shift();
    if (word) {
      this.currentWord = word;
      this._showWord(word);
    } else {
      // 没有单词了，1 分钟后重试
      console.log('[Scheduler] No words available, retrying in 60s');
      this.nextPopupTimer = setTimeout(() => this._popNext(), 60000);
    }
  }

  /**
   * 显示单词
   */
  _showWord(word) {
    const progress = word.stage !== undefined ? {
      stage: word.stage,
      total: MAX_STAGE,
      correct: word.correct_count || 0,
      wrong: word.wrong_count || 0
    } : null;

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
  }

  /**
   * 重新加载队列
   */
  reloadQueue() {
    const db = getDb();
    const now = Date.now();

    const dueReviews = db.prepare(`
      SELECT w.id, w.word, w.phonetic, w.translation, w.example,
             p.stage, p.next_review_at, p.correct_count, p.wrong_count
      FROM words w
      JOIN progress p ON w.id = p.word_id
      WHERE p.next_review_at <= ? AND p.stage < ?
      ORDER BY p.next_review_at ASC
      LIMIT 200
    `).all(now, MAX_STAGE);

    const remaining = Math.max(0, this.dailyNewWordsLimit - this.dailyNewWordsCount);
    let newWords = [];
    if (remaining > 0) {
      newWords = db.prepare(`
        SELECT w.id, w.word, w.phonetic, w.translation, w.example, 0 as stage,
               0 as correct_count, 0 as wrong_count
        FROM words w
        LEFT JOIN progress p ON w.id = p.word_id
        WHERE p.word_id IS NULL
        ORDER BY w.id ASC
        LIMIT ?
      `).all(remaining);
    }

    this.queue = [...dueReviews, ...newWords];

    console.log('[Scheduler] Queue reloaded | due:', dueReviews.length,
      '| new:', newWords.length, '| total:', this.queue.length);
  }

  /**
   * 用户点击「认识」
   */
  markKnown() {
    if (!this.currentWord) return;
    this._updateProgress(true);
    this._advanceToNext();
  }

  /**
   * 用户点击「不认识」
   */
  markUnknown() {
    if (!this.currentWord) return;
    this._updateProgress(false);
    this._advanceToNext();
  }

  /**
   * 更新学习进度
   */
  _updateProgress(known) {
    const db = getDb();
    const word = this.currentWord;
    const existing = db.prepare('SELECT * FROM progress WHERE word_id = ?').get(word.id);

    let newStage;
    const currentStage = existing ? existing.stage : 0;

    if (existing) {
      newStage = known ? Math.min(currentStage + 1, MAX_STAGE) : 0;
    } else {
      newStage = known ? 1 : 0;
      this.dailyNewWordsCount++;
    }

    const nextInterval = STAGE_INTERVALS[newStage] || 0;
    const nextReviewAt = Date.now() + nextInterval;

    db.prepare(`
      INSERT INTO progress (word_id, stage, next_review_at, last_review_at, correct_count, wrong_count)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(word_id) DO UPDATE SET
        stage = excluded.stage,
        next_review_at = excluded.next_review_at,
        last_review_at = excluded.last_review_at,
        correct_count = progress.correct_count + excluded.correct_count,
        wrong_count = progress.wrong_count + excluded.wrong_count
    `).run(word.id, newStage, nextReviewAt, Date.now(),
      known ? 1 : 0, known ? 0 : 1);

    db.prepare(`
      INSERT INTO daily_stats (date, words_reviewed, words_learned)
      VALUES (date('now', 'localtime'), 1, ?)
      ON CONFLICT(date) DO UPDATE SET
        words_reviewed = words_reviewed + 1,
        words_learned = words_learned + excluded.words_learned
    `).run(existing ? 0 : 1);

    console.log('[Scheduler] Word:', word.word,
      '| known:', known,
      '| stage:', currentStage, '\u2192', newStage,
      '| next:', new Date(nextReviewAt).toISOString());
  }

  /**
   * 进入下一个单词（等 popupInterval 后再弹出）
   */
  _advanceToNext() {
    this.currentWord = null;
    popupManager.hide();

    if (this._onStatsUpdate) this._onStatsUpdate();

    // 按配置的间隔弹出下一个
    this.nextPopupTimer = setTimeout(() => this._popNext(), this.popupInterval);
  }

  /**
   * 重置每日新词计数
   */
  _resetDailyCountIfNeeded() {
    const db = getDb();
    const todayStats = db.prepare(
      "SELECT words_learned FROM daily_stats WHERE date = date('now', 'localtime')"
    ).get();

    this.dailyNewWordsCount = todayStats ? (todayStats.words_learned || 0) : 0;
  }

  /**
   * 应用配置变更
   */
  applyConfig(config) {
    if (config.dailyNewWords !== undefined) {
      this.dailyNewWordsLimit = config.dailyNewWords;
    }
    if (config.popupInterval !== undefined) {
      this.popupInterval = config.popupInterval;
    }
    if (config.dailyNewWords !== undefined) {
      this.reloadQueue();
    }
  }

  /**
   * 获取当前状态
   */
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
