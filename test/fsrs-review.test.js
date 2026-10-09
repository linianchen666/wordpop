const assert = require('assert');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { fsrs, generatorParameters, createEmptyCard, Rating, State, FSRSVersion } = require('ts-fsrs');
const { calculateReview, deserializeCard, cardForProgress, FSRS_OPTIONS, MINUTE, DAY, MAX_INTERVAL } = require('../src/main/review-algorithm');
const { recordReview } = require('../src/main/review-progress');
const { migrateFsrs } = require('../src/main/fsrs-schema');

const now = Date.UTC(2026, 9, 9);
const upstream = fsrs(generatorParameters(FSRS_OPTIONS));
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`  ✓ ${name}`); }
function legacy(interval, extra = {}) {
  return { stage: 5, interval, efactor: 2.5, repetitions: 5,
    last_review_at: now - interval, next_review_at: now, ...extra };
}
test('依赖实际运行的是 FSRS-6，目标记忆率为90%', () => {
  assert.match(FSRSVersion, /FSRS-6/);
  assert.equal(upstream.parameters.request_retention, 0.9);
});
test('新词四种评分精确对应上游 Again / Hard / Good / Easy', () => {
  for (const [action, rating] of [['unknown', 1], ['fuzzy', 2], ['known', 3], ['easy', 4]]) {
    const actual = calculateReview(null, action, now);
    const expected = upstream.next(createEmptyCard(new Date(now)), new Date(now), rating);
    assert.deepEqual(JSON.parse(actual.fsrs_card), JSON.parse(JSON.stringify(expected.card)));
    assert.deepEqual(JSON.parse(actual.fsrs_log), JSON.parse(JSON.stringify(expected.log)));
    assert.equal(actual.rating, rating);
  }
});
test('新词默认 Again 1分钟、Hard 6分钟、Good 10分钟、Easy 8天', () => {
  for (const [action, delay] of [['unknown', MINUTE], ['fuzzy', 6 * MINUTE],
    ['known', 10 * MINUTE], ['easy', 8 * DAY]]) {
    assert.equal(calculateReview(null, action, now).interval, delay);
  }
});
test('Easy/旧接口mastered 都继续安排复习，不直接标记已掌握', () => {
  const easy = calculateReview(null, 'easy', now);
  assert.ok(easy.stage < 9 && easy.next_review_at > now);
  assert.deepEqual(calculateReview(null, 'mastered', now), easy);
});
test('多次混合评分与上游FSRS逐次完全一致，包含长期遗忘与重学', () => {
  let expected = createEmptyCard(new Date(now));
  let actual = null;
  let time = now;
  for (const [action, rating] of [['known', 3], ['known', 3], ['known', 3],
    ['unknown', 1], ['fuzzy', 2], ['known', 3], ['easy', 4]]) {
    const scheduled = upstream.next(expected, new Date(time), rating);
    actual = calculateReview(actual, action, time);
    assert.equal(actual.fsrs_card, JSON.stringify(scheduled.card));
    assert.equal(actual.fsrs_log, JSON.stringify(scheduled.log));
    expected = scheduled.card;
    time = expected.due.getTime();
  }
});
test('长期遗忘增加lapses并进入Relearning，而非简单缩短旧间隔', () => {
  const easy = calculateReview(null, 'easy', now);
  const forgotten = calculateReview(easy, 'unknown', easy.next_review_at);
  const card = deserializeCard(forgotten.fsrs_card);
  assert.equal(card.state, State.Relearning);
  assert.equal(card.lapses, 1);
  assert.equal(forgotten.interval, 10 * MINUTE);
});
test('FSRS利用真实逾期天数，提前/准时/逾期结果与上游一致', () => {
  const previous = calculateReview(null, 'easy', now);
  const card = deserializeCard(previous.fsrs_card);
  for (const time of [now + DAY, previous.next_review_at, previous.next_review_at + 30 * DAY]) {
    const result = calculateReview(previous, 'known', time);
    assert.equal(result.fsrs_card, JSON.stringify(upstream.next(card, new Date(time), Rating.Good).card));
  }
});
test('90天上限不自动掌握，也不丢弃FSRS稳定性', () => {
  const card = upstream.next(createEmptyCard(new Date(now - DAY)), new Date(now - DAY), Rating.Easy).card;
  card.state = State.Review; card.stability = 10000;
  const result = calculateReview({ fsrs_card: JSON.stringify(card) }, 'known', now);
  assert.equal(result.interval, MAX_INTERVAL);
  assert.equal(result.stage, 8);
  assert.ok(deserializeCard(result.fsrs_card).stability > 90);
});
test('旧E-Factor已退出算法，修改它不会影响FSRS输出', () => {
  const a = calculateReview(legacy(3 * DAY, { efactor: 1.3 }), 'known', now);
  const b = calculateReview(legacy(3 * DAY, { efactor: 3 }), 'known', now);
  assert.equal(a.fsrs_card, b.fsrs_card);
});
test('旧进度按实际间隔初始化稳定性，但不虚构历史日志或修改原对象', () => {
  const previous = Object.freeze(legacy(5 * DAY));
  const card = cardForProgress(previous, now);
  assert.equal(card.stability, 5);
  assert.equal(card.last_review.getTime(), previous.last_review_at);
  assert.equal(card.due.getTime(), previous.next_review_at);
  assert.equal(card.state, State.Review);
  assert.equal(previous.fsrs_card, undefined);
});
test('FSRS状态可以JSON往返，日期恢复后仍产生相同的下一次调度', () => {
  const previous = calculateReview(null, 'known', now);
  const restored = JSON.parse(JSON.stringify(previous));
  assert.deepEqual(calculateReview(restored, 'known', previous.next_review_at),
    calculateReview(previous, 'known', previous.next_review_at));
});
test('损坏状态和时间倒退会报错，不能静默重置学习进度', () => {
  assert.throws(() => calculateReview({ fsrs_card: '{bad' }, 'known', now));
  assert.throws(() => deserializeCard({ difficulty: NaN }));
  assert.throws(() => calculateReview(null, 'invalid', now));
  assert.throws(() => calculateReview(null, 'known', NaN));
  const previous = calculateReview(null, 'known', now);
  assert.throws(() => calculateReview(previous, 'known', now - MINUTE));
});

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
db.exec(`
 CREATE TABLE words (id INTEGER PRIMARY KEY, word TEXT UNIQUE, phonetic TEXT DEFAULT '',
   translation TEXT DEFAULT '', example TEXT DEFAULT '', wordlist TEXT DEFAULT 'cet4', frequency_rank INTEGER DEFAULT 0);
 CREATE TABLE word_wordlists (word_id INTEGER, wordlist TEXT);
 CREATE TABLE progress (id INTEGER PRIMARY KEY, word_id INTEGER UNIQUE REFERENCES words(id),
   stage INTEGER DEFAULT 0, next_review_at INTEGER DEFAULT 0, last_review_at INTEGER,
   correct_count INTEGER DEFAULT 0, wrong_count INTEGER DEFAULT 0, mastered_count INTEGER DEFAULT 0,
   efactor REAL DEFAULT 2.5, interval INTEGER DEFAULT 0, repetitions INTEGER DEFAULT 0);
 CREATE TABLE daily_stats (date TEXT PRIMARY KEY, words_reviewed INTEGER DEFAULT 0, words_learned INTEGER DEFAULT 0);
 PRAGMA user_version = 6;
 INSERT INTO words (id,word) VALUES (99,'old');
 INSERT INTO progress (word_id,stage,interval,next_review_at) VALUES (99,9,777,123456);
`);
test('schema6→7保留旧进度、已掌握状态和到期时间；重复迁移安全', () => {
  const previous = db.prepare('SELECT * FROM progress WHERE word_id=99').get();
  migrateFsrs(db); migrateFsrs(db);
  const { fsrs_card, ...after } = db.prepare('SELECT * FROM progress WHERE word_id=99').get();
  assert.deepEqual(after, previous);
  assert.equal(fsrs_card, null);
  assert.equal(db.pragma('user_version', { simple: true }), 7);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM review_history').get().n, 0);
});
const config = { selectedWordlists: ['cet4'], dailyNewWords: 20, autoBalanceLoad: false };
const originalLoad = Module._load;
let scheduler, focus, backup, productionDb;
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wordpop-fsrs-'));
try {
 Module._load = function(request, parent) {
  if (request === 'electron') return {
   app: { getPath: () => testDir }, BrowserWindow: { getAllWindows: () => [] }, dialog: {}
  };
  if (parent?.filename.includes(path.join('src', 'main') + path.sep)) {
   if (request === './db') return { getDb: () => db, importWordlist() {} };
   if (request === './config') return { loadConfig: () => config, saveConfig: value => ({ success: true, config: value }) };
   if (request === './popup-manager') return { show() {} };
   if (request === './etymology') return { analyzeWord: () => null };
  }
  return originalLoad.apply(this, arguments);
 };
 scheduler = require('../src/main/scheduler');
 focus = require('../src/main/focus-manager');
 backup = require('../src/main/backup');
 productionDb = require('../src/main/db');
} finally { Module._load = originalLoad; }
const originalNow = Date.now;
try {
 Date.now = () => now;
 const row = id => db.prepare('SELECT * FROM progress WHERE word_id=?').get(id);
 function seed(id) {
  db.prepare('INSERT INTO words (id,word) VALUES (?,?)').run(id, `word${id}`);
  db.prepare("INSERT INTO word_wordlists VALUES (?,'cet4')").run(id);
 }
 function clear() {
  scheduler.stop(); scheduler._undoInfo = null;
  db.exec('DELETE FROM review_history; DELETE FROM progress; DELETE FROM daily_stats; DELETE FROM word_wordlists; DELETE FROM words;');
  scheduler.dailyNewWordsCount = 0;
 }
 test('两种模式对相同旧进度及全部评分保存完全相同的FSRS状态', () => {
  for (const action of ['known', 'fuzzy', 'unknown', 'easy']) {
   clear(); seed(1); seed(2);
   for (const id of [1, 2]) db.prepare('INSERT INTO progress (word_id,stage,interval,last_review_at) VALUES (?,5,?,?)').run(id, 3 * DAY, now - 3 * DAY);
   scheduler.currentWord = { id: 1, word: 'word1' };
   scheduler._updateProgress(action);
   assert.equal(focus.submitFocusWord(2, action).success, true);
   const { id: i1, word_id: w1, ...first } = row(1);
   const { id: i2, word_id: w2, ...second } = row(2);
   assert.deepEqual(first, second);
   assert.equal(db.prepare('SELECT COUNT(*) AS n FROM review_history').get().n, 2);
  }
 });
 test('预览读取真实新词/旧进度/FSRS卡片，四档与保存算法一致且不修改数据库', () => {
  const { getReviewPreview } = require('../src/main/review-preview');
  clear(); seed(1);
  for (const kind of ['new', 'legacy', 'fsrs']) {
   if (kind === 'legacy') db.prepare('INSERT INTO progress (word_id,stage,interval,last_review_at,next_review_at) VALUES (1,5,?,?,?)').run(3 * DAY, now - 3 * DAY, now);
   if (kind === 'fsrs') recordReview(db, 1, 'easy', now - DAY);
   const before = JSON.stringify(row(1));
   const historyBefore = db.prepare('SELECT COUNT(*) n FROM review_history').get().n;
   const preview = getReviewPreview(db, 1, now);
   for (const action of ['unknown', 'fuzzy', 'known', 'easy']) {
    const calculated = calculateReview(row(1), action, now);
    assert.equal(preview.intervals[action].interval, calculated.interval);
    assert.equal(preview.intervals[action].dueAt, calculated.next_review_at);
   }
   assert.equal(JSON.stringify(row(1)), before);
   assert.equal(db.prepare('SELECT COUNT(*) n FROM review_history').get().n, historyBefore);
  }
  assert.throws(() => getReviewPreview(db, -1, now));
  assert.throws(() => getReviewPreview(db, 999, now));
 });
 test('FSRS状态和官方日志连同统计在一个事务中保存', () => {
  clear(); seed(1);
  recordReview(db, 1, 'known', now);
  recordReview(db, 1, 'fuzzy', now + 10 * MINUTE);
  const history = db.prepare('SELECT * FROM review_history ORDER BY id').all();
  assert.equal(history.length, 2);
  assert.equal(history[1].card_before, history[0].card_after);
  assert.equal(history[1].card_after, row(1).fsrs_card);
  assert.equal(JSON.parse(history[1].log).rating, Rating.Hard);
  const stats = db.prepare('SELECT * FROM daily_stats').get();
  assert.equal(stats.words_learned, 1); assert.equal(stats.words_reviewed, 2);
 });
 test('统计失败时同时回滚FSRS进度和复习历史', () => {
  clear(); seed(1);
  db.exec("CREATE TRIGGER reject_stats BEFORE INSERT ON daily_stats BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  assert.throws(() => recordReview(db, 1, 'known', now));
  assert.equal(row(1), undefined);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM review_history').get().n, 0);
  db.exec('DROP TRIGGER reject_stats');
 });
 test('撤销新词删除FSRS状态与日志，并还原每日统计', () => {
  clear(); seed(1);
  scheduler.currentWord = { id: 1, word: 'word1', stage: 0 };
  scheduler._updateProgress('known');
  assert.equal(scheduler.undo(), true);
  assert.equal(row(1), undefined);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM review_history').get().n, 0);
  assert.equal(db.prepare('SELECT words_learned FROM daily_stats').get().words_learned, 0);
 });
 test('撤销已学词精确恢复FSRS稳定性/难度/状态和已有日志', () => {
  clear(); seed(1);
  recordReview(db, 1, 'easy', now - DAY);
  const previous = row(1);
  const history = db.prepare('SELECT * FROM review_history').all();
  scheduler.currentWord = { id: 1, word: 'word1', stage: previous.stage };
  scheduler._updateProgress('unknown');
  assert.equal(scheduler.undo(), true);
  assert.deepEqual(row(1), previous);
  assert.deepEqual(db.prepare('SELECT * FROM review_history').all(), history);
 });
 test('后续专注反馈不能被旧弹窗撤销覆盖', () => {
  clear(); seed(1);
  scheduler.currentWord = { id: 1, word: 'word1' };
  scheduler._updateProgress('known');
  focus.submitFocusWord(1, 'unknown');
  const previous = row(1);
  const history = db.prepare('SELECT * FROM review_history').all();
  assert.equal(scheduler.undo(), false);
  assert.deepEqual(row(1), previous);
  assert.deepEqual(db.prepare('SELECT * FROM review_history').all(), history);
 });
 test('FSRS备份往返无损，重复导入不会重复历史记录', () => {
  clear(); seed(1);
  recordReview(db, 1, 'easy', now - DAY);
  recordReview(db, 1, 'known', now);
  const previous = row(1);
  const exported = backup.createBackupData();
  assert.equal(exported.schemaVersion, 7);
  assert.equal(exported.data.review_history.length, 2);
  clear(); seed(1);
  backup.restoreBackupData(exported); backup.restoreBackupData(exported);
  const { id: i1, ...a } = previous; const { id: i2, ...b } = row(1);
  assert.deepEqual(a, b);
  const again = backup.createBackupData();
  assert.deepEqual(again.data.review_history, exported.data.review_history);
 });
 test('导入旧备份保留到期时间和已掌握状态，下一次反馈才接入FSRS', () => {
  clear(); seed(1);
  backup.restoreBackupData({ appName: 'WordPop', schemaVersion: 6, data: {
   progress: [{ word: 'word1', stage: 9, interval: 12345, next_review_at: 777 }]
  }});
  assert.equal(row(1).stage, 9); assert.equal(row(1).next_review_at, 777);
  assert.equal(row(1).fsrs_card, null);
  scheduler.reloadQueue(); assert.equal(scheduler.queue.length, 0);
  assert.equal(focus.getFocusWords(20, ['cet4']).words.length, 0);
 });
 test('损坏的FSRS备份在事务内回滚，不覆盖现有进度和历史', () => {
  clear(); seed(1); recordReview(db, 1, 'known', now);
  const previous = row(1); const history = db.prepare('SELECT * FROM review_history').all();
  const exported = backup.createBackupData(); exported.data.progress[0].fsrs_card = '{}';
  assert.throws(() => backup.restoreBackupData(exported));
  assert.deepEqual(row(1), previous); assert.deepEqual(db.prepare('SELECT * FROM review_history').all(), history);
 });
 test('schema升级失败时保留数据库文件，不删除用户数据', () => {
  const file = path.join(testDir, 'wordpop.db');
  const broken = new Database(file);
  broken.exec("CREATE TABLE sentinel (value TEXT); INSERT INTO sentinel VALUES ('keep'); PRAGMA user_version=6;");
  broken.close();
  assert.throws(() => productionDb.initDatabase());
  const preserved = new Database(file);
  assert.equal(preserved.prepare('SELECT value FROM sentinel').get().value, 'keep');
  assert.equal(preserved.pragma('user_version', { simple: true }), 6);
  preserved.close();
 });
 test('焦点模式计数同步；到期FSRS重学词先于未处理新词', () => {
  clear(); seed(1); seed(2);
  recordReview(db, 1, 'unknown', now);
  Date.now = () => now + MINUTE;
  scheduler.queue = [{ id: 2 }];
  scheduler._popNext();
  assert.equal(scheduler.currentWord.id, 1); assert.equal(scheduler.dailyNewWordsCount, 1);
  Date.now = () => now;
 });
} finally {
 Date.now = originalNow; scheduler.stop(); db.close();
 fs.rmSync(testDir, { recursive: true, force: true });
}
console.log(`\nFSRS：${passed} 项测试全部通过`);
