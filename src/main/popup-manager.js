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

  popupReady = false;
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
    console.log('[Popup] Window ready');
    if (pendingWordData) {
      const data = pendingWordData;
      pendingWordData = null;
      _displayWord(data);
    }
  });

  popupWindow.on('closed', () => {
    popupWindow = null;
    popupReady = false;
  });

  return popupWindow;
}

/**
 * 显示弹窗并传入单词数据
 * 如果窗口已存在且可见，直接更新内容；否则创建/显示窗口
 */
function show(wordData) {
  if (popupWindow && !popupWindow.isDestroyed() && popupReady) {
    // 窗口已就绪，直接更新内容
    _displayWord(wordData);
  } else {
    // 窗口未就绪或不存在，创建并暂存数据
    createPopupWindow();
    if (popupReady) {
      _displayWord(wordData);
    } else {
      pendingWordData = wordData;
    }
  }
}

/**
 * 发送单词数据到渲染进程并确保窗口可见
 */
function _displayWord(wordData) {
  if (!popupWindow || popupWindow.isDestroyed()) {
    // 窗口丢了，重建
    createPopupWindow();
    if (!popupReady) {
      pendingWordData = wordData;
      return;
    }
  }

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

  // 确保窗口可见
  if (!popupWindow.isVisible()) {
    try {
      popupWindow.showInactive();
    } catch (e) {
      popupWindow.show();
    }
  }

  console.log('[Popup] Displaying word:', wordData.word);
}

/**
 * 隐藏弹窗（仅隐藏，不销毁，下次 show 时直接复用）
 */
function hide() {
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.hide();
  }
}

/**
 * 强制关闭弹窗
 */
function closeImmediately() {
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.close();
    popupWindow = null;
  }
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

function destroy() {
  closeImmediately();
}

module.exports = {
  createPopupWindow,
  show,
  hide,
  closeImmediately,
  updateConfig,
  isVisible,
  destroy
};
