const MASTERED_STAGE = 9;

/** Parameterized membership avoids duplicate words shared by several lists. */
function wordlistFilter(column, wordlists) {
  if (!Array.isArray(wordlists)) throw new TypeError('Wordlists must be an array');
  const selected = [...new Set(wordlists)];
  return {
    sql: selected.length
      ? `${column} IN (SELECT word_id FROM word_wordlists WHERE wordlist IN (${selected.map(() => '?').join(',')}))`
      : '0',
    params: selected
  };
}

function optionalLimit(limit) {
  if (limit == null) return { sql: '', params: [] };
  if (!Number.isInteger(limit) || limit < 0) throw new RangeError('Limit must be a nonnegative integer');
  return { sql: 'LIMIT ?', params: [limit] };
}

/**
 * Learning queries and undo persistence shared by all learning modes.
 * Resolve the connection per operation: database initialization/restoration may
 * replace it, and importing this module must not depend on Electron startup.
 */
function createLearningRepository(getDb) {
  if (typeof getDb !== 'function') throw new TypeError('A database getter is required');

  function getDueWords(wordlists = ['cet4'], now = Date.now(), limit = null) {
    const filter = wordlistFilter('w.id', wordlists);
    const cap = optionalLimit(limit);
    return getDb().prepare(`
      SELECT w.id, w.word, w.phonetic, w.translation, w.example,
             p.stage, p.next_review_at, p.correct_count, p.wrong_count,
             p.efactor, p.interval, p.repetitions
      FROM words w
      JOIN progress p ON w.id = p.word_id
      WHERE p.next_review_at <= ? AND p.stage < ? AND ${filter.sql}
      ORDER BY p.next_review_at ASC, p.stage ASC
      ${cap.sql}
    `).all(now, MASTERED_STAGE, ...filter.params, ...cap.params);
  }

  function getNewWords(wordlists = ['cet4'], limit = null) {
    const filter = wordlistFilter('w.id', wordlists);
    const cap = optionalLimit(limit);
    return getDb().prepare(`
      SELECT w.id, w.word, w.phonetic, w.translation, w.example, 0 AS stage,
             0 AS correct_count, 0 AS wrong_count, 2.5 AS efactor,
             0 AS interval, 0 AS repetitions
      FROM words w
      LEFT JOIN progress p ON w.id = p.word_id
      WHERE p.word_id IS NULL AND ${filter.sql}
      ORDER BY w.frequency_rank ASC, w.id ASC
      ${cap.sql}
    `).all(...filter.params, ...cap.params);
  }

  function countUnlearned(wordlists = ['cet4']) {
    const filter = wordlistFilter('w.id', wordlists);
    return getDb().prepare(`
      SELECT COUNT(*) AS count FROM words w
      LEFT JOIN progress p ON w.id = p.word_id
      WHERE p.word_id IS NULL AND ${filter.sql}
    `).get(...filter.params).count;
  }

  function countDue(wordlists = ['cet4'], now = Date.now()) {
    const filter = wordlistFilter('p.word_id', wordlists);
    return getDb().prepare(`
      SELECT COUNT(*) AS count FROM progress p
      WHERE p.next_review_at <= ? AND p.stage < ? AND ${filter.sql}
    `).get(now, MASTERED_STAGE, ...filter.params).count;
  }

  function getDailyLearned(now = Date.now()) {
    const row = getDb().prepare(`
      SELECT words_learned FROM daily_stats
      WHERE date = date(?, 'unixepoch', 'localtime')
    `).get(now / 1000);
    return row ? (row.words_learned || 0) : 0;
  }

  /** Returns the next review time only; quotas/new-word fallback belong to scheduling. */
  function getNextReviewTime(wordlists = ['cet4']) {
    const filter = wordlistFilter('p.word_id', wordlists);
    return getDb().prepare(`
      SELECT MIN(p.next_review_at) AS next_at FROM progress p
      WHERE p.stage < ? AND p.next_review_at > 0 AND ${filter.sql}
    `).get(MASTERED_STAGE, ...filter.params).next_at ?? null;
  }

  function hasNewWords(wordlists = ['cet4']) {
    return countUnlearned(wordlists) > 0;
  }

  function hasUnmasteredWords(wordlists = ['cet4']) {
    const filter = wordlistFilter('w.id', wordlists);
    return Boolean(getDb().prepare(`
      SELECT 1 FROM words w
      LEFT JOIN progress p ON w.id = p.word_id
      WHERE (p.word_id IS NULL OR p.stage < ?) AND ${filter.sql}
      LIMIT 1
    `).get(MASTERED_STAGE, ...filter.params));
  }

  /** Daily activity/streak are global; optional list filtering affects progress totals. */
  function getStats(wordlists = null, now = Date.now()) {
    const db = getDb();
    const today = db.prepare(`
      SELECT words_reviewed, words_learned FROM daily_stats
      WHERE date = date(?, 'unixepoch', 'localtime')
    `).get(now / 1000) || { words_reviewed: 0, words_learned: 0 };
    const filter = wordlists == null
      ? { sql: '1', params: [] }
      : wordlistFilter('p.word_id', wordlists);
    const total = db.prepare(`
      SELECT COUNT(*) AS words,
             COALESCE(SUM(p.correct_count), 0) AS correct,
             COALESCE(SUM(p.wrong_count), 0) AS wrong,
             COUNT(CASE WHEN p.stage >= ? THEN 1 END) AS mastered
      FROM progress p WHERE ${filter.sql}
    `).get(MASTERED_STAGE, ...filter.params);
    const streak = db.prepare(`
      WITH RECURSIVE d(day) AS (
        SELECT date(?, 'unixepoch', 'localtime')
        UNION ALL
        SELECT date(day, '-1 day') FROM d
        WHERE day > date(?, 'unixepoch', '-365 days')
          AND EXISTS (SELECT 1 FROM daily_stats ds WHERE ds.date = date(day, '-1 day'))
      )
      SELECT COUNT(*) AS streak FROM d
      WHERE EXISTS (SELECT 1 FROM daily_stats ds WHERE ds.date = d.day)
    `).get(now / 1000, now / 1000).streak;
    return { today, total, streak };
  }

  function getDailyStats(days = 7, now = Date.now()) {
    return getDb().prepare(`
      SELECT date, words_reviewed, words_learned FROM daily_stats
      WHERE date >= date(?, 'unixepoch', 'localtime', '-' || ? || ' days')
      ORDER BY date ASC
    `).all(now / 1000, days);
  }

  function getStageDistribution() {
    return getDb().prepare(`
      SELECT stage, COUNT(*) AS count FROM progress
      WHERE stage < ? GROUP BY stage ORDER BY stage ASC
    `).all(MASTERED_STAGE);
  }

  function getStubbornWords(minWrong = 3) {
    return getDb().prepare(`
      SELECT w.id, w.word, w.phonetic, w.translation, w.example,
             p.stage, p.wrong_count, p.correct_count, p.next_review_at
      FROM words w JOIN progress p ON w.id = p.word_id
      WHERE p.wrong_count >= ? AND p.stage < ?
      ORDER BY p.wrong_count DESC, p.stage ASC LIMIT 50
    `).all(minWrong, MASTERED_STAGE);
  }

  function getImportedWordlistCount(wordlist) {
    return getDb().prepare(`
      SELECT COUNT(DISTINCT word_id) AS count FROM word_wordlists WHERE wordlist = ?
    `).get(wordlist).count;
  }

  function getCustomWordlists() {
    return getDb().prepare(`
      SELECT wordlist AS id, COUNT(DISTINCT word_id) AS importedCount
      FROM word_wordlists WHERE wordlist NOT IN ('cet4', 'cet6', 'kaoyan')
      GROUP BY wordlist
    `).all();
  }

  function getProgressSummary(wordlists) {
    const filter = wordlistFilter('w.id', wordlists || []);
    const row = getDb().prepare(`
      SELECT COUNT(*) AS totalWords,
             COUNT(CASE WHEN p.stage < ? THEN 1 END) AS learnedWords,
             COUNT(CASE WHEN p.stage >= ? THEN 1 END) AS masteredWords,
             COUNT(CASE WHEN p.word_id IS NULL THEN 1 END) AS remainingWords
      FROM words w LEFT JOIN progress p ON w.id = p.word_id
      WHERE ${filter.sql}
    `).get(MASTERED_STAGE, MASTERED_STAGE, ...filter.params);
    return row;
  }

  /** Defer an overdue queue without fabricating FSRS reviews or memory updates. */
  function smoothOverdueReviews(days = 3, wordlists = null, now = Date.now()) {
    const db = getDb();
    const targetDays = Math.max(1, Math.min(30, parseInt(days) || 3));
    const filter = Array.isArray(wordlists) && wordlists.length > 0
      ? wordlistFilter('p.word_id', wordlists) : { sql: '1', params: [] };
    return db.transaction(() => {
      const overdue = db.prepare(`
        SELECT p.word_id FROM progress p JOIN words w ON p.word_id = w.id
        WHERE p.next_review_at <= ? AND p.stage < ? AND ${filter.sql}
        ORDER BY p.next_review_at ASC, p.stage ASC
      `).all(now, MASTERED_STAGE, ...filter.params);
      const update = db.prepare('UPDATE progress SET next_review_at = ? WHERE word_id = ?');
      overdue.forEach((row, index) => {
        const dayOffset = index % targetDays;
        const jitter = dayOffset ? (Math.random() - 0.5) * 2 * 3600 * 1000 : 0;
        update.run(Math.round(now + dayOffset * 86400000 + jitter), row.word_id);
      });
      return { success: true, count: overdue.length, days: targetDays };
    })();
  }

  /** Restore only the latest matching review, atomically with its log and original day's statistics. */
  function undoReview(undoInfo) {
    if (!undoInfo?.word || !undoInfo.reviewLogId) return false;
    const { word, oldProgress, reviewLogId, wasNewWord } = undoInfo;
    if (!wasNewWord && !oldProgress) return false;
    const db = getDb();
    return db.transaction(() => {
      const latest = db.prepare(`
        SELECT id, reviewed_at, card_after FROM review_history
        WHERE word_id = ? ORDER BY id DESC LIMIT 1
      `).get(word.id);
      const current = db.prepare('SELECT fsrs_card FROM progress WHERE word_id = ?').get(word.id);
      // Later reviews or a restore must not be overwritten by a stale undo.
      if (!latest || latest.id !== reviewLogId || !current || current.fsrs_card !== latest.card_after) {
        return false;
      }
      if (wasNewWord) {
        db.prepare('DELETE FROM progress WHERE word_id = ?').run(word.id);
      } else {
        db.prepare(`
          UPDATE progress SET stage = ?, next_review_at = ?, last_review_at = ?,
            correct_count = ?, wrong_count = ?, mastered_count = ?, efactor = ?,
            interval = ?, repetitions = ?, fsrs_card = ? WHERE word_id = ?
        `).run(oldProgress.stage, oldProgress.next_review_at, oldProgress.last_review_at,
          oldProgress.correct_count, oldProgress.wrong_count, oldProgress.mastered_count,
          oldProgress.efactor, oldProgress.interval, oldProgress.repetitions,
          oldProgress.fsrs_card ?? null, word.id);
      }
      db.prepare('DELETE FROM review_history WHERE id = ?').run(reviewLogId);
      db.prepare(`
        UPDATE daily_stats SET words_reviewed = MAX(words_reviewed - 1, 0),
          words_learned = MAX(words_learned - ?, 0)
        WHERE date = date(?, 'unixepoch', 'localtime')
      `).run(wasNewWord ? 1 : 0, latest.reviewed_at / 1000);
      return true;
    }).immediate();
  }

  return { getDueWords, getNewWords, countUnlearned, countDue, getDailyLearned,
    getNextReviewTime, hasNewWords, hasUnmasteredWords, getStats, getDailyStats,
    getStageDistribution, getStubbornWords, getImportedWordlistCount, getCustomWordlists,
    getProgressSummary, smoothOverdueReviews, undoReview };
}

const learningRepository = createLearningRepository(() => require('./db').getDb());
module.exports = { ...learningRepository, learningRepository, createLearningRepository };
