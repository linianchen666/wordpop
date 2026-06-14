const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let db = null;

/**
 * 初始化数据库
 * - 创建数据库文件（存储在 userData 目录）
 * - 开启 WAL 模式和外键约束
 * - 执行 schema 迁移
 */
function initDatabase() {
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'wordpop.db');

  db = new Database(dbPath);

  // 性能优化：WAL 模式 + 外键约束
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -8000'); // 8MB 缓存

  // 执行迁移
  migrate(db);

  console.log('[DB] Database initialized at:', dbPath);
  return db;
}

/**
 * Schema 迁移
 * 通过 SQLite user_version 管理版本号
 */
function migrate(db) {
  const currentVersion = db.pragma('user_version', { simple: true });

  if (currentVersion < 1) {
    db.exec(`
      -- 单词字典表
      CREATE TABLE IF NOT EXISTS words (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        word TEXT NOT NULL,
        phonetic TEXT DEFAULT '',
        translation TEXT NOT NULL,
        example TEXT DEFAULT '',
        wordlist TEXT NOT NULL DEFAULT 'custom',
        created_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
      );

      -- 学习进度表
      CREATE TABLE IF NOT EXISTS progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        word_id INTEGER NOT NULL UNIQUE,
        stage INTEGER NOT NULL DEFAULT 0,
        next_review_at INTEGER NOT NULL DEFAULT 0,
        last_review_at INTEGER DEFAULT NULL,
        correct_count INTEGER DEFAULT 0,
        wrong_count INTEGER DEFAULT 0,
        FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
      );

      -- 每日统计表
      CREATE TABLE IF NOT EXISTS daily_stats (
        date TEXT PRIMARY KEY,
        words_reviewed INTEGER DEFAULT 0,
        words_learned INTEGER DEFAULT 0
      );

      -- 索引
      CREATE INDEX IF NOT EXISTS idx_progress_next_review ON progress(next_review_at);
      CREATE INDEX IF NOT EXISTS idx_progress_stage ON progress(stage);
      CREATE INDEX IF NOT EXISTS idx_words_wordlist ON words(wordlist);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_words_word ON words(word);
    `);

    db.pragma('user_version = 1');
    console.log('[DB] Migration v1 complete');
  }
}

/**
 * 获取词库目录路径（兼容开发/生产环境）
 */
function getWordlistPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'wordlists');
  }
  return path.join(__dirname, '..', 'data', 'wordlists');
}

/**
 * 导入词库到数据库
 * @param {string} wordlistId - 词库 ID（如 cet4, cet6, kaoyan）
 * @returns {{ imported: number, skipped: number }}
 */
function importWordlist(wordlistId) {
  const wordlistDir = getWordlistPath();
  const indexPath = path.join(wordlistDir, 'index.json');

  if (!fs.existsSync(indexPath)) {
    throw new Error(`词库索引文件不存在: ${indexPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  const index = Array.isArray(raw) ? raw : (raw.wordlists || []);
  const entry = index.find(e => e.id === wordlistId);

  if (!entry) {
    throw new Error(`未找到词库: ${wordlistId}`);
  }

  const wordlistPath = path.join(wordlistDir, entry.file);
  if (!fs.existsSync(wordlistPath)) {
    throw new Error(`词库文件不存在: ${wordlistPath}`);
  }

  const wordlist = JSON.parse(fs.readFileSync(wordlistPath, 'utf-8'));

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO words (word, phonetic, translation, example, wordlist)
    VALUES (?, ?, ?, ?, ?)
  `);

  let imported = 0;
  let skipped = 0;

  const importTransaction = db.transaction((words) => {
    for (const w of words) {
      const result = insertStmt.run(
        w.word.trim().toLowerCase(),
        w.phonetic || '',
        w.translation || '',
        w.example || '',
        wordlistId
      );
      if (result.changes > 0) {
        imported++;
      } else {
        skipped++;
      }
    }
  });

  importTransaction(wordlist.words);

  console.log(`[DB] Imported ${imported} words from ${wordlistId}, skipped ${skipped}`);
  return { imported, skipped };
}

/**
 * 获取词库元信息列表
 */
function getWordlistIndex() {
  const wordlistDir = getWordlistPath();
  const indexPath = path.join(wordlistDir, 'index.json');
  if (!fs.existsSync(indexPath)) return [];
  const raw = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  return Array.isArray(raw) ? raw : (raw.wordlists || []);
}

/**
 * 导入用户自定义词表（CSV/TXT）
 * CSV 格式：word,phonetic,translation,example
 * TXT 格式：每行一个单词，用 tab 分隔
 */
function importCustomWordlist(filePath, wordlistName) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/).filter(l => l.trim());

  const words = [];
  const ext = path.extname(filePath).toLowerCase();

  for (const line of lines) {
    let word, phonetic, translation, example;
    if (ext === '.csv') {
      const parts = line.split(',').map(s => s.trim().replace(/^"|"$/g, ''));
      [word, phonetic = '', translation = '', example = ''] = parts;
    } else {
      // TXT: tab 分隔
      const parts = line.split('\t').map(s => s.trim());
      [word, phonetic = '', translation = '', example = ''] = parts;
    }

    if (word) {
      words.push({
        word: word.toLowerCase(),
        phonetic,
        translation,
        example
      });
    }
  }

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO words (word, phonetic, translation, example, wordlist)
    VALUES (?, ?, ?, ?, ?)
  `);

  let imported = 0;
  const transaction = db.transaction((items) => {
    for (const w of items) {
      const result = insertStmt.run(w.word, w.phonetic, w.translation, w.example, wordlistName);
      if (result.changes > 0) imported++;
    }
  });

  transaction(words);
  return { imported, total: words.length };
}

/**
 * 获取数据库实例
 */
function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * 关闭数据库
 */
function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    console.log('[DB] Database closed');
  }
}

module.exports = {
  initDatabase,
  getDb,
  closeDatabase,
  importWordlist,
  getWordlistIndex,
  importCustomWordlist,
  getWordlistPath
};
