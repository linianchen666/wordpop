const assert = require('assert');
const Database = require('better-sqlite3');
const { createLearningRepository } = require('../src/main/learning-repository');
const { recordReview } = require('../src/main/review-progress');
const { migrateFsrs } = require('../src/main/fsrs-schema');

const DAY = 86400000;
const now = new Date(2026, 9, 9, 12).getTime();
let passed = 0;

function database() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE words (id INTEGER PRIMARY KEY, word TEXT UNIQUE NOT NULL,
      phonetic TEXT DEFAULT '', translation TEXT DEFAULT '', example TEXT DEFAULT '',
      wordlist TEXT DEFAULT 'cet4', frequency_rank INTEGER DEFAULT 999999);
    CREATE TABLE word_wordlists (word_id INTEGER REFERENCES words(id), wordlist TEXT,
      PRIMARY KEY (word_id, wordlist));
    CREATE TABLE progress (id INTEGER PRIMARY KEY, word_id INTEGER UNIQUE REFERENCES words(id),
      stage INTEGER DEFAULT 0, next_review_at INTEGER DEFAULT 0, last_review_at INTEGER,
      correct_count INTEGER DEFAULT 0, wrong_count INTEGER DEFAULT 0, mastered_count INTEGER DEFAULT 0,
      efactor REAL DEFAULT 2.5, interval INTEGER DEFAULT 0, repetitions INTEGER DEFAULT 0);
    CREATE TABLE daily_stats (date TEXT PRIMARY KEY, words_reviewed INTEGER DEFAULT 0,
      words_learned INTEGER DEFAULT 0);
  `);
  migrateFsrs(db);
  return db;
}

function test(name, fn) {
  const db = database();
  const repo = createLearningRepository(() => db);
  try {
    fn(db, repo);
    passed++;
    console.log(`  ✓ ${name}`);
  } finally { db.close(); }
}

function seed(db, id, lists = ['cet4'], frequency = id) {
  db.prepare('INSERT INTO words (id, word, frequency_rank) VALUES (?, ?, ?)')
    .run(id, `word${id}`, frequency);
  for (const list of lists) db.prepare('INSERT INTO word_wordlists VALUES (?, ?)').run(id, list);
}

function legacy(db, id, stage, due, correct = 0, wrong = 0) {
  db.prepare(`INSERT INTO progress (word_id, stage, next_review_at, correct_count, wrong_count)
    VALUES (?, ?, ?, ?, ?)`).run(id, stage, due, correct, wrong);
}

function review(db, id, action, time) {
  const result = recordReview(db, id, action, time);
  return { word: { id }, oldProgress: result.previous || null,
    reviewLogId: result.reviewLogId, wasNewWord: result.wasNewWord };
}

function snapshot(db) {
  return {
    progress: db.prepare('SELECT * FROM progress ORDER BY word_id').all(),
    history: db.prepare('SELECT * FROM review_history ORDER BY id').all(),
    daily: db.prepare('SELECT * FROM daily_stats ORDER BY date').all()
  };
}

test('数据库连接惰性获取，连接被替换后查询使用新连接', (db) => {
  const replacement = database();
  let current = db;
  let calls = 0;
  const repo = createLearningRepository(() => { calls++; return current; });
  assert.equal(calls, 0);
  try {
    seed(db, 1); seed(replacement, 2); seed(replacement, 3);
    assert.equal(repo.countUnlearned(['cet4']), 1);
    current = replacement;
    assert.equal(repo.countUnlearned(['cet4']), 2);
    assert.equal(calls, 2);
  } finally { replacement.close(); }
});

test('到期队列跨词库去重，按到期时间和阶段排序并支持限量', (db, repo) => {
  seed(db, 1, ['cet4', 'cet6']); seed(db, 2); seed(db, 3); seed(db, 4); seed(db, 5, ['custom']);
  legacy(db, 1, 3, now - 100); legacy(db, 2, 1, now - 100);
  legacy(db, 3, 1, now + 1); legacy(db, 4, 9, now - 1000); legacy(db, 5, 1, now - 2000);
  assert.deepEqual(repo.getDueWords(['cet4', 'cet6'], now).map(word => word.id), [2, 1]);
  assert.deepEqual(repo.getDueWords(['cet4', 'cet6'], now, 1).map(word => word.id), [2]);
  assert.deepEqual(repo.getDueWords(['cet4'], now, 0), []);
  assert.equal(repo.countDue(['cet4', 'cet6'], now + 1), 3);
});

test('新词按词频和ID排序，排除任何已有进度并遵守查询数量', (db, repo) => {
  seed(db, 1, ['cet4', 'cet6'], 50); seed(db, 2, ['cet4'], 10);
  seed(db, 3, ['cet4'], 10); seed(db, 4, ['cet4'], 1); seed(db, 5, ['custom'], 0);
  legacy(db, 4, 0, 0);
  assert.deepEqual(repo.getNewWords(['cet4', 'cet6']).map(word => word.id), [2, 3, 1]);
  assert.deepEqual(repo.getNewWords(['cet4'], 2).map(word => word.id), [2, 3]);
  assert.equal(repo.getNewWords(['cet4'], 2)[0].stage, 0);
  assert.equal(repo.countUnlearned(['cet4', 'cet6', 'cet4']), 3);
  assert.deepEqual(repo.getNewWords(['cet4'], 0), []);
});

test('空词库不返回全库，词库参数不能改变SQL，非法限量明确报错', (db, repo) => {
  seed(db, 1); legacy(db, 1, 2, now);
  assert.deepEqual(repo.getDueWords([], now), []);
  assert.deepEqual(repo.getNewWords([], 5), []);
  assert.equal(repo.countDue([], now), 0);
  assert.equal(repo.countUnlearned([]), 0);
  assert.equal(repo.hasNewWords([]), false);
  assert.equal(repo.hasUnmasteredWords([]), false);
  assert.deepEqual(repo.getDueWords(["cet4') OR 1=1 --"], now), []);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM words').get().n, 1);
  assert.throws(() => repo.getDueWords(['cet4'], now, -1), RangeError);
  assert.throws(() => repo.getNewWords(['cet4'], 1.5), RangeError);
});

test('是否仍可学习涵盖新词与未掌握词，已掌握词不触发', (db, repo) => {
  seed(db, 1); legacy(db, 1, 9, now);
  assert.equal(repo.hasUnmasteredWords(['cet4']), false);
  assert.equal(repo.hasNewWords(['cet4']), false);
  seed(db, 2);
  assert.equal(repo.hasUnmasteredWords(['cet4']), true);
  assert.equal(repo.hasNewWords(['cet4']), true);
  legacy(db, 2, 1, now + DAY);
  assert.equal(repo.hasUnmasteredWords(['cet4']), true);
  assert.equal(repo.hasNewWords(['cet4']), false);
});

test('下一复习时间只取选中未掌握词的正时间，允许返回已逾期时间', (db, repo) => {
  seed(db, 1); seed(db, 2); seed(db, 3); seed(db, 4, ['cet6']);
  legacy(db, 1, 1, 0); legacy(db, 2, 9, now - DAY);
  legacy(db, 3, 2, now - 100); legacy(db, 4, 1, now - DAY);
  assert.equal(repo.getNextReviewTime(['cet4']), now - 100);
  assert.equal(repo.getNextReviewTime(['cet6']), now - DAY);
  assert.equal(repo.getNextReviewTime([]), null);
  assert.equal(repo.getNextReviewTime(['missing']), null);
});

test('每日已学计数使用指定时间的本地日期，缺失日期为0', (db, repo) => {
  seed(db, 1); seed(db, 2);
  review(db, 1, 'known', now); review(db, 2, 'known', now - DAY);
  review(db, 1, 'known', now + 600000);
  assert.equal(repo.getDailyLearned(now), 1);
  assert.equal(repo.getDailyLearned(now - DAY), 1);
  assert.equal(repo.getDailyLearned(now + DAY), 0);
});

test('统计默认全库、可筛选进度总数，跨词库不重复，打卡在日期缺口停止', (db, repo) => {
  seed(db, 1, ['cet4', 'cet6']); seed(db, 2, ['cet6']); seed(db, 3, ['custom']);
  legacy(db, 1, 2, now, 5, 2); legacy(db, 2, 9, now, 3, 1); legacy(db, 3, 4, now, 4, 0);
  const insert = db.prepare("INSERT INTO daily_stats VALUES (date(?,'unixepoch','localtime'),?,?)");
  insert.run(now / 1000, 8, 2); insert.run((now - DAY) / 1000, 3, 1);
  insert.run((now - 3 * DAY) / 1000, 6, 0);
  assert.deepEqual(repo.getStats(null, now), {
    today: { words_reviewed: 8, words_learned: 2 },
    total: { words: 3, correct: 12, wrong: 3, mastered: 1 }, streak: 2
  });
  assert.deepEqual(repo.getStats(['cet4', 'cet6'], now).total,
    { words: 2, correct: 8, wrong: 3, mastered: 1 });
  assert.equal(repo.getStats([], now).total.words, 0);
  assert.equal(repo.getStats(['cet4'], now).streak, 2);
  // Preserve the existing streak behavior before today's first review.
  assert.equal(repo.getStats(null, now + DAY).streak, 2);
  assert.equal(repo.getStats(null, now + 2 * DAY).streak, 0);
});

test('空数据库统计返回完整的0值结构', (_db, repo) => {
  assert.deepEqual(repo.getStats(null, now), {
    today: { words_reviewed: 0, words_learned: 0 },
    total: { words: 0, correct: 0, wrong: 0, mastered: 0 }, streak: 0
  });
});

test('每日统计包含范围边界并按日期升序', (db, repo) => {
  for (const [id, daysAgo] of [[1, 0], [2, 7], [3, 8]]) {
    seed(db, id); review(db, id, 'known', now - daysAgo * DAY);
  }
  const actual = repo.getDailyStats(7, now);
  assert.equal(actual.length, 2);
  assert.ok(actual[0].date < actual[1].date);
  assert.equal(repo.getDailyStats(0, now).length, 1);
});

test('阶段分布聚合全库并排除旧已掌握状态', (db, repo) => {
  for (const [id, stage] of [[1, 3], [2, 1], [3, 3], [4, 9]]) {
    seed(db, id); legacy(db, id, stage, now);
  }
  assert.deepEqual(repo.getStageDistribution(), [{ stage: 1, count: 1 }, { stage: 3, count: 2 }]);
});

test('顽固词按错误次数降序、阶段升序且最多50个', (db, repo) => {
  for (let id = 1; id <= 54; id++) {
    seed(db, id);
    legacy(db, id, id === 54 ? 9 : (id % 3) + 1, now, 0, id === 53 ? 2 : 5);
  }
  const words = repo.getStubbornWords(3);
  assert.equal(words.length, 50);
  assert.equal(words.some(word => word.id === 53 || word.id === 54), false);
  assert.ok(words.every((word, index) => !index || word.stage >= words[index - 1].stage));
  assert.equal(repo.getStubbornWords(6).length, 0);
});

test('词库导入数量与自定义列表从关联表获取', (db, repo) => {
  seed(db, 1, ['cet4', 'custom_a']); seed(db, 2, ['custom_a', 'custom_b']); seed(db, 3, ['cet6']);
  assert.equal(repo.getImportedWordlistCount('cet4'), 1);
  assert.equal(repo.getImportedWordlistCount('missing'), 0);
  assert.deepEqual(repo.getCustomWordlists(), [
    { id: 'custom_a', importedCount: 2 }, { id: 'custom_b', importedCount: 1 }
  ]);
});

test('进度预测摘要跨库去重，区分未学、学习和已掌握并兼容空选择', (db, repo) => {
  seed(db, 1, ['cet4', 'cet6']); seed(db, 2); seed(db, 3); seed(db, 4, ['custom']);
  legacy(db, 1, 2, now); legacy(db, 2, 9, now);
  assert.deepEqual(repo.getProgressSummary(['cet4', 'cet6']),
    { totalWords: 3, learnedWords: 1, masteredWords: 1, remainingWords: 1 });
  assert.deepEqual(repo.getProgressSummary([]),
    { totalWords: 0, learnedWords: 0, masteredWords: 0, remainingWords: 0 });
});

test('复习平摊只调整选中逾期词的队列时间，保留FSRS状态、日志和统计', (db, repo) => {
  for (let id = 1; id <= 5; id++) {
    seed(db, id, id === 5 ? ['cet6'] : ['cet4']);
    review(db, id, 'easy', now - 30 * DAY);
  }
  seed(db, 6); review(db, 6, 'easy', now);
  seed(db, 7); legacy(db, 7, 9, now - DAY);
  const before = snapshot(db);
  assert.deepEqual(repo.smoothOverdueReviews(2, ['cet4'], now), { success: true, count: 4, days: 2 });
  const after = snapshot(db);
  assert.deepEqual(after.history, before.history);
  assert.deepEqual(after.daily, before.daily);
  for (const previous of before.progress) {
    const updated = after.progress.find(row => row.word_id === previous.word_id);
    const { next_review_at: oldDue, ...oldState } = previous;
    const { next_review_at: newDue, ...newState } = updated;
    assert.deepEqual(newState, oldState);
    if (previous.word_id <= 4) {
      assert.ok(newDue === now || Math.abs(newDue - now - DAY) <= 3600000);
    } else assert.equal(newDue, oldDue);
  }
  assert.equal(after.progress.filter(row => row.word_id <= 4 && row.next_review_at === now).length, 2);
  assert.deepEqual(repo.smoothOverdueReviews(99, ['missing'], now), { success: true, count: 0, days: 30 });
});

test('撤销新词清除进度和对应日志，回退评分原日期而不影响次日统计', (db, repo) => {
  seed(db, 1); seed(db, 2);
  const undoInfo = review(db, 1, 'known', now - DAY);
  review(db, 2, 'known', now);
  assert.equal(repo.undoReview(undoInfo), true);
  assert.equal(db.prepare('SELECT * FROM progress WHERE word_id=1').get(), undefined);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM review_history WHERE word_id=1').get().count, 0);
  assert.equal(repo.getDailyLearned(now - DAY), 0);
  assert.equal(repo.getDailyLearned(now), 1);
  assert.equal(repo.getStats(null, now - DAY).today.words_reviewed, 0);
  assert.equal(repo.undoReview(undoInfo), false);
});

test('撤销已有评分精确恢复所有进度字段和FSRS卡片，保留先前日志', (db, repo) => {
  seed(db, 1); review(db, 1, 'easy', now - DAY);
  const before = snapshot(db);
  const undoInfo = review(db, 1, 'unknown', now);
  assert.equal(repo.undoReview(undoInfo), true);
  const after = snapshot(db);
  assert.deepEqual(after.progress, before.progress);
  assert.deepEqual(after.history, before.history);
  assert.equal(repo.getStats(null, now).today.words_reviewed, 0);
  assert.equal(repo.getDailyLearned(now - DAY), 1);
});

test('后续同词评分使旧撤销失效，所有数据保持完整', (db, repo) => {
  seed(db, 1);
  const undoInfo = review(db, 1, 'known', now);
  review(db, 1, 'unknown', now + 600000);
  const before = snapshot(db);
  assert.equal(repo.undoReview(undoInfo), false);
  assert.deepEqual(snapshot(db), before);
});

test('日志相同但FSRS卡片被恢复或进度已删除时拒绝陈旧撤销', (db, repo) => {
  seed(db, 1);
  const undoInfo = review(db, 1, 'known', now);
  db.prepare('UPDATE progress SET fsrs_card = ? WHERE word_id=1').run('{"restored":true}');
  const before = snapshot(db);
  assert.equal(repo.undoReview(undoInfo), false);
  assert.deepEqual(snapshot(db), before);
  db.prepare('DELETE FROM progress WHERE word_id=1').run();
  assert.equal(repo.undoReview(undoInfo), false);
});

test('撤销统计失败会回滚进度和历史删除，可在失败修复后重试', (db, repo) => {
  seed(db, 1);
  const undoInfo = review(db, 1, 'known', now);
  const before = snapshot(db);
  db.exec("CREATE TRIGGER reject_undo BEFORE UPDATE ON daily_stats BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  assert.throws(() => repo.undoReview(undoInfo), /test failure/);
  assert.deepEqual(snapshot(db), before);
  db.exec('DROP TRIGGER reject_undo');
  assert.equal(repo.undoReview(undoInfo), true);
});

console.log(`\n学习存储层：${passed} 项真实 SQLite 测试全部通过`);
