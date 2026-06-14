const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
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

// 开发模式标志
const isDev = process.argv.includes('--dev');

/**
 * 应用入口
 */
app.whenReady().then(async () => {
  console.log('[App] WordPop starting...');

  // 1. 初始化数据库
  initDatabase();

  // 2. 加载配置
  const config = loadConfig();

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

  // 5. 隐藏 macOS 的 Dock 图标（Windows 下不影响）
  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  // 6. 移除应用菜单（Windows 上不需要）
  Menu.setApplicationMenu(null);

  // 7. 首次启动：检查是否需要初始设置
  if (!config.setupComplete) {
    openSetupWindow();
  } else {
    // 确保所选词库已导入
    await ensureWordlistsImported(config);

    // 8. 创建弹窗（不显示，等待调度器）
    popupManager.createPopupWindow();

    // 9. 启动调度器
    scheduler.start();

    // 10. 设置统计更新通知
    scheduler.onStatsUpdate(() => {
      // 通知统计窗口更新
      if (statsWindow && !statsWindow.isDestroyed()) {
        statsWindow.webContents.send('stats:updated');
      }
    });
  }

  console.log('[App] WordPop ready');
});

/**
 * 确保所选词库已导入数据库
 */
async function ensureWordlistsImported(config) {
  const wordlists = config.selectedWordlists || ['cet4'];
  const index = getWordlistIndex();
  const { getDb } = require('./db');
  const db = getDb();

  for (const wlId of wordlists) {
    const entry = index.find(e => e.id === wlId);
    if (!entry) continue;

    // 检查是否已导入
    const count = db.prepare('SELECT COUNT(*) as c FROM words WHERE wordlist = ?').get(wlId);
    if (!count || count.c === 0) {
      try {
        importWordlist(wlId);
        console.log(`[App] Auto-imported wordlist: ${wlId}`);
      } catch (err) {
        console.error(`[App] Failed to import ${wlId}:`, err.message);
      }
    }
  }
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
  settingsWindow.setMenu(null);

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
  statsWindow.setMenu(null);

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
  setupWindow.setMenu(null);

  setupWindow.on('closed', () => {
    setupWindow = null;
    // 设置窗口关闭后启动主功能
    const config = loadConfig();
    if (!config.setupComplete) {
      // 用户关闭了设置窗口但未完成设置，使用默认配置
      saveConfig({ setupComplete: true });
    }

    popupManager.createPopupWindow();
    scheduler.start();
    scheduler.onStatsUpdate(() => {
      if (statsWindow && !statsWindow.isDestroyed()) {
        statsWindow.webContents.send('stats:updated');
      }
    });
  });
}

// === 应用生命周期 ===

// 所有窗口关闭时不退出（托盘应用）
app.on('window-all-closed', () => {
  // 不退出，托盘常驻
});

// macOS 激活
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    openStatsWindow();
  }
});

// 退出前清理
app.on('before-quit', () => {
  scheduler.stop();
  destroyTray();
  const { closeDatabase } = require('./db');
  closeDatabase();
});

// 防止多实例
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // 已有实例运行时，显示设置窗口
    openStatsWindow();
  });
}

// 全局异常处理
process.on('uncaughtException', (error) => {
  console.error('[App] Uncaught Exception:', error);
});
