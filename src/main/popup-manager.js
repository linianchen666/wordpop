const { BrowserWindow, screen, app } = require('electron');
const path = require('path');

let popupWindow = null;
let popupReady = false;
let pendingWordData = null;

let popupConfig = {
  position: 'bottom-right',
  fontSize: 'medium',
  showExample: true,
  theme: 'light'
};

/**
 * 获取 asar 内资源的正确路径
 */
function getAsarPath(...segments) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar', ...segments);
  }
  return path.join(__dirname, '..', '..', ...segments);
}

/**
 * 创建弹窗窗口
 */
function createPopupWindow() {
  if (popupWindow && !popupWindow.isDestroyed()) {
    return popupWindow;
  }

  popupReady = false;
  pendingWordData = null;

  try {
    const bounds = getPopupBounds(popupConfig.position);

    popupWindow = new BrowserWindow({
      width: 360,
      height: 240,
      x: bounds.x,
      y: bounds.y,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: true,
      show: false,
      transparent: false,
      hasShadow: true,
      backgroundColor: '#FFFFFF',
      webPreferences: {
        preload: getAsarPath('src', 'preload', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });

    const htmlPath = getAsarPath('src', 'renderer', 'popup', 'index.html');
    console.log('[Popup] Loading:', htmlPath);
    popupWindow.loadFile(htmlPath);

    popupWindow.once('ready-to-show', () => {
      popupReady = true;
      console.log('[Popup] ready-to-show fired');
      if (pendingWordData) {
        const d = pendingWordData;
        pendingWordData = null;
        setTimeout(() => {
          try { _displayWord(d); } catch (e) {
            console.error('[Popup] pending displayWord error:', e.message);
          }
        }, 300);
      }
    });

    popupWindow.on('closed', () => {
      popupWindow = null;
      popupReady = false;
      console.log('[Popup] closed');
    });

    return popupWindow;
  } catch (err) {
    console.error('[Popup] create ERROR:', err.message, err.stack);
    popupWindow = null;
    popupReady = false;
    return null;
  }
}

/**
 * 等待弹窗就绪
 */
function waitForReady(timeout) {
  timeout = timeout || 10000;
  return new Promise((resolve) => {
    if (popupReady) { resolve(); return; }
    const t0 = Date.now();
    const id = setInterval(() => {
      if (popupReady || Date.now() - t0 > timeout) {
        clearInterval(id);
        console.log('[Popup] waitForReady done, ready=', popupReady);
        resolve();
      }
    }, 100);
  });
}

/**
 * 显示弹窗并传入单词数据
 */
function show(wordData) {
  console.log('[Popup] show() called, ready=', popupReady, 'win=', !!popupWindow);
  try {
    if (popupWindow && !popupWindow.isDestroyed() && popupReady) {
      _displayWord(wordData);
    } else if (popupWindow && !popupWindow.isDestroyed() && !popupReady) {
      // 窗口存在但还没 ready，暂存数据
      pendingWordData = wordData;
      console.log('[Popup] win exists but not ready, data pending');
    } else {
      // 窗口不存在，创建新的
      createPopupWindow();
      pendingWordData = wordData;
      console.log('[Popup] new window created, data pending');
    }
  } catch (err) {
    console.error('[Popup] show() ERROR:', err.message);
  }
}

/**
 * 向渲染进程发送数据并显示窗口
 */
function _displayWord(wordData) {
  if (!popupWindow || popupWindow.isDestroyed()) {
    console.log('[Popup] _displayWord: window invalid, recreating...');
    createPopupWindow();
    pendingWordData = wordData;
    return;
  }

  try {
    const bounds = getPopupBounds(popupConfig.position);
    popupWindow.setBounds({ ...bounds, width: 360, height: 240 });

    popupWindow.webContents.send('popup:word', {
      ...wordData,
      config: {
        showExample: popupConfig.showExample,
        fontSize: popupConfig.fontSize,
        theme: popupConfig.theme
      }
    });

    // Windows 显示窗口的关键：show → focus → setAlwaysOnTop → moveTop
    if (!popupWindow.isVisible()) popupWindow.show();
    popupWindow.focus();
    popupWindow.setAlwaysOnTop(true, 'floating');
    popupWindow.moveTop();

    console.log('[Popup] displayWord:', wordData.word, '| visible:', popupWindow.isVisible());
  } catch (err) {
    console.error('[Popup] _displayWord ERROR:', err.message, err.stack);
  }
}

function hide() {
  try {
    if (popupWindow && !popupWindow.isDestroyed()) popupWindow.hide();
  } catch (e) {}
}

function restore() {
  try {
    if (!popupWindow || popupWindow.isDestroyed()) {
      createPopupWindow();
      return;
    }
    if (!popupWindow.isVisible()) popupWindow.show();
    popupWindow.focus();
    popupWindow.setAlwaysOnTop(true, 'floating');
    popupWindow.moveTop();
  } catch (e) {
    console.error('[Popup] restore ERROR:', e.message);
  }
}

function closeImmediately() {
  try { if (popupWindow && !popupWindow.isDestroyed()) popupWindow.close(); } catch (e) {}
  popupWindow = null;
  popupReady = false;
}

function getPopupBounds(position) {
  try {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const W = 360, H = 240, M = 20;
    switch (position) {
      case 'top-left':     return { x: M, y: M };
      case 'top-right':    return { x: width - W - M, y: M };
      case 'bottom-left':  return { x: M, y: height - H - M };
      default:             return { x: width - W - M, y: height - H - M };
    }
  } catch (e) { return { x: 100, y: 100 }; }
}

function updateConfig(cfg) {
  if (cfg.popupPosition !== undefined) popupConfig.position = cfg.popupPosition;
  if (cfg.fontSize !== undefined) popupConfig.fontSize = cfg.fontSize;
  if (cfg.showExample !== undefined) popupConfig.showExample = cfg.showExample;
  if (cfg.theme !== undefined) popupConfig.theme = cfg.theme;
}

function isVisible() {
  return popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible();
}

function destroy() { closeImmediately(); }

module.exports = {
  createPopupWindow, show, hide, restore, closeImmediately,
  updateConfig, isVisible, waitForReady, destroy
};
