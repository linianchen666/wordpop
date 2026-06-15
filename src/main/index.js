const { app, BrowserWindow, Menu, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const { initDatabase, importWordlist, getWordlistIndex } = require('./db');
const { loadConfig, saveConfig } = require('./config');
const { createTray, destroyTray } = require('./tray');
const popupManager = require('./popup-manager');
const scheduler = require('./scheduler');
const { registerIpcHandlers } = require('./ipc-handlers');

// ── 日志系统 ──
const LOG_FILE = path.join(app.getPath('userData'), 'wordpop.log');
let logLines = 0;

function initLog() {
  try {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(LOG_FILE)) {
      const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').length;
      logLines = lines;
      if (lines > 5000) {
        const kept = fs.readFileSync(LOG_FILE, 'utf8').split('\n').slice(-3000).join('\n');
        fs.writeFileSync(LOG_FILE, kept);
        logLines = kept.split('\n').length;
      }
    }
  } catch (e) { console.error('initLog error:', e.message); }
}

function log(...args) {
  const msg = `[${new Date().toISOString()}] ${args.join(' ')}`;
  console.log(msg);
  try {
    fs.appendFileSync(LOG_FILE, msg + '\n');
    logLines++;
  } catch (_) {}
}

// ── 窗口引用 ──
let settingsWindow = null;
let statsWindow   = null;
let setupWindow   = null;
let startupErrors  = [];

// ── 单例锁 ──
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { try { openStatsWindow(); } catch (_) {} });
}

process.on('uncaughtException', (err) => {
  log('[FATAL]', err.message, '\n', err.stack);
  startupErrors.push(`[FATAL] ${err.message}\n${err.stack}`);
});

function safeStep(name, fn) {
  try {
    const r = fn();
    log('[App] ✅', name, 'ok');
    return r;
  } catch (err) {
    log('[App] ❌', name, 'FAILED:', err.message);
    startupErrors.push(`[${name}] ${err.message}`);
    return null;
  }
}

// ── 路径工具 ──
function getPreloadPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar', 'src', 'preload', 'preload.js');
  }
  return path.join(__dirname, '..', 'src', 'preload', 'preload.js');
}

function getRendererPath(...segments) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar', 'src', 'renderer', ...segments);
  }
  return path.join(__dirname, '..', 'src', 'renderer', ...segments);
}

// ════════════════════════════════════════════╗
//  app 生命周期
// ════════════════════════════════════════════╝

app.whenReady().then(async () => {
  initLog();
  log('[App] ═══╗ WordPop starting');
  log('[App] Electron', process.versions.electron, '| Node', process.version);
  log('[App] platform', process.platform, '| arch', process.arch);
  log('[App] userData:', app.getPath('userData'));

  // 1. 数据库
  safeStep('initDatabase', initDatabase);

  // 2. 配置
  let config = safeStep('loadConfig', loadConfig);
  if (!config || typeof config !== 'object') {
    log('[App] loadConfig returned invalid, using default');
    config = { setupComplete: false, selectedWordlists: ['cet4'], dailyNewWords: 20 };
  }
  log('[App] config:', JSON.stringify(config));

  // 3. IPC
  safeStep('registerIpc', registerIpcHandlers);

  // 4. 托盘
  const trayOk = safeStep('createTray', () => createTray({
    onPauseToggle: (p) => { try { p ? scheduler.pause() : scheduler.resume(); } catch (_) {} },
    onOpenSettings: () => { try { openSettingsWindow(); } catch (_) {} },
    onOpenStats:    () => { try { openStatsWindow(); } catch (_) {} },
    onQuit:         () => { try { scheduler.stop(); app.quit(); } catch (_) { app.quit(); } }
  }));

  if (!trayOk) {
    log('[App] ❌ Tray creation FAILED');
    startupErrors.push('系统托盘创建失败');
    showErrorWindow();
    return;
  }

  // 5. 菜单
  safeStep('setMenu', () => Menu.setApplicationMenu(null));

  // 6. 启动
  if (!config.setupComplete) {
    log('[App] first launch → openSetupWindow');
    safeStep('openSetup', openSetupWindow);
  } else {
    safeStep('ensureWordlists', async () => { await ensureWordlistsImported(config); });

    const popOk = safeStep('createPopup', () => popupManager.createPopupWindow());

    // 等弹窗 ready 再启动调度器
    log('[App] waiting for popup ready...');
    popupManager.waitForReady(10000).then(() => {
      log('[App] popup ready → starting scheduler');
      try {
        scheduler.start();
        log('[App] scheduler started successfully');
      } catch (e) {
        log('[App] scheduler.start FAILED:', e.message, e.stack);
      }
    }).catch(() => {
      log('[App] popup waitForReady timed out → starting scheduler anyway');
      try {
        scheduler.start();
        log('[App] scheduler started (after timeout)');
      } catch (e) {
        log('[App] scheduler.start FAILED (after timeout):', e.message);
      }
    });
  }

  log('[App] ═══╗ WordPop ready (errors:', startupErrors.length, ')');
});

// ════════════════════════════════════════════╗
//  词库导入
// ══════════════════════════════════════════════╝

async function ensureWordlistsImported(config) {
  const db = require('./db').getDb();
  const lists = config.selectedWordlists || ['cet4'];
  for (const id of lists) {
    try {
      const cnt = db.prepare('SELECT COUNT(*) c FROM words WHERE wordlist=?').get(id).c;
      log('[App] wordlist', id, ':', cnt, 'words in DB');
      if (cnt === 0) {
        log('[App] importing', id, '...');
        const r = importWordlist(id);
        log('[App] imported', r.imported, 'words');
      }
    } catch (err) {
      log('[App] ❌ import', id, 'failed:', err.message);
    }
  }
}

// ════════════════════════════════════════════╗
//  窗口工厂
// ════════════════════════════════════════════╝

function showErrorWindow() {
  try {
    const win = new BrowserWindow({
      width: 520, height: 400, title: 'WordPop — 启动错误',
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: false, nodeIntegration: true }
    });
    const logPath = LOG_FILE.replace(/\\/g, '\\\\');
    const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:20px;background:#f5f5f5">
      <h2 style="color:#d32f2f">WordPop 启动遇到问题</h2>
      <pre style="background:#fff;padding:12px;border-radius:6px;font-size:12px;max-height:180px;overflow:auto">${startupErrors.join('\n\n')}</pre>
      <p style="color:#666;font-size:12px">日志位置：${logPath}</p>
      <button onclick="require('electron').shell.openPath('${logPath}')" style="margin:8px 8px 0 0;padding:8px 18px;background:#1976d2;color:#fff;border:none;border-radius:4px;cursor:pointer">📂 打开日志文件夹</button>
      <button onclick="require('electron').app.quit()" style="margin:8px 0 0 0;padding:8px 18px;background:#d32f2f;color:#fff;border:none;border-radius:4px;cursor:pointer">❌ 退出</button>
    </body></html>`;
    win.loadURL('data:text/html;charset=utf8,' + encodeURIComponent(html));
  } catch (_) {}
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.focus(); return; }
  try {
    settingsWindow = new BrowserWindow({
      width: 520, height: 640, resizable: false, title: 'WordPop — 设置',
      autoHideMenuBar: true,
      webPreferences: {
        preload: getPreloadPath(),
        contextIsolation: true, nodeIntegration: false, sandbox: false
      }
    });
    settingsWindow.loadFile(getRendererPath('settings', 'index.html'));
    settingsWindow.on('closed', () => { settingsWindow = null; });
  } catch (err) { log('[App] openSettings ERROR:', err.message); }
}

function openStatsWindow() {
  if (statsWindow && !statsWindow.isDestroyed()) { statsWindow.focus(); return; }
  try {
    statsWindow = new BrowserWindow({
      width: 520, height: 600, resizable: true, title: 'WordPop — 学习统计',
      autoHideMenuBar: true,
      webPreferences: {
        preload: getPreloadPath(),
        contextIsolation: true, nodeIntegration: false, sandbox: false
      }
    });
    statsWindow.loadFile(getRendererPath('stats', 'index.html'));
    statsWindow.on('closed', () => { statsWindow = null; });
  } catch (err) { log('[App] openStats ERROR:', err.message); }
}

function openSetupWindow() {
  try {
    setupWindow = new BrowserWindow({
      width: 480, height: 560, resizable: false, title: 'WordPop — 初始设置',
      autoHideMenuBar: true,
      webPreferences: {
        preload: getPreloadPath(),
        contextIsolation: true, nodeIntegration: false, sandbox: false
      }
    });
    setupWindow.loadFile(getRendererPath('settings', 'index.html'));
    setupWindow.on('closed', async () => {
      setupWindow = null;
      try {
        const c = loadConfig();
        if (!c || !c.setupComplete) saveConfig({ setupComplete: true });
        await ensureWordlistsImported(loadConfig());
        popupManager.createPopupWindow();
        popupManager.waitForReady(10000).then(() => {
          try { scheduler.start(); log('[App] scheduler started after setup'); } catch (e) {
            log('[App] scheduler start after setup FAILED:', e.message);
          }
        }).catch(() => {
          try { scheduler.start(); } catch (_) {}
        });
      } catch (err) { log('[App] setup closed handler error:', err.message); }
    });
  } catch (err) { log('[App] openSetup ERROR:', err.message); }
}

// ════════════════════════════════════════════╗
//  生命周期
// ════════════════════════════════════════════╝

app.on('window-all-closed', () => {});
app.on('activate', () => { try { openStatsWindow(); } catch (_) {} });
app.on('before-quit', () => {
  try { scheduler.stop(); destroyTray(); require('./db').closeDatabase(); } catch (_) {}
});
