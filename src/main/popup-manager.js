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
 * Windows 兼容性要点：
 * - focusable: true（Windows 要求可聚焦才能显示）
 * - transparent: false（Windows 上 transparent 会导致渲染异常）
 * - alwaysOnTop: true（确保弹窗不会被其他窗口遮挡）
 * - show: false（延迟显示，等 ready-to-show 后再 show）
 * - 不使用 showInactive()，直接用 show()
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
    // Windows 兼容：设置 level 为 floating 确保始终置顶
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // 不显示在任务栏
  popupWindow.setVisibleOnAllWorkspaces(true);

  popupWindow.loadFile(path.join(__dirname, '..', 'renderer', 'popup', 'index.html'));

  popupWindow.once('ready-to-show', () => {
    popupReady = true;
    console.log('[Popup] Window ready-to-show');

    if (pendingWordData) {
      const data = pendingWordData;
      pendingWordData = null;
      _displayWord(data);
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
 * 显示弹窗并传入单词数据
 * 核心逻辑：窗口创建后永不销毁（除非应用退出），只在需要时显示/隐藏
 */
function show(wordData) {
  console.log('[Popup] show() called, ready=', popupReady, 'window=', !!popupWindow);

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
 *
 * Windows 关键：show() 之后必须 moveTop()，否则窗口可能被遮挡
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

  // === Windows 兼容的窗口显示逻辑 ===
  // 关键：必须按 show -> setAlwaysOnTop -> moveTop 顺序调用
  try {
    if (!popupWindow.isVisible()) {
      popupWindow.show();
    }

    // 强制重新置顶（Windows 多显示器/Alt+Tab 后可能丢失置顶状态）
    popupWindow.setAlwaysOnTop(true, 'floating');

    // moveTop 将窗口提升到所有同级窗口之上
    popupWindow.moveTop();

    // 聚焦但不抢焦点（仅确保窗口在前台层级）
    if (!popupWindow.isFocused()) {
      // Windows 上 showInactive 不可靠，但 show + moveTop 组合更稳
      // 不调用 focus() 避免抢夺用户正在输入的焦点
    }
  } catch (e) {
    console.error('[Popup] Error showing window:', e.message);
    // 终极回退：重建窗口
    try {
      popupWindow.close();
    } catch (_) {}
    popupWindow = null;
    popupReady = false;
    createPopupWindow();
    pendingWordData = wordData;
  }

  console.log('[Popup] Displaying word:', wordData.word,
    '| visible:', popupWindow ? popupWindow.isVisible() : false);
}

/**
 * 隐藏弹窗
 * Windows 兼容：不使用 hide()，而是将窗口移出屏幕
 * 因为 hide() 后 show()/showInactive() 在 Windows 上不可靠
 *
 * 但为了功能正确，我们还是用 hide()，然后在恢复时用 show() + moveTop()
 */
function hide() {
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.hide();
    console.log('[Popup] Window hidden');
  }
}

/**
 * 恢复弹窗显示（从隐藏状态恢复）
 * 这是隐藏后恢复的关键路径
 */
function restore() {
  if (!popupWindow || popupWindow.isDestroyed()) {
    createPopupWindow();
    return;
  }

  try {
    popupWindow.show();
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
  destroy
};
