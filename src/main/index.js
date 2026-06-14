const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { initDatabase, importWordlist, getWordlistIndex } = require('./db');
const { loadConfig, saveConfig } = require('./config');
const { createTray, destroyTray } = require('./tray');
const popupManager = require('./popup-manager');
const scheduler = require('./scheduler');
const { registerIpcHandlers } = require('./ipc-handlers');

// 窗口引用
let settingsWindow = null;
let statsWindow = null;
let setupWindow = null;

// 日志文件
const logPath = path.join(app.getPath('userData'), 'wordpop.log');
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  console.log(line.trim());
  try { fs.appendFileSync(logPath, line); } catch (e) {}
}

// 防止多实例
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    openStatsWindow();
  });
}

// 全局异常处理——写日志
process.on('uncaughtException', (error) => {
  log(`[FATAL] Uncaught Exception: ${error.message}\n${error.stack}`);
});

/**
 * 应用入口
 */
app.whenReady().then(async () => {
  log('[App] WordPop starting...');

  try {
    // 1. 初始化数据库
    initDatabase();
    log('[App] Database initialized');

    // 2. 加载配置
    const config = loadConfig();
    log(`[App] Config loaded: setupComplete=${config.setupComplete}, wordlists=${JSON.stringify(config.selectedWordlists)}`);

    // 3. 注册 IPC 处理器
    registerIpcHandlers();

    // 4. 创建系统托盘
    createTray({
      onPauseToggle: (paused) => {
        if (paused) {
          scheduler.pause();
          popupManager.closeImmediately();
        } else {
          scheduler.resume();
        }
      },
      onOpenSettings: openSettingsWindow,
      onOpenStats: openStatsWindow,
      onQuit: () => {
        scheduler.stop();
        app.quit();
      }
    });

    // 5. 移除应用菜单
    Menu.setApplicationMenu(null);

    // 6. 首次启动或已设置完成
    if (!config.setupComplete) {
      log('[App] First launch, opening setup window');
      openSetupWindow();
    } else {
      // 确保词库已导入
      await ensureWordlistsImported(config);

      // 创建弹窗
      popupManager.createPopupWindow();

      // 启动调度器
      scheduler.start();
      log('[App] Scheduler started');

      scheduler.onStatsUpdate(() => {
        if (statsWindow && !statsWindow.isDestroyed()) {
          statsWindow.webContents.send('stats:updated');
        }
      });
    }

    log('[App] WordPop ready');
  } catch (err) {
    log(`[FATAL] Startup error: ${err.message}\n${err.stack}`);
  }
});

/**
 * 确保所选词库已导入数据库
 */
async function ensureWordlistsImported(config) {
  const wordlists = config.selectedWordlists || ['cet4'];
  log(`[App] Ensuring wordlists imported: ${JSON.stringify(wordlists)}`);

  const index = getWordlistIndex();
  log(`[App] Available wordlists: ${JSON.stringify(index.map(e => e.id))}`);

  const { getDb } = require('./db');
  const db = getDb();

  for (const wlId of wordlists) {
    const entry = index.find(e => e.id === wlId);
    if (!entry) {
      log(`[App] WARNING: Wordlist ${wlId} not found in index`);
      continue;
    }

    const count = db.prepare('SELECT COUNT(*) as c FROM words WHERE wordlist = ?').get(wlId);
    log(`[App] Wordlist ${wlId}: ${count.c} words in DB`);

    if (!count || count.c === 0) {
      try {
        const result = importWordlist(wlId);
        log(`[App] Imported ${result.imported} words from ${wlId}`);
      } catch (err) {
        log(`[App] FAILED to import ${wlId}: ${err.message}`);
      }
    }
  }

  // 验证数据库中确实有单词
  const totalCount = db.prepare('SELECT COUNT(*) as c FROM words').get();
  log(`[App] Total words in DB: ${totalCount.c}`);
}

/**
 * 打开设置窗口
 */
function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 520,
    height: 640,
    resizable: false,
    title: 'WordPop - 设置',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, '..', 'renderer', 'settings', 'index.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

/**
 * 打开统计窗口
 */
function openStatsWindow() {
  if (statsWindow && !statsWindow.isDestroyed()) {
    statsWindow.focus();
    return;
  }

  statsWindow = new BrowserWindow({
    width: 520,
    height: 600,
    resizable: true,
    title: 'WordPop - 学习统计',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  statsWindow.loadFile(path.join(__dirname, '..', 'renderer', 'stats', 'index.html'));

  statsWindow.on('closed', () => {
    statsWindow = null;
  });
}

/**
 * 打开首次设置向导
 */
function openSetupWindow() {
  setupWindow = new BrowserWindow({
    width: 480,
    height: 560,
    resizable: false,
    title: 'WordPop - 初始设置',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  setupWindow.loadFile(path.join(__dirname, '..', 'renderer', 'settings', 'index.html'));

  setupWindow.on('closed', async () => {
    setupWindow = null;
    log('[App] Setup window closed');

    const config = loadConfig();
    if (!config.setupComplete) {
      saveConfig({ setupComplete: true });
    }

    const latestConfig = loadConfig();
    await ensureWordlistsImported(latestConfig);

    popupManager.createPopupWindow();
    scheduler.start();
    log('[App] Scheduler started after setup');

    scheduler.onStatsUpdate(() => {
      if (statsWindow && !statsWindow.isDestroyed()) {
        statsWindow.webContents.send('stats:updated');
      }
    });
  });
}

// === 应用生命周期 ===

app.on('window-all-closed', () => {
  // 不退出，托盘常驻
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    openStatsWindow();
  }
});

app.on('before-quit', () => {
  scheduler.stop();
  destroyTray();
  const { closeDatabase } = require('./db');
  closeDatabase();
});
