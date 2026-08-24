/**
 * 词库多对多映射与跨词库学习进度继承测试
 */
const assert = require('assert');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const rootDir = path.join(__dirname, '..');
const testDbPath = path.join(__dirname, 'test_wordlist_mapping.db');
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

const db = new Database(testDbPath);
db.pragma('journal_mode = WAL');

console.log('=== 开始测试：词库多对多映射与进度继承 ===');

// 1. 初始化完整 Schema
db.exec(`
  CREATE TABLE words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL,
    phonetic TEXT DEFAULT '',
    translation TEXT NOT NULL,
    example TEXT DEFAULT '',
    wordlist TEXT NOT NULL DEFAULT 'custom',
    frequency_rank INTEGER DEFAULT 999999,
    created_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
  );
  CREATE UNIQUE INDEX idx_words_word ON words(word);

  CREATE TABLE progress (
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

  CREATE TABLE daily_stats (
    date TEXT PRIMARY KEY,
    words_reviewed INTEGER DEFAULT 0,
    words_learned INTEGER DEFAULT 0
  );

  CREATE TABLE word_wordlists (
    word_id INTEGER NOT NULL,
    wordlist TEXT NOT NULL,
    PRIMARY KEY (word_id, wordlist),
    FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
  );
  CREATE INDEX idx_word_wordlists_wordlist ON word_wordlists(wordlist);
  CREATE INDEX idx_word_wordlists_word_id ON word_wordlists(word_id);
`);

// 2. 模拟先导入 CET-4
const c4Data = JSON.parse(fs.readFileSync(path.join(rootDir, 'src/data/wordlists/cet4.json'), 'utf-8'));
const insertWordStmt = db.prepare(`
  INSERT OR IGNORE INTO words (word, phonetic, translation, example, wordlist, frequency_rank)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const getWordIdStmt = db.prepare('SELECT id FROM words WHERE word = ?');
const insertRelStmt = db.prepare(`
  INSERT OR IGNORE INTO word_wordlists (word_id, wordlist) VALUES (?, ?)
`);

db.transaction(() => {
  for (const w of c4Data.words) {
    const cleanWord = w.word.trim().toLowerCase();
    insertWordStmt.run(cleanWord, w.phonetic || '', w.translation || '', w.example || '', 'cet4', 100);
    const row = getWordIdStmt.get(cleanWord);
    if (row) {
      insertRelStmt.run(row.id, 'cet4');
    }
  }
})();

console.log('  ✓ 导入 CET-4 完成，词数:', db.prepare("SELECT COUNT(*) c FROM word_wordlists WHERE wordlist='cet4'").get().c);
assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM word_wordlists WHERE wordlist='cet4'").get().c, 4544);

// 3. 模拟用户学习了 1000 个单词（300 个 stage 9 已掌握，700 个 stage 3 复习中）
const insertProgStmt = db.prepare(`
  INSERT INTO progress (word_id, stage, next_review_at, efactor, interval, repetitions)
  VALUES (?, ?, ?, ?, ?, ?)
`);

db.transaction(() => {
  for (let id = 1; id <= 300; id++) {
    insertProgStmt.run(id, 9, 0, 2.7, 90*86400*1000, 9);
  }
  for (let id = 301; id <= 1000; id++) {
    insertProgStmt.run(id, 3, Date.now() - 1000, 2.5, 4*3600*1000, 3);
  }
})();
console.log('  ✓ 模拟学习记录注入完成: 300 熟知, 700 复习中');

// 4. 导入 CET-6
const c6Data = JSON.parse(fs.readFileSync(path.join(rootDir, 'src/data/wordlists/cet6.json'), 'utf-8'));
db.transaction(() => {
  for (const w of c6Data.words) {
    const cleanWord = w.word.trim().toLowerCase();
    insertWordStmt.run(cleanWord, w.phonetic || '', w.translation || '', w.example || '', 'cet6', 200);
    const row = getWordIdStmt.get(cleanWord);
    if (row) {
      insertRelStmt.run(row.id, 'cet6');
    }
  }
})();

const c6Count = db.prepare("SELECT COUNT(*) c FROM word_wordlists WHERE wordlist='cet6'").get().c;
console.log('  ✓ 导入 CET-6 完成，word_wordlists 记录数:', c6Count);
assert.strictEqual(c6Count, 3991, 'CET-6 词数应该正好为 3991');

// 5. 验证单选 CET-6 时的进度汇总
function getSummary(wordlistIds) {
  const placeholders = wordlistIds.map(() => '?').join(',');
  const total = db.prepare(`SELECT COUNT(DISTINCT word_id) as total FROM word_wordlists WHERE wordlist IN (${placeholders})`).get(...wordlistIds).total;
  const learned = db.prepare(`SELECT COUNT(DISTINCT p.word_id) as learned FROM progress p WHERE p.stage < 9 AND p.word_id IN (SELECT word_id FROM word_wordlists WHERE wordlist IN (${placeholders}))`).get(...wordlistIds).learned;
  const mastered = db.prepare(`SELECT COUNT(DISTINCT p.word_id) as mastered FROM progress p WHERE p.stage >= 9 AND p.word_id IN (SELECT word_id FROM word_wordlists WHERE wordlist IN (${placeholders}))`).get(...wordlistIds).mastered;
  const remaining = total - learned - mastered;
  return { total, learned, mastered, remaining };
}

const c6Summary = getSummary(['cet6']);
console.log('  ✓ CET-6 进度摘要统计:');
console.log('     总词数 (需为 3991):', c6Summary.total);
console.log('     四级已继承的熟知词 (已掌握):', c6Summary.mastered);
console.log('     四级已继承的在背词 (复习中):', c6Summary.learned);
console.log('     剩余待学新词:', c6Summary.remaining);

assert.strictEqual(c6Summary.total, 3991);
assert.ok(c6Summary.mastered > 0, '应该继承四级已掌握的单词');
assert.ok(c6Summary.learned > 0, '应该继承四级复习中的单词');
assert.strictEqual(c6Summary.total, c6Summary.learned + c6Summary.mastered + c6Summary.remaining);

// 6. 验证调度器加载队列
const dueWords = db.prepare(`
  SELECT w.id, w.word, p.stage
  FROM words w
  JOIN progress p ON w.id = p.word_id
  WHERE p.next_review_at <= ? AND p.stage < 9
    AND w.id IN (SELECT word_id FROM word_wordlists WHERE wordlist IN ('cet6'))
`).all(Date.now());

const newWords = db.prepare(`
  SELECT w.id, w.word
  FROM words w
  LEFT JOIN progress p ON w.id = p.word_id
  WHERE p.word_id IS NULL
    AND w.id IN (SELECT word_id FROM word_wordlists WHERE wordlist IN ('cet6'))
  LIMIT 20
`).all();

console.log('  ✓ CET-6 到期复习词获取数:', dueWords.length);
console.log('  ✓ CET-6 新词获取数:', newWords.length);
assert.ok(dueWords.length > 0, '复习词应该能够正常被查出');
assert.strictEqual(newWords.length, 20, '新词应该能够正常被查出');

// 7. 验证双选 CET-4 + CET-6 时的去重
const bothSummary = getSummary(['cet4', 'cet6']);
console.log('  ✓ 同时勾选 CET-4 + CET-6 时去重后总词数 (4544 + 3991 - 1873 = 6662):', bothSummary.total);
assert.strictEqual(bothSummary.total, 6662);

db.close();
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
const walPath = testDbPath + '-wal';
const shmPath = testDbPath + '-shm';
if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

console.log('🎉 所有多词库关联与进度继承测试全部通过！\n');
process.exit(0);
