const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');
const Database = require('better-sqlite3');
const { fsrs, generatorParameters, Rating, State } = require('ts-fsrs');
const root = process.env.WORDPOP_TEST_APP_ROOT || path.join(__dirname, '..');
const { initializeMemory } = require(path.join(root, 'src/main/memory-initialization'));
const { calculateReview, cardForProgress, deserializeCard, FSRS_OPTIONS, DAY, MINUTE } = require(path.join(root, 'src/main/review-algorithm'));
const now = Date.UTC(2026, 9, 9);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wordpop-memory-init-'));
const originalLoad = Module._load;
Module._load = function(request) {
  if (request === 'electron') return { app: { getPath: () => profile, isPackaged: !!process.env.WORDPOP_TEST_APP_ROOT } };
  return originalLoad.apply(this, arguments);
};
let production;
try {
  production = require(path.join(root, 'src/main/db'));
  let db = production.initDatabase();
  assert.equal(db.pragma('user_version', { simple: true }), 8);
  db.exec('DELETE FROM words');
  for (let id = 1; id <= 4; id++) db.prepare('INSERT INTO words (id,word,translation) VALUES (?, ?, ?)').run(id, 'word'+id, '释义');
  const legacy = { stage: 8, interval: 15 * DAY, last_review_at: now - 15 * DAY, next_review_at: now + 15 * DAY, repetitions: 8 };
  const insert = db.prepare('INSERT INTO progress (word_id,stage,interval,last_review_at,next_review_at,repetitions,correct_count,wrong_count,fsrs_card) VALUES (?,?,?,?,?,?,5,3,?)');
  insert.run(1, legacy.stage, legacy.interval, legacy.last_review_at, legacy.next_review_at, 8, null);
  insert.run(2, 9, 90 * DAY, legacy.last_review_at, legacy.next_review_at, 10, null);
  const before = cardForProgress(legacy, now); before.learning_steps = 1; // beta.6 legacy bootstrap bug
  const upstream = fsrs(generatorParameters(FSRS_OPTIONS));
  const old = upstream.next(before, new Date(now), Rating.Hard);
  insert.run(3, 8, old.card.due.getTime()-now, now, old.card.due.getTime(), old.card.reps, JSON.stringify(old.card));
  db.prepare('INSERT INTO review_history (word_id,reviewed_at,rating,card_before,card_after,log) VALUES (3,?,?,?,?,?)').run(now, 2, JSON.stringify(before), JSON.stringify(old.card), JSON.stringify(old.log));
  // A later Good must use the repaired earlier failure state, not the old Hard state.
  const next = upstream.next(old.card, new Date(now + DAY), Rating.Good);
  insert.run(4, 8, next.card.due.getTime()-(now+DAY), now+DAY, next.card.due.getTime(), next.card.reps, JSON.stringify(next.card));
  const logInsert = db.prepare('INSERT INTO review_history (word_id,reviewed_at,rating,card_before,card_after,log) VALUES (4,?,?,?,?,?)');
  logInsert.run(now, 2, JSON.stringify(before), JSON.stringify(old.card), JSON.stringify(old.log));
  logInsert.run(now+DAY, 3, JSON.stringify(old.card), JSON.stringify(next.card), JSON.stringify(next.log));
  db.prepare('INSERT INTO daily_stats VALUES (?,7,2)').run('2026-10-09');
  db.pragma('user_version = 7');
  const history = JSON.stringify(db.prepare('SELECT * FROM review_history').all());
  const stats = JSON.stringify(db.prepare('SELECT * FROM daily_stats').all());
  const originals = db.prepare('SELECT * FROM progress ORDER BY word_id').all();
  // A failed update must roll back every record, archive and version marker.
  db.exec("CREATE TRIGGER fail_init BEFORE UPDATE ON progress WHEN NEW.word_id=3 BEGIN SELECT RAISE(ABORT,'injected'); END");
  assert.throws(() => initializeMemory(db, now + DAY), /injected/);
  assert.equal(db.pragma('user_version', { simple: true }), 7);
  assert.deepEqual(db.prepare('SELECT * FROM progress ORDER BY word_id').all(), originals);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM memory_initialization_archive').get().n, 0);
  db.exec('DROP TRIGGER fail_init');
  production.closeDatabase();
  // Exercise the real application startup hook, including persisted upgrade marker.
  db = production.initDatabase();
  const rows = db.prepare('SELECT * FROM progress ORDER BY word_id').all();
  assert.equal(db.pragma('user_version', { simple: true }), 8);
  assert.deepEqual(rows[1], originals[1], 'Keep mastered words unchanged');
  assert.ok(rows[0].next_review_at <= Date.now() + DAY, 'Legacy rows get near-term assessment');
  assert.equal(deserializeCard(rows[0].fsrs_card).learning_steps, 0);
  assert.equal(rows[2].next_review_at, now + 10 * MINUTE);
  assert.equal(deserializeCard(rows[2].fsrs_card).state, State.Relearning);
  before.learning_steps = 0;
  const again = calculateReview({ fsrs_card: JSON.stringify(before) }, 'unknown', now);
  const good = calculateReview(again, 'known', now + DAY);
  assert.equal(rows[3].fsrs_card, good.fsrs_card);
  for (const row of rows) {
    const previous = originals.find(p => p.word_id === row.word_id);
    for (const field of ['correct_count','wrong_count','mastered_count','last_review_at','efactor']) assert.equal(row[field], previous[field]);
  }
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM review_history').all()), history);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM daily_stats').all()), stats);
  const archive = db.prepare('SELECT * FROM memory_initialization_archive ORDER BY word_id').all();
  assert.equal(archive.length, 3);
  for (const row of archive) assert.deepEqual(JSON.parse(row.progress_json), originals.find(p => p.word_id === row.word_id));
  production.closeDatabase();
  db = production.initDatabase();
  assert.deepEqual(db.prepare('SELECT * FROM progress ORDER BY word_id').all(), rows, 'Restart must not reinitialize');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM memory_initialization_archive').get().n, 3);
  console.log('Memory initialization checks passed: real startup, historical Hard replay, legacy assessment, mastered preservation, archive, counters, rollback and once-only restart.');
} finally {
  production?.closeDatabase(); Module._load = originalLoad;
  fs.rmSync(profile, { recursive: true, force: true });
}
