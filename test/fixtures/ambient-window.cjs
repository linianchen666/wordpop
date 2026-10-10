const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, screen, desktopCapturer } = require('electron');
app.on('window-all-closed', () => {});
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wordpop-ambient-'));
app.setPath('userData', profile);
app.setLoginItemSettings = () => {};
const root = process.env.WORDPOP_TEST_APP_ROOT || path.join(__dirname, '../..');
if (process.env.WORDPOP_TEST_APP_ROOT) process.resourcesPath = path.dirname(root);
let db, ambient, scheduler;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) {
  const end = Date.now() + 15000;
  while (Date.now() < end) { if (await check()) return; await delay(40); }
  throw new Error(message);
}
const pillWindow = () => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/ambient/index.html'));
app.whenReady().then(async () => {
  const database = require(path.join(root, 'src/main/db'));
  db = database.initDatabase();
  const config = require(path.join(root, 'src/main/config'));
  config.saveConfig({ autoCheckUpdate: false, autoPronounce: false, setupComplete: true,
    ambientPillEnabled: false, popupSizes: { card: { width: 380, height: 440 } } });
  database.importWordlist('cet4');
  const words = db.prepare('SELECT * FROM words ORDER BY id LIMIT 2').all();
  const { recordReview } = require(path.join(root, 'src/main/review-progress'));
  for (const word of words) recordReview(db, word.id, 'unknown');
  require(path.join(root, 'src/main/ipc-handlers')).registerIpcHandlers();
  ambient = require(path.join(root, 'src/main/ambient-pill'));
  scheduler = require(path.join(root, 'src/main/scheduler'));
  const manager = require(path.join(root, 'src/main/popup-manager'));
  manager.updateConfig(config.loadConfig());
  const popup = manager.createPopupWindow();
  await new Promise(resolve => popup.webContents.once('did-finish-load', resolve));
  popup.showInactive();
  popup.webContents.send('popup:word', { ...words[0], isNew: false, queueRemaining: 2,
    config: config.loadConfig() });
  await until(() => popup.webContents.executeJavaScript("document.querySelector('.word-main').textContent.length > 0"), 'Card failed to render');
  const before = popup.getBounds();
  const settings = new BrowserWindow({ show: false, webPreferences: {
    preload: path.join(root, 'src/preload/preload.js'), contextIsolation: true, nodeIntegration: false } });
  await settings.loadFile(path.join(root, 'src/renderer/settings/index.html'));
  await until(() => settings.webContents.executeJavaScript("document.querySelectorAll('.wordlist-item').length === 3"), 'Settings failed to initialize');
  assert.strictEqual(await settings.webContents.executeJavaScript("document.getElementById('ambientPillEnabled').checked"), false);
  settings.show();
  await settings.webContents.executeJavaScript("document.getElementById('ambientPillEnabled').click()");
  await until(() => !!pillWindow(), 'Settings failed to enable separate pill');
  const pill = pillWindow();
  const text = () => pill.webContents.executeJavaScript("document.getElementById('ambient-word').textContent");
  await until(async () => { const current = await text(); return words.some(w => w.word === current); }, 'Pill did not display selected word');
  assert.deepStrictEqual(popup.getBounds(), before);
  assert.strictEqual(await popup.webContents.executeJavaScript("document.body.classList.contains('pill-mode')"), false);
  assert.strictEqual(pill.isFocusable(), false);
  assert.strictEqual(pill.isResizable(), false);
  assert.strictEqual(config.loadConfig().ambientPillEnabled, true, 'Switch must persist without Save');
  assert.ok(pill.isVisible());
  assert.ok(pill.isAlwaysOnTop());
  const b = pill.getBounds(), display = screen.getPrimaryDisplay();
  assert.ok(Math.abs(b.x + b.width / 2 - display.bounds.x - display.bounds.width / 2) <= 1);
  assert.ok(b.y >= display.bounds.y && b.y + b.height <= display.bounds.y + display.bounds.height);
  const bottom = display.workArea.y + display.workArea.height;
  if (bottom < display.bounds.y + display.bounds.height - 4) assert.ok(b.y >= bottom, 'Pill must be inside taskbar');
  const snapshot = JSON.stringify({ progress: db.prepare('SELECT * FROM progress').all(), history: db.prepare('SELECT * FROM review_history').all(), stats: db.prepare('SELECT * FROM daily_stats').all() });
  const first = await text();
  await until(async () => await text() !== first, 'Real eight-second rotation failed');
  assert.strictEqual(JSON.stringify({ progress: db.prepare('SELECT * FROM progress').all(), history: db.prepare('SELECT * FROM review_history').all(), stats: db.prepare('SELECT * FROM daily_stats').all() }), snapshot);
  if (process.env.WORDPOP_TEST_SCREENSHOT_DIR) {
    await pill.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    fs.mkdirSync(process.env.WORDPOP_TEST_SCREENSHOT_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.WORDPOP_TEST_SCREENSHOT_DIR, 'ambient-pill.png'), (await pill.webContents.capturePage()).toPNG());
    if (process.platform === 'win32') {
      // Mimic Explorer raising a competing topmost surface in the taskbar band.
      const cover = new BrowserWindow({ ...b, frame: false, show: false,
        focusable: false, alwaysOnTop: true, skipTaskbar: true, backgroundColor: '#ff0000' });
      await cover.loadURL('data:text/html,<body style="background:red"></body>');
      cover.showInactive(); cover.moveTop();
      await delay(1600);
      const sources = await desktopCapturer.getSources({ types: ['screen'],
        thumbnailSize: { width: display.size.width * display.scaleFactor,
          height: display.size.height * display.scaleFactor } });
      const source = sources.find(s => s.display_id === String(display.id)) || sources[0];
      assert.ok(source && !source.thumbnail.isEmpty(), 'Capture actual Windows desktop');
      fs.writeFileSync(path.join(process.env.WORDPOP_TEST_SCREENSHOT_DIR, 'ambient-taskbar-desktop.png'), source.thumbnail.toPNG());
      const size = source.thumbnail.getSize(), bitmap = source.thumbnail.toBitmap();
      const sx = size.width / display.bounds.width, sy = size.height / display.bounds.height;
      const left = Math.ceil((b.x - display.bounds.x + 8) * sx);
      const top = Math.ceil((b.y - display.bounds.y + 6) * sy);
      const right = Math.floor((b.x - display.bounds.x + b.width - 8) * sx);
      const bottom = Math.floor((b.y - display.bounds.y + b.height - 6) * sy);
      let dark = 0, bright = 0, blue = 0, pixels = 0;
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
        const offset = (y * size.width + x) * 4;
        const [bb, gg, rr] = bitmap.subarray(offset, offset + 3);
        if (rr < 80 && gg < 80 && bb < 80) dark++;
        if (rr > 230 && gg > 230 && bb > 230) bright++;
        if (bb > 150 && bb > rr * 1.2 && bb > gg * 1.05) blue++;
        pixels++;
      }
      assert.ok(pixels > 0 && dark > pixels * 0.65 && bright > pixels * 0.005 && blue > pixels * 0.001,
        `Pill must be visible above taskbar/competing topmost window: ${dark} dark, ${bright} bright, ${blue} blue / ${pixels}`);
      cover.destroy();
    }
  }
  for (const word of words) recordReview(db, word.id, 'known');
  scheduler.emit('stats-updated');
  await until(async () => await text() === '暂无待巩固单词', 'Successful reviews did not refresh candidates');
  await until(() => settings.webContents.executeJavaScript("!document.getElementById('ambientPillEnabled').disabled"), 'Switch is still saving');
  await settings.webContents.executeJavaScript("document.getElementById('ambientPillEnabled').click()");
  await until(() => !pillWindow(), 'Disabling must close independent window');
  assert.strictEqual(config.loadConfig().ambientPillEnabled, false);
  assert.deepStrictEqual(popup.getBounds(), before);
  assert.ok(!popup.isDestroyed());
  console.log('Ambient Chromium checks passed: real settings, independent card, native taskbar bounds, eight-second passive rotation, review refresh and disable.');
}).then(() => finish(0), error => { console.error(error); finish(1); });
function finish(code) {
  ambient?.destroy(); scheduler?.stop();
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  try { db?.close(); fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  app.exit(code);
}
