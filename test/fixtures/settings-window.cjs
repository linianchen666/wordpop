const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');
app.on('window-all-closed', () => {});

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wordpop-settings-test-'));
app.setPath('userData', profile);
// This test must not change OS startup registration.
app.setLoginItemSettings = () => {};
const root = process.env.WORDPOP_TEST_APP_ROOT || path.join(__dirname, '..', '..');
if (process.env.WORDPOP_TEST_APP_ROOT) process.resourcesPath = path.dirname(root);
const errors = [];
let database;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error(message + ': ' + errors.join('; '));
}

app.whenReady().then(async () => {
  const db = require(path.join(root, 'src/main/db.js'));
  database = db.initDatabase();
  const config = require(path.join(root, 'src/main/config.js'));
  config.saveConfig({ autoCheckUpdate: false, autoPronounce: false });
  require(path.join(root, 'src/main/ipc-handlers.js')).registerIpcHandlers();
  async function openSettings() {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(root, 'src/preload/preload.js'),
        contextIsolation: true, nodeIntegration: false
      }
    });
    win.webContents.on('console-message', (_event, level, message) => {
      if (level === 3) errors.push(message);
    });
    await win.loadFile(path.join(root, 'src/renderer/settings/index.html'));
    await until(() => win.webContents.executeJavaScript(
      "document.querySelectorAll('.wordlist-item').length === 3 && " +
      "document.querySelector('.settings-subtitle').textContent.includes('首次使用')"
    ), 'First-run wordlist selection failed to initialize');
    return win;
  }
  const win = await openSettings();
  const initial = await win.webContents.executeJavaScript(`({
    selected: [...document.querySelectorAll('#wordlist-options input:checked')].map(e => e.value),
    example: document.getElementById('showExample').checked,
    first: document.querySelector('.settings-content > .form-group').textContent
  })`);
  assert.deepStrictEqual(initial.selected, ['cet4']);
  assert.strictEqual(initial.example, true);
  assert.ok(initial.first.includes('学习词库'));
  await win.webContents.executeJavaScript(`
    document.getElementById('showExample').checked = false;
    document.querySelector('#wordlist-options input[value="cet6"]').click();
    document.getElementById('btn-save').click();
  `);
  await until(() => config.loadConfig().setupComplete, 'Settings did not save');
  assert.deepStrictEqual(config.loadConfig().selectedWordlists, ['cet4', 'cet6']);
  assert.strictEqual(config.loadConfig().showExample, false);
  for (const [id, count] of [['cet4', 4544], ['cet6', 3991]]) {
    assert.strictEqual(database.prepare('SELECT COUNT(*) c FROM word_wordlists WHERE wordlist=?').get(id).c, count);
  }
  // Reload the saved page and verify persisted selections and progress display.
  if (!win.isDestroyed()) win.destroy();
  const saved = new BrowserWindow({ show: false, webPreferences: {
    preload: path.join(root, 'src/preload/preload.js'), contextIsolation: true, nodeIntegration: false
  } });
  saved.webContents.on('console-message', (_event, level, message) => {
    if (level === 3) errors.push(message);
  });
  await saved.loadFile(path.join(root, 'src/renderer/settings/index.html'));
  await until(() => saved.webContents.executeJavaScript(
    "document.querySelectorAll('#wordlist-options input:checked').length === 2 && " +
    "document.getElementById('prediction-content').style.display !== 'none'"
  ), 'Saved wordlists and progress did not load');
  assert.strictEqual(await saved.webContents.executeJavaScript("document.getElementById('showExample').checked"), false);
  assert.deepStrictEqual(errors, []);
  console.log('Settings Chromium test passed: first-run lists, imports, save and reload.');
  saved.destroy();
}).then(() => finish(0), error => {
  console.error(error);
  finish(1);
});

function finish(code) {
  try { database?.close(); } catch (_) {}
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  app.exit(code);
}
