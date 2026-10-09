const { BrowserWindow, screen, app } = require('electron');
const path = require('path');
const { saveConfig } = require('./config');

let popupWindow = null;
let popupWindowMode = null;
let popupReady = false;
let pendingWordData = null;
let popupSizes = {};
let sizeSaveTimer = null;

function minimumSize(displayMode) {
  return displayMode === 'pill'
    ? { minWidth: 280, minHeight: 56 }
    : { minWidth: 320, minHeight: 300 };
}

function savePopupSizes() {
  const result = saveConfig({ popupSizes });
  if (!result.success) console.error('[Popup] Save size:', result.error);
}

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
      width: bounds.width,
      height: bounds.height,
      ...minimumSize(popupConfig.displayMode),
      x: bounds.x,
      y: bounds.y,
      frame: false,
      resizable: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: true,
      show: false,
      transparent: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: getAsarPath('src', 'preload', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });
    popupWindowMode = isPill ? 'pill' : 'card';

    const htmlPath = getAsarPath('src', 'renderer', 'popup', 'index.html');
    popupWindow.loadFile(htmlPath);

    const window = popupWindow;
    window.on('resize', () => {
      if (window.isDestroyed()) return;
      const [width, height] = window.getSize();
      const mode = popupWindowMode;
      popupSizes[mode] = { width, height };
      clearTimeout(sizeSaveTimer);
      sizeSaveTimer = setTimeout(() => {
        sizeSaveTimer = null;
        savePopupSizes();
      }, 250);
    });

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
      if (sizeSaveTimer) {
        clearTimeout(sizeSaveTimer);
        sizeSaveTimer = null;
        savePopupSizes();
      }
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
    const bounds = getPopupBounds(popupConfig.position, popupConfig.displayMode);
    popupWindowMode = popupConfig.displayMode === 'pill' ? 'pill' : 'card';
    const { minWidth, minHeight } = minimumSize(popupConfig.displayMode);
    popupWindow.setMinimumSize(minWidth, minHeight);
    popupWindow.setBounds(bounds);

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
    const display = screen.getPrimaryDisplay();
    const { x = 0, y = 0, width, height } = display.workArea || display.workAreaSize;
    const isPill = displayMode === 'pill';
    const mode = isPill ? 'pill' : 'card';
    let saved = popupSizes[mode];
    // Read the native size too: a new word can arrive before the resize event.
    if (popupWindow && !popupWindow.isDestroyed() && popupWindowMode === mode) {
      const [currentWidth, currentHeight] = popupWindow.getSize();
      saved = { width: currentWidth, height: currentHeight };
    }
    const { minWidth, minHeight } = minimumSize(displayMode);
    const M = 20;
    const W = Math.min(Math.max(minWidth, Number.isFinite(saved?.width) ? Math.round(saved.width) : (isPill ? 320 : 380)), width - M * 2);
    const H = Math.min(Math.max(minHeight, Number.isFinite(saved?.height) ? Math.round(saved.height) : (isPill ? 56 : 440)), height - M * 2);
    const size = { width: W, height: H };
    switch (position) {
      case 'top-left':     return { ...size, x: x + M, y: y + M };
      case 'top-right':    return { ...size, x: x + width - W - M, y: y + M };
      case 'bottom-left':  return { ...size, x: x + M, y: y + height - H - M };
      default:             return { ...size, x: x + width - W - M, y: y + height - H - M };
    }
  } catch (e) { return { x: 100, y: 100, width: displayMode === 'pill' ? 320 : 380, height: displayMode === 'pill' ? 56 : 440 }; }
}

function updateConfig(cfg) {
  if (cfg.popupSizes) popupSizes = { ...popupSizes, ...cfg.popupSizes };
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
    const bounds = getPopupBounds(popupConfig.position, popupConfig.displayMode);
    popupWindowMode = popupConfig.displayMode === 'pill' ? 'pill' : 'card';
    const { minWidth, minHeight } = minimumSize(popupConfig.displayMode);
    popupWindow.setMinimumSize(minWidth, minHeight);
    popupWindow.setBounds(bounds);
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
