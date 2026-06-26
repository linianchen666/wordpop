const { getDb } = require('./db');
const { loadConfig } = require('./config');
const popupManager = require('./popup-manager');
const { analyzeWord } = require('./etymology');

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
 * 三种操作：
 *   认识：阶段 +1
 *   模糊：阶段不变，重新进入复习队列
 *   不认识：回退到阶段 1
 *   熟知：跳到 stage 8，连续2次熟知 → 彻底已掌握
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
    this._onWordPop = null;
    this._lastDate = null;
    this._undoInfo = null;
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
    this._popNext();
  }

  stop() {
    if (this.nextPopupTimer) {
      clearTimeout(this.nextPopupTimer);
      this.nextPopupTimer = null;
    }
    this.queue = [];
    this.currentWord = null;
  }

  pause() {
    this.isPaused = true;
    if (this.nextPopupTimer) {
      clearTimeout(this.nextPopupTimer);
      this.nextPopupTimer = null;
    }
    try { popupManager.hide(); } catch (e) {}
  }

  resume() {
    this.isPaused = false;
    this.reloadQueue();

    if (this.queue.length > 0) {
      // 有单词：显示弹窗并弹出下一个
      try { popupManager.restore(); } catch (e) {}
      this._popNext();
    } else {
      // 没有单词：不显示弹窗（避免闪烁），延迟后重试
      this.nextPopupTimer = setTimeout(() => {
        this.reloadQueue();
        if (this.queue.length > 0) {
          try { popupManager.restore(); } catch (e) {}
          this._popNext();
        } else {
          // 仍然没有单词，30秒后再试
          this.nextPopupTimer = setTimeout(() => this._popNext(), 30000);
        }
      }, 10000);
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
    } else {
      // 没有单词了，隐藏弹窗，30秒后重试
      try {
        if (popupManager.isVisible()) {
          popupManager.hide();
        }
      } catch (e) {}
      // 通知托盘更新状态（显示下次复习倒计时）
      if (this._onStatsUpdate) {
        try { this._onStatsUpdate(); } catch (e) {}
      }
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

    // 分析词源（始终提供，即使无精确拆分也有相关词根提示）
    let etymology = null;
    try {
      etymology = analyzeWord(word.word);
    } catch (e) {
      console.error('[Scheduler] analyzeWord error:', e.message);
    }

    try {
      popupManager.show({
        id: word.id,
        word: word.word,
        phonetic: word.phonetic || '',
        translation: word.translation || '',
        example: word.example || '',
        isNew: word.stage === undefined || word.stage === 0,
        progress: progress,
        queueRemaining: this.queue.length,
        etymology: etymology
      });
    } catch (e) {
      console.error('[Scheduler] _showWord ERROR:', e.message);
    }

    // 通知托盘更新状态（显示"正在显示单词"）
    if (this._onWordPop) {
      try { this._onWordPop(); } catch (e) {}
    }
  }

  reloadQueue() {
    try {
      const db = getDb();
      const now = Date.now();
      const config = loadConfig();
      const wordlists = (config && config.selectedWordlists && config.selectedWordlists.length > 0)
        ? config.selectedWordlists
        : ['cet4'];
      const placeholders = wordlists.map(() => '?').join(',');

      // 1. 到期需复习的单词（随机排序）
      const dueReviews = db.prepare(`
        SELECT w.id, w.word, w.phonetic, w.translation, w.example,
               p.stage, p.next_review_at, p.correct_count, p.wrong_count,
               p.efactor, p.interval, p.repetitions
        FROM words w
        JOIN progress p ON w.id = p.word_id
        WHERE p.next_review_at <= ? AND p.stage < ?
          AND w.wordlist IN (${placeholders})
        LIMIT 200
      `).all(now, MASTERED_STAGE, ...wordlists);

      // 2. 今日配额内的新词
      const remaining = Math.max(0, this.dailyNewWordsLimit - this.dailyNewWordsCount);
      let newWords = [];
      if (remaining > 0) {
        newWords = db.prepare(`
          SELECT w.id, w.word, w.phonetic, w.translation, w.example, 0 as stage,
                 0 as correct_count, 0 as wrong_count, 2.5 as efactor, 0 as interval, 0 as repetitions
          FROM words w
          LEFT JOIN progress p ON w.id = p.word_id
          WHERE p.word_id IS NULL
            AND w.wordlist IN (${placeholders})
          ORDER BY w.frequency_rank ASC, w.id ASC
          LIMIT ?
        `).all(...wordlists, remaining);
      }

      this.queue = [...shuffleArray(dueReviews), ...newWords];
    } catch (e) {
      console.error('[Scheduler] reloadQueue ERROR:', e.message);
      this.queue = [];
    }
  }

  markKnown() {
    if (!this.currentWord) return;
    try {
      this._updateProgress('known');
      this._advanceToNext();
    } catch (e) {
      console.error('[Scheduler] markKnown ERROR:', e.message);
      this.currentWord = null;
      this.nextPopupTimer = setTimeout(() => this._popNext(), 500);
    }
  }

  markUnknown() {
    if (!this.currentWord) return;
    try {
      this._updateProgress('unknown');
      this._advanceToNext();
    } catch (e) {
      console.error('[Scheduler] markUnknown ERROR:', e.message);
      this.currentWord = null;
      this.nextPopupTimer = setTimeout(() => this._popNext(), 500);
    }
  }

  markFuzzy() {
    if (!this.currentWord) return;
    try {
      this._updateProgress('fuzzy');
      this._advanceToNext();
    } catch (e) {
      console.error('[Scheduler] markFuzzy ERROR:', e.message);
      this.currentWord = null;
      this.nextPopupTimer = setTimeout(() => this._popNext(), 500);
    }
  }

  markMastered() {
    if (!this.currentWord) return;
    try {
      this._updateProgress('mastered');
      this._advanceToNext();
    } catch (e) {
      console.error('[Scheduler] markMastered ERROR:', e.message);
      this.currentWord = null;
      this.nextPopupTimer = setTimeout(() => this._popNext(), 500);
    }
  }

  /**
   * 更新单词学习进度
   * @param {'known'|'unknown'|'fuzzy'|'mastered'} action
   * 
   * 三种操作的行为：
   *   known    → 阶段 +1
   *   fuzzy    → 阶段不变，按当前阶段间隔重新进入复习队列
   *   unknown  → 回退到阶段 1
   *   mastered → 跳到 stage 8，连续2次熟知 → 彻底已掌握(stage 9)
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

    // 保存撤销信息（在修改数据库之前）
    this._undoInfo = {
      word: { ...word },
      oldProgress: existing ? { ...existing } : null,
      action: action,
      wasNewWord: !existing
    };

    let q;
    if (action === 'mastered') q = 5;
    else if (action === 'known') q = 4;
    else if (action === 'fuzzy') q = 3;
    else q = 0; // unknown

    let currentEfactor = existing ? (existing.efactor || 2.5) : 2.5;
    let currentRepetitions = existing ? (existing.repetitions || 0) : 0;
    let currentInterval = existing ? (existing.interval || 0) : 0;

    let newEfactor = currentEfactor;
    let newRepetitions = currentRepetitions;
    let newInterval = currentInterval;

    let isCorrect = q >= 3 ? 1 : 0;
    let isWrong = q < 3 ? 1 : 0;

    if (q >= 3) {
      // 答对 (认识/模糊/熟知)
      if (currentRepetitions === 0) {
        if (q === 5) {
          // 熟知：直接15天
          newInterval = 15 * 86400 * 1000;
          newRepetitions = 2;
          newEfactor = 2.7;
        } else {
          // 认识 / 模糊: 5分钟
          newInterval = 5 * 60 * 1000;
          newRepetitions = 1;
        }
      } else if (currentRepetitions === 1) {
        newInterval = 30 * 60 * 1000;
        newRepetitions = 2;
      } else if (currentRepetitions === 2) {
        newInterval = 4 * 3600 * 1000; // 4小时
        newRepetitions = 3;
      } else if (currentRepetitions === 3) {
        newInterval = 24 * 3600 * 1000; // 1天
        newRepetitions = 4;
      } else if (currentRepetitions === 4) {
        newInterval = 2 * 86400 * 1000; // 2天
        newRepetitions = 5;
      } else {
        newInterval = Math.round(currentInterval * currentEfactor);
        newRepetitions = currentRepetitions + 1;
      }

      // 更新 E-Factor
      newEfactor = currentEfactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
      newEfactor = Math.max(1.3, newEfactor);
    } else {
      // 答错 (不认识)
      newRepetitions = 0;
      newInterval = 5 * 60 * 1000; // 5分钟后重新确认
      newEfactor = Math.max(1.3, currentEfactor - 0.2);
    }

    // 限制最大间隔为 90 天
    const maxInterval = 90 * 86400 * 1000;
    if (newInterval > maxInterval) {
      newInterval = maxInterval;
    }

    // 映射回一个平滑的虚拟 stage (用于界面上的进度条展示，0-9)
    let newStage = 0;
    if (newInterval >= 90 * 86400 * 1000) newStage = 9;
    else if (newInterval >= 15 * 86400 * 1000) newStage = 8;
    else if (newInterval >= 7 * 86400 * 1000) newStage = 7;
    else if (newInterval >= 4 * 86400 * 1000) newStage = 6;
    else if (newInterval >= 2 * 86400 * 1000) newStage = 5;
    else if (newInterval >= 24 * 3600 * 1000) newStage = 4;
    else if (newInterval >= 4 * 3600 * 1000) newStage = 3;
    else if (newInterval >= 30 * 60 * 1000) newStage = 2;
    else if (newInterval >= 5 * 60 * 1000) newStage = 1;

    if (q < 3 && existing) {
      newStage = 1;
    }

    if (!existing) {
      this.dailyNewWordsCount++;
    }

    const nextReviewAt = Date.now() + newInterval;

    try {
      db.prepare(`
        INSERT INTO progress (word_id, stage, next_review_at, last_review_at, correct_count, wrong_count, mastered_count, efactor, interval, repetitions)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(word_id) DO UPDATE SET
          stage = excluded.stage,
          next_review_at = excluded.next_review_at,
          last_review_at = excluded.last_review_at,
          correct_count = progress.correct_count + excluded.correct_count,
          wrong_count = progress.wrong_count + excluded.wrong_count,
          mastered_count = excluded.mastered_count,
          efactor = excluded.efactor,
          interval = excluded.interval,
          repetitions = excluded.repetitions
      `).run(word.id, newStage, nextReviewAt, Date.now(), isCorrect, isWrong, 0, newEfactor, newInterval, newRepetitions);

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
  }

  _advanceToNext() {
    this.currentWord = null;
    if (this._onStatsUpdate) {
      try { this._onStatsUpdate(); } catch (e) {}
    }
    this.nextPopupTimer = setTimeout(() => this._popNext(), 300);
  }

  /**
   * 撤销上一次操作，恢复单词进度
   * @returns {boolean} 是否成功撤销
   */
  undo() {
    if (!this._undoInfo) return false;

    const { word, oldProgress, action, wasNewWord } = this._undoInfo;
    const db = getDb();

    // 如果下一个单词已经弹出，将其放回队列头部
    if (this.currentWord && this.currentWord.id !== word.id) {
      this.queue.unshift(this.currentWord);
    }

    // 取消待弹出的下一个单词
    if (this.nextPopupTimer) {
      clearTimeout(this.nextPopupTimer);
      this.nextPopupTimer = null;
    }

    try {
      if (wasNewWord) {
        // 新词：删除刚插入的 progress 记录
        db.prepare('DELETE FROM progress WHERE word_id = ?').run(word.id);
      } else {
        // 已学词：恢复旧值
        db.prepare(`
          UPDATE progress SET
            stage = ?,
            next_review_at = ?,
            last_review_at = ?,
            correct_count = ?,
            wrong_count = ?,
            mastered_count = ?,
            efactor = ?,
            interval = ?,
            repetitions = ?
          WHERE word_id = ?
        `).run(
          oldProgress.stage,
          oldProgress.next_review_at,
          oldProgress.last_review_at,
          oldProgress.correct_count,
          oldProgress.wrong_count,
          oldProgress.mastered_count,
          oldProgress.efactor,
          oldProgress.interval,
          oldProgress.repetitions,
          word.id
        );
      }

      // 回退今日统计
      const wordsLearnedDelta = wasNewWord ? 1 : 0;
      db.prepare(`
        UPDATE daily_stats SET
          words_reviewed = MAX(words_reviewed - 1, 0),
          words_learned = MAX(words_learned - ?, 0)
        WHERE date = date('now', 'localtime')
      `).run(wordsLearnedDelta);

      // 回退今日新词计数
      if (wasNewWord) {
        this.dailyNewWordsCount = Math.max(0, this.dailyNewWordsCount - 1);
      }
    } catch (e) {
      console.error('[Scheduler] undo DB ERROR:', e.message);
      return false;
    }

    // 清除撤销信息
    this._undoInfo = null;

    // 重新显示该单词
    this.currentWord = word;
    this._showWord(word);

    return true;
  }

  canUndo() {
    return this._undoInfo !== null;
  }

  _checkDateChange() {
    const now = new Date();
    const today = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');
    if (this._lastDate && this._lastDate !== today) {
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
  }

  applyConfig(config) {
    if (!config) return;
    let needReload = false;

    if (config.dailyNewWords !== undefined) {
      this.dailyNewWordsLimit = config.dailyNewWords;
      needReload = true;
    }

    if (config.selectedWordlists !== undefined) {
      needReload = true;
    }

    if (needReload) {
      this.reloadQueue();
    }
  }

  /**
   * 获取下一个到期单词的复习时间
   * @returns {number|null} 下次弹窗的时间戳（ms），null 表示没有待复习单词
   */
  getNextReviewTime() {
    try {
      const db = getDb();
      const config = loadConfig();
      const wordlists = (config && config.selectedWordlists && config.selectedWordlists.length > 0)
        ? config.selectedWordlists
        : ['cet4'];
      const placeholders = wordlists.map(() => '?').join(',');

      const row = db.prepare(`
        SELECT MIN(p.next_review_at) as next_at
        FROM progress p
        JOIN words w ON p.word_id = w.id
        WHERE p.stage < ? AND p.next_review_at > 0
          AND w.wordlist IN (${placeholders})
      `).get(MASTERED_STAGE, ...wordlists);

      if (row && row.next_at) return row.next_at;

      // 没有待复习的单词，但有新词配额且还有未学单词 → 返回当前时间表示很快会弹出
      if (this.hasNewWordsQuotaToday()) {
        const unlearned = db.prepare(`
          SELECT COUNT(*) c
          FROM words w
          LEFT JOIN progress p ON w.id = p.word_id
          WHERE p.word_id IS NULL AND w.wordlist IN (${placeholders})
        `).get(...wordlists);
        if (unlearned && unlearned.c > 0) return Date.now();
      }

      return null;
    } catch (e) {
      console.error('[Scheduler] getNextReviewTime error:', e.message);
      return null;
    }
  }

  /**
   * 判断今天是否还有新词配额
   */
  hasNewWordsQuotaToday() {
    return this.dailyNewWordsCount < this.dailyNewWordsLimit;
  }

  /**
   * 判断是否还有未掌握的单词可以学
   */
  hasUnmasteredWords() {
    try {
      const db = getDb();
      const config = loadConfig();
      const wordlists = (config && config.selectedWordlists && config.selectedWordlists.length > 0)
        ? config.selectedWordlists
        : ['cet4'];
      const placeholders = wordlists.map(() => '?').join(',');

      // 选中的词库中，已学习但未掌握的词 (stage < 9)
      const learningRow = db.prepare(`
        SELECT COUNT(*) c FROM progress p
        JOIN words w ON p.word_id = w.id
        WHERE p.stage < ? AND w.wordlist IN (${placeholders})
      `).get(MASTERED_STAGE, ...wordlists);

      // 选中的词库中，总词数
      const totalWords = db.prepare(`
        SELECT COUNT(*) c FROM words w
        WHERE w.wordlist IN (${placeholders})
      `).get(...wordlists).c;

      // 选中的词库中，已开始学习的词
      const masteredOrLearning = db.prepare(`
        SELECT COUNT(*) c FROM progress p
        JOIN words w ON p.word_id = w.id
        WHERE w.wordlist IN (${placeholders})
      `).get(...wordlists).c;

      return (learningRow.c > 0) || (totalWords > masteredOrLearning);
    } catch (e) {
      return false;
    }
  }

  getStatus() {
    return {
      isPaused: this.isPaused,
      queueSize: this.queue.length,
      currentWord: this.currentWord ? this.currentWord.word : null,
      dailyNewWordsCount: this.dailyNewWordsCount,
      dailyNewWordsLimit: this.dailyNewWordsLimit,
      nextReviewAt: this.currentWord ? Date.now() : this.getNextReviewTime(),
      hasNewWordsQuota: this.hasNewWordsQuotaToday(),
      hasUnmasteredWords: this.hasUnmasteredWords()
    };
  }

  onStatsUpdate(callback) {
    this._onStatsUpdate = callback;
  }

  onWordPop(callback) {
    this._onWordPop = callback;
  }
}

const scheduler = new Scheduler();
module.exports = scheduler;
