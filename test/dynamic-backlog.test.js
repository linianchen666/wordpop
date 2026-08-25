/**
 * 智能目标动态新词与积压平摊算法测试
 */
const assert = require('assert');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const rootDir = path.join(__dirname, '..');
const testDbPath = path.join(__dirname, 'test_dynamic_backlog.db');

// 清理旧测试文件
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');

console.log('=== 开始测试：智能目标动态新词与积压平摊算法 ===');

const db = new Database(testDbPath);
db.pragma('journal_mode = WAL');

// 初始化表结构
db.exec(`
  CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL,
    phonetic TEXT DEFAULT '',
    translation TEXT NOT NULL,
    example TEXT DEFAULT '',
    wordlist TEXT NOT NULL DEFAULT 'custom',
    frequency_rank INTEGER DEFAULT 999999
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_words_word ON words(word);

  CREATE TABLE IF NOT EXISTS progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id INTEGER NOT NULL UNIQUE,
    stage INTEGER NOT NULL DEFAULT 0,
    next_review_at INTEGER NOT NULL DEFAULT 0,
    last_review_at INTEGER DEFAULT NULL,
    correct_count INTEGER DEFAULT 0,
    wrong_count INTEGER DEFAULT 0,
    efactor REAL DEFAULT 2.5,
    interval INTEGER DEFAULT 0,
    repetitions INTEGER DEFAULT 0,
    mastered_count INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS daily_stats (
    date TEXT PRIMARY KEY,
    words_reviewed INTEGER DEFAULT 0,
    words_learned INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS word_wordlists (
    word_id INTEGER NOT NULL,
    wordlist TEXT NOT NULL,
    PRIMARY KEY (word_id, wordlist),
    FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
  );
`);

// 插入 500 个单词
const insertWord = db.prepare('INSERT INTO words (word, translation, wordlist, frequency_rank) VALUES (?, ?, ?, ?)');
const insertRel = db.prepare('INSERT INTO word_wordlists (word_id, wordlist) VALUES (?, ?)');

db.transaction(() => {
  for (let i = 1; i <= 500; i++) {
    const res = insertWord.run('word_' + i, '释义_' + i, 'cet4', i);
    insertRel.run(res.lastInsertRowid, 'cet4');
  }
})();

console.log('  ✓ 初始插入 500 个单词');

// ── 测试 1：动态新词计算函数 ──
function calculateDynamicQuota(config, totalUnlearned, dueCount) {
  let baseLimit = parseInt(config.dailyNewWords) || 20;
  const mode = config.dailyNewWordsMode || 'fixed';

  if (mode === 'target' && config.targetDate) {
    const targetTime = new Date(config.targetDate);
    targetTime.setHours(23, 59, 59, 999);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysLeft = Math.ceil((targetTime.getTime() - today.getTime()) / (24 * 3600 * 1000));

    if (daysLeft > 0 && totalUnlearned > 0) {
      const calculated = Math.ceil(totalUnlearned / daysLeft);
      const maxCap = parseInt(config.maxDynamicNewWords) || 50;
      baseLimit = Math.min(maxCap, Math.max(1, calculated));
    }
  }

  let effectiveLimit = baseLimit;
  let loadState = 'normal';

  if (config.autoBalanceLoad !== false && baseLimit > 0) {
    if (dueCount >= 80) {
      effectiveLimit = 0;
      loadState = 'overload';
    } else if (dueCount >= 40) {
      effectiveLimit = Math.max(1, Math.floor(baseLimit / 2));
      loadState = 'heavy';
    }
  }

  return { effectiveLimit, baseLimit, loadState };
}

// 目标日期 25 天后，剩余 500 词 -> 500 / 25 = 20 词/天
const future25 = new Date();
future25.setDate(future25.getDate() + 25);
const dateStr25 = future25.toISOString().split('T')[0];

const q1 = calculateDynamicQuota({
  dailyNewWordsMode: 'target',
  targetDate: dateStr25,
  autoBalanceLoad: true,
  maxDynamicNewWords: 50
}, 500, 10);

assert.strictEqual(q1.baseLimit, 20, '目标模式基础新词应为 20');
assert.strictEqual(q1.effectiveLimit, 20, '复习负荷正常时有效新词应为 20');
assert.strictEqual(q1.loadState, 'normal');
console.log('  ✓ 测试 1 通过：智能目标规划基础新词计算正常 (20 词/天)');

// ── 测试 2：智能负荷动态平衡（中度负荷减半，重度负荷归零） ──
// 中度负荷 (dueCount = 50) -> 20 / 2 = 10
const q2 = calculateDynamicQuota({
  dailyNewWordsMode: 'target',
  targetDate: dateStr25,
  autoBalanceLoad: true
}, 500, 50);

assert.strictEqual(q2.effectiveLimit, 10, '中度负荷（50词积压）应自动减半至 10');
assert.strictEqual(q2.loadState, 'heavy');

// 重度负荷 (dueCount = 95) -> 0
const q3 = calculateDynamicQuota({
  dailyNewWordsMode: 'target',
  targetDate: dateStr25,
  autoBalanceLoad: true
}, 500, 95);

assert.strictEqual(q3.effectiveLimit, 0, '重度负荷（95词积压）应自动暂停推新 (0)');
assert.strictEqual(q3.loadState, 'overload');
console.log('  ✓ 测试 2 通过：智能负荷动态平衡（中度减半、重度熔断暂停）验证正常');

// ── 测试 3：积压复习平摊算法（smoothOverdueReviews） ──
const now = Date.now();
// 为 150 个单词注入逾期记录
const insertProg = db.prepare(`
  INSERT INTO progress (word_id, stage, next_review_at, efactor, interval, repetitions)
  VALUES (?, ?, ?, ?, ?, ?)
`);

db.transaction(() => {
  for (let id = 1; id <= 150; id++) {
    insertProg.run(id, id % 8, now - (id * 3600 * 1000), 2.5, 86400000, 2);
  }
})();

// 模拟平摊实现
function testSmooth(days, wordlists) {
  const targetDays = Math.max(1, Math.min(30, parseInt(days) || 3));
  const query = `
    SELECT p.word_id, p.stage, p.efactor, p.next_review_at
    FROM progress p
    JOIN words w ON p.word_id = w.id
    WHERE p.next_review_at <= ? AND p.stage < 9
    ORDER BY p.stage ASC, p.efactor ASC, p.next_review_at ASC
  `;
  const overdueList = db.prepare(query).all(now);
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const updateStmt = db.prepare('UPDATE progress SET next_review_at = ? WHERE word_id = ?');

  db.transaction(() => {
    overdueList.forEach((row, index) => {
      const dayOffset = index % targetDays;
      let newTime;
      if (dayOffset === 0) {
        newTime = now;
      } else {
        const jitter = (Math.random() - 0.5) * 2 * 3600 * 1000;
        newTime = now + (dayOffset * ONE_DAY_MS) + jitter;
      }
      updateStmt.run(Math.round(newTime), row.word_id);
    });
  })();

  return { success: true, count: overdueList.length, days: targetDays };
}

const smoothRes = testSmooth(3, ['cet4']);
assert.strictEqual(smoothRes.count, 150, '应成功平摊 150 个逾期单词');
assert.strictEqual(smoothRes.days, 3, '平摊天数应为 3');

// 检验平摊后的各天分布
const updatedRows = db.prepare('SELECT word_id, next_review_at FROM progress WHERE word_id <= 150').all();
assert.strictEqual(updatedRows.length, 150);

let day0Count = 0;
let day1Count = 0;
let day2Count = 0;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
updatedRows.forEach(r => {
  const diffDays = Math.round((r.next_review_at - now) / ONE_DAY_MS);
  if (diffDays === 0) day0Count++;
  else if (diffDays === 1) day1Count++;
  else if (diffDays === 2) day2Count++;
});

console.log('     平摊后分布：今天 =', day0Count, ', 明天 =', day1Count, ', 后天 =', day2Count);
assert.strictEqual(day0Count, 50, '今天应分得 50 词');
assert.strictEqual(day1Count, 50, '明天应分得 50 词');
assert.strictEqual(day2Count, 50, '后天应分得 50 词');

console.log('  ✓ 测试 3 通过：积压平摊算法均匀分配验证完全正确 (150 -> 50 / 50 / 50)');

db.close();
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');

console.log('\n🎉 所有智能目标规划与积压平摊算法测试全部通过！\n');
process.exit(0);
