const path = require('path');

/** Electron window lifecycle for focus mode; learning logic lives in focus-session. */
function createFocusWindow({
  BrowserWindow,
  app,
  hidePopup = () => {},
  onClose = () => {},
  resourcesPath = process.resourcesPath,
  rootPath = path.join(__dirname, '..', '..')
}) {
  let focusWindow = null;

  function getAppPath(...segments) {
    return app.isPackaged
      ? path.join(resourcesPath, 'app.asar', ...segments)
      : path.join(rootPath, ...segments);
  }

  function openFocusWindow() {
    if (focusWindow && !focusWindow.isDestroyed()) {
      focusWindow.show();
      focusWindow.focus();
      return focusWindow;
    }

    // Focus mode hides the ordinary popup without changing scheduler settings.
    try {
      hidePopup();
    } catch (e) {}

    const window = new BrowserWindow({
      width: 680,
      height: 540,
      center: true,
      frame: false,
      resizable: true,
      minWidth: 440,
      minHeight: 360,
      skipTaskbar: false,
      alwaysOnTop: true,
      backgroundColor: '#0F172A',
      webPreferences: {
        preload: getAppPath('src', 'preload', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });
    focusWindow = window;
    window.loadFile(getAppPath('src', 'renderer', 'focus', 'index.html'));
    window.on('closed', () => {
      if (focusWindow === window) focusWindow = null;
      // Refresh the ordinary review queue after focus mode closes.
      try {
        onClose();
      } catch (e) {}
    });
    return window;
  }

  function closeFocusWindow() {
    if (focusWindow && !focusWindow.isDestroyed()) {
      focusWindow.close();
      focusWindow = null;
    }
  }

  return { openFocusWindow, closeFocusWindow };
}

module.exports = { createFocusWindow };
