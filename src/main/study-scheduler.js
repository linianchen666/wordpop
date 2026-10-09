const { EventEmitter } = require('events');
const { selectedWordlists, localDateKey, endOfDay, batchSettings, calculateDailyQuota } = require('./study-policy');

/** Learning-session orchestration. No Electron, window management or SQL. */
class StudyScheduler extends EventEmitter {
  constructor({ repository, getConfig, recordReview, now = () => Date.now(),
    setTimeout: schedule = setTimeout, clearTimeout: cancel = clearTimeout, logger = console }) {
    super();
    this.repository = repository;
    this.getConfig = getConfig;
    this.recordReview = recordReview;
    this.now = now;
    this.schedule = schedule;
    this.cancel = cancel;
    this.logger = logger;
    this.queue = [];
    this.currentWord = null;
    this.nextPopupTimer = null;
    this.isPaused = false;
    this.dailyNewWordsLimit = 20;
    this.dailyNewWordsCount = 0;
    this.currentBatchCount = 0;
    this._lastDate = null;
    this._undoInfo = null;
    this._onStatsUpdate = null;
    this._onWordPop = null;
  }

  _clearTimer() {
    if (this.nextPopupTimer !== null) this.cancel(this.nextPopupTimer);
    this.nextPopupTimer = null;
  }

  _scheduleNext(delay, callback = () => this._popNext()) {
    this._clearTimer();
    this.nextPopupTimer = this.schedule(() => {
      this.nextPopupTimer = null;
      callback();
    }, delay);
  }

  _notifyStats() {
    this.emit('stats-updated');
    if (this._onStatsUpdate) {
      try { this._onStatsUpdate(); } catch (error) { this.logger.error('[Scheduler] stats callback:', error.message); }
    }
  }

  start() {
    this._clearTimer();
    this.isPaused = false;
    this._resetDailyCountIfNeeded();
    this._popNext();
  }

  stop() {
    this._clearTimer();
    this.queue = [];
    this.currentWord = null;
  }

  pause() {
    this.isPaused = true;
    this._clearTimer();
    this.emit('paused');
  }

  resume() {
    this.isPaused = false;
    this.reloadQueue();
    if (this.currentWord || this.queue.length) {
      this.emit('resumed');
      this._popNext();
    } else {
      this._scheduleNext(10000, () => {
        this.reloadQueue();
        if (this.queue.length) {
          this.emit('resumed');
          this._popNext();
        } else {
          this._scheduleNext(30000);
        }
      });
    }
  }

  _popNext() {
    if (this.isPaused || this.currentWord) return;
    this._checkDateChange();
    this.reloadQueue();
    const word = this.queue.shift();
    if (word) {
      this.currentWord = word;
      this._showWord(word);
    } else {
      this.emit('idle');
      this._notifyStats();
      this._scheduleNext(30000);
    }
  }

  _showWord(word) {
    this.emit('word', { word, queueRemaining: this.queue.length, batchCount: this.currentBatchCount });
    if (this._onWordPop) {
      try { this._onWordPop(); } catch (error) { this.logger.error('[Scheduler] word callback:', error.message); }
    }
  }

  getDynamicQuotaInfo() {
    try {
      const config = this.getConfig();
      const wordlists = selectedWordlists(config);
      return calculateDailyQuota(config, {
        unlearnedCount: this.repository.countUnlearned(wordlists),
        dueCount: this.repository.countDue(wordlists, this.now())
      }, this.now());
    } catch (error) {
      this.logger.error('[Scheduler] quota:', error.message);
      return { effectiveLimit: 20, baseLimit: 20, mode: 'fixed', dueCount: 0,
        loadState: 'normal', reason: '默认设置' };
    }
  }

  reloadQueue() {
    try {
      const wordlists = selectedWordlists(this.getConfig());
      this._resetDailyCountIfNeeded();
      this.dailyNewWordsLimit = this.getDynamicQuotaInfo().effectiveLimit;
      const due = this.repository.getDueWords(wordlists, this.now(), 30);
      const remaining = Math.max(0, this.dailyNewWordsLimit - this.dailyNewWordsCount);
      this.queue = [...due, ...this.repository.getNewWords(wordlists, remaining)];
    } catch (error) {
      this.logger.error('[Scheduler] reloadQueue:', error.message);
      this.queue = [];
    }
  }

  _submit(action) {
    if (!this.currentWord) return;
    try {
      this._updateProgress(action);
      this._advanceToNext();
    } catch (error) {
      // Keep the word available for retry; a failed write is not a review.
      this.logger.error('[Scheduler] review:', error.message);
      this.emit('review-failed', { word: this.currentWord, action, error,
        queueRemaining: this.queue.length, batchCount: this.currentBatchCount });
    }
  }

  markKnown() { this._submit('known'); }
  markUnknown() { this._submit('unknown'); }
  markFuzzy() { this._submit('fuzzy'); }
  markEasy() { this._submit('easy'); }
  markMastered() { this.markEasy(); }

  _updateProgress(action) {
    const word = this.currentWord;
    if (!word) return;
    const result = this.recordReview(word.id, action, this.now());
    this._undoInfo = { word: { ...word }, oldProgress: result.previous ? { ...result.previous } : null,
      action, reviewLogId: result.reviewLogId, wasNewWord: result.wasNewWord };
    if (result.wasNewWord) this.dailyNewWordsCount++;
  }

  _advanceToNext() {
    this.currentWord = null;
    this._notifyStats();
    this.currentBatchCount++;
    const { batchSize, cooldownMinutes } = batchSettings(this.getConfig());
    if (batchSize > 0 && this.currentBatchCount >= batchSize) {
      this.currentBatchCount = 0;
      this.emit('batch-complete', { batchSize, cooldownMinutes, queueRemaining: this.queue.length });
      this._scheduleNext(Math.max(1000, cooldownMinutes * 60 * 1000));
    } else {
      this._scheduleNext(300);
    }
  }

  triggerNextBatchNow() {
    this._clearTimer();
    this.currentBatchCount = 0;
    this._popNext();
  }

  undo() {
    if (!this._undoInfo) return false;
    const info = this._undoInfo;
    try {
      if (!this.repository.undoReview(info)) {
        this._undoInfo = null;
        return false;
      }
    } catch (error) {
      this.logger.error('[Scheduler] undo:', error.message);
      return false;
    }
    this._clearTimer();
    this._resetDailyCountIfNeeded();
    this._undoInfo = null;
    this.currentWord = info.word;
    this._showWord(info.word);
    return true;
  }

  canUndo() { return this._undoInfo !== null; }

  _checkDateChange() {
    const today = localDateKey(this.now());
    if (this._lastDate && this._lastDate !== today) this.dailyNewWordsCount = 0;
    this._lastDate = today;
  }

  _resetDailyCountIfNeeded() {
    try { this.dailyNewWordsCount = this.repository.getDailyLearned(this.now()); }
    catch (error) {
      this.logger.error('[Scheduler] daily count:', error.message);
      this.dailyNewWordsCount = 0;
    }
    this._lastDate = localDateKey(this.now());
  }

  applyConfig(config) { if (config) this.reloadQueue(); }
  hasNewWordsQuotaToday() { return this.dailyNewWordsCount < this.dailyNewWordsLimit; }

  getNextReviewTime() {
    try {
      const wordlists = selectedWordlists(this.getConfig());
      return this.repository.getNextReviewTime(wordlists) ||
        (this.hasNewWordsQuotaToday() && this.repository.hasNewWords(wordlists) ? this.now() : null);
    } catch (error) {
      this.logger.error('[Scheduler] next review:', error.message);
      return null;
    }
  }

  hasUnmasteredWords() {
    try { return this.repository.hasUnmasteredWords(selectedWordlists(this.getConfig())); }
    catch (_) { return false; }
  }

  getStatus() {
    this._resetDailyCountIfNeeded();
    const quotaInfo = this.getDynamicQuotaInfo();
    this.dailyNewWordsLimit = quotaInfo.effectiveLimit;
    let todayDueCount = 0;
    try { todayDueCount = this.repository.countDue(selectedWordlists(this.getConfig()), endOfDay(this.now())); }
    catch (error) { this.logger.error('[Scheduler] today due:', error.message); }
    return { isPaused: this.isPaused, queueSize: this.queue.length,
      currentWord: this.currentWord ? this.currentWord.word : null,
      dailyNewWordsCount: this.dailyNewWordsCount, dailyNewWordsLimit: this.dailyNewWordsLimit,
      nextReviewAt: this.currentWord ? this.now() : this.getNextReviewTime(),
      hasNewWordsQuota: this.hasNewWordsQuotaToday(), hasUnmasteredWords: this.hasUnmasteredWords(),
      todayDueCount, todayNewRemaining: Math.max(0, this.dailyNewWordsLimit - this.dailyNewWordsCount), quotaInfo };
  }

  onStatsUpdate(callback) { this._onStatsUpdate = callback; }
  onWordPop(callback) { this._onWordPop = callback; }
}

function createScheduler(dependencies) { return new StudyScheduler(dependencies); }
module.exports = { StudyScheduler, createScheduler };
