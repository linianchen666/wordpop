const assert = require('assert');
const { EventEmitter } = require('events');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wordpop-resize-'));
const modules = ['popup-manager', 'config'].map(name => require.resolve('../src/main/' + name));
const cached = modules.map(file => require.cache[file]);
const originalLoad = Module._load;
let workArea = { x: 0, y: 0, width: 1920, height: 1080 };
let passed = 0;
let popup;

class Window extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
    this.visible = false;
    this.destroyed = false;
    this.messages = [];
    this.webContents = { send: (...message) => this.messages.push(message) };
  }
  loadFile() {}
  isDestroyed() { return this.destroyed; }
  isVisible() { return this.visible; }
  showInactive() { this.visible = true; }
  setAlwaysOnTop() {}
  moveTop() {}
  getSize() { return [this.bounds.width, this.bounds.height]; }
  setMinimumSize(width, height) { this.minimum = [width, height]; }
  setBounds(bounds) {
    const resized = bounds.width !== this.bounds.width || bounds.height !== this.bounds.height;
    this.bounds = { ...this.bounds, ...bounds };
    if (resized) this.emit('resize');
  }
  close() { this.destroyed = true; this.emit('closed'); }
}

function test(name, run) { run(); passed++; console.log('  ✓ ' + name); }

async function run() {
  try {
    Module._load = function(request) {
      if (request === 'electron') return {
        BrowserWindow: Window,
        app: { isPackaged: false, getPath: () => directory },
        screen: { getPrimaryDisplay: () => ({ workArea }) }
      };
      return originalLoad.apply(this, arguments);
    };
    modules.forEach(file => { delete require.cache[file]; });
    const config = require('../src/main/config');
    popup = require('../src/main/popup-manager');
    popup.updateConfig(config.loadConfig());
    const window = popup.createPopupWindow();
    window.emit('ready-to-show');

    test('实际弹窗允许缩放，并设置可用的最小卡片尺寸', () => {
      assert.strictEqual(window.options.resizable, true);
      assert.strictEqual(window.options.transparent, true);
      assert.strictEqual(window.options.backgroundColor, '#00000000');
      assert.strictEqual(window.options.minWidth, 320);
      assert.strictEqual(window.options.minHeight, 300);
      assert.deepStrictEqual(window.getSize(), [380, 440]);
    });

    test('用户调整后显示下一词和修改主题都保留尺寸', () => {
      window.setBounds({ ...window.bounds, width: 600, height: 640 });
      popup.show({ id: 1, word: 'first' });
      popup.show({ id: 2, word: 'second' });
      popup.updateConfig({ theme: 'dark' });
      assert.deepStrictEqual(window.getSize(), [600, 640]);
      assert.deepStrictEqual(window.bounds, { x: 1300, y: 420, width: 600, height: 640 });
      assert.strictEqual(window.messages.at(-1)[1].id, 2);
    });

    test('原生尺寸已变化但 resize 事件尚未到达时，新词也不会重置尺寸', () => {
      window.bounds = { ...window.bounds, width: 620, height: 660 };
      popup.show({ id: 3, word: 'resize-in-flight' });
      assert.deepStrictEqual(window.getSize(), [620, 660]);
      window.emit('resize');
      window.setBounds({ ...window.bounds, width: 600, height: 640 });
    });

    test('独立胶囊开关与旧模式值都不会把复习卡片压扁', () => {
      popup.updateConfig({ ambientPillEnabled: true, displayMode: 'pill' });
      assert.deepStrictEqual(window.getSize(), [600, 640]);
      assert.deepStrictEqual(window.minimum, [320, 300]);
      popup.show({ id: 3, word: 'card' });
      assert.strictEqual(window.messages.at(-1)[1].config.displayMode, 'card');
      popup.updateConfig({ ambientPillEnabled: false });
      assert.deepStrictEqual(window.getSize(), [600, 640]);
    });

    await new Promise(resolve => setTimeout(resolve, 300));
    test('缩放经实际配置模块保存，不覆盖其他配置', () => {
      const onDisk = JSON.parse(fs.readFileSync(path.join(directory, 'config.json'), 'utf8'));
      assert.deepStrictEqual(onDisk.popupSizes, { card: { width: 600, height: 640 } });
      assert.strictEqual(onDisk.dailyNewWords, 20);
    });

    test('关闭时立即保存最终尺寸，新模块实例从配置恢复', () => {
      window.setBounds({ ...window.bounds, width: 520, height: 500 });
      popup.destroy();
      config.clearCache();
      delete require.cache[modules[0]];
      popup = require('../src/main/popup-manager');
      popup.updateConfig(config.loadConfig());
      const reopened = popup.createPopupWindow();
      assert.deepStrictEqual(reopened.getSize(), [520, 500]);
      popup.updateConfig({ displayMode: 'pill' });
      reopened.emit('ready-to-show');
      popup.show({ id: 4, word: 'restored' });
      assert.deepStrictEqual(reopened.getSize(), [520, 500]);
    });

    test('保存的大尺寸适配较小屏幕和工作区偏移', () => {
      popup.destroy();
      workArea = { x: -1280, y: 40, width: 1280, height: 720 };
      popup.updateConfig({ displayMode: 'card', popupSizes: { card: { width: 4000, height: 3000 } } });
      const smaller = popup.createPopupWindow();
      assert.deepStrictEqual(smaller.bounds, { x: -1260, y: 60, width: 1240, height: 680 });
      popup.destroy();
      popup.updateConfig({ popupSizes: { card: { width: 'invalid', height: null } } });
      assert.deepStrictEqual(popup.createPopupWindow().getSize(), [380, 440]);
    });

    console.log(`Popup resizing: ${passed} tests passed.`);
  } finally {
    if (popup) popup.destroy();
    Module._load = originalLoad;
    modules.forEach((file, index) => {
      if (cached[index]) require.cache[file] = cached[index];
      else delete require.cache[file];
    });
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
