/** Actual quota policy and SQLite backlog repository regression tests. */
const assert = require('assert');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { calculateDailyQuota } = require('../src/main/study-policy');
const { createLearningRepository } = require('../src/main/learning-repository');
const { recordReview } = require('../src/main/review-progress');

const DAY = 86400000;
const HOUR = 3600000;
const now = new Date(2026, 9, 9, 12).getTime();
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`  ✓ ${name}`); }
console.log('=== 智能目标规划与真实积压平摊回归 ===');

const targetConfig = {
  dailyNewWordsMode: 'target', targetDate: '2026-11-03',
  autoBalanceLoad: true, maxDynamicNewWords: 50
};
const quota = (config, unlearnedCount, dueCount) =>
  calculateDailyQuota(config, { unlearnedCount, dueCount }, now);

test('目标日期依据注入时间计算配额，不依赖运行测试的日期', () => {
  const actual = quota(targetConfig, 500, 10);
  assert.strictEqual(actual.baseLimit, 20);
  assert.strictEqual(actual.effectiveLimit, 20);
  assert.strictEqual(actual.loadState, 'normal');
  assert.strictEqual(actual.mode, 'target');
  assert.strictEqual(actual.dueCount, 10);
});

test('40与80个到期词是减半和暂停推新的边界', () => {
  const config = { dailyNewWords: 20, autoBalanceLoad: true };
  for (const [due, effective, state] of [[39, 20, 'normal'], [40, 10, 'heavy'],
    [79, 10, 'heavy'], [80, 0, 'overload']]) {
    const actual = quota(config, 500, due);
    assert.strictEqual(actual.effectiveLimit, effective);
    assert.strictEqual(actual.loadState, state);
  }
});

test('关闭负荷调整保留配额，小配额减半至少保留一个新词', () => {
  assert.strictEqual(quota({ dailyNewWords: 7, autoBalanceLoad: false }, 500, 100).effectiveLimit, 7);
  assert.strictEqual(quota({ dailyNewWords: 1 }, 500, 40).effectiveLimit, 1);
});

test('目标模式遵守每日上限，词库学完时配额归零', () => {
  assert.strictEqual(quota(targetConfig, 5000, 0).baseLimit, 50);
  assert.strictEqual(quota(targetConfig, 0, 0).effectiveLimit, 0);
  assert.strictEqual(quota({ ...targetConfig, targetDate: '2026-10-01', dailyNewWords: 13 }, 500, 0).baseLimit, 13);
});

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wordpop-backlog-'));
const originalLoad = Module._load;
const dbModulePath = require.resolve('../src/main/db');
const cachedDb = require.cache[dbModulePath];
let productionDb;
try {
  Module._load = function(request) {
    if (request === 'electron') return { app: { isPackaged: false, getPath: () => testDir } };
    return originalLoad.apply(this, arguments);
  };
  delete require.cache[dbModulePath];
  productionDb = require('../src/main/db');
  Module._load = originalLoad;
  const db = productionDb.initDatabase();
  // Build the real schema, then replace built-in vocabulary with small deterministic fixtures.
  db.exec('DELETE FROM review_history; DELETE FROM progress; DELETE FROM daily_stats; DELETE FROM word_wordlists; DELETE FROM words;');
  const repository = createLearningRepository(() => db);
  const insert = db.prepare('INSERT INTO words (id,word,translation,wordlist,frequency_rank) VALUES (?,?,?,?,?)');
  const relate = db.prepare('INSERT INTO word_wordlists (word_id,wordlist) VALUES (?,?)');
  db.transaction(() => {
    for (let id = 1; id <= 153; id++) {
      const list = id === 151 ? 'cet6' : 'cet4';
      insert.run(id, `backlog_${id}`, `释义_${id}`, list, id);
      relate.run(id, list);
      recordReview(db, id, 'known', now - id * HOUR);
    }
    relate.run(1, 'cet6');
    db.prepare('UPDATE progress SET next_review_at=? WHERE word_id=152').run(now + DAY);
    db.prepare('UPDATE progress SET stage=9 WHERE word_id=153').run();
  })();
  const allProgress = () => db.prepare('SELECT * FROM progress ORDER BY word_id').all();
  const history = () => db.prepare('SELECT * FROM review_history ORDER BY id').all();
  const dailyStats = () => db.prepare('SELECT * FROM daily_stats ORDER BY date').all();

  test('真实 repository 统计选定词库，跨词库共享词只计一次', () => {
    assert.strictEqual(repository.countDue(['cet4'], now), 150);
    assert.strictEqual(repository.countDue(['cet4', 'cet6'], now), 151);
    assert.strictEqual(repository.countUnlearned(['cet4']), 0);
  });

  test('真实平摊将150个到期词均分为三天，隔离未选择词库及未来/掌握词', () => {
    const before = allProgress();
    const beforeHistory = history();
    const beforeStats = dailyStats();
    assert.deepStrictEqual(repository.smoothOverdueReviews(3, ['cet4'], now),
      { success: true, count: 150, days: 3 });
    const after = allProgress();
    const distribution = [0, 0, 0];
    for (let i = 0; i < after.length; i++) {
      const row = after[i];
      const previous = before[i];
      if (row.word_id > 150) {
        assert.deepStrictEqual(row, previous);
      } else {
        const { next_review_at: ignoredBefore, ...originalMemory } = previous;
        const { next_review_at: nextReview, ...currentMemory } = row;
        assert.deepStrictEqual(currentMemory, originalMemory, '平摊不能改动FSRS记忆状态和答题计数');
        const day = Math.round((nextReview - now) / DAY);
        assert.ok(day >= 0 && day <= 2);
        assert.ok(Math.abs(nextReview - now - day * DAY) <= HOUR, '每日抖动应在一小时内');
        distribution[day]++;
      }
    }
    assert.deepStrictEqual(distribution, [50, 50, 50]);
    assert.deepStrictEqual(history(), beforeHistory, '延期不能伪造新的复习记录');
    assert.deepStrictEqual(dailyStats(), beforeStats, '延期不能伪造学习统计');
  });

  test('数据库更新失败时真实平摊回滚整批到期时间', () => {
    db.prepare('UPDATE progress SET next_review_at=? WHERE word_id<=150').run(now - HOUR);
    const before = allProgress();
    db.exec("CREATE TRIGGER reject_deferral BEFORE UPDATE OF next_review_at ON progress WHEN NEW.word_id=10 BEGIN SELECT RAISE(ABORT,'test deferral failure'); END;");
    try {
      assert.throws(() => repository.smoothOverdueReviews(3, ['cet4'], now), /test deferral failure/);
      assert.deepStrictEqual(allProgress(), before);
    } finally {
      db.exec('DROP TRIGGER reject_deferral');
    }
  });
} finally {
  Module._load = originalLoad;
  if (productionDb) productionDb.closeDatabase();
  if (cachedDb) require.cache[dbModulePath] = cachedDb;
  else delete require.cache[dbModulePath];
  fs.rmSync(testDir, { recursive: true, force: true });
}
console.log(`\n🎉 ${passed} 项真实业务回归测试全部通过！\n`);
