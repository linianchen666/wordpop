const { cardForProgress, deserializeCard, calculateReview, stageForInterval, DAY } = require('./review-algorithm');
const { State } = require('ts-fsrs');

/** One atomic startup upgrade. Original progress and rating logs remain recoverable. */
function initializeMemory(db, now = Date.now()) {
  if (db.pragma('user_version', { simple: true }) >= 8) return { updated: 0 };
  return db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS memory_initialization_archive (
      word_id INTEGER PRIMARY KEY, progress_json TEXT NOT NULL, initialized_at INTEGER NOT NULL
    )`);
    const archive = db.prepare('INSERT INTO memory_initialization_archive VALUES (?, ?, ?)');
    const historyFor = db.prepare('SELECT * FROM review_history WHERE word_id=? ORDER BY reviewed_at, id');
    const update = db.prepare(`UPDATE progress SET fsrs_card=?, stage=?, interval=?,
      next_review_at=?, repetitions=? WHERE word_id=?`);
    let updated = 0;
    for (const row of db.prepare('SELECT * FROM progress WHERE stage < 9').all()) {
      archive.run(row.word_id, JSON.stringify(row), now);
      const history = historyFor.all(row.word_id);
      // Replay only a complete, continuous chain ending at the persisted card.
      // Restored/imported snapshots can have an unrelated history: keep their
      // memory state and arrange a near-term assessment instead of guessing.
      const continuous = history.length && row.fsrs_card === history.at(-1).card_after &&
        history.every((h, i) => !i || h.card_before === history[i - 1].card_after);
      let card;
      if (continuous) {
        card = deserializeCard(history[0].card_before);
        if (card.state === State.Review) card.learning_steps = 0;
        for (const h of history) {
          const action = h.rating <= 2 ? 'unknown' : h.rating === 3 ? 'known' : 'easy';
          card = deserializeCard(calculateReview({ fsrs_card: JSON.stringify(card) }, action, h.reviewed_at).fsrs_card);
        }
      } else {
        card = cardForProgress(row, now);
        if (card.state === State.Review) card.learning_steps = 0;
        card.due = new Date(Math.min(card.due.getTime(), now + DAY));
      }
      // Never postpone a word that was already due or brought forward manually.
      if (row.next_review_at > 0) card.due = new Date(Math.min(card.due.getTime(), row.next_review_at));
      const interval = Math.max(0, card.due.getTime() - (card.last_review?.getTime() ?? now));
      update.run(JSON.stringify(card), stageForInterval(interval), interval,
        card.due.getTime(), card.reps, row.word_id);
      updated++;
    }
    db.pragma('user_version = 8');
    return { updated };
  })();
}
module.exports = { initializeMemory };
