const { calculateReview, cardForProgress } = require('./review-algorithm');

// Read the current persisted card each time. Previewing never records a review,
// initializes a legacy row, or increments statistics.
function getReviewPreview(db, wordId, now = Date.now()) {
  if (!Number.isInteger(wordId) || wordId <= 0) throw new Error('Invalid word ID');
  const row = db.prepare(`SELECT p.* FROM words w
    LEFT JOIN progress p ON p.word_id = w.id WHERE w.id = ?`).get(wordId);
  if (!row) throw new Error('Word not found');
  const existing = row.word_id == null ? null : row;
  const card = cardForProgress(existing, now);
  const intervals = {};
  for (const action of ['unknown', 'fuzzy', 'known', 'easy']) {
    const result = calculateReview(existing, action, now);
    intervals[action] = { interval: result.interval, dueAt: result.next_review_at };
  }
  return { success: true, wordId, generatedAt: now,
    state: existing?.stage >= 9 ? 'mastered' : ['new', 'learning', 'review', 'relearning'][card.state],
    dueAt: existing?.next_review_at || null, intervals };
}

module.exports = { getReviewPreview };
