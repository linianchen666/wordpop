const assert = require('assert');
const { EventEmitter } = require('events');
const Database = require('better-sqlite3');
const { getAmbientWords } = require('../src/main/ambient-words');
const { createAmbientPill } = require('../src/main/ambient-pill-window');

const db = new Database(':memory:');
db.exec(`CREATE TABLE words (id INTEGER PRIMARY KEY, word TEXT, translation TEXT);
  CREATE TABLE progress (word_id INTEGER PRIMARY KEY, stage INTEGER, wrong_count INTEGER, correct_count INTEGER, last_review_at INTEGER);
  CREATE TABLE word_wordlists (word_id INTEGER, wordlist TEXT);
  CREATE TABLE review_history (id INTEGER PRIMARY KEY, word_id INTEGER, reviewed_at INTEGER, rating INTEGER);`);
for (const [id, wrong, correct, stage, list, rating] of [
  [1, 1, 5, 1, 'cet4', 1], // latest Again, even with a low historical rate
  [2, 3, 2, 1, 'cet4', 3], // high difficulty rate after a successful rating
  [3, 3, 20, 1, 'cet4', 3], // frequent mistakes but low rate: exclude
  [4, 5, 0, 9, 'cet4', 1], // legacy mastered: exclude
  [5, 5, 0, 1, 'cet6', 1], // unselected dictionary: exclude
  [6, 3, 0, 1, 'cet4', null] // legacy progress without history: include
]) {
  db.prepare('INSERT INTO words VALUES (?, ?, ?)').run(id, `word${id}`, `释义${id}`);
  db.prepare('INSERT INTO progress VALUES (?, ?, ?, ?, 1)').run(id, stage, wrong, correct);
  db.prepare('INSERT INTO word_wordlists VALUES (?, ?)').run(id, list);
  if (rating) db.prepare('INSERT INTO review_history VALUES (?, ?, 100, ?)').run(id, id, rating);
}
db.prepare("INSERT INTO word_wordlists VALUES (2, 'cet6')").run();
const before = db.serialize();
assert.deepStrictEqual(getAmbientWords(db, ['cet4']).map(w => w.id), [1, 6, 2]);
assert.strictEqual(getAmbientWords(db, ['cet4', 'cet6']).filter(w => w.id === 2).length, 1);
assert.deepStrictEqual(getAmbientWords(db, []), []);
assert.ok(db.serialize().equals(before), 'Passive word selection must not alter progress/history');
db.prepare('INSERT INTO review_history VALUES (99, 1, 101, 3)').run();
assert.ok(!getAmbientWords(db, ['cet4']).some(w => w.id === 1));
db.close();

const windows = [];
class Window extends EventEmitter {
  constructor(options) {
    super(); this.options = options; this.destroyed = false; this.messages = [];
    this.webContents = new EventEmitter();
    this.webContents.send = (_channel, payload) => this.messages.push(payload);
    windows.push(this);
  }
  setIgnoreMouseEvents(...args) { this.ignore = args; }
  loadFile(file) { this.file = file; }
  setBounds(bounds) { this.bounds = bounds; }
  showInactive() { this.visible = true; }
  setAlwaysOnTop() {}
  isDestroyed() { return this.destroyed; }
  destroy() { this.destroyed = true; this.emit('closed'); }
}
const screen = new EventEmitter();
let display = { bounds: { x: -100, y: 20, width: 1200, height: 800 },
  workArea: { x: -100, y: 20, width: 1200, height: 752 } };
screen.getPrimaryDisplay = () => display;
let config = { ambientPillEnabled: false, selectedWordlists: ['cet4'] };
let words = [{ id: 1 }, { id: 2 }];
let tick, cancelled = 0, schedules = 0;
const pill = createAmbientPill({ BrowserWindow: Window, screen, getConfig: () => config,
  getWords: () => words, schedule: (callback, ms) => { assert.strictEqual(ms, 8000); tick = callback; schedules++; return 1; },
  cancel: () => { cancelled++; }, logger: { error() {} } });
pill.updateConfig();
assert.strictEqual(windows.length, 0);
config.ambientPillEnabled = true;
pill.updateConfig();
const win = windows[0];
assert.strictEqual(win.options.x, 300);
assert.strictEqual(win.options.y, 772); // taskbar starts at workArea bottom, not above it
assert.strictEqual(win.options.height, 48);
assert.deepStrictEqual(win.ignore, [true, { forward: true }]);
assert.strictEqual(win.options.focusable, false);
win.webContents.emit('did-finish-load');
assert.strictEqual(win.messages.at(-1).word.id, 1);
tick(); assert.strictEqual(win.messages.at(-1).word.id, 2);
tick(); assert.strictEqual(win.messages.at(-1).word.id, 1);
words = [{ id: 2 }]; pill.refresh(); assert.strictEqual(win.messages.at(-1).word.id, 2);
words = []; tick(); assert.strictEqual(win.messages.at(-1).word, null);
pill.updateConfig(); assert.strictEqual(windows.length, 1); assert.strictEqual(schedules, 1);
display = { bounds: { x: 0, y: 0, width: 800, height: 600 }, workArea: { x: 0, y: 40, width: 800, height: 560 } };
screen.emit('display-metrics-changed');
assert.strictEqual(win.bounds.y, 0); assert.strictEqual(win.bounds.height, 40);
config.ambientPillEnabled = false; pill.updateConfig();
assert.strictEqual(win.destroyed, true); assert.strictEqual(cancelled, 1);
assert.strictEqual(screen.listenerCount('display-metrics-changed'), 0);
tick(); assert.strictEqual(windows.length, 1);
console.log('Ambient pill tests passed: selected words, passive reads, taskbar bounds, click-through, rotation and shutdown.');
