const path = require('path');

function createAmbientPill({ BrowserWindow, screen, getConfig, getWords,
  rootPath = path.join(__dirname, '..', '..'),
  platform = process.platform,
  schedule = setInterval, cancel = clearInterval, logger = console }) {
  let window = null;
  let timer = null;
  let visibilityTimer = null;
  let enabled = false;
  let ready = false;
  let currentId = null;
  let payload = null;
  let watchingDisplays = false;

  function bounds() {
    const display = screen.getPrimaryDisplay();
    const work = display.workArea;
    const full = display.bounds || work;
    const bottomSpace = full.y + full.height - (work.y + work.height);
    const topSpace = work.y - full.y;
    const bandHeight = bottomSpace > 4 ? bottomSpace : (topSpace > 4 ? topSpace : 48);
    const bandY = bottomSpace > 4 ? work.y + work.height : (topSpace > 4 ? full.y : full.y + full.height - bandHeight);
    const width = Math.min(400, full.width - 16);
    const height = Math.min(48, bandHeight);
    return { width, height, x: Math.round(full.x + (full.width - width) / 2),
      y: Math.round(bandY + (bandHeight - height) / 2) };
  }

  function reposition() {
    if (window && !window.isDestroyed()) window.setBounds(bounds());
  }

  function present() {
    if (!enabled || !ready || !window || window.isDestroyed()) return;
    if (!window.isVisible()) window.showInactive();
    reposition();
    window.setAlwaysOnTop(true, platform === 'win32' ? 'screen-saver' : 'floating');
    // Explorer can raise the taskbar above other topmost windows. Restore the
    // overlay's z-order without activating it or intercepting taskbar clicks.
    if (platform === 'win32') window.moveTop();
  }

  function ensureWindow() {
    if (window && !window.isDestroyed()) return;
    ready = false;
    const win = new BrowserWindow({ ...bounds(), frame: false, transparent: true,
      backgroundColor: '#00000000', hasShadow: false, resizable: false,
      movable: false, focusable: false, alwaysOnTop: true, skipTaskbar: true, show: false,
      webPreferences: { preload: path.join(rootPath, 'src/preload/preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: false } });
    window = win;
    win.setIgnoreMouseEvents(true, { forward: true });
    win.webContents.once('did-finish-load', () => {
      if (window !== win || !enabled || win.isDestroyed()) return;
      ready = true;
      if (payload) win.webContents.send('ambient:word', payload);
      present();
      logger.info?.('[AmbientPill] Visible', JSON.stringify(bounds()));
    });
    win.on('closed', () => {
      if (window === win) { window = null; ready = false; }
    });
    Promise.resolve(win.loadFile(path.join(rootPath, 'src/renderer/ambient/index.html')))
      .catch(error => logger.error('[AmbientPill] Failed to load:', error.message));
  }

  function refresh(advance = false) {
    if (!enabled) return;
    const config = getConfig();
    if (!config.ambientPillEnabled) { destroy(); return; }
    ensureWindow();
    let words = [];
    let error = false;
    try { words = getWords(config.selectedWordlists?.length ? config.selectedWordlists : ['cet4']); }
    catch (e) { error = true; logger.error('[AmbientPill]', e.message); }
    const previous = words.findIndex(word => word.id === currentId);
    const index = previous < 0 ? 0 : (advance ? (previous + 1) % words.length : previous);
    const word = words[index] || null;
    currentId = word?.id ?? null;
    payload = { word, index: word ? index + 1 : 0, total: words.length,
      theme: config.theme || 'light', error };
    if (ready && window && !window.isDestroyed()) window.webContents.send('ambient:word', payload);
    present();
  }

  function updateConfig(config = getConfig()) {
    if (!config.ambientPillEnabled) { destroy(); return; }
    enabled = true;
    ensureWindow();
    reposition();
    if (!watchingDisplays) {
      for (const event of ['display-metrics-changed', 'display-added', 'display-removed']) screen.on(event, reposition);
      watchingDisplays = true;
    }
    refresh();
    if (!timer) timer = schedule(() => refresh(true), 8000);
    if (platform === 'win32' && !visibilityTimer) visibilityTimer = schedule(present, 1000);
  }

  function destroy() {
    enabled = false;
    if (timer != null) cancel(timer);
    timer = null;
    if (visibilityTimer != null) cancel(visibilityTimer);
    visibilityTimer = null;
    if (watchingDisplays) {
      for (const event of ['display-metrics-changed', 'display-added', 'display-removed']) screen.removeListener(event, reposition);
      watchingDisplays = false;
    }
    const win = window;
    window = null; ready = false; currentId = null; payload = null;
    if (win && !win.isDestroyed()) win.destroy();
  }

  return { updateConfig, refresh, destroy };
}

module.exports = { createAmbientPill };
