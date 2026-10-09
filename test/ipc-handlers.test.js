/** Exercise real IPC adapters and real SQLite queries; isolate only the desktop. */
const assert = require('assert');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wordpop-ipc-'));
const db = new Database(':memory:');
const originalLoad = Module._load;
const originalNow = Date.now;
const modulePaths = ['ipc-handlers', 'learning-repository'].map(name =>
  require.resolve('../src/main/' + name));
const previousModules = new Map(modulePaths.map(file => [file, require.cache[file]]));
const handlers = new Map();
const listeners = new Map();
let registrationCalls = 0;
let passed = 0;
const now = Date.now();
const status = { todayDueCount: 7, todayNewRemaining: 3, isPaused: false };
const wordlistIndex = [
  { id: 'cet4', name: 'CET-4', count: 4544, file: 'cet4.json' },
  { id: 'cet6', name: 'CET-6', count: 3991, file: 'cet6.json' },
  { id: 'kaoyan', name: '考研', count: 5047, file: 'kaoyan.json' }
];

function test(name, callback) {
  callback();
  passed++;
  console.log('  ✓ ' + name);
}
function invoke(channel, ...args) {
  const handler = handlers.get(channel);
  assert.ok(handler, 'Missing IPC handler: ' + channel);
  return handler({ sender: {} }, ...args);
}

try {
  Date.now = () => now;
  db.exec(`
    CREATE TABLE words (
      id INTEGER PRIMARY KEY, word TEXT UNIQUE, phonetic TEXT DEFAULT '',
      translation TEXT DEFAULT '', example TEXT DEFAULT '', frequency_rank INTEGER DEFAULT 999999
    );
    CREATE TABLE word_wordlists (word_id INTEGER, wordlist TEXT, PRIMARY KEY (word_id, wordlist));
    CREATE TABLE progress (
      word_id INTEGER PRIMARY KEY, stage INTEGER DEFAULT 0, next_review_at INTEGER DEFAULT 0,
      correct_count INTEGER DEFAULT 0, wrong_count INTEGER DEFAULT 0,
      efactor REAL DEFAULT 2.5, interval INTEGER DEFAULT 0, repetitions INTEGER DEFAULT 0
    );
    CREATE TABLE daily_stats (date TEXT PRIMARY KEY, words_reviewed INTEGER, words_learned INTEGER);
  `);
  const insertWord = db.prepare('INSERT INTO words (id, word, translation) VALUES (?, ?, ?)');
  const insertList = db.prepare('INSERT INTO word_wordlists VALUES (?, ?)');
  for (const [id, word, lists] of [
    [1, 'apple', ['cet4', 'cet6']], [2, 'boat', ['cet4']], [3, 'cat', ['cet6']],
    [4, 'delta', ['custom_foo']], [5, 'echo', ['cet4', 'custom_foo']], [6, 'fawn', ['custom_bar']]
  ]) {
    insertWord.run(id, word, '释义-' + word);
    lists.forEach(list => insertList.run(id, list));
  }
  const insertProgress = db.prepare(`INSERT INTO progress
    (word_id, stage, correct_count, wrong_count, next_review_at) VALUES (?, ?, ?, ?, ?)`);
  for (const row of [[1, 2, 2, 4], [2, 9, 20, 10], [4, 1, 0, 7], [5, 4, 5, 1]]) {
    insertProgress.run(...row, now - 1000);
  }
  const insertDay = db.prepare(`INSERT INTO daily_stats VALUES
    (date(?, 'unixepoch', 'localtime', ?), ?, ?)`);
  insertDay.run(now / 1000, '+0 days', 7, 2);
  insertDay.run(now / 1000, '-1 days', 5, 1);
  insertDay.run(now / 1000, '-4 days', 2, 1);

  const desktop = {
    ipcMain: {
      handle(channel, handler) {
        registrationCalls++;
        assert.ok(!handlers.has(channel), 'Duplicate handler: ' + channel);
        handlers.set(channel, handler);
      },
      on(channel, listener) {
        registrationCalls++;
        const registered = listeners.get(channel) || [];
        registered.push(listener);
        listeners.set(channel, registered);
      }
    },
    BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
    app: {
      getPath(name) { assert.strictEqual(name, 'userData'); return tempDir; },
      quit() {}
    },
    dialog: {},
    shell: { openPath: async () => '' }
  };
  Module._load = function(request, parent) {
    if (request === 'electron') return desktop;
    if (parent?.filename.includes(path.join('src', 'main'))) {
      if (request === './db') return {
        getDb: () => db,
        getWordlistIndex: () => wordlistIndex.map(entry => ({ ...entry }))
      };
      if (request === './config') return {
        loadConfig: () => ({ selectedWordlists: ['cet4'] }),
        saveConfig: config => ({ success: true, config })
      };
      if (request === './scheduler') return { getStatus: () => status };
      if (['./backup', './popup-manager', './focus-manager', './tray'].includes(request)) return {};
    }
    return originalLoad.apply(this, arguments);
  };
  modulePaths.forEach(file => { delete require.cache[file]; });
  const ipc = require('../src/main/ipc-handlers');
  const { learningRepository } = require('../src/main/learning-repository');

  test('导入 IPC 模块不会提前注册监听器', () => {
    assert.strictEqual(handlers.size, 0);
    assert.strictEqual(listeners.size, 0);
    assert.strictEqual(registrationCalls, 0);
    assert.strictEqual(typeof ipc.registerIpcHandlers, 'function');
  });

  test('显式注册后保留全部 IPC 通道', () => {
    ipc.registerIpcHandlers();
    for (const channel of [
      'app:get-logs', 'app:open-log-folder', 'config:get', 'config:save',
      'wordlists:get', 'wordlist:import', 'wordlist:import-custom', 'stats:progress-summary',
      'db:diagnose', 'db:repair', 'backup:export', 'backup:import', 'reviews:smooth-overdue',
      'scheduler:quota-info', 'scheduler:trigger-next-batch', 'focus:open', 'focus:close',
      'focus:get-words', 'focus:submit-word', 'stats:get', 'stats:daily', 'stats:stubborn-words',
      'stats:stage-distribution', 'scheduler:status', 'scheduler:toggle-pause'
    ]) assert.strictEqual(typeof handlers.get(channel), 'function', channel);
    for (const channel of ['word:known', 'word:unknown', 'word:fuzzy', 'word:easy',
      'word:mastered', 'word:undo', 'popup:minimize', 'app:quit']) {
      assert.strictEqual(listeners.get(channel).length, 1, channel);
    }
  });

  test('重复注册不会重复添加 handle 或 on', () => {
    const initialCalls = registrationCalls;
    const initialHandlers = [...handlers];
    ipc.registerIpcHandlers();
    assert.strictEqual(registrationCalls, initialCalls);
    assert.deepStrictEqual([...handlers], initialHandlers);
    for (const registered of listeners.values()) assert.strictEqual(registered.length, 1);
  });

  test('统计 IPC 返回数据库结果和调度器剩余量', () => {
    const result = invoke('stats:get');
    assert.deepStrictEqual(result, { ...learningRepository.getStats(),
      todayDueCount: status.todayDueCount, todayNewRemaining: status.todayNewRemaining });
    assert.deepStrictEqual(result.today, { words_reviewed: 7, words_learned: 2 });
    assert.deepStrictEqual(result.total, { words: 4, correct: 27, wrong: 22, mastered: 1 });
    assert.strictEqual(result.streak, 2);
  });

  test('词库 IPC 保留索引元数据并从真实关系表补充导入量与自定义词表', () => {
    const lists = invoke('wordlists:get');
    assert.strictEqual(lists.length, 5);
    for (const expected of wordlistIndex) {
      const count = learningRepository.getImportedWordlistCount(expected.id);
      assert.deepStrictEqual(lists.find(entry => entry.id === expected.id), {
        ...expected, importedCount: count, isImported: count > 0
      });
    }
    assert.strictEqual(lists.find(entry => entry.id === 'cet4').importedCount, 3);
    for (const custom of learningRepository.getCustomWordlists()) {
      assert.deepStrictEqual(lists.find(entry => entry.id === custom.id), {
        id: custom.id, name: '自定义词表 (' + custom.id + ')', file: '',
        count: custom.importedCount, importedCount: custom.importedCount, isImported: true
      });
    }
  });

  test('进度摘要 IPC 在重叠词库中只统计一次并保持返回字段', () => {
    assert.deepStrictEqual(invoke('stats:progress-summary', ['cet4', 'cet6']), {
      totalWords: 4, learnedWords: 2, masteredWords: 1, remainingWords: 1
    });
    for (const ids of [['cet4'], ['custom_foo'], [], undefined]) {
      assert.deepStrictEqual(invoke('stats:progress-summary', ids), learningRepository.getProgressSummary(ids));
    }
  });

  test('每日记录 IPC 使用真实日期筛选并保留默认时间范围', () => {
    assert.deepStrictEqual(invoke('stats:daily'), learningRepository.getDailyStats());
    assert.strictEqual(invoke('stats:daily').length, 3);
    assert.deepStrictEqual(invoke('stats:daily', 1), learningRepository.getDailyStats(1));
    assert.strictEqual(invoke('stats:daily', 1).length, 2);
  });

  test('顽固词 IPC 保留阈值和排序，排除已掌握词', () => {
    assert.deepStrictEqual(invoke('stats:stubborn-words'), learningRepository.getStubbornWords());
    assert.deepStrictEqual(invoke('stats:stubborn-words').map(word => word.id), [4, 1]);
    assert.deepStrictEqual(invoke('stats:stubborn-words', 5), learningRepository.getStubbornWords(5));
    assert.deepStrictEqual(invoke('stats:stubborn-words', 5).map(word => word.id), [4]);
  });

  test('阶段分布 IPC 返回实际数据库聚合并排除已掌握阶段', () => {
    assert.deepStrictEqual(invoke('stats:stage-distribution'), learningRepository.getStageDistribution());
    assert.deepStrictEqual(invoke('stats:stage-distribution'), [
      { stage: 1, count: 1 }, { stage: 2, count: 1 }, { stage: 4, count: 1 }
    ]);
  });

  test('日志 IPC 通过 Node fs 读取真实 UTF-8 文件并报告缺失文件', () => {
    const logFile = path.join(tempDir, 'wordpop.log');
    const logs = '启动 WordPop\nFSRS review saved ✓\n';
    fs.writeFileSync(logFile, logs, 'utf8');
    assert.deepStrictEqual(invoke('app:get-logs'), { success: true, logs });
    fs.unlinkSync(logFile);
    const missing = invoke('app:get-logs');
    assert.strictEqual(missing.success, false);
    assert.strictEqual(typeof missing.error, 'string');
    assert.match(missing.error, /ENOENT/);
  });
  console.log('IPC production adapter tests passed: ' + passed + '.');
} finally {
  Module._load = originalLoad;
  Date.now = originalNow;
  for (const [file, previous] of previousModules) {
    if (previous) require.cache[file] = previous;
    else delete require.cache[file];
  }
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
