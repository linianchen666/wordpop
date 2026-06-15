const { BrowserWindow, screen } = require('electron');
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
 * 创建弹窗窗口
 */
function createPopupWindow() {
  if (popupWindow && !popupWindow.isDestroyed()) {
    return popupWindow;
  }

  try {
    popupReady = false;
    pendingWordData = null;
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
        preload: path.join(__dirname, '..', 'preload', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });

    popupWindow.loadFile(path.join(__dirname, '..', 'renderer', 'popup', 'index.html'));

    popupWindow.once('ready-to-show', () => {
      popupReady = true;
      console.log('[Popup] ready-to-show fired');

      // 延迟 150ms 处理 pending data，避免 Windows 上回调内 show() 失效
      if (pendingWordData) {
        const data = pendingWordData;
        pendingWordData = null;
        setTimeout(() => {
          try {
            _displayWord(data);
          } catch (e) {
            console.error('[Popup] Error displaying pending word:', e.message);
          }
        }, 150);
      }
    });

    popupWindow.on('closed', () => {
      popupWindow = null;
      popupReady = false;
      console.log('[Popup] Window closed');
    });

    return popupWindow;
  } catch (err) {
    console.error('[Popup] FAILED to create window:', err.message);
    popupWindow = null;
    popupReady = false;
    return null;
  }
}

/**
 * 等待弹窗就绪
 */
function waitForReady(timeout = 10000) {
  return new Promise((resolve) => {
    if (popupReady) {
      resolve();
      return;
    }

    const start = Date.now();
    const check = setInterval(() => {
      if (popupReady || (Date.now() - start > timeout)) {
        clearInterval(check);
        resolve();
      }
    }, 50);
  });
}

/**
 * 显示弹窗并传入单词数据
 */
function show(wordData) {
  console.log('[Popup] show() called, ready=', popupReady, 'window=', !!popupWindow);

  try {
    if (popupWindow && !popupWindow.isDestroyed() && popupReady) {
      _displayWord(wordData);
    } else if (popupWindow && !popupWindow.isDestroyed() && !popupReady) {
      pendingWordData = wordData;
    } else {
      createPopupWindow();
      if (popupReady) {
        _displayWord(wordData);
      } else {
        pendingWordData = wordData;
      }
    }
  } catch (err) {
    console.error('[Popup] show() error:', err.message);
    // 重建窗口
    try {
      if (popupWindow && !popupWindow.isDestroyed()) popupWindow.close();
    } catch (_) {}
    popupWindow = null;
    popupReady = false;
    createPopupWindow();
    pendingWordData = wordData;
  }
}

/**
 * 发送单词数据到渲染进程并确保窗口可见
 */
function _displayWord(wordData) {
  if (!popupWindow || popupWindow.isDestroyed()) {
    createPopupWindow();
    pendingWordData = wordData;
    return;
  }

  try {
    // 更新位置
    const bounds = getPopupBounds(popupConfig.position);
    popupWindow.setBounds({ ...bounds, width: 360, height: 240 });

    // 发送数据到渲染进程
    popupWindow.webContents.send('popup:word', {
      ...wordData,
      config: {
        showExample: popupConfig.showExample,
        fontSize: popupConfig.fontSize,
        theme: popupConfig.theme
      }
    });

    // === Windows 兼容的窗口显示逻辑 ===
    popupWindow.show();
    popupWindow.focus();
    popupWindow.setAlwaysOnTop(true, 'floating');
    popupWindow.moveTop();

    console.log('[Popup] Displaying word:', wordData.word,
      '| visible:', popupWindow.isVisible(),
      '| focused:', popupWindow.isFocused());
  } catch (err) {
    console.error('[Popup] _displayWord error:', err.message);
  }
}

/**
 * 隐藏弹窗
 */
function hide() {
  try {
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.hide();
      console.log('[Popup] Window hidden');
    }
  } catch (err) {
    console.error('[Popup] hide error:', err.message);
  }
}

/**
 * 恢复弹窗显示
 */
function restore() {
  try {
    if (!popupWindow || popupWindow.isDestroyed()) {
      createPopupWindow();
      return;
    }

    popupWindow.show();
    popupWindow.focus();
    popupWindow.setAlwaysOnTop(true, 'floating');
    popupWindow.moveTop();
    console.log('[Popup] Window restored, visible:', popupWindow.isVisible());
  } catch (err) {
    console.error('[Popup] restore error:', err.message);
  }
}

/**
 * 强制关闭弹窗
 */
function closeImmediately() {
  try {
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.close();
    }
  } catch (e) {
    // 不在乎
  }
  popupWindow = null;
  popupReady = false;
}

/**
 * 计算弹窗坐标
 */
function getPopupBounds(position) {
  try {
    const display = screen.getPrimaryDisplay();
    const { width, height } = display.workAreaSize;
    const popupW = 360;
    const popupH = 240;
    const margin = 20;

    switch (position) {
      case 'top-left':
        return { x: margin, y: margin };
      case 'top-right':
        return { x: width - popupW - margin, y: margin };
      case 'bottom-left':
        return { x: margin, y: height - popupH - margin };
      case 'bottom-right':
      default:
        return { x: width - popupW - margin, y: height - popupH - margin };
    }
  } catch (e) {
    return { x: 100, y: 100 };
  }
}

/**
 * 更新弹窗配置
 */
function updateConfig(config) {
  if (config.popupPosition !== undefined) popupConfig.position = config.popupPosition;
  if (config.fontSize !== undefined) popupConfig.fontSize = config.fontSize;
  if (config.showExample !== undefined) popupConfig.showExample = config.showExample;
  if (config.theme !== undefined) popupConfig.theme = config.theme;
}

function isVisible() {
  return popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible();
}

function isReady() {
  return popupReady;
}

function destroy() {
  closeImmediately();
}

module.exports = {
  createPopupWindow,
  show,
  hide,
  restore,
  closeImmediately,
  updateConfig,
  isVisible,
  isReady,
  waitForReady,
  destroy
};