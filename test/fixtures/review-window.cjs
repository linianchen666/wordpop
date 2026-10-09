const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');
app.on('window-all-closed', () => {});
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wordpop-review-window-'));
app.setPath('userData', profile);
app.setLoginItemSettings = () => {};
const root = process.env.WORDPOP_TEST_APP_ROOT || path.join(__dirname, '..', '..');
if (process.env.WORDPOP_TEST_APP_ROOT) process.resourcesPath = path.dirname(root);
let db, scheduler;
const errors = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (await check()) return;
    await delay(30);
  }
  throw new Error('Review window check timed out: ' + errors.join('; '));
}
async function windowFor(mode, width, height) {
  let win;
  if (mode === 'popup') {
    const popupManager = require(path.join(root, 'src/main/popup-manager.js'));
    popupManager.updateConfig(require(path.join(root, 'src/main/config.js')).loadConfig());
    win = popupManager.createPopupWindow();
    assert.ok(win);
  } else {
    win = new BrowserWindow({ show: false, width, height, useContentSize: true,
      webPreferences: { preload: path.join(root, 'src/preload/preload.js'),
        contextIsolation: true, nodeIntegration: false } });
  }
  win.webContents.on('console-message', (_event, level, message) => {
    if (level === 3) errors.push(message);
  });
  if (mode === 'popup') {
    await new Promise((resolve, reject) => {
      win.webContents.once('did-finish-load', resolve);
      win.webContents.once('did-fail-load', (_event, code, message) => reject(new Error(`${code}: ${message}`)));
    });
    win.setContentSize(width, height);
    assert.strictEqual(win.isResizable(), true);
  } else {
    await win.loadFile(path.join(root, 'src/renderer', mode, 'index.html'));
  }
  await win.webContents.insertCSS('*, *::before, *::after { animation: none !important; transition: none !important; }');
  return win;
}
app.whenReady().then(async () => {
  const database = require(path.join(root, 'src/main/db.js'));
  db = database.initDatabase();
  const config = require(path.join(root, 'src/main/config.js'));
  config.saveConfig({ autoCheckUpdate: false, autoPronounce: false, batchSize: 0 });
  database.importWordlist('cet4');
  require(path.join(root, 'src/main/ipc-handlers.js')).registerIpcHandlers();
  scheduler = require(path.join(root, 'src/main/scheduler.js'));
  const words = db.prepare('SELECT * FROM words LIMIT 6').all();
  const popup = await windowFor('popup', 380, 440);
  const actions = [['unknown', 1], ['fuzzy', 2], ['known', 3], ['mastered', 4], ['m', 4]];
  for (const [index, [action, rating]] of actions.entries()) {
    const word = words[index];
    scheduler.currentWord = word;
    popup.webContents.send('popup:word', { ...word, isNew: true, queueRemaining: 19,
      batchIndex: 1, batchSize: 3, config: { autoPronounce: false } });
    await until(() => popup.webContents.executeJavaScript("document.getElementById('interval-easy').textContent === '8天后'"));
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM review_history WHERE word_id=?').get(word.id).n, 0);
    await popup.webContents.executeJavaScript("document.getElementById('btn-reveal').click()");
    await until(() => popup.webContents.executeJavaScript("document.getElementById('interval-known').textContent === '10分钟后'"));
    const layout = await popup.webContents.executeJavaScript(`({
      text: document.getElementById('progress-text').textContent,
      buttons: [...document.querySelectorAll('#action-buttons button')].length,
      star: getComputedStyle(document.getElementById('btn-mastered')).display,
      bottom: document.getElementById('action-buttons').getBoundingClientRect().bottom,
      width: innerWidth, height: innerHeight, content: document.documentElement.scrollWidth
    })`);
    assert.ok(!layout.text.includes('阶段'));
    assert.strictEqual(layout.buttons, 3);
    assert.notStrictEqual(layout.star, 'none');
    assert.ok(layout.bottom <= layout.height + 1 && layout.content <= layout.width, JSON.stringify(layout));
    if (index === 0) {
      // Transparent gaps and opaque text surfaces must coexist in both themes.
      for (const theme of ['light', 'dark']) {
        const paint = await popup.webContents.executeJavaScript(`(() => {
          document.documentElement.dataset.theme = '${theme}';
          const selectors = ['.popup-header', '.word-main', '.word-phonetic', '.word-translation', '.etymology-section'];
          return { canvas: [document.documentElement, document.body, document.getElementById('popup-container')].map(e => getComputedStyle(e).backgroundColor),
            surfaces: selectors.map(selector => { const e = document.querySelector(selector); const r = e.getBoundingClientRect(); const style = getComputedStyle(e);
              return { background: style.backgroundColor, border: style.borderTopWidth, left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }),
            drag: getComputedStyle(document.querySelector('.popup-header')).getPropertyValue('-webkit-app-region'),
            actions: getComputedStyle(document.querySelector('.popup-actions')).getPropertyValue('-webkit-app-region') };
        })()`);
        assert.ok(paint.canvas.every(color => color === 'rgba(0, 0, 0, 0)'));
        assert.ok(paint.surfaces.every(surface => surface.background.startsWith('rgb(') && surface.border === '1px'));
        assert.strictEqual(paint.drag, 'drag');
        assert.strictEqual(paint.actions, 'no-drag');
        // Capture the actual transparent Chromium surface, not a CSS mock.
        const image = await popup.webContents.capturePage();
        const bitmap = image.toBitmap();
        const size = image.getSize();
        const scale = size.width / layout.width;
        const alpha = (x, y) => bitmap[(Math.floor(y * scale) * size.width + Math.floor(x * scale)) * 4 + 3];
        const wordSurface = paint.surfaces[1];
        assert.strictEqual(alpha(wordSurface.left + 12, wordSurface.top + 12), 255);
        assert.strictEqual(alpha(4, (wordSurface.top + wordSurface.bottom) / 2), 0);
        if (process.env.WORDPOP_TEST_SCREENSHOT_DIR) {
          fs.mkdirSync(process.env.WORDPOP_TEST_SCREENSHOT_DIR, { recursive: true });
          fs.writeFileSync(path.join(process.env.WORDPOP_TEST_SCREENSHOT_DIR, `popup-${theme}.png`), image.toPNG());
        }
      }
      await popup.webContents.executeJavaScript("document.documentElement.dataset.theme = 'light'");
    }
    if (action === 'm') await popup.webContents.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }))");
    else await popup.webContents.executeJavaScript(`document.getElementById('btn-${action}').click()`);
    await until(() => db.prepare('SELECT rating FROM review_history WHERE word_id=?').get(word.id));
    assert.strictEqual(db.prepare('SELECT rating FROM review_history WHERE word_id=?').get(word.id).rating, rating);
    scheduler._clearTimer();
    if (index === 0) popup.setContentSize(320, 300);
  }
  // Existing FSRS state must replace the previous word's new-card preview.
  const word = words[3];
  const preview = require(path.join(root, 'src/main/review-preview.js')).getReviewPreview(db, word.id);
  popup.webContents.send('popup:word', { ...word, config: { autoPronounce: false } });
  await until(() => popup.webContents.executeJavaScript("document.getElementById('progress-text').textContent.startsWith('复习中')"));
  const title = await popup.webContents.executeJavaScript("document.getElementById('btn-known').title");
  assert.ok(title.includes(new Date(preview.intervals.known.dueAt).toLocaleDateString('zh-CN')));
  popup.destroy();
  const focus = await windowFor('focus', 440, 360);
  await until(() => focus.webContents.executeJavaScript("document.getElementById('interval-easy').textContent.endsWith('后')"));
  await focus.webContents.executeJavaScript("document.getElementById('focus-reveal-prompt').click()");
  await until(() => focus.webContents.executeJavaScript("document.getElementById('interval-easy').textContent.endsWith('后')"));
  const focusWordId = await focus.webContents.executeJavaScript('sessionWords[currentIndex].id');
  await focus.webContents.executeJavaScript("document.getElementById('btn-mastered').click()");
  await until(() => db.prepare('SELECT rating FROM review_history WHERE word_id=? ORDER BY id DESC').get(focusWordId)?.rating === 4);
  assert.deepStrictEqual(errors, []);
  console.log('Review preview Chromium checks passed: real IPC, four ratings, star shortcut, saved FSRS state, small windows and native transparency in both themes.');
}).then(() => finish(0), error => { console.error(error); finish(1); });
function finish(code) {
  scheduler?.stop();
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  try { db?.close(); } catch (_) {}
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  app.exit(code);
}
