/** Ensure FSRS state and history atomically, including incomplete old upgrades. */
function migrateFsrs(db) {
  db.transaction(() => {
    const columns = db.prepare("PRAGMA table_info('progress')").all();
    if (!columns.some(column => column.name === 'fsrs_card')) {
      db.exec('ALTER TABLE progress ADD COLUMN fsrs_card TEXT DEFAULT NULL');
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS review_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
        reviewed_at INTEGER NOT NULL,
        rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
        card_before TEXT NOT NULL,
        card_after TEXT NOT NULL,
        log TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_review_history_word ON review_history(word_id, reviewed_at);
    `);
    // Do not downgrade v8 and repeat its one-time memory upgrade during repair.
    if (db.pragma('user_version', { simple: true }) < 7) {
      db.pragma('user_version = 7');
    }
  })();
}

module.exports = { migrateFsrs };
