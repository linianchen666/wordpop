/** Focus learning business rules, independent of Electron windows. */
function createFocusSession({ repository, recordReview, now = () => Date.now(), logger = console }) {
  return {
    getFocusWords(count = 20, wordlists = ['cet4']) {
      try {
        const dueWords = repository.getDueWords(wordlists, now());
        const targetCount = count > 0 ? count : (dueWords.length || 20);
        const selected = dueWords.slice(0, targetCount);
        const words = [...selected, ...repository.getNewWords(wordlists, targetCount - selected.length)];
        return { success: true, words, totalDue: dueWords.length };
      } catch (error) {
        logger.error('[FocusSession] getFocusWords:', error.message);
        return { success: false, words: [], totalDue: 0, error: error.message };
      }
    },
    submitFocusWord(wordId, action) {
      try {
        const id = Number(wordId);
        if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid word ID');
        const { progress } = recordReview(id, action, now());
        return { success: true, stage: progress.stage, nextReviewAt: progress.next_review_at };
      } catch (error) {
        logger.error('[FocusSession] submitFocusWord:', error.message);
        return { success: false, error: error.message };
      }
    }
  };
}

module.exports = { createFocusSession };
