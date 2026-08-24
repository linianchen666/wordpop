/**
 * 备份与恢复（导出/导入）功能单元与集成测试
 */
const assert = require('assert');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const rootDir = path.join(__dirname, '..');
const testDbPath1 = path.join(__dirname, 'test_source_db.db');
const testDbPath2 = path.join(__dirname, 'test_target_db.db');
const backupFilePath = path.join(__dirname, 'test_backup_export.json');

// 清理旧临时文件
[testDbPath1, testDbPath2, backupFilePath].forEach(f => {
  if (fs.existsSync(f)) fs.unlinkSync(f);
  if (fs.existsSync(f + '-wal')) fs.unlinkSync(f + '-wal');
  if (fs.existsSync(f + '-shm')) fs.unlinkSync(f + '-shm');
});

console.log('=== 开始测试：数据备份与恢复 ===');

// 1. 初始化源数据库并模拟真实学习数据
function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT NOT NULL,
      phonetic TEXT DEFAULT '',
      translation TEXT NOT NULL,
      example TEXT DEFAULT '',
      wordlist TEXT NOT NULL DEFAULT 'custom',
      frequency_rank INTEGER DEFAULT 999999,
      created_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
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
}

const db1 = new Database(testDbPath1);
db1.pragma('journal_mode = WAL');
initSchema(db1);

// 导入 CET-4
const c4Words = JSON.parse(fs.readFileSync(path.join(rootDir, 'src/data/wordlists/cet4.json'), 'utf-8')).words;
const insertWord = db1.prepare('INSERT INTO words (word, phonetic, translation, example, wordlist) VALUES (?, ?, ?, ?, ?)');
const insertRel = db1.prepare('INSERT INTO word_wordlists (word_id, wordlist) VALUES (?, ?)');

db1.transaction(() => {
  for (let i = 0; i < 100; i++) {
    const w = c4Words[i];
    const res = insertWord.run(w.word.toLowerCase(), w.phonetic, w.translation, w.example, 'cet4');
    insertRel.run(res.lastInsertRowid, 'cet4');
  }
})();

// 插入模拟 progress 与 daily_stats
const insertProg = db1.prepare(`
  INSERT INTO progress (word_id, stage, next_review_at, last_review_at, correct_count, wrong_count, efactor, interval, repetitions, mastered_count)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

db1.transaction(() => {
  for (let id = 1; id <= 50; id++) {
    insertProg.run(id, id % 10, Date.now() + id * 1000, Date.now() - 5000, id, id % 3, 2.6, id * 60000, id, 0);
  }
})();

db1.prepare("INSERT INTO daily_stats VALUES ('2026-08-20', 25, 10), ('2026-08-21', 40, 20)").run();

// 插入一条自定义词汇
const customWordRes = insertWord.run('mycustomword', '/custom/', 'n. 我的自定义词', 'custom ex', 'my_custom_list');
insertRel.run(customWordRes.lastInsertRowid, 'my_custom_list');
insertProg.run(customWordRes.lastInsertRowid, 4, Date.now() + 100000, Date.now(), 5, 1, 2.5, 86400000, 4, 0);

console.log('  ✓ 源数据库数据准备完成 (51 条进度, 2 条打卡统计, 1 条自定义词汇)');

// 2. 模拟导出备份
const progressRows = db1.prepare(`
  SELECT w.word, p.stage, p.next_review_at, p.last_review_at,
         p.correct_count, p.wrong_count, p.efactor, p.interval,
         p.repetitions, p.mastered_count
  FROM progress p
  JOIN words w ON p.word_id = w.id
`).all();

const statsRows = db1.prepare(`
  SELECT date, words_reviewed, words_learned
  FROM daily_stats
  ORDER BY date ASC
`).all();

const customWords = db1.prepare(`
  SELECT word, phonetic, translation, example, wordlist, frequency_rank
  FROM words
  WHERE wordlist NOT IN ('cet4', 'cet6', 'kaoyan')
`).all();

const customRelations = db1.prepare(`
  SELECT w.word, ww.wordlist
  FROM word_wordlists ww
  JOIN words w ON ww.word_id = w.id
  WHERE ww.wordlist NOT IN ('cet4', 'cet6', 'kaoyan')
`).all();

const backupPayload = {
  appName: 'WordPop',
  appVersion: '1.3.0',
  schemaVersion: 6,
  exportedAt: new Date().toISOString(),
  config: {
    dailyNewWords: 30,
    selectedWordlists: ['cet4'],
    fontSize: 'large'
  },
  data: {
    progress: progressRows,
    daily_stats: statsRows,
    custom_words: customWords,
    custom_word_wordlists: customRelations
  }
};

fs.writeFileSync(backupFilePath, JSON.stringify(backupPayload, null, 2), 'utf-8');
console.log('  ✓ 导出备份文件成功，大小:', fs.statSync(backupFilePath).size, 'bytes');
assert.strictEqual(progressRows.length, 51);
assert.strictEqual(statsRows.length, 2);
assert.strictEqual(customWords.length, 1);

// 3. 模拟目标新设备：恢复数据
const db2 = new Database(testDbPath2);
db2.pragma('journal_mode = WAL');
initSchema(db2);

// 在新设备中也先初始化 CET-4 词库
db2.transaction(() => {
  for (let i = 0; i < 100; i++) {
    const w = c4Words[i];
    const res = db2.prepare('INSERT INTO words (word, phonetic, translation, example, wordlist) VALUES (?, ?, ?, ?, ?)').run(w.word.toLowerCase(), w.phonetic, w.translation, w.example, 'cet4');
    db2.prepare('INSERT INTO word_wordlists (word_id, wordlist) VALUES (?, ?)').run(res.lastInsertRowid, 'cet4');
  }
})();

// 读取并恢复备份
const backupToRestore = JSON.parse(fs.readFileSync(backupFilePath, 'utf-8'));
assert.strictEqual(backupToRestore.appName, 'WordPop');

let restoredProgressCount = 0;
let restoredStatsCount = 0;
let restoredCustomWordsCount = 0;

db2.transaction(() => {
  // 恢复自定义词
  for (const cw of backupToRestore.data.custom_words) {
    const res = db2.prepare('INSERT OR IGNORE INTO words (word, phonetic, translation, example, wordlist, frequency_rank) VALUES (?, ?, ?, ?, ?, ?)').run(
      cw.word.toLowerCase(), cw.phonetic || '', cw.translation || '', cw.example || '', cw.wordlist, cw.frequency_rank || 999999
    );
    if (res.changes > 0) restoredCustomWordsCount++;
  }

  for (const rel of backupToRestore.data.custom_word_wordlists) {
    const row = db2.prepare('SELECT id FROM words WHERE word = ?').get(rel.word.toLowerCase());
    if (row) {
      db2.prepare('INSERT OR IGNORE INTO word_wordlists (word_id, wordlist) VALUES (?, ?)').run(row.id, rel.wordlist);
    }
  }

  // 恢复 progress
  const upsertProgressStmt = db2.prepare(`
    INSERT INTO progress (
      word_id, stage, next_review_at, last_review_at,
      correct_count, wrong_count, efactor, interval,
      repetitions, mastered_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(word_id) DO UPDATE SET
      stage = excluded.stage,
      next_review_at = excluded.next_review_at,
      last_review_at = excluded.last_review_at,
      correct_count = excluded.correct_count,
      wrong_count = excluded.wrong_count,
      efactor = excluded.efactor,
      interval = excluded.interval,
      repetitions = excluded.repetitions,
      mastered_count = excluded.mastered_count
  `);

  for (const p of backupToRestore.data.progress) {
    const cleanWord = p.word.trim().toLowerCase();
    const wordRow = db2.prepare('SELECT id FROM words WHERE word = ?').get(cleanWord);
    if (wordRow) {
      upsertProgressStmt.run(
        wordRow.id,
        p.stage,
        p.next_review_at,
        p.last_review_at,
        p.correct_count,
        p.wrong_count,
        p.efactor,
        p.interval,
        p.repetitions,
        p.mastered_count
      );
      restoredProgressCount++;
    }
  }

  // 恢复 daily_stats
  for (const s of backupToRestore.data.daily_stats) {
    db2.prepare(`
      INSERT INTO daily_stats (date, words_reviewed, words_learned)
      VALUES (?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        words_reviewed = MAX(daily_stats.words_reviewed, excluded.words_reviewed),
        words_learned = MAX(daily_stats.words_learned, excluded.words_learned)
    `).run(s.date, s.words_reviewed, s.words_learned);
    restoredStatsCount++;
  }
})();

console.log('  ✓ 目标数据库恢复执行完成:');
console.log('     恢复进度记录数:', restoredProgressCount);
console.log('     恢复打卡天数:', restoredStatsCount);
console.log('     恢复自定义词汇数:', restoredCustomWordsCount);

// 4. 断言验证
assert.strictEqual(restoredProgressCount, 51);
assert.strictEqual(restoredStatsCount, 2);
assert.strictEqual(restoredCustomWordsCount, 1);

// 抽查自定义词及其进度
const customCheck = db2.prepare(`
  SELECT w.word, p.stage, p.efactor
  FROM progress p
  JOIN words w ON p.word_id = w.id
  WHERE w.word = 'mycustomword'
`).get();

assert.ok(customCheck, '自定义词及其进度应存在');
assert.strictEqual(customCheck.stage, 4);
assert.strictEqual(customCheck.efactor, 2.5);

// 验证打卡数据
const statsCheck = db2.prepare('SELECT * FROM daily_stats ORDER BY date ASC').all();
assert.strictEqual(statsCheck.length, 2);
assert.strictEqual(statsCheck[0].date, '2026-08-20');
assert.strictEqual(statsCheck[0].words_reviewed, 25);

// 清理数据库连接与临时文件
db1.close();
db2.close();
[testDbPath1, testDbPath2, backupFilePath].forEach(f => {
  if (fs.existsSync(f)) fs.unlinkSync(f);
  if (fs.existsSync(f + '-wal')) fs.unlinkSync(f + '-wal');
  if (fs.existsSync(f + '-shm')) fs.unlinkSync(f + '-shm');
});

console.log('🎉 备份与恢复（导出/导入）全部测试通过！\n');
process.exit(0);
