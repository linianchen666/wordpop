const assert = require('assert');
const Module = require('module');
const { EventEmitter } = require('events');
const originalLoad = Module._load;
let version, menu;
const dialogs = [], links = [], requests = [];
const image = { isEmpty: () => false };
class Tray extends EventEmitter {
  setToolTip() {}
  setContextMenu(value) { menu = value; }
  destroy() {}
}
Module._load = function(request) {
  if (request === 'electron') return {
    Tray, Menu: { buildFromTemplate: items => items },
    nativeImage: { createFromPath: () => image, createFromBuffer: () => image },
    app: { getVersion: () => version, isPackaged: false },
    dialog: { showMessageBox: async options => { dialogs.push(options); return { response: 0 }; } },
    shell: { openExternal: url => links.push(url) }
  };
  if (request === 'https') return { get(options, callback) {
    requests.push(options);
    const req = new EventEmitter();
    req.setTimeout = () => {}; req.destroy = () => {};
    setImmediate(() => {
      const res = new EventEmitter(); callback(res);
      res.emit('data', JSON.stringify({ tag_name: 'v1.8.1', body: '正式版' }));
      res.emit('end');
    });
    return req;
  } };
  return originalLoad.apply(this, arguments);
};
(async () => {
  const tray = require('../src/main/tray');
  try {
    for (const current of ['1.7.1', '1.8.0-beta.10', '1.8.1']) {
      version = current; dialogs.length = 0; links.length = 0; requests.length = 0;
      tray.createTray();
      menu.find(item => item.label?.includes('检查更新')).click();
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(requests[0].hostname, 'api.github.com');
      assert.equal(requests[0].path, '/repos/linianchen666/wordpop/releases/latest');
      assert.equal(dialogs.length, 1);
      if (current !== '1.8.1') {
        assert.equal(dialogs[0].title, '发现新版本');
        assert.ok(dialogs[0].message.includes('v1.8.1'));
        assert.deepEqual(links, ['https://github.com/linianchen666/wordpop/releases/latest']);
      } else {
        assert.ok(dialogs[0].message.includes('当前已是最新版本'));
        assert.deepEqual(links, []);
      }
      tray.destroyTray();
    }
    console.log('Update checks passed: actual tray menu, latest-release API, stable and beta upgrades, download link and current version.');
  } finally { tray.destroyTray(); Module._load = originalLoad; }
})().catch(error => { console.error(error); process.exitCode = 1; });
