const { BrowserWindow, screen } = require('electron');
const path = require('path');

let popupWindow = null;
let popupReady = false;  // 窗口是否已加载完毕
let pendingWordData = null;  // 等待发送的单词数据

let popupConfig = {
  position: 'bottom-right',
  fontSize: 'medium',
  showExample: true,
  theme: 'light'
};

/**
 * 创建弹窗窗口
 * @returns {BrowserWindow}
 */
function createPopupWindow() {
  if (popupWindow && !popupWindow.isDestroyed()) {
    return popupWindow;
  }

  popupReady = false;
  const bounds = getPopupBounds(popupConfig.position);

  popupWindow = new BrowserWindow({
    width: 360,
    height: 220,
    x: bounds.x,
    y: bounds.y,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: false,
    focusable: false,
    show: false,
    transparent: true,
    type: 'toolbar',
    hasShadow: true,
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
    // 如果有等待发送的数据，立即发送
    if (pendingWordData) {
      const data = pendingWordData;
      pendingWordData = null;
      _sendWordData(data);
    }
  });

  popupWindow.on('closed', () => {
    popupWindow = null;
    popupReady = false;
  });

  return popupWindow;
}

/**
 * 发送单词数据到弹窗并显示
 */
function _sendWordData(wordData) {
  if (!popupWindow || popupWindow.isDestroyed()) return;

  popupWindow.webContents.send('popup:word', {
    ...wordData,
    config: {
      showExample: popupConfig.showExample,
      fontSize: popupConfig.fontSize,
      theme: popupConfig.theme
    }
  });

  popupWindow.showInactive();
}

/**
 * 计算弹窗坐标
 */
function getPopupBounds(position) {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;
  const popupW = 360;
  const popupH = 220;
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
}

/**
 * 显示弹窗并传入单词数据
 * @param {object} wordData - 单词数据 { id, word, phonetic, translation, example, stage, progress }
 */
function show(wordData) {
  const win = createPopupWindow();

  // 更新位置
  const bounds = getPopupBounds(popupConfig.position);
  win.setBounds({ ...bounds, width: 360, height: 220 });

  if (popupReady) {
    _sendWordData(wordData);
  } else {
    // 页面还没加载完，暂存数据等 ready-to-show
    pendingWordData = wordData;
  }
}

/**
 * 隐藏弹窗
 */
function hide() {
  if (popupWindow && !popupWindow.isDestroyed()) {
    // 发送隐藏信号让渲染进程执行淡出动画
    popupWindow.webContents.send('popup:hide');
    // 延迟关闭窗口以等待动画
    setTimeout(() => {
      if (popupWindow && !popupWindow.isDestroyed()) {
        popupWindow.hide();
      }
    }, 300);
  }
}

/**
 * 强制立即关闭弹窗
 */
function closeImmediately() {
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.close();
    popupWindow = null;
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

  // 如果弹窗当前可见，更新位置
  if (popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible()) {
    const bounds = getPopupBounds(popupConfig.position);
    popupWindow.setBounds({ ...bounds, width: 360, height: 220 });
  }
}

/**
 * 获取弹窗是否可见
 */
function isVisible() {
  return popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible();
}

/**
 * 销毁弹窗
 */
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
