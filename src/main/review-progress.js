const { calculateReview } = require('./review-algorithm');

/** Shared transactional persistence for popup and focus reviews. */
function recordReview(db, wordId, action, now = Date.now()) {
  return db.transaction(() => {
    const previous = db.prepare('SELECT * FROM progress WHERE word_id = ?').get(wordId);
    const progress = calculateReview(previous, action, now);
    db.prepare(`
      INSERT INTO progress (word_id, stage, next_review_at, last_review_at,
        correct_count, wrong_count, mastered_count, efactor, interval, repetitions, fsrs_card)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(word_id) DO UPDATE SET
        stage = excluded.stage,
        next_review_at = excluded.next_review_at,
        last_review_at = excluded.last_review_at,
        correct_count = progress.correct_count + excluded.correct_count,
        wrong_count = progress.wrong_count + excluded.wrong_count,
        mastered_count = excluded.mastered_count,
        efactor = excluded.efactor,
        interval = excluded.interval,
        repetitions = excluded.repetitions,
        fsrs_card = excluded.fsrs_card
    `).run(wordId, progress.stage, progress.next_review_at, progress.last_review_at,
      progress.correct_count, progress.wrong_count, progress.mastered_count,
      progress.efactor, progress.interval, progress.repetitions, progress.fsrs_card);
    const history = db.prepare(`
      INSERT INTO review_history (word_id, reviewed_at, rating, card_before, card_after, log)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(wordId, now, progress.rating, progress.fsrs_before, progress.fsrs_card, progress.fsrs_log);
    db.prepare(`
      INSERT INTO daily_stats (date, words_reviewed, words_learned)
      VALUES (date(?, 'unixepoch', 'localtime'), 1, ?)
      ON CONFLICT(date) DO UPDATE SET
        words_reviewed = words_reviewed + 1,
        words_learned = words_learned + excluded.words_learned
    `).run(now / 1000, previous ? 0 : 1);
    return { previous, progress, wasNewWord: !previous, reviewLogId: history.lastInsertRowid };
  })();
}

module.exports = { recordReview };
