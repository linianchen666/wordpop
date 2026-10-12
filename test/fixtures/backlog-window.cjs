const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');
app.on('window-all-closed', () => {});
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wordpop-backlog-window-'));
app.setPath('userData', profile); app.setLoginItemSettings = () => {};
const root = process.env.WORDPOP_TEST_APP_ROOT || path.join(__dirname, '../..');
if (process.env.WORDPOP_TEST_APP_ROOT) process.resourcesPath = path.dirname(root);
let db, scheduler;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) {
  const end = Date.now() + 10000;
  while (Date.now() < end) { if (await check()) return; await delay(30); }
  throw new Error(message);
}
app.whenReady().then(async () => {
  const database = require(path.join(root, 'src/main/db'));
  db = database.initDatabase(); database.importWordlist('cet4');
  const config = require(path.join(root, 'src/main/config'));
  config.saveConfig({ autoCheckUpdate: false, autoPronounce: false, autoBalanceLoad: false,
    selectedWordlists: ['cet4'], dailyNewWords: 20, batchSize: 0 });
  const words = db.prepare("SELECT w.* FROM words w JOIN word_wordlists m ON m.word_id=w.id WHERE m.wordlist='cet4' ORDER BY w.id LIMIT 70").all();
  const { recordReview } = require(path.join(root, 'src/main/review-progress'));
  const old = Date.now() - 2 * 86400000;
  for (const word of words) recordReview(db, word.id, 'unknown', old);
  require(path.join(root, 'src/main/ipc-handlers')).registerIpcHandlers();
  scheduler = require(path.join(root, 'src/main/scheduler'));
  scheduler.currentWord = { ...words[0], stage: 1 };
  const manager = require(path.join(root, 'src/main/popup-manager'));
  manager.updateConfig(config.loadConfig());
  const popup = manager.createPopupWindow();
  await new Promise(resolve => popup.webContents.once('did-finish-load', resolve));
  manager.show({ ...words[0], isNew: false, queueRemaining: 29, config: config.loadConfig() });
  const status = () => popup.webContents.executeJavaScript("document.getElementById('progress-text').textContent");
  await until(async () => (await status()).includes('待复习 70') && (await status()).includes('待新学 20'), 'Must show actual counts beyond cache limit');
  await popup.webContents.executeJavaScript("document.getElementById('btn-reveal').click()");
  await until(() => popup.webContents.executeJavaScript("document.getElementById('interval-unknown').textContent !== '…'"), 'Predictions failed');
  const current = db.prepare('SELECT * FROM progress WHERE word_id=?').get(words[0].id);
  const history = JSON.stringify(db.prepare('SELECT * FROM review_history').all());
  const stats = JSON.stringify(db.prepare('SELECT * FROM daily_stats').all());
  const result = await popup.webContents.executeJavaScript('window.wordpopAPI.smoothOverdueReviews(3)');
  assert.equal(result.success, true); assert.equal(result.count, 69);
  await until(async () => (await status()).includes('待复习 24'), 'Smooth must update existing card immediately');
  assert.deepEqual(db.prepare('SELECT * FROM progress WHERE word_id=?').get(words[0].id), current);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM review_history').all()), history);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM daily_stats').all()), stats);
  const state = await popup.webContents.executeJavaScript(`({
    word: document.getElementById('word-text').textContent,
    hidden: document.getElementById('word-detail').classList.contains('hidden'),
    disabled: document.getElementById('btn-known').disabled,
    width: innerWidth, contentWidth: document.documentElement.scrollWidth
  })`);
  assert.equal(state.word, words[0].word); assert.equal(state.hidden, false); assert.equal(state.disabled, false);
  assert.ok(state.contentWidth <= state.width, 'Counter must fit card');
  // Match the reported 65 / 25 header at the smallest supported card size.
  popup.setSize(320, 300);
  manager.show({ ...words[0], isNew: false, pendingCounts: { review: 65, new: 25 } });
  await until(async () => (await status()).includes('待新学 25'), 'Narrow counter did not render');
  const counterLayout = await popup.webContents.executeJavaScript(`(() => {
    const progress = document.getElementById('progress-text');
    const style = getComputedStyle(progress);
    const rect = progress.getBoundingClientRect();
    const actions = document.querySelector('.popup-actions').getBoundingClientRect();
    return { radius: style.borderRadius, overflow: style.overflow,
      left: rect.left, right: rect.right, actionsLeft: actions.left, width: innerWidth,
      textWidth: progress.scrollWidth, boxWidth: progress.clientWidth };
  })()`);
  assert.equal(counterLayout.radius, '0px', 'Round clipping must not cut the two-line counter');
  assert.equal(counterLayout.overflow, 'visible');
  assert.ok(counterLayout.right <= counterLayout.actionsLeft && counterLayout.left >= 0);
  assert.ok(counterLayout.textWidth <= counterLayout.boxWidth);
  if (process.env.WORDPOP_TEST_SCREENSHOT_DIR) {
    await popup.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    fs.mkdirSync(process.env.WORDPOP_TEST_SCREENSHOT_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.WORDPOP_TEST_SCREENSHOT_DIR, 'backlog-popup.png'), (await popup.webContents.capturePage()).toPNG());
  }
  console.log('Backlog Chromium checks passed: full pending counts, actual smoothing IPC, immediate update, preserved current card, memory, history and stats.');
}).then(() => finish(0), error => { console.error(error); finish(1); });
function finish(code) {
  scheduler?.stop();
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  try { db?.close(); fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  app.exit(code);
}
