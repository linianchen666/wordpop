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
 * - 如果迁移失败（数据库结构严重损坏），删除后重建
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
  try {
    migrate(db);
  } catch (err) {
    console.error('[DB] Migration failed:', err.message);
    console.log('[DB] Attempting to recreate database (learning data will be lost)...');

    // 迁移失败，关闭并删除损坏的数据库
    try { db.close(); } catch (_) {}
    db = null;

    // 删除旧的数据库文件
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      const walPath = dbPath + '-wal';
      const shmPath = dbPath + '-shm';
      if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
      if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
    } catch (e) {
      console.error('[DB] Failed to delete old database:', e.message);
    }

    // 重新创建
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -8000');

    // 在全新数据库上执行迁移（这次应该不会失败）
    migrate(db);
    console.log('[DB] Database recreated successfully');
  }

  return db;
}

/**
 * Schema 迁移
 * 通过 SQLite user_version 管理版本号
 * 
 * 重要：必须处理旧版本升级的情况——
 * 旧版 words 表可能没有 wordlist 列，需要先加列再加索引
 */
function migrate(db) {
  const currentVersion = db.pragma('user_version', { simple: true });

  if (currentVersion < 1) {
    // 创建表（IF NOT EXISTS 对已存在的表安全）
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
        FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS daily_stats (
        date TEXT PRIMARY KEY,
        words_reviewed INTEGER DEFAULT 0,
        words_learned INTEGER DEFAULT 0
      );
    `);

    // 旧版本升级：words 表可能没有 wordlist 列
    // 必须在创建索引之前检查并添加缺失的列
    const wordlistColExists = db.prepare(
      "SELECT COUNT(*) as cnt FROM pragma_table_info('words') WHERE name='wordlist'"
    ).get().cnt > 0;

    if (!wordlistColExists) {
      db.exec(`ALTER TABLE words ADD COLUMN wordlist TEXT NOT NULL DEFAULT 'custom'`);
    }

    // 同样检查 phonetic 和 example 列（旧版本可能没有）
    const phoneticColExists = db.prepare(
      "SELECT COUNT(*) as cnt FROM pragma_table_info('words') WHERE name='phonetic'"
    ).get().cnt > 0;
    if (!phoneticColExists) {
      db.exec(`ALTER TABLE words ADD COLUMN phonetic TEXT DEFAULT ''`);
    }

    const exampleColExists = db.prepare(
      "SELECT COUNT(*) as cnt FROM pragma_table_info('words') WHERE name='example'"
    ).get().cnt > 0;
    if (!exampleColExists) {
      db.exec(`ALTER TABLE words ADD COLUMN example TEXT DEFAULT ''`);
    }

    // 检查 progress 表是否缺少 last_review_at 列
    const lastReviewColExists = db.prepare(
      "SELECT COUNT(*) as cnt FROM pragma_table_info('progress') WHERE name='last_review_at'"
    ).get().cnt > 0;
    if (!lastReviewColExists) {
      db.exec(`ALTER TABLE progress ADD COLUMN last_review_at INTEGER DEFAULT NULL`);
    }

    // 现在可以安全地创建索引了
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_progress_next_review ON progress(next_review_at);
      CREATE INDEX IF NOT EXISTS idx_progress_stage ON progress(stage);
      CREATE INDEX IF NOT EXISTS idx_words_wordlist ON words(wordlist);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_words_word ON words(word);
    `);

    db.pragma('user_version = 1');
  }

  // v2: 增加 mastered_count 字段，追踪连续熟知次数
  if (currentVersion < 2) {
    try {
      // 先检查列是否已存在
      const masteredColExists = db.prepare(
        "SELECT COUNT(*) as cnt FROM pragma_table_info('progress') WHERE name='mastered_count'"
      ).get().cnt > 0;
      if (!masteredColExists) {
        db.exec(`ALTER TABLE progress ADD COLUMN mastered_count INTEGER NOT NULL DEFAULT 0`);
      }
    } catch (e) {
      if (!e.message.includes('duplicate column')) {
        console.error('[DB] Migration v2 ALTER error:', e.message);
      }
    }
    db.pragma('user_version = 2');
  }

  // v3: 增加 frequency_rank 字段，对现有单词加载 frequency.json 进行词频权重更新
  if (currentVersion < 3) {
    try {
      const hasFreqCol = db.prepare(
        "SELECT COUNT(*) as cnt FROM pragma_table_info('words') WHERE name='frequency_rank'"
      ).get().cnt > 0;
      if (!hasFreqCol) {
        db.exec(`ALTER TABLE words ADD COLUMN frequency_rank INTEGER DEFAULT 999999`);
      }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_words_frequency ON words(frequency_rank)`);

      const map = getFrequencyMap();
      const updateStmt = db.prepare('UPDATE words SET frequency_rank = ? WHERE word = ?');
      const updateTransaction = db.transaction((freqMap) => {
        for (const [word, rank] of freqMap.entries()) {
          updateStmt.run(rank, word);
        }
      });
      updateTransaction(map);
      console.log('[DB] Migration v3 finished: updated word frequency ranks');
    } catch (e) {
      console.error('[DB] Migration v3 ERROR:', e.message);
    }
    db.pragma('user_version = 3');
  }

  // v4: 增加 efactor, interval, repetitions 字段，并映射现有的 stage 进度
  if (currentVersion < 4) {
    try {
      const hasEfactor = db.prepare("SELECT COUNT(*) as cnt FROM pragma_table_info('progress') WHERE name='efactor'").get().cnt > 0;
      if (!hasEfactor) {
        db.exec(`ALTER TABLE progress ADD COLUMN efactor REAL DEFAULT 2.5`);
      }
      const hasInterval = db.prepare("SELECT COUNT(*) as cnt FROM pragma_table_info('progress') WHERE name='interval'").get().cnt > 0;
      if (!hasInterval) {
        db.exec(`ALTER TABLE progress ADD COLUMN interval INTEGER DEFAULT 0`);
      }
      const hasRepetitions = db.prepare("SELECT COUNT(*) as cnt FROM pragma_table_info('progress') WHERE name='repetitions'").get().cnt > 0;
      if (!hasRepetitions) {
        db.exec(`ALTER TABLE progress ADD COLUMN repetitions INTEGER DEFAULT 0`);
      }

      const STAGE_MAP = [
        { reps: 0, iv: 0, ef: 2.5 },
        { reps: 1, iv: 5 * 60 * 1000, ef: 2.5 },
        { reps: 2, iv: 30 * 60 * 1000, ef: 2.5 },
        { reps: 3, iv: 4 * 3600 * 1000, ef: 2.5 },
        { reps: 4, iv: 24 * 3600 * 1000, ef: 2.5 },
        { reps: 5, iv: 2 * 86400 * 1000, ef: 2.5 },
        { reps: 6, iv: 4 * 86400 * 1000, ef: 2.5 },
        { reps: 7, iv: 7 * 86400 * 1000, ef: 2.5 },
        { reps: 8, iv: 15 * 86400 * 1000, ef: 2.6 },
        { reps: 9, iv: 90 * 86400 * 1000, ef: 2.7 }
      ];

      const records = db.prepare('SELECT id, stage FROM progress').all();
      const updateStmt = db.prepare('UPDATE progress SET efactor = ?, interval = ?, repetitions = ? WHERE id = ?');
      const updateTransaction = db.transaction((rows) => {
        for (const row of rows) {
          const map = STAGE_MAP[row.stage] || STAGE_MAP[0];
          updateStmt.run(map.ef, map.iv, map.reps, row.id);
        }
      });
      updateTransaction(records);
      console.log('[DB] Migration v4 finished: mapped stage progress to SM-2 states');
    } catch (e) {
      console.error('[DB] Migration v4 ERROR:', e.message);
    }
    db.pragma('user_version = 4');
  }
}

let frequencyMap = null;

function getFrequencyMap() {
  if (frequencyMap) return frequencyMap;
  frequencyMap = new Map();
  try {
    const freqPath = path.join(getWordlistPath(), 'frequency.json');
    if (fs.existsSync(freqPath)) {
      const words = JSON.parse(fs.readFileSync(freqPath, 'utf-8'));
      words.forEach((word, index) => {
        frequencyMap.set(word.toLowerCase().trim(), index);
      });
    }
  } catch (e) {
    console.error('[DB] Failed to load frequency map:', e.message);
  }
  return frequencyMap;
}

function getWordFrequencyRank(word) {
  const map = getFrequencyMap();
  const cleanWord = word.trim().toLowerCase();
  return map.has(cleanWord) ? map.get(cleanWord) : 999999;
}

/**
 * 获取词库目录路径（兼容开发/生产环境）
 * 打包后 wordlists 被复制到 resources/wordlists/
 */
function getWordlistPath() {
  if (app.isPackaged) {
    // electron-builder extraResources 把 wordlists/ 复制到 resources/wordlists/
    return path.join(process.resourcesPath, 'wordlists');
  }
  return path.join(__dirname, '..', 'data', 'wordlists');
}

/**
 * 获取学习进度摘要（用于预测背完天数）
 * @param {string[]} wordlistIds - 选中的词库 ID 数组
 * @returns {{ totalWords: number, learnedWords: number, masteredWords: number, remainingWords: number }}
 */
function getProgressSummary(wordlistIds) {
  const d = getDb();
  if (!wordlistIds || wordlistIds.length === 0) {
    return { totalWords: 0, learnedWords: 0, masteredWords: 0, remainingWords: 0 };
  }

  const placeholders = wordlistIds.map(() => '?').join(',');

  // 选中词库的总词数
  const totalRow = d.prepare(
    `SELECT COUNT(*) as total FROM words WHERE wordlist IN (${placeholders})`
  ).get(...wordlistIds);

  // 已学单词（stage 0-8，有 progress 记录但未掌握）
  const learnedRow = d.prepare(`
    SELECT COUNT(*) as learned FROM progress p
    JOIN words w ON p.word_id = w.id
    WHERE p.stage < 9 AND w.wordlist IN (${placeholders})
  `).get(...wordlistIds);

  // 已掌握（stage = 9）
  const masteredRow = d.prepare(`
    SELECT COUNT(*) as mastered FROM progress p
    JOIN words w ON p.word_id = w.id
    WHERE p.stage >= 9 AND w.wordlist IN (${placeholders})
  `).get(...wordlistIds);

  const total = totalRow.total || 0;
  const learned = learnedRow.learned || 0;
  const mastered = masteredRow.mastered || 0;
  const remaining = total - learned - mastered;

  return { totalWords: total, learnedWords: learned, masteredWords: mastered, remainingWords: remaining };
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
    INSERT OR IGNORE INTO words (word, phonetic, translation, example, wordlist, frequency_rank)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let imported = 0;
  let skipped = 0;

  const importTransaction = db.transaction((words) => {
    for (const w of words) {
      const cleanWord = w.word.trim().toLowerCase();
      const rank = getWordFrequencyRank(cleanWord);
      const result = insertStmt.run(
        cleanWord,
        w.phonetic || '',
        w.translation || '',
        w.example || '',
        wordlistId,
        rank
      );
      if (result.changes > 0) {
        imported++;
      } else {
        skipped++;
      }
    }
  });

  importTransaction(wordlist.words);

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
    INSERT OR IGNORE INTO words (word, phonetic, translation, example, wordlist, frequency_rank)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let imported = 0;
  const transaction = db.transaction((items) => {
    for (const w of items) {
      const rank = getWordFrequencyRank(w.word);
      const result = insertStmt.run(w.word, w.phonetic, w.translation, w.example, wordlistName, rank);
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
  }
}

/**
 * 诊断数据库健康状态
 * 包含和 stats:get 完全一样的查询，用于排查统计显示0的问题
 */
function diagnoseDatabase() {
  try {
    if (!db) {
      return { healthy: false, wordCount: 0, progressCount: 0, statsCount: 0, todayStats: null, sampleProgress: [], statsQueryResult: null, sqliteToday: null, error: '数据库未初始化' };
    }
    const wordCount = db.prepare('SELECT COUNT(*) c FROM words').get().c;
    const progressCount = db.prepare('SELECT COUNT(*) c FROM progress').get().c;
    const statsCount = db.prepare('SELECT COUNT(*) c FROM daily_stats').get().c;

    // 诊断用：查看 daily_stats 实际存储的日期
    const todayStats = db.prepare("SELECT * FROM daily_stats ORDER BY date DESC LIMIT 5").all();

    // 诊断用：查看 SQLite 认为的今天日期
    const sqliteToday = db.prepare("SELECT date('now','localtime') as today, datetime('now','localtime') as now").get();

    // 诊断用：查看几条 progress 记录
    const sampleProgress = db.prepare('SELECT p.*, w.word FROM progress p JOIN words w ON p.word_id = w.id LIMIT 5').all();

    // 诊断用：运行和 stats:get 完全一样的查询
    let statsQueryResult = null;
    try {
      const today = db.prepare(
        "SELECT words_reviewed, words_learned FROM daily_stats WHERE date = date('now','localtime')"
      ).get() || { words_reviewed: 0, words_learned: 0 };

      const total = db.prepare(`
        SELECT
          COUNT(DISTINCT p.word_id) total_words,
          SUM(p.correct_count) total_correct,
          SUM(p.wrong_count)   total_wrong,
          COUNT(DISTINCT CASE WHEN p.stage >= 9 THEN p.word_id END) mastered
        FROM progress p
      `).get();

      statsQueryResult = {
        today: today,
        total: {
          words:    total.total_words   || 0,
          correct:  total.total_correct  || 0,
          wrong:    total.total_wrong    || 0,
          mastered: total.mastered     || 0
        },
        raw_total: total
      };
    } catch (e) {
      statsQueryResult = { error: e.message };
    }

    return { healthy: true, wordCount, progressCount, statsCount, todayStats, sampleProgress, sqliteToday, statsQueryResult };
  } catch (err) {
    return { healthy: false, wordCount: 0, progressCount: 0, statsCount: 0, todayStats: null, sampleProgress: [], statsQueryResult: null, sqliteToday: null, error: err.message };
  }
}

/**
 * 修复数据库：关闭 → 删除 → 重建
 * 注意：这会丢失所有学习数据
 * @returns {{ success: boolean, message: string }}
 */
function repairDatabase() {
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'wordpop.db');

  try { if (db) db.close(); } catch (_) {}
  db = null;
  try {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    const walPath = dbPath + '-wal';
    const shmPath = dbPath + '-shm';
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
  } catch (e) {
    return { success: false, message: '删除旧数据库失败: ' + e.message };
  }

  try {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -8000');
    migrate(db);
    return { success: true, message: '数据库已修复，请重新导入词库' };
  } catch (err) {
    console.error('[DB] Repair failed:', err.message);
    return { success: false, message: '修复失败: ' + err.message };
  }
}

module.exports = {
  initDatabase,
  getDb,
  closeDatabase,
  importWordlist,
  getWordlistIndex,
  importCustomWordlist,
  getWordlistPath,
  getProgressSummary,
  diagnoseDatabase,
  repairDatabase
};
