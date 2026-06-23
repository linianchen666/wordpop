const { BrowserWindow, screen, app } = require('electron');
const path = require('path');

let popupWindow = null;
let popupReady = false;
let pendingWordData = null;

let popupConfig = {
  position: 'bottom-right',
  fontSize: 'medium',
  showExample: true,
  theme: 'light',
  autoPronounce: true,
  pronounceAccent: 'en-US'
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
      height: 280,
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
      // 关键：允许窗口在不获取焦点的情况下显示
      // 弹窗自动弹出时不抢焦点，用户点击时才获得焦点
      webPreferences: {
        preload: getAsarPath('src', 'preload', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });

    const htmlPath = getAsarPath('src', 'renderer', 'popup', 'index.html');
    popupWindow.loadFile(htmlPath);

    popupWindow.once('ready-to-show', () => {
      popupReady = true;
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
        resolve();
      }
    }, 100);
  });
}

/**
 * 显示弹窗并传入单词数据
 */
function show(wordData) {
  try {
    if (popupWindow && !popupWindow.isDestroyed() && popupReady) {
      _displayWord(wordData);
    } else if (popupWindow && !popupWindow.isDestroyed() && !popupReady) {
      pendingWordData = wordData;
    } else {
      createPopupWindow();
      pendingWordData = wordData;
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
    createPopupWindow();
    pendingWordData = wordData;
    return;
  }

  try {
    const bounds = getPopupBounds(popupConfig.position);
    popupWindow.setBounds({ ...bounds, width: 360, height: 280 });

    popupWindow.webContents.send('popup:word', {
      ...wordData,
      config: {
        showExample: popupConfig.showExample,
        fontSize: popupConfig.fontSize,
        theme: popupConfig.theme,
        autoPronounce: popupConfig.autoPronounce,
        pronounceAccent: popupConfig.pronounceAccent
      }
    });

    // 弹窗显示但不抢焦点：用 showInactive() 让弹窗可见但不中断用户当前操作
    // alwaysOnTop 确保弹窗在最前面可见
    // 用户想操作弹窗时点击即可获得焦点
    if (!popupWindow.isVisible()) popupWindow.showInactive();
    popupWindow.setAlwaysOnTop(true, 'floating');
    popupWindow.moveTop();
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
    // 恢复弹窗但不抢焦点
    if (!popupWindow.isVisible()) popupWindow.showInactive();
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
    const W = 360, H = 280, M = 20;
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
  if (cfg.autoPronounce !== undefined) popupConfig.autoPronounce = cfg.autoPronounce;
  if (cfg.pronounceAccent !== undefined) popupConfig.pronounceAccent = cfg.pronounceAccent;

  // 如果弹窗正在显示，立即移动到新位置
  if (popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible()) {
    const bounds = getPopupBounds(popupConfig.position);
    popupWindow.setBounds({ ...bounds, width: 360, height: 280 });
  }
}

function isVisible() {
  return popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible();
}

/**
 * 判断弹窗是否有当前单词可显示
 * 用于托盘「显示弹窗」按钮：有单词则恢复，无单词则不操作
 */
function hasCurrentWord() {
  return popupWindow && !popupWindow.isDestroyed();
}

function destroy() { closeImmediately(); }

/**
 * 向弹窗发送撤销提示
 */
function sendUndoAvailable(label) {
  try {
    if (popupWindow && !popupWindow.isDestroyed() && popupReady) {
      popupWindow.webContents.send('popup:undo-available', label);
    }
  } catch (e) {
    console.error('[Popup] sendUndoAvailable error:', e.message);
  }
}

module.exports = {
  createPopupWindow, show, hide, restore, closeImmediately,
  updateConfig, isVisible, hasCurrentWord, waitForReady, destroy,
  sendUndoAvailable
};
