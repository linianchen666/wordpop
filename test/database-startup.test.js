const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const vm = require('vm');
const Database = require('better-sqlite3');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wordpop-db-startup-'));
let profile = path.join(dir, '新电脑', 'WordPop');
const originalLoad = Module._load;
const originalFetch = global.fetch;
const app = { getPath: () => profile, getAppPath: () => path.join(__dirname, '..') };
const desktop = { reloadQueue() {}, emit() {}, applyConfig() {}, updateConfig() {} };
Module._load = function(name, parent) {
  if (name === 'electron') return {
    app, BrowserWindow: { getAllWindows: () => [] },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(value), decryptString: value => value.toString()
    }
  };
  if (['cloud-sync.js', 'backup.js'].some(file => parent?.filename.endsWith(file)) &&
      ['./scheduler', './popup-manager', './ambient-pill'].includes(name)) return desktop;
  return originalLoad.apply(this, arguments);
};
const production = require('../src/main/db');

async function main() {
  // A new profile directory may not exist yet; logging must not be a prerequisite.
  let db = production.initDatabase();
  assert.equal(db.pragma('user_version', { simple: true }), 8);
  assert.strictEqual(production.initDatabase(), db, 'Do not reopen a live database');
  const word = db.prepare('SELECT id FROM words ORDER BY id LIMIT 1').get();
  assert(word);
  const now = Date.now();
  db.prepare(`INSERT INTO progress
    (word_id,stage,last_review_at,next_review_at,interval,repetitions,correct_count,wrong_count)
    VALUES (?,4,?,?,86400000,3,7,2)`).run(word.id, now - 86400000, now + 86400000);
  db.exec("INSERT INTO daily_stats VALUES ('2026-10-15',7,2)");
  const previous = db.prepare('SELECT * FROM progress').get();
  const stats = db.prepare('SELECT * FROM daily_stats').all();

  // Reproduce old releases whose schema marker is 7 but review_history is absent.
  db.exec('DROP TABLE review_history; PRAGMA user_version=7');
  production.closeDatabase();
  db = production.initDatabase();
  assert.equal(db.pragma('user_version', { simple: true }), 8);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM review_history').get().n, 0);
  const upgraded = db.prepare('SELECT * FROM progress').get();
  for (const key of ['word_id', 'last_review_at', 'correct_count', 'wrong_count', 'mastered_count'])
    assert.equal(upgraded[key], previous[key]);
  assert(upgraded.fsrs_card, 'Existing progress receives its normal memory upgrade');
  assert.deepEqual(db.prepare('SELECT * FROM daily_stats').all(), stats);
  assert.deepEqual(JSON.parse(db.prepare('SELECT progress_json FROM memory_initialization_archive').get().progress_json), previous);

  // Repair an already-upgraded profile without rerunning memory initialization.
  db.exec('DROP TABLE review_history');
  production.closeDatabase();
  db = production.initDatabase();
  assert.equal(db.pragma('user_version', { simple: true }), 8);
  assert.deepEqual(db.prepare('SELECT * FROM progress').get(), upgraded);
  assert.deepEqual(db.prepare('SELECT * FROM daily_stats').all(), stats);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM memory_initialization_archive').get().n, 1);
  db.prepare(`INSERT INTO review_history
    (word_id,reviewed_at,rating,card_before,card_after,log) VALUES (?, ?,3,'{}','{}','{}')`).run(word.id, now);
  production.closeDatabase();
  db = production.initDatabase();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM review_history').get().n, 1, 'Keep existing history on every restart');
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');

  // Use real login + backup + SQLite merge; substitute only the cloud server/UI.
  // Older auth tests mocked backup, which could hide this missing-table error.
  const baseline = require('../src/main/backup').createBackupData();
  const english = db.prepare('SELECT word FROM words WHERE id=?').get(word.id).word;
  const event = {
    id: 'dbce4e1a-16ee-49b2-a69e-bfa3f824f602', word: english, action: 'known',
    reviewed_at: now + 60000, target_id: null, created_at: new Date(now + 60000).toISOString()
  };
  let settings = [];
  global.fetch = async (url, options) => {
    const request = new URL(url);
    let data;
    if (request.pathname.includes('/auth/')) data = {
      access_token: 'fixture-token', refresh_token: 'fixture-refresh',
      user: { id: 'fixture-user' }, expires_in: 3600
    };
    else if (request.pathname.endsWith('wordpop_baseline')) data = [{ state: baseline }];
    else if (request.pathname.endsWith('wordpop_current_settings')) data = settings;
    else if (request.pathname.endsWith('wordpop_settings_changes') && options.method === 'POST') {
      settings = JSON.parse(options.body); data = null;
    } else if (request.pathname.endsWith('wordpop_events')) data = request.searchParams.has('or') || request.searchParams.get('limit') === '0' ? [] : [event];
    else throw new Error('Unexpected fixture request: ' + request.pathname);
    return { ok: true, status: 200, headers: { get: () => '*/1' }, text: async () => JSON.stringify(data) };
  };
  const cloud = require('../src/main/cloud-sync');
  cloud.start(db);
  try {
    const result = await cloud.login({
      url: 'https://fixture.supabase.co', key: 'fixture-public',
      email: 'fixture@example.com', password: 'fixture-password'
    });
    assert.equal(result.authenticated, true, result.message);
    assert(!result.error, result.message);
    assert(result.message.startsWith('已同步'), result.message);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM review_history').get().n, 2);
    assert.equal(db.prepare('SELECT reviewed_at FROM review_history ORDER BY id DESC LIMIT 1').get().reviewed_at, event.reviewed_at);
    assert.equal(db.prepare('SELECT correct_count FROM progress').get().correct_count, upgraded.correct_count + 1);
  } finally {
    cloud.logout(); global.fetch = originalFetch;
  }
  production.closeDatabase();

  // A real SQLite opening/PRAGMA failure preserves both its cause and the file.
  profile = path.join(dir, 'corrupt');
  fs.mkdirSync(profile);
  const file = path.join(profile, 'wordpop.db');
  const contents = Buffer.from('not a SQLite database; preserve this file');
  fs.writeFileSync(file, contents);
  let originalError;
  assert.throws(() => production.initDatabase(), error => {
    originalError = error;
    return error.code === 'SQLITE_NOTADB';
  });
  assert.throws(() => production.getDb(), error =>
    error.cause === originalError && error.message.includes(originalError.message));
  assert.deepEqual(fs.readFileSync(file), contents);

  // Exercise the actual entrypoint: database failure must stop dependent services.
  const windows = [], unexpected = [];
  let ready;
  const startupApp = {
    ...app, commandLine: { appendSwitch() {} }, requestSingleInstanceLock: () => true,
    on() {}, whenReady: () => ({ then(fn) { ready = Promise.resolve().then(fn); } })
  };
  class Window {
    constructor() { windows.push(this); }
    loadURL(url) { this.html = decodeURIComponent(url.split(',').slice(1).join(',')); }
  }
  const entry = path.join(__dirname, '../src/main/index.js');
  const nativeRequire = Module.createRequire(entry);
  const service = new Proxy({}, { get: (_target, key) => () => unexpected.push(key) });
  vm.runInNewContext(fs.readFileSync(entry, 'utf8'), {
    __dirname: path.dirname(entry), console, process: { on() {} },
    setInterval() { unexpected.push('timer'); },
    require(name) {
      if (name === 'electron') return { app: startupApp, BrowserWindow: Window };
      if (name === './db') return production;
      if (name.startsWith('./')) return service;
      return nativeRequire(name);
    }
  }, { filename: entry });
  await ready;
  assert.deepEqual(unexpected, [], 'No cloud login, IPC, scheduler, config or tray after database failure');
  assert.equal(windows.length, 1);
  assert(windows[0].html.includes('initDatabase'));
  assert(windows[0].html.includes(originalError.message));
  assert.deepEqual(fs.readFileSync(file), contents);

  // Once a recoverable directory error is fixed, a retry clears the old cause.
  profile = path.join(dir, 'blocked');
  fs.writeFileSync(profile, 'directory is blocked by this file');
  assert.throws(() => production.initDatabase());
  assert.throws(() => production.getDb(), /本地学习数据库初始化失败/);
  fs.unlinkSync(profile);
  db = production.initDatabase();
  assert.strictEqual(production.getDb(), db);
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  console.log('Database startup checks passed: missing legacy history, real login/backup/sync, preserved records, fresh profiles, opening failures, original cause, retry and startup gate.');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  production.closeDatabase();
  Module._load = originalLoad;
  global.fetch = originalFetch;
  fs.rmSync(dir, { recursive: true, force: true });
});
