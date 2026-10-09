/** Passive reminders use existing progress; selecting words never schedules reviews. */
function getAmbientWords(db, wordlists) {
  const lists = [...new Set(wordlists || [])];
  if (!lists.length) return [];
  return db.prepare(`
    WITH candidates AS (
      SELECT w.id, w.word, w.translation, p.wrong_count, p.correct_count,
        p.last_review_at,
        CAST(p.wrong_count AS REAL) / MAX(1, p.wrong_count + p.correct_count) AS error_rate,
        (SELECT h.rating FROM review_history h WHERE h.word_id = w.id
          ORDER BY h.reviewed_at DESC, h.id DESC LIMIT 1) AS latest_rating
      FROM words w JOIN progress p ON p.word_id = w.id
      WHERE p.stage < 9 AND w.id IN (
        SELECT word_id FROM word_wordlists WHERE wordlist IN (${lists.map(() => '?').join(',')})
      )
    )
    SELECT * FROM candidates
    WHERE latest_rating = 1 OR (wrong_count >= 3 AND error_rate >= 0.4)
    ORDER BY CASE WHEN latest_rating = 1 THEN 1 ELSE 0 END DESC, error_rate DESC, wrong_count DESC,
      last_review_at DESC, id ASC
    LIMIT 30
  `).all(...lists);
}

module.exports = { getAmbientWords };
