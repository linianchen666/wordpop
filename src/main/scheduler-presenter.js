const { batchSettings } = require('./study-policy');

/** Translate learning events to the existing popup API. */
function attachSchedulerPresenter(scheduler, { popupManager, analyzeWord, getConfig, logger = console }) {
  const safely = callback => payload => {
    try { callback(payload); } catch (error) { logger.error('[SchedulerPresenter]', error.message); }
  };
  const presentWord = safely(({ word, queueRemaining, batchCount }) => {
    let etymology = null;
    try { etymology = analyzeWord(word.word); } catch (error) { logger.error('[SchedulerPresenter] etymology:', error.message); }
    const { batchSize, cooldownMinutes } = batchSettings(getConfig());
    popupManager.show({
      id: word.id, word: word.word, phonetic: word.phonetic || '',
      translation: word.translation || '', example: word.example || '',
      isNew: word.stage === undefined || word.stage === 0,
      progress: word.stage !== undefined && word.stage !== null
        ? { stage: word.stage, total: 9, correct: word.correct_count || 0, wrong: word.wrong_count || 0 } : null,
      queueRemaining, etymology, batchIndex: (batchCount % (batchSize || 1)) + 1,
      batchSize, cooldownMinutes
    });
  });
  const listeners = {
    word: presentWord,
    // The renderer clears its submitted word; send it again to allow retry.
    'review-failed': presentWord,
    paused: safely(() => popupManager.hide()),
    resumed: safely(() => popupManager.restore()),
    idle: safely(() => { if (popupManager.isVisible()) popupManager.hide(); }),
    'batch-complete': safely(summary => popupManager.showBatchCompletion(summary))
  };
  for (const [event, listener] of Object.entries(listeners)) scheduler.on(event, listener);
  return () => {
    for (const [event, listener] of Object.entries(listeners)) scheduler.off(event, listener);
  };
}

module.exports = { attachSchedulerPresenter };
