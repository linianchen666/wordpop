const assert = require('assert');
const path = require('path');
const { EventEmitter } = require('events');
const { createFocusWindow } = require('../src/main/focus-window');

function createHarness(overrides = {}) {
  const windows = [];
  let hidden = 0;
  let reloaded = 0;
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.destroyed = false;
      this.showCount = 0;
      this.focusCount = 0;
      this.closeCount = 0;
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    loadFile(file) { this.file = file; }
    show() { this.showCount++; }
    focus() { this.focusCount++; }
    close() {
      this.closeCount++;
      this.destroyed = true;
      this.emit('closed');
    }
  }
  const controller = createFocusWindow({
    BrowserWindow: Window,
    app: { isPackaged: false },
    rootPath: '/development/wordpop',
    resourcesPath: '/installed/resources',
    hidePopup: () => { hidden++; },
    onClose: () => { reloaded++; },
    ...overrides
  });
  return {
    controller,
    windows,
    get hidden() { return hidden; },
    get reloaded() { return reloaded; }
  };
}

{
  const h = createHarness();
  h.controller.closeFocusWindow();
  assert.strictEqual(h.windows.length, 0);
  const first = h.controller.openFocusWindow();
  assert.strictEqual(h.windows.length, 1);
  assert.strictEqual(h.hidden, 1, 'opening focus mode hides the ordinary popup');
  assert.strictEqual(first.file, path.join('/development/wordpop', 'src/renderer/focus/index.html'));
  assert.strictEqual(first.options.webPreferences.preload, path.join('/development/wordpop', 'src/preload/preload.js'));
  assert.deepStrictEqual(first.options.webPreferences, {
    preload: first.options.webPreferences.preload,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false
  });
  assert.strictEqual(first.options.width, 680);
  assert.strictEqual(first.options.height, 540);
  assert.strictEqual(first.options.resizable, true);
  assert.strictEqual(first.options.minWidth, 440);
  assert.strictEqual(first.options.minHeight, 360);
  assert.strictEqual(first.options.alwaysOnTop, true);
  const second = h.controller.openFocusWindow();
  assert.strictEqual(second, first, 'repeated opening reuses the existing window');
  assert.strictEqual(h.windows.length, 1);
  assert.strictEqual(first.showCount, 1);
  assert.strictEqual(first.focusCount, 1);
  assert.strictEqual(h.hidden, 1, 'reusing the window does not hide the popup again');
  h.controller.closeFocusWindow();
  assert.strictEqual(first.closeCount, 1);
  assert.strictEqual(h.reloaded, 1, 'closing reloads the ordinary review queue');
  h.controller.closeFocusWindow();
  assert.strictEqual(h.reloaded, 1, 'closing twice is harmless');
  const reopened = h.controller.openFocusWindow();
  assert.notStrictEqual(reopened, first);
  assert.strictEqual(h.windows.length, 2);
  assert.strictEqual(h.hidden, 2);
  // Closing through Electron instead of the controller releases the window too.
  reopened.close();
  assert.strictEqual(h.reloaded, 2);
  assert.notStrictEqual(h.controller.openFocusWindow(), reopened);
}

{
  const h = createHarness({ app: { isPackaged: true } });
  const window = h.controller.openFocusWindow();
  assert.strictEqual(window.file, path.join('/installed/resources', 'app.asar', 'src/renderer/focus/index.html'));
  assert.strictEqual(window.options.webPreferences.preload, path.join('/installed/resources', 'app.asar', 'src/preload/preload.js'));
}

{
  const h = createHarness({
    hidePopup: () => { throw new Error('popup already unavailable'); },
    onClose: () => { throw new Error('scheduler shutting down'); }
  });
  assert.doesNotThrow(() => h.controller.openFocusWindow());
  assert.doesNotThrow(() => h.controller.closeFocusWindow());
  assert.strictEqual(h.windows.length, 1);
  assert.notStrictEqual(h.controller.openFocusWindow(), h.windows[0]);
}

{
  const h = createHarness();
  const previous = h.controller.openFocusWindow();
  // Electron can emit closed after close() returns; a stale callback must not
  // discard a window that was opened in the meantime.
  previous.close = () => { previous.destroyed = true; };
  h.controller.closeFocusWindow();
  const current = h.controller.openFocusWindow();
  previous.emit('closed');
  assert.strictEqual(h.controller.openFocusWindow(), current);
  assert.strictEqual(h.windows.length, 2);
  assert.strictEqual(h.reloaded, 1);
}

console.log('Focus window lifecycle tests passed.');
