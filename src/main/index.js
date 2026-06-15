const { app, BrowserWindow, Menu, dialog } = require('electron');
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

// 日志文件路径（初始化前不能用 app.getPath）
let logPath = null;
let startupErrors = [];

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  console.log(line.trim());
  if (logPath) {
    try { fs.appendFileSync(logPath, line); } catch (e) {}
  }
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

// 全局异常处理——写日志 + 记录错误
process.on('uncaughtException', (error) => {
  const msg = `[FATAL] Uncaught Exception: ${error.message}\n${error.stack}`;
  log(msg);
  startupErrors.push(msg);
});

/**
 * 显示错误兜底窗口
 * 如果启动过程中出现严重错误，显示一个简单的窗口告知用户
 */
function showErrorWindow(errors) {
  const win = new BrowserWindow({
    width: 500,
    height: 400,
    title: 'WordPop - 启动错误',
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true
    }
  });

  const errorHtml = `
    <html>
    <body style="font-family: 'Segoe UI', sans-serif; padding: 20px; background: #f5f5f5;">
      <h2 style="color: #d32f2f;">WordPop 启动遇到问题</h2>
      <p>应用启动过程中出现了以下错误：</p>
      <pre style="background: #fff; padding: 12px; border-radius: 8px; font-size: 12px;
                  overflow: auto; max-height: 200px; border: 1px solid #e0e0e0;">
${errors.join('\n\n')}
      </pre>
      <p style="color: #666; font-size: 12px;">
        日志文件位置: ${logPath || '未知'}
      </p>
      <p style="color: #666; font-size: 12px;">
        你可以尝试：删除 %AppData%\\wordpop 文件夹后重新启动
      </p>
      <button onclick="require('electron').app.quit()" style="margin-top: 12px;
        padding: 8px 24px; background: #d32f2f; color: white; border: none;
        border-radius: 4px; cursor: pointer; font-size: 14px;">
        退出应用
      </button>
    </body>
    </html>
  `;

  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(errorHtml));
}

/**
 * 安全执行某个步骤，失败时记录错误但不阻断
 */
function safeStep(stepName, fn) {
  try {
    const result = fn();
    log(`[App] ${stepName} completed successfully`);
    return result;
  } catch (err) {
    const msg = `${stepName} failed: ${err.message}\n${err.stack}`;
    log(`[App] ERROR: ${msg}`);
    startupErrors.push(msg);
    return null;
  }
}

/**
 * 启动调度器和弹窗（等弹窗就绪后）
 */
function startScheduler() {
  log('[App] Starting scheduler...');

  popupManager.waitForReady(10000).then(() => {
    log('[App] Popup ready, starting scheduler');
    try {
      scheduler.start();
      scheduler.onStatsUpdate(() => {
        if (statsWindow && !statsWindow.isDestroyed()) {
          statsWindow.webContents.send('stats:updated');
        }
      });
    } catch (err) {
      log(`[App] Scheduler start error: ${err.message}`);
    }
  }).catch(() => {
    // 超时也要启动
    log('[App] Popup wait timed out, starting scheduler anyway');
    try {
      scheduler.start();
      scheduler.onStatsUpdate(() => {
        if (statsWindow && !statsWindow.isDestroyed()) {
          statsWindow.webContents.send('stats:updated');
        }
      });
    } catch (err) {
      log(`[App] Scheduler start error: ${err.message}`);
    }
  });
}

/**
 * 应用入口
 */
app.whenReady().then(async () => {
  // 初始化日志路径（app.whenReady 后才能用 app.getPath）
  logPath = path.join(app.getPath('userData'), 'wordpop.log');
  log('[App] WordPop starting...');

  // === 每个步骤独立错误处理，不互相阻断 ===

  // 1. 初始化数据库
  safeStep('Database init', () => initDatabase());

  // 2. 加载配置
  const config = safeStep('Config load', () => loadConfig()) || {
    setupComplete: false,
    selectedWordlists: ['cet4'],
    dailyNewWords: 20
  };
  log(`[App] Config: setupComplete=${config.setupComplete}, wordlists=${JSON.stringify(config.selectedWordlists)}`);

  // 3. 注册 IPC 处理器
  safeStep('IPC handlers', () => registerIpcHandlers());

  // 4. 创建系统托盘（最关键！即使其他都失败，托盘必须能用）
  const trayResult = safeStep('Tray creation', () => {
    return createTray({
      onPauseToggle: (paused) => {
        try {
          if (paused) { scheduler.pause(); }
          else { scheduler.resume(); }
        } catch (err) {
          log(`[App] Pause toggle error: ${err.message}`);
        }
      },
      onOpenSettings: openSettingsWindow,
      onOpenStats: openStatsWindow,
      onQuit: () => {
        scheduler.stop();
        app.quit();
      }
    });
  });

  // 如果托盘创建失败，这是一个严重问题，因为用户无法退出应用
  if (!trayResult) {
    startupErrors.push('系统托盘创建失败 - 应用可能无法正常退出');
  }

  // 5. 移除应用菜单
  safeStep('Menu removal', () => Menu.setApplicationMenu(null));

  // 6. 根据是否首次启动，走不同流程
  if (!config.setupComplete) {
    log('[App] First launch, opening setup window');
    openSetupWindow();
  } else {
    // 确保词库已导入
    safeStep('Wordlist import', async () => await ensureWordlistsImported(config));

    // 创建弹窗
    safeStep('Popup creation', () => popupManager.createPopupWindow());

    // 等弹窗就绪后启动调度器
    startScheduler();
  }

  // === 如果有严重错误，显示错误窗口 ===
  if (startupErrors.length > 0 && !trayResult) {
    // 托盘都没了，必须显示错误窗口让用户知道发生了什么
    showErrorWindow(startupErrors);
  }

  log(`[App] WordPop ready (errors: ${startupErrors.length})`);
});

/**
 * 确保所选词库已导入数据库
 */
async function ensureWordlistsImported(config) {
  const wordlists = config.selectedWordlists || ['cet4'];
  log(`[App] Ensuring wordlists imported: ${JSON.stringify(wordlists)}`);

  try {
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
      const expectedCount = entry.count || 0;
      log(`[App] Wordlist ${wlId}: ${count.c} words in DB, expected ${expectedCount}`);

      if (!count || count.c === 0 || count.c < expectedCount) {
        try {
          if (count.c > 0 && count.c < expectedCount) {
            db.prepare('DELETE FROM words WHERE wordlist = ?').run(wlId);
            db.prepare('DELETE FROM progress WHERE word_id NOT IN (SELECT id FROM words)').run();
          }
          const result = importWordlist(wlId);
          log(`[App] Imported ${result.imported} words from ${wlId}`);
        } catch (err) {
          log(`[App] FAILED to import ${wlId}: ${err.message}`);
        }
      }
    }

    const totalCount = db.prepare('SELECT COUNT(*) as c FROM words').get();
    log(`[App] Total words in DB: ${totalCount.c}`);
  } catch (err) {
    log(`[App] Wordlist import process error: ${err.message}`);
  }
}

/**
 * 打开设置窗口
 */
function openSettingsWindow() {
  try {
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
        nodeIntegration: false,
        sandbox: false
      }
    });

    settingsWindow.loadFile(path.join(__dirname, '..', 'renderer', 'settings', 'index.html'));

    settingsWindow.on('closed', () => {
      settingsWindow = null;
    });
  } catch (err) {
    log(`[App] Settings window error: ${err.message}`);
  }
}

/**
 * 打开统计窗口
 */
function openStatsWindow() {
  try {
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
        nodeIntegration: false,
        sandbox: false
      }
    });

    statsWindow.loadFile(path.join(__dirname, '..', 'renderer', 'stats', 'index.html'));

    statsWindow.on('closed', () => {
      statsWindow = null;
    });
  } catch (err) {
    log(`[App] Stats window error: ${err.message}`);
  }
}

/**
 * 打开首次设置向导
 */
function openSetupWindow() {
  try {
    setupWindow = new BrowserWindow({
      width: 480,
      height: 560,
      resizable: false,
      title: 'WordPop - 初始设置',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });

    setupWindow.loadFile(path.join(__dirname, '..', 'renderer', 'settings', 'index.html'));

    setupWindow.on('closed', async () => {
      setupWindow = null;
      log('[App] Setup window closed');

      try {
        const config = loadConfig();
        if (!config.setupComplete) {
          saveConfig({ setupComplete: true });
        }

        const latestConfig = loadConfig();
        await ensureWordlistsImported(latestConfig);

        popupManager.createPopupWindow();
        startScheduler();
      } catch (err) {
        log(`[App] Setup close handler error: ${err.message}`);
      }
    });
  } catch (err) {
    log(`[App] Setup window error: ${err.message}`);
    startupErrors.push(`设置窗口创建失败: ${err.message}`);
  }
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
  try {
    scheduler.stop();
    destroyTray();
    const { closeDatabase } = require('./db');
    closeDatabase();
  } catch (err) {
    // 退出时不在乎错误
  }
});