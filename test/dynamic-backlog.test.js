/** Actual quota policy and SQLite backlog repository regression tests. */
const assert = require('assert');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { calculateDailyQuota } = require('../src/main/study-policy');
const { createLearningRepository } = require('../src/main/learning-repository');
const { recordReview } = require('../src/main/review-progress');
const { createScheduler } = require('../src/main/study-scheduler');
const { cardForProgress } = require('../src/main/review-algorithm');
const { State } = require('ts-fsrs');

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

  test('按学习状态与FSRS遗忘风险分组，稳固词后移且不改记忆状态', () => {
    db.prepare('UPDATE progress SET next_review_at=? WHERE word_id<=150').run(now + DAY);
    const cases = [[1, State.Review, 90, 7], [2, State.Review, 1, 7],
      [3, State.Relearning, 90, 0], [4, State.Review, 10, 14],
      [5, State.Review, 30, 2], [6, State.Review, 5, 7]];
    for (const [id, state, stability, elapsed] of cases) {
      const card = cardForProgress(null, now);
      card.state = state; card.stability = stability;
      card.last_review = new Date(now - elapsed * DAY);
      db.prepare('UPDATE progress SET fsrs_card=?,next_review_at=? WHERE word_id=?')
        .run(JSON.stringify(card), now - HOUR, id);
    }
    const before = allProgress();
    const oldHistory = history(), oldStats = dailyStats();
    repository.smoothOverdueReviews(3, ['cet4'], now);
    const rows = allProgress();
    for (const [ids, offset] of [[[3,2], 0], [[6,4], 1], [[1,5], 2]]) {
      for (const id of ids) {
        const row = rows.find(p => p.word_id === id);
        assert.equal(Math.round((row.next_review_at - now) / DAY), offset);
        assert.equal(row.fsrs_card, before.find(p => p.word_id === id).fsrs_card);
      }
    }
    assert.deepEqual(history(), oldHistory); assert.deepEqual(dailyStats(), oldStats);
  });

  test('实际待复习总数超过30也正确，平摊保护当前词并随评分减少', () => {
    db.prepare('UPDATE progress SET next_review_at=? WHERE word_id<=150').run(now - HOUR);
    for (const id of [200,201]) {
      insert.run(id, 'new_'+id, '新词', 'cet4', id); relate.run(id, 'cet4');
    }
    const callbacks = [];
    const scheduler = createScheduler({ repository,
      getConfig: () => ({ selectedWordlists: ['cet4'], dailyNewWords: 20, autoBalanceLoad: false, batchSize: 0 }),
      recordReview: (id, action, time) => recordReview(db, id, action, time), now: () => now,
      setTimeout: callback => { callbacks.push(callback); return callbacks.length; }, clearTimeout() {} });
    const events = []; scheduler.on('word', event => events.push(event));
    scheduler.start();
    assert.equal(events[0].pendingCounts.review, 150);
    assert.equal(events[0].pendingCounts.new, 2, '只剩两个未学词时不能显示配额余量');
    const current = scheduler.currentWord.id;
    const currentBefore = db.prepare('SELECT * FROM progress WHERE word_id=?').get(current);
    assert.equal(repository.smoothOverdueReviews(3, ['cet4'], now, current).count, 149);
    assert.deepEqual(db.prepare('SELECT * FROM progress WHERE word_id=?').get(current), currentBefore);
    scheduler.reloadQueue();
    assert.equal(scheduler.getStatus().pendingReviewCount, 51);
    assert.equal(scheduler.currentWord.id, current);
    scheduler.markKnown(); callbacks.at(-1)();
    assert.equal(events.at(-1).pendingCounts.review, 50);
    assert.ok(events.at(-1).queueRemaining !== events.at(-1).pendingCounts.review);
    scheduler.stop();
  });

  test('深夜平摊的随机时间不跨越分配的本地日期', () => {
    const late = new Date(now); late.setHours(23, 59, 59, 900);
    db.prepare('UPDATE progress SET next_review_at=? WHERE word_id<=150').run(late.getTime() - HOUR);
    const random = Math.random;
    try {
      Math.random = () => 1;
      repository.smoothOverdueReviews(3, ['cet4'], late.getTime());
      const days = [0,0,0];
      for (const row of db.prepare('SELECT next_review_at FROM progress WHERE word_id<=150').all()) {
        const date = new Date(row.next_review_at);
        const offset = date.getDate() - late.getDate();
        assert.ok(offset >= 0 && offset <= 2); days[offset]++;
      }
      assert.deepEqual(days, [50,50,50]);
    } finally { Math.random = random; }
  });
} finally {
  Module._load = originalLoad;
  if (productionDb) productionDb.closeDatabase();
  if (cachedDb) require.cache[dbModulePath] = cachedDb;
  else delete require.cache[dbModulePath];
  fs.rmSync(testDir, { recursive: true, force: true });
}
console.log(`\n🎉 ${passed} 项真实业务回归测试全部通过！\n`);
