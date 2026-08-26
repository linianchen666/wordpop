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
  pronounceVoice: 'dict-us',
  displayMode: 'card',
  batchSize: 3,
  cooldownMinutes: 10
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
    const isPill = popupConfig.displayMode === 'pill';
    const bounds = getPopupBounds(popupConfig.position, popupConfig.displayMode);

    popupWindow = new BrowserWindow({
      width: isPill ? 320 : 380,
      height: isPill ? 56 : 440,
      x: bounds.x,
      y: bounds.y,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: true,
      show: false,
      transparent: isPill,
      hasShadow: true,
      backgroundColor: isPill ? '#00000000' : '#FFFFFF',
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
    const isPill = popupConfig.displayMode === 'pill';
    const bounds = getPopupBounds(popupConfig.position, popupConfig.displayMode);
    popupWindow.setBounds({
      ...bounds,
      width: isPill ? 320 : 380,
      height: isPill ? 56 : 440
    });

    popupWindow.webContents.send('popup:word', {
      ...wordData,
      config: {
        showExample: popupConfig.showExample,
        fontSize: popupConfig.fontSize,
        theme: popupConfig.theme,
        autoPronounce: popupConfig.autoPronounce,
        pronounceVoice: popupConfig.pronounceVoice || 'dict-us',
        displayMode: popupConfig.displayMode || 'card'
      }
    });

    if (!popupWindow.isVisible()) popupWindow.showInactive();
    popupWindow.setAlwaysOnTop(true, 'floating');
    popupWindow.moveTop();
  } catch (err) {
    console.error('[Popup] _displayWord ERROR:', err.message, err.stack);
  }
}

/**
 * 显示批次完成微结算卡片
 */
function showBatchCompletion(data) {
  if (!popupWindow || popupWindow.isDestroyed()) return;
  try {
    popupWindow.webContents.send('popup:batch-completed', data);
    // 2.8 秒后优雅隐退
    setTimeout(() => {
      try {
        if (popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible()) {
          popupWindow.hide();
        }
      } catch (e) {}
    }, 2800);
  } catch (e) {
    console.error('[Popup] showBatchCompletion error:', e.message);
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

function getPopupBounds(position, displayMode = 'card') {
  try {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const isPill = displayMode === 'pill';
    const W = isPill ? 320 : 380;
    const H = isPill ? 56 : 440;
    const M = 20;
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
  if (cfg.pronounceVoice !== undefined) popupConfig.pronounceVoice = cfg.pronounceVoice;
  if (cfg.displayMode !== undefined) popupConfig.displayMode = cfg.displayMode;
  if (cfg.batchSize !== undefined) popupConfig.batchSize = cfg.batchSize;
  if (cfg.cooldownMinutes !== undefined) popupConfig.cooldownMinutes = cfg.cooldownMinutes;

  // 如果弹窗正在显示，立即调整尺寸与位置
  if (popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible()) {
    const isPill = popupConfig.displayMode === 'pill';
    const bounds = getPopupBounds(popupConfig.position, popupConfig.displayMode);
    popupWindow.setBounds({
      ...bounds,
      width: isPill ? 320 : 380,
      height: isPill ? 56 : 440
    });
  }
}

function isVisible() {
  return popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible();
}

function hasCurrentWord() {
  return popupWindow && !popupWindow.isDestroyed();
}

function destroy() { closeImmediately(); }

module.exports = {
  createPopupWindow, show, hide, restore, closeImmediately,
  showBatchCompletion, updateConfig, isVisible, hasCurrentWord, waitForReady, destroy
};
