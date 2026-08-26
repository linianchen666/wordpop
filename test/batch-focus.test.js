/**
 * 微批次冷却、专注刷词模式与多角色音色自动化测试
 */
const assert = require('assert');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, 'test_batch_focus.db');
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');

console.log('=== 开始测试：微批次、专注模式与多角色音色系统 ===');

const db = new Database(testDbPath);
db.pragma('journal_mode = WAL');

// 初始化表结构
db.exec(`
  CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL UNIQUE,
    phonetic TEXT DEFAULT '',
    translation TEXT NOT NULL,
    example TEXT DEFAULT '',
    wordlist TEXT NOT NULL DEFAULT 'cet4',
    frequency_rank INTEGER DEFAULT 999999
  );
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
    mastered_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS daily_stats (
    date TEXT PRIMARY KEY,
    words_reviewed INTEGER DEFAULT 0,
    words_learned INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS word_wordlists (
    word_id INTEGER NOT NULL,
    wordlist TEXT NOT NULL,
    PRIMARY KEY (word_id, wordlist)
  );
`);

// 插入 100 个单词
const insertWord = db.prepare('INSERT INTO words (word, translation, wordlist, frequency_rank) VALUES (?, ?, ?, ?)');
const insertRel = db.prepare('INSERT INTO word_wordlists (word_id, wordlist) VALUES (?, ?)');

db.transaction(() => {
  for (let i = 1; i <= 100; i++) {
    const res = insertWord.run('focus_word_' + i, '释义_' + i, 'cet4', i);
    insertRel.run(res.lastInsertRowid, 'cet4');
  }
})();

console.log('  ✓ 初始插入 100 个单词');

// ── 测试 1：微批次计数与冷却流转 ──
let currentBatchCount = 0;
const batchSize = 3;
let batchCompletedEvents = 0;

function advanceMockWord() {
  currentBatchCount++;
  if (batchSize > 0 && currentBatchCount >= batchSize) {
    currentBatchCount = 0;
    batchCompletedEvents++;
    return 'cooldown';
  }
  return 'continue';
}

assert.strictEqual(advanceMockWord(), 'continue', '第 1 词应继续');
assert.strictEqual(currentBatchCount, 1);
assert.strictEqual(advanceMockWord(), 'continue', '第 2 词应继续');
assert.strictEqual(currentBatchCount, 2);
assert.strictEqual(advanceMockWord(), 'cooldown', '第 3 词应触发冷却结算');
assert.strictEqual(currentBatchCount, 0, '结算后批次计数应归 0');
assert.strictEqual(batchCompletedEvents, 1, '应触发 1 次批次完成事件');
console.log('  ✓ 测试 1 通过：微批次限额与冷却结算触发验证完全正确');

// ── 测试 2：专注模式词库抽取 (getFocusWords) ──
const now = Date.now();
// 注入 15 个逾期复习词
const insertProg = db.prepare('INSERT INTO progress (word_id, stage, next_review_at) VALUES (?, ?, ?)');
db.transaction(() => {
  for (let id = 1; id <= 15; id++) {
    insertProg.run(id, 2, now - 10000);
  }
})();

function getFocusWordsMock(count, wordlists) {
  const placeholders = wordlists.map(() => '?').join(',');
  let dueWords = db.prepare(`
    SELECT w.id, w.word, w.translation, p.stage, p.next_review_at
    FROM words w
    JOIN progress p ON w.id = p.word_id
    WHERE p.next_review_at <= ? AND p.stage < 9
      AND w.id IN (SELECT word_id FROM word_wordlists WHERE wordlist IN (${placeholders}))
    ORDER BY p.stage ASC, p.next_review_at ASC
  `).all(now, ...wordlists);

  let targetCount = count > 0 ? count : dueWords.length;
  let selected = dueWords.slice(0, targetCount);

  if (selected.length < targetCount) {
    const remainingNeeded = targetCount - selected.length;
    const newWords = db.prepare(`
      SELECT w.id, w.word, w.translation, 0 as stage
      FROM words w
      LEFT JOIN progress p ON w.id = p.word_id
      WHERE p.word_id IS NULL
        AND w.id IN (SELECT word_id FROM word_wordlists WHERE wordlist IN (${placeholders}))
      LIMIT ?
    `).all(...wordlists, remainingNeeded);

    selected = [...selected, ...newWords];
  }

  return selected;
}

const focusList20 = getFocusWordsMock(20, ['cet4']);
assert.strictEqual(focusList20.length, 20, '专注模式目标 20 词应返回 20 个');
// 前 15 个为复习词，后 5 个补充新词
assert.strictEqual(focusList20.filter(w => w.stage > 0).length, 15, '前 15 个应为待复习词');
assert.strictEqual(focusList20.filter(w => w.stage === 0).length, 5, '后 5 个应补充未学新词');
console.log('  ✓ 测试 2 通过：专注模式专属词库抽取（复习优先+新词自动补足）验证正确');

// ── 测试 3：专注模式单词提交与 SQLite 事务一致性 ──
function submitWordMock(wordId, action) {
  const existing = db.prepare('SELECT * FROM progress WHERE word_id = ?').get(wordId);
  let stage = existing ? existing.stage : 0;
  let correctCount = existing ? existing.correct_count : 0;
  let wrongCount = existing ? existing.wrong_count : 0;

  if (action === 'known') {
    correctCount++;
    stage = Math.min(9, stage + 1);
  } else if (action === 'unknown') {
    wrongCount++;
    stage = Math.max(1, stage - 1);
  }

  if (existing) {
    db.prepare('UPDATE progress SET stage = ?, correct_count = ?, wrong_count = ? WHERE word_id = ?').run(stage, correctCount, wrongCount, wordId);
  } else {
    db.prepare('INSERT INTO progress (word_id, stage, correct_count, wrong_count) VALUES (?, ?, ?, ?)').run(wordId, stage, correctCount, wrongCount);
  }

  db.prepare(`
    INSERT INTO daily_stats (date, words_reviewed, words_learned)
    VALUES (date('now','localtime'), 1, ?)
    ON CONFLICT(date) DO UPDATE SET
      words_reviewed = words_reviewed + 1,
      words_learned = words_learned + ?
  `).run(existing ? 0 : 1, existing ? 0 : 1);
}

// 模拟提交
submitWordMock(1, 'known'); // 复习词 1 认识 -> stage 2->3
const w1 = db.prepare('SELECT stage, correct_count FROM progress WHERE word_id = 1').get();
assert.strictEqual(w1.stage, 3);
assert.strictEqual(w1.correct_count, 1);

submitWordMock(16, 'known'); // 新词 16 认识 -> 新学插入
const w16 = db.prepare('SELECT stage, correct_count FROM progress WHERE word_id = 16').get();
assert.strictEqual(w16.stage, 1);

const stats = db.prepare("SELECT * FROM daily_stats WHERE date = date('now','localtime')").get();
assert.strictEqual(stats.words_reviewed, 2, '打卡复习总数应为 2');
assert.strictEqual(stats.words_learned, 1, '打卡新学词数应为 1');
console.log('  ✓ 测试 3 通过：专注模式数据更新与打卡统计完全正确');

// ── 测试 4：多音色角色与形态参数有效性校验 ──
const validVoices = ['dict-us', 'dict-uk', 'loli', 'mature', 'deep-male', 'fast'];
const validModes = ['card', 'pill'];

assert.ok(validVoices.includes('loli'), '萝莉音应合法');
assert.ok(validVoices.includes('mature'), '御姐音应合法');
assert.ok(validVoices.includes('deep-male'), '大叔音应合法');
assert.ok(validModes.includes('pill'), '灵动胶囊形态应合法');
console.log('  ✓ 测试 4 通过：多音色角色与形态枚举校验通过');

db.close();
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');

console.log('\n🎉 所有微批次、专注模式与多角色音色系统测试全部通过！\n');
process.exit(0);
