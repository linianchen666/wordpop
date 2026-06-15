const { app, BrowserWindow, Menu, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const { initDatabase, importWordlist, getWordlistIndex } = require('./db');
const { loadConfig, saveConfig } = require('./config');
const { createTray, destroyTray } = require('./tray');
const popupManager = require('./popup-manager');
const scheduler = require('./scheduler');
const { registerIpcHandlers } = require('./ipc-handlers');

// ─┘ 日志系统 ═┘
const LOG_FILE = path.join(app.getPath('userData'), 'wordpop.log');
let   logFd = null;               // 文件描述符（持续打开，减少 I/O）
let   logLines = 0;            // 日志行数 → 超过 5000 行自动截断

function initLog() {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // 启动时截断超大日志（> 5000 行）
  if (fs.existsSync(LOG_FILE)) {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').length;
    logLines = lines;
    if (lines > 5000) {
      const kept = fs.readFileSync(LOG_FILE, 'utf8').split('\n').slice(-3000).join('\n');
      fs.writeFileSync(LOG_FILE, kept);
      logLines = kept.split('\n').length;
    }
  }
}
function log(...args) {
  const msg = `[${new Date().toISOString()}] ${args.join(' ')}`;
  console.log(msg);
  try {
    fs.appendFileSync(LOG_FILE, msg + '\n');
    logLines++;
  } catch (_) {}
}
function getLogs() {
  try { return fs.readFileSync(LOG_FILE, 'utf8'); } catch (_) { return '(no log)'; }
}
function openLogInNotepad() {
  // Windows：用 notepad 打开日志
  const { exec } = require('child_process');
  exec(`notepad "${LOG_FILE.replace(/\//g, '\\')}"`, (err) => {
    if (err) dialog.showErrorBox('无法打开日志', err.message);
  });
}

// ─┘ 窗口引用 ═┘
let settingsWindow = null;
let statsWindow   = null;
let setupWindow   = null;

// ─┘ 启动步骤错误收集 ═┘
let startupErrors = [];

// ════════════════════════════════════════════╗
//  app 生命周期
// ════════════════════════════════════════════╝

// 单例锁
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

/**
 * 安全执行一个启动步骤；失败只记录，不阻断其他步骤
 */
function safeStep(name, fn) {
  try {
    const r = fn();
    log(`[App] ✅ ${name} ok`);
    return r;
  } catch (err) {
    const msg = `[App] ❌ ${name} FAILED: ${err.message}`;
    log(msg, '\n', err.stack);
    startupErrors.push(msg);
    return null;
  }
}

/**
 * 显示「启动错误」窗口（仅当托盘创建失败时使用）
 */
function showErrorWindow() {
  try {
    const win = new BrowserWindow({
      width: 520, height: 400, title: 'WordPop — 启动错误',
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: false, nodeIntegration: true }
    });
    const html = `<!DOCTYPE html>
<html><body style="font-family:sans-serif;padding:20px;background:#f5f5f5">
  <h2 style="color:#d32f2f">WordPop 启动遇到问题</h2>
  <p>以下错误阻止了应用正常启动：</p>
  <pre style="background:#fff;padding:12px;border-radius:6px;font-size:12px;max-height:180px;overflow:auto">${startupErrors.join('\n\n')}</pre>
  <p style="color:#666;font-size:12px">日志位置：${LOG_FILE.replace(/\\/g, '\\\\')}</p>
  <button onclick="require('electron').shell.openPath('${LOG_FILE.replace(/\\/g, '\\\\')}')" style="margin:8px 8px 0 0;padding:8px 18px;background:#1976d2;color:#fff;border:none;border-radius:4px;cursor:pointer">📂 打开日志文件夹</button>
  <button onclick="require('electron').app.quit()" style="margin:8px 0 0 0;padding:8px 18px;background:#d32f2f;color:#fff;border:none;border-radius:4px;cursor:pointer">❌ 退出</button>
</body></html>`;
    win.loadURL('data:text/html;charset=utf8,' + encodeURIComponent(html));
  } catch (_) {}
}

app.whenReady().then(async () => {
  initLog();
  log('[App] ═══╗ WordPop starting');
  log('[App] Electron', process.versions.electron, '| Node', process.version);
  log('[App] platform', process.platform, '| arch', process.arch);
  log('[App] userData:', app.getPath('userData'));

  // ── 1. 数据库 ═─
  safeStep('initDatabase', initDatabase);

  // ── 2. 配置 ═─
  const config = safeStep('loadConfig', loadConfig) || {
    setupComplete: false, selectedWordlists: ['cet4'], dailyNewWords: 20
  };
  log(`[App] config:`, JSON.stringify(config));

  // ── 3. IPC ═─
  safeStep('registerIpc', registerIpcHandlers);

  // ── 4. 托盘 ═─
  const trayOk = safeStep('createTray', () => createTray({
    onPauseToggle: (p) => { try { p ? scheduler.pause() : scheduler.resume(); } catch (_) {} },
    onOpenSettings:  () => { try { openSettingsWindow(); } catch (_) {} },
    onOpenStats:     () => { try { openStatsWindow();   } catch (_) {} },
    onQuit:          () => { try { scheduler.stop(); app.quit(); } catch (_) { app.quit(); } }
  }));

  if (!trayOk) {
    log('[App] ❌ Tray creation FAILED — showing error window');
    startupErrors.push('系统托盘创建失败，WordPop 无法在后台运行。');
    showErrorWindow();
    return;   // ← 不继续，否则用户无法退出
  }

  // ── 5. 菜单 ═─
  safeStep('setMenu', () => Menu.setApplicationMenu(null));

  // ── 6. 首次启动 / 正常启动 ═─
  if (!config.setupComplete) {
    log('[App] first launch → openSetupWindow');
    safeStep('openSetup', openSetupWindow);
  } else {
    // 导入词库（失败不影响后续启动）
    safeStep('ensureWordlists', async () => { await ensureWordlistsImported(config); });

    // 创建弹窗
    const popOk = safeStep('createPopup', () => popupManager.createPopupWindow());

    // 启动调度器（无论弹窗是否成功都要启动，否则托盘暂停/恢复无响应）
    safeStep('startScheduler', () => {
      if (popOk !== null) {
        popupManager.waitForReady(10000).then(() => {
          log('[App] popup ready → start scheduler');
          try { scheduler.start(); } catch (e) { log('[App] scheduler.start error:', e.message); }
        }).catch(() => {
          log('[App] popup waitForReady timed out → start scheduler anyway');
          try { scheduler.start(); } catch (e) { log('[App] scheduler.start error:', e.message); }
        });
      } else {
        log('[App] popup creation failed → start scheduler without popup');
        try { scheduler.start(); } catch (e) { log('[App] scheduler.start error:', e.message); }
      }
    });
  }

  log('[App] ═══╗ WordPop ready (errors:', startupErrors.length, ')');
});

// ════════════════════════════════════════════╗
//  词库导入
// ══════════════════════════════════════════════╝

async function ensureWordlistsImported(config) {
  const db     = require('./db').getDb();
  const lists = config.selectedWordlists || ['cet4'];
  for (const id of lists) {
    try {
      const cnt = db.prepare('SELECT COUNT(*) c FROM words WHERE wordlist=?').get(id).c;
      log(`[App] wordlist ${id}: ${cnt} words in DB`);
      if (cnt === 0) {
        log(`[App] importing ${id}...`);
        const r = importWordlist(id);
        log(`[App] imported ${r.imported} words`);
      }
    } catch (err) {
      log(`[App] ❌ import ${id} failed:`, err.message);
    }
  }
}

// ════════════════════════════════════════════╗
//  窗口工厂
// ════════════════════════════════════════════╝

/** 用 asar 兼容路径加载 HTML */
function loadView(window, ...segments) {
  const fp = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar', ...segments)
    : path.join(__dirname, '..', ...segments);
  log(`[Window] loadFile: ${fp}`);
  window.loadFile(fp);
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.focus(); return; }
  try {
    settingsWindow = new BrowserWindow({
      width: 520, height: 640, resizable: false, title: 'WordPop — 设置',
      autoHideMenuBar: true,
      webPreferences: {
        preload: app.isPackaged
          ? path.join(process.resourcesPath, 'app.asar', 'src', 'preload', 'preload.js')
          : path.join(__dirname, '..', 'src', 'preload', 'preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: false
      }
    });
    loadView(settingsWindow, 'src', 'renderer', 'settings', 'index.html');
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
        preload: app.isPackaged
          ? path.join(process.resourcesPath, 'app.asar', 'src', 'preload', 'preload.js')
          : path.join(__dirname, '..', 'src', 'preload', 'preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: false
      }
    });
    loadView(statsWindow, 'src', 'renderer', 'stats', 'index.html');
    statsWindow.on('closed', () => { statsWindow = null; });
  } catch (err) { log('[App] openStats ERROR:', err.message); }
}

function openSetupWindow() {
  try {
    setupWindow = new BrowserWindow({
      width: 480, height: 560, resizable: false, title: 'WordPop — 初始设置',
      autoHideMenuBar: true,
      webPreferences: {
        preload: app.isPackaged
          ? path.join(process.resourcesPath, 'app.asar', 'src', 'preload', 'preload.js')
          : path.join(__dirname, '..', 'src', 'preload', 'preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: false
      }
    });
    loadView(setupWindow, 'src', 'renderer', 'settings', 'index.html');
    setupWindow.on('closed', async () => {
      setupWindow = null;
      try {
        const c = loadConfig();
        if (!c.setupComplete) saveConfig({ setupComplete: true });
        await ensureWordlistsImported(loadConfig());
        popupManager.createPopupWindow();
        popupManager.waitForReady(10000).then(() => {
          try { scheduler.start(); } catch (_) {}
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

app.on('window-all-closed', () => {});   // 托盘常驻
app.on('activate',            () => { try { openStatsWindow(); } catch (_) {} });
app.on('before-quit',          () => {
  try { scheduler.stop(); destroyTray(); require('./db').closeDatabase(); } catch (_) {}
});
