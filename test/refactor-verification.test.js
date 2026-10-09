/**
 * 公共工具、开发资源路径和配置迁移的生产代码回归测试。
 * 浏览器工具在 VM 中运行；仅隔离 Electron 和 userData，不复制业务实现。
 */
const assert = require('assert');
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const vm = require('vm');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('=== 开始测试：生产工具、开发路径与配置回归 ===');

const root = path.join(__dirname, '..');
const utilsPath = path.join(root, 'src', 'renderer', 'shared', 'utils.js');
const renderer = vm.createContext({});
vm.runInContext(fs.readFileSync(utilsPath, 'utf8'), renderer, { filename: utilsPath });

test('实际公共工具显示巩固阶段和区间，兼容未知阶段', () => {
  assert.strictEqual(renderer.getStageName(0), '新学');
  assert.strictEqual(renderer.getStageName(1), '短期巩固');
  assert.strictEqual(renderer.getStageName(2), '半小时起');
  assert.strictEqual(renderer.getStageName(3), '4小时起');
  assert.strictEqual(renderer.getStageName(4), '1天起');
  assert.strictEqual(renderer.getStageName(9), '已掌握');
  assert.strictEqual(renderer.getStageName(99), '阶段99');
  assert.strictEqual(renderer.getStageColor(99), '#95A5A6');
});

test('实际公共数字格式化覆盖千与万的边界', () => {
  assert.strictEqual(renderer.formatNumber(999), '999');
  assert.strictEqual(renderer.formatNumber(1000), '1.0k');
  assert.strictEqual(renderer.formatNumber(10000), '1.0万');
});

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wordpop-config-test-'));
const configFile = path.join(testDir, 'config.json');
const configModulePath = require.resolve('../src/main/config');
const popupModulePath = require.resolve('../src/main/popup-manager');
const originalLoad = Module._load;
const originalModules = new Map([
  [configModulePath, require.cache[configModulePath]],
  [popupModulePath, require.cache[popupModulePath]]
]);

class BrowserWindowStub {
  constructor(options) { this.options = options; }
  loadFile(filePath) { this.loadedFile = filePath; }
  once() {}
  on() {}
  isDestroyed() { return false; }
  close() {}
}

let config;
let popup;
try {
  // 配置模块只使用真实临时 userData 路径，文件读写仍由实际 fs 执行。
  Module._load = function(request) {
    if (request === 'electron') {
      return {
        app: {
          isPackaged: false,
          getPath(name) {
            assert.strictEqual(name, 'userData');
            return testDir;
          }
        },
        BrowserWindow: BrowserWindowStub,
        screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) }
      };
    }
    return originalLoad.apply(this, arguments);
  };
  delete require.cache[configModulePath];
  delete require.cache[popupModulePath];
  config = require('../src/main/config');
  popup = require('../src/main/popup-manager');
  Module._load = originalLoad;

  test('实际弹窗开发路径指向现有 preload 和 renderer 文件', () => {
    const window = popup.createPopupWindow();
    assert.ok(window, '实际 createPopupWindow 必须成功创建窗口');
    assert.strictEqual(window.options.webPreferences.preload,
      path.join(root, 'src', 'preload', 'preload.js'));
    assert.strictEqual(window.loadedFile,
      path.join(root, 'src', 'renderer', 'popup', 'index.html'));
    assert.ok(fs.existsSync(window.options.webPreferences.preload));
    assert.ok(fs.existsSync(window.loadedFile));
    assert.strictEqual(window.options.webPreferences.contextIsolation, true);
    assert.strictEqual(window.options.webPreferences.nodeIntegration, false);
  });

  function loadFileConfig(value) {
    fs.writeFileSync(configFile, JSON.stringify(value));
    config.clearCache();
    return config.loadConfig();
  }

  test('实际配置模块迁移英美音，保留用户设置并补齐默认值', () => {
    for (const [accent, voice] of [['en-GB', 'dict-uk'], ['uk', 'dict-uk'], ['en-US', 'dict-us']]) {
      const loaded = loadFileConfig({ pronounceAccent: accent, dailyNewWords: 7 });
      assert.strictEqual(loaded.pronounceVoice, voice);
      assert.strictEqual(loaded.pronounceAccent, undefined);
      assert.strictEqual(loaded.dailyNewWords, 7);
      assert.strictEqual(loaded.cooldownMinutes, config.DEFAULT_CONFIG.cooldownMinutes);
      assert.strictEqual(config.getConfig('pronounceVoice'), voice);
    }
  });

  test('迁移后的配置通过实际保存与重载保留，不重新引入旧字段', () => {
    loadFileConfig({ pronounceAccent: 'en-GB', dailyNewWords: 7 });
    const saved = config.saveConfig({ theme: 'dark' });
    assert.strictEqual(saved.success, true);
    const onDisk = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    assert.strictEqual(onDisk.pronounceVoice, 'dict-uk');
    assert.strictEqual(onDisk.pronounceAccent, undefined);
    config.clearCache();
    assert.deepStrictEqual(config.loadConfig(), onDisk);
    assert.strictEqual(config.getConfig('theme'), 'dark');
    assert.strictEqual(config.getConfig('dailyNewWords'), 7);
  });

  test('新版角色音色不会被迁移或默认配置覆盖', () => {
    const loaded = loadFileConfig({ pronounceVoice: 'loli', dailyNewWords: 13 });
    assert.strictEqual(loaded.pronounceVoice, 'loli');
    assert.strictEqual(loaded.dailyNewWords, 13);
  });

  test('缺少配置文件时实际模块返回默认配置', () => {
    fs.unlinkSync(configFile);
    config.clearCache();
    assert.deepStrictEqual(config.loadConfig(), config.DEFAULT_CONFIG);
  });
} finally {
  Module._load = originalLoad;
  if (popup) popup.destroy();
  for (const [modulePath, previous] of originalModules) {
    if (previous) require.cache[modulePath] = previous;
    else delete require.cache[modulePath];
  }
  fs.rmSync(testDir, { recursive: true, force: true });
}

console.log(`\n🎉 ${passed} 项生产代码回归测试全部通过！\n`);
