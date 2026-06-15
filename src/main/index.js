const { app, BrowserWindow, Menu, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const { initDatabase, importWordlist, getWordlistIndex } = require('./db');
const { loadConfig, saveConfig } = require('./config');
const { createTray, destroyTray, updateStatus, startAutoUpdateCheck } = require('./tray');
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
    // 如果返回 Promise，记录但不 await（调用方需自行处理）
    if (r && typeof r.then === 'function') {
      log('[App] ⏳', name, 'returned Promise (async step)');
      r.then(() => log('[App] ✅', name, 'async ok'))
       .catch(err => {
         log('[App] ❌', name, 'async FAILED:', err.message);
         startupErrors.push(`[${name}] ${err.message}`);
       });
    } else {
      log('[App] ✅', name, 'ok');
    }
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
    onShowPopup:    () => { try { showPopup(); } catch (_) {} },
    onPauseToggle:  (p) => { try { p ? scheduler.pause() : scheduler.resume(); } catch (_) {} },
    onOpenSettings: () => { try { openSettingsWindow(); } catch (_) {} },
    onOpenStats:    () => { try { openStatsWindow(); } catch (_) {} },
    onQuit:         () => { try { scheduler.stop(); app.quit(); } catch (_) { app.quit(); } }
  }));

  // 4.1 自动检查更新
  startAutoUpdateCheck(config.autoCheckUpdate !== false);

  if (!trayOk) {
    log('[App] ❌ Tray creation FAILED');
    startupErrors.push('系统托盘创建失败');
    showErrorWindow();
    return;
  }

  // 5. 菜单
  safeStep('setMenu', () => Menu.setApplicationMenu(null));

  // 5.1 定时刷新托盘状态（显示下次弹窗倒计时）
  setInterval(() => {
    try { updateStatus(scheduler.getStatus()); } catch (_) {}
  }, 15000); // 每15秒刷新一次

  // 5.2 每次学完单词也刷新托盘状态
  scheduler.onStatsUpdate(() => {
    try { updateStatus(scheduler.getStatus()); } catch (_) {}
  });

  // 5.3 每次弹出单词也刷新托盘状态（显示"正在显示单词..."）
  scheduler.onWordPop(() => {
    try { updateStatus(scheduler.getStatus()); } catch (_) {}
  });

  // 5.5 开机自启：每次启动时根据配置重新注册（确保 exe 路径更新后自启仍然有效）
  if (config.autoStart) {
    safeStep('autoStart', () => {
      app.setLoginItemSettings({
        openAtLogin: true,
        path: app.getPath('exe')
      });
      log('[App] autoStart registered, exe:', app.getPath('exe'));
    });
  }

  // 6. 启动（确保词库导入完成后再启动调度器）
  if (!config.setupComplete) {
    log('[App] first launch → openSetupWindow');
    safeStep('openSetup', openSetupWindow);
  } else {
    // 关键修复：确保词库导入完成后再创建弹窗和启动调度器
    try {
      log('[App] importing wordlists...');
      await ensureWordlistsImported(config);
      log('[App] wordlists import completed');
    } catch (err) {
      log('[App] ❌ wordlists import error:', err.message);
    }

    safeStep('createPopup', () => popupManager.createPopupWindow());

    // 等弹窗 ready 再启动调度器
    log('[App] waiting for popup ready...');
    popupManager.waitForReady(10000).then(() => {
      log('[App] popup ready → starting scheduler');
      try {
        scheduler.start();
        log('[App] scheduler started successfully');
        // 调度器启动后立即刷新托盘状态
        try { updateStatus(scheduler.getStatus()); } catch (_) {}
      } catch (e) {
        log('[App] scheduler.start FAILED:', e.message, e.stack);
      }
    }).catch(() => {
      log('[App] popup waitForReady timed out → starting scheduler anyway');
      try {
        scheduler.start();
        log('[App] scheduler started (after timeout)');
        try { updateStatus(scheduler.getStatus()); } catch (_) {}
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
  let lists = (config && config.selectedWordlists) || [];

  // 如果词库列表为空，使用默认值并更新配置
  if (lists.length === 0) {
    log('[App] ⚠️ selectedWordlists is empty, using default [cet4]');
    lists = ['cet4'];
    try {
      saveConfig({ selectedWordlists: lists });
    } catch (e) {
      log('[App] failed to update config with default wordlist:', e.message);
    }
  }

  log('[App] ensureWordlistsImported: wordlists =', JSON.stringify(lists));

  for (const id of lists) {
    try {
      const cnt = db.prepare('SELECT COUNT(*) c FROM words WHERE wordlist=?').get(id).c;
      log('[App] wordlist', id, ':', cnt, 'words in DB');
      if (cnt === 0) {
        log('[App] importing', id, '...');
        const r = importWordlist(id);
        log('[App] imported', r.imported, 'words from', id);
      }
    } catch (err) {
      log('[App] ❌ import', id, 'failed:', err.message);
    }
  }

  // 验证导入结果
  try {
    const totalWords = db.prepare('SELECT COUNT(*) c FROM words').get().c;
    log('[App] total words in DB after import:', totalWords);
    if (totalWords === 0) {
      log('[App] ⚠️ WARNING: no words in database after import!');
    }
  } catch (e) {
    log('[App] word count check failed:', e.message);
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
        // 1. 清除配置缓存，确保读取到设置窗口保存的最新配置
        const { clearCache } = require('./config');
        clearCache();

        // 2. 确保配置标记为已完成
        const c = loadConfig();
        if (!c || !c.setupComplete) saveConfig({ setupComplete: true });

        // 3. 重新读取配置（设置窗口可能修改了词库选择等配置）
        const freshConfig = loadConfig();
        log('[App] setup closed, config after refresh:', JSON.stringify(freshConfig));

        // 4. 等待词库导入完成（关键！确保词库在DB中后才启动调度器）
        log('[App] importing wordlists after setup...');
        await ensureWordlistsImported(freshConfig);
        log('[App] wordlists import completed after setup');

        // 5. 创建弹窗窗口
        popupManager.createPopupWindow();

        // 6. 等弹窗 ready 再启动调度器
        popupManager.waitForReady(10000).then(() => {
          log('[App] popup ready after setup → starting scheduler');
          try {
            scheduler.start();
            log('[App] scheduler started after setup');
            try { updateStatus(scheduler.getStatus()); } catch (_) {}
          } catch (e) {
            log('[App] scheduler start after setup FAILED:', e.message);
          }
        }).catch(() => {
          log('[App] popup waitForReady timed out after setup → starting scheduler anyway');
          try {
            scheduler.start();
            try { updateStatus(scheduler.getStatus()); } catch (_) {}
          } catch (_) {}
        });
      } catch (err) {
        log('[App] setup closed handler error:', err.message, err.stack);
        // 即使出错也尝试启动调度器
        try { scheduler.start(); } catch (_) {}
      }
    });
  } catch (err) { log('[App] openSetup ERROR:', err.message); }
}

// ════════════════════════════════════════════╗
//  显示弹窗（托盘「显示弹窗」/ 双击托盘图标）
// ════════════════════════════════════════════╝

function showPopup() {
  try {
    const status = scheduler.getStatus();
    if (status.isPaused) {
      // 暂停状态 → 恢复学习
      scheduler.resume();
    } else if (status.currentWord) {
      // 有当前单词（用户最小化了弹窗）→ 恢复显示
      popupManager.restore();
    } else {
      // 没有当前单词（单词已进入间隔等待中）
      // 不强行弹出，因为此时没有可显示的单词
      log('[App] showPopup: no current word, popup stays hidden until next word is due');
    }
  } catch (err) {
    log('[App] showPopup error:', err.message);
  }
}

// ════════════════════════════════════════════╗
//  生命周期
// ════════════════════════════════════════════╝

app.on('window-all-closed', () => {});
app.on('activate', () => { try { openStatsWindow(); } catch (_) {} });
app.on('before-quit', () => {
  try { scheduler.stop(); destroyTray(); require('./db').closeDatabase(); } catch (_) {}
});
