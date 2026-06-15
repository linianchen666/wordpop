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
 *
 * 关键设计：
 * - show: false 创建时不显示
 * - 等 ready-to-show 事件后标记 popupReady = true
 * - 延迟 100ms 后再处理 pendingWordData，确保 Electron 内部状态完全就绪
 * - Windows 上不能在 ready-to-show 回调中直接调用 show()，会被忽略
 */
function createPopupWindow() {
  if (popupWindow && !popupWindow.isDestroyed()) {
    return popupWindow;
  }

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

  // 核心修复：不在 ready-to-show 中直接 show()
  // 而是：标记 ready → 延迟 → 再处理待显示的单词
  popupWindow.once('ready-to-show', () => {
    popupReady = true;
    console.log('[Popup] ready-to-show fired');

    // 延迟 150ms 让 Electron 完成内部初始化
    // Windows 上直接在回调中 show() 会被系统忽略
    if (pendingWordData) {
      const data = pendingWordData;
      pendingWordData = null;
      setTimeout(() => {
        _displayWord(data);
      }, 150);
    }
  });

  popupWindow.on('closed', () => {
    popupWindow = null;
    popupReady = false;
    console.log('[Popup] Window closed');
  });

  return popupWindow;
}

/**
 * 等待弹窗就绪
 * 返回 Promise，在 popupReady=true 时 resolve
 */
function waitForReady(timeout = 5000) {
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

  if (popupWindow && !popupWindow.isDestroyed() && popupReady) {
    // 窗口已就绪，直接更新内容
    _displayWord(wordData);
  } else if (popupWindow && !popupWindow.isDestroyed() && !popupReady) {
    // 窗口已创建但未就绪，暂存数据（等 ready-to-show 延迟后自动处理）
    pendingWordData = wordData;
  } else {
    // 窗口不存在，创建并暂存数据
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
 *
 * Windows 关键修复：
 * - show() 必须在非回调上下文中调用
 * - show() 后紧跟 focus() 确保 Windows 将窗口提升到前台
 * - setAlwaysOnTop + moveTop 双重保障
 */
function _displayWord(wordData) {
  if (!popupWindow || popupWindow.isDestroyed()) {
    // 窗口丢了，重建
    createPopupWindow();
    pendingWordData = wordData;
    return;
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

  // === Windows 兼容的窗口显示逻辑 ===
  try {
    // 先 show，让窗口从隐藏状态变为可见
    popupWindow.show();

    // show() 之后立即 focus()，这是 Windows 上的关键步骤
    // Windows 要求窗口获得焦点才能正确显示在前台
    popupWindow.focus();

    // 重新确认置顶状态
    popupWindow.setAlwaysOnTop(true, 'floating');

    // moveTop 将窗口提升到 Z-order 顶部
    popupWindow.moveTop();
  } catch (e) {
    console.error('[Popup] Error showing window:', e.message);
  }

  console.log('[Popup] Displaying word:', wordData.word,
    '| visible:', popupWindow.isVisible(),
    '| focused:', popupWindow.isFocused());
}

/**
 * 隐藏弹窗
 */
function hide() {
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.hide();
    console.log('[Popup] Window hidden');
  }
}

/**
 * 恢复弹窗显示（从隐藏状态恢复）
 */
function restore() {
  if (!popupWindow || popupWindow.isDestroyed()) {
    createPopupWindow();
    return;
  }

  try {
    // 与 _displayWord 相同的显示逻辑
    popupWindow.show();
    popupWindow.focus();
    popupWindow.setAlwaysOnTop(true, 'floating');
    popupWindow.moveTop();
    console.log('[Popup] Window restored, visible:', popupWindow.isVisible());
  } catch (e) {
    console.error('[Popup] Error restoring window:', e.message);
  }
}

/**
 * 强制关闭弹窗
 */
function closeImmediately() {
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.close();
    popupWindow = null;
    popupReady = false;
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
