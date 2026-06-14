const { BrowserWindow, screen } = require('electron');
const path = require('path');

let popupWindow = null;
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

  const bounds = getPopupBounds(popupConfig.position);

  popupWindow = new BrowserWindow({
    width: 360,
    height: 220,
    x: bounds.x,
    y: bounds.y,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: false,       // PRD 要求：不强制置顶
    focusable: false,         // 不抢焦点
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

  // 窗口准备好后显示（避免白屏）
  popupWindow.once('ready-to-show', () => {
    // 不自动显示，等待调度器推送
  });

  // 阻止窗口获取焦点
  popupWindow.on('focus', () => {
    // 立即让出焦点，但不在 Windows 上完全阻止
    // 这里使用 focusable: false 已经满足大部分需求
  });

  popupWindow.on('closed', () => {
    popupWindow = null;
  });

  return popupWindow;
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

  // 更新位置（以防设置变更）
  const bounds = getPopupBounds(popupConfig.position);
  win.setBounds({ ...bounds, width: 360, height: 220 });

  // 发送单词数据到渲染进程
  win.webContents.send('popup:word', {
    ...wordData,
    config: {
      showExample: popupConfig.showExample,
      fontSize: popupConfig.fontSize,
      theme: popupConfig.theme
    }
  });

  // 显示窗口（带淡入效果由 CSS 处理）
  win.showInactive();  // 不激活窗口，不抢焦点
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
