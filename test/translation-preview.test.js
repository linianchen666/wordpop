const assert = require('assert');
const { summarize, render } = require('../src/renderer/shared/translations');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ✓ ' + name); }
test('简短释义保持原格式，空值可显示', () => {
  for (const value of ['vt. 放弃；抛弃', '苹果', '', undefined, null]) {
    const result = summarize(value);
    assert.equal(result.summary, value || ''); assert.equal(result.shortened, false);
  }
});
test('合并动词词性与重复义项，最多保留两条原义', () => {
  const full = 'vt. 投资, 花费, 笼罩, 授予；vi. 投资, 利用';
  const result = summarize(full);
  assert.equal(result.summary, 'v. 投资、花费');
  assert.equal(result.full, full); assert.equal(result.shortened, true);
});
test('保留括号内的逗号，专业义移到完整原文', () => {
  const full = 'n. 工具（用于切割、打磨等）, 器具, 设备；[计] 控件';
  assert.equal(summarize(full).summary, 'n. 工具（用于切割、打磨等）、器具');
  assert.equal(summarize(full).full, full);
});
test('情态助动词义不被can的罕见动词义挤掉', () => {
  const full = 'vt. 装罐；n. 罐头, 容器；aux. 能, 可以；[计] 作废字符';
  assert.ok(summarize(full).summary.startsWith('aux. 能、可以'));
  assert.ok(!summarize(full).summary.includes('作废字符'));
});
test('最多三个词性，胶囊使用单词性和单义项', () => {
  const full = 'n. 声音, 语音, 吵闹；a. 健全的, 可靠的, 合理的；adv. 彻底地, 充分地；vi. 发声, 回响';
  assert.equal(summarize(full).summary, 'n. 声音、语音；adj. 健全的、可靠的；adv. 彻底地、充分地');
  assert.equal(summarize(full, { maxGroups: 1, maxSenses: 1, maxLength: 18 }).summary, 'n. 声音');
});
test('单条极长释义有限长预览，唯一专业义不会变空', () => {
  const full = '一条很长的自定义释义'.repeat(20);
  assert.ok(summarize(full).summary.endsWith('…'));
  assert.ok(summarize(full).summary.length <= 64);
  assert.equal(summarize(full).full, full);
  assert.equal(summarize('[医] 胆囊').summary, '[医] 胆囊');
  const unicode = summarize('𠮷'.repeat(80)).summary;
  assert.equal(Array.from(unicode).length, 64);
  assert.ok(unicode.endsWith('…'));
});
test('完整原文用textContent显示，换词关闭详情并清除旧内容', () => {
  const summary = {}, details = { open: true }, fullElement = {};
  const full = 'n. <img src=x>, 普通义, 其他义, 很多义';
  render(summary, details, fullElement, full);
  assert.equal(fullElement.textContent, full);
  assert.equal(details.hidden, false); assert.equal(details.open, false);
  assert.ok(summary.textContent.includes('<img src=x>'));
  details.open = true;
  render(summary, details, fullElement, '短释义');
  assert.equal(details.hidden, true); assert.equal(details.open, false);
  assert.equal(fullElement.textContent, '短释义');
});
console.log(`Translation preview: ${passed} checks passed.`);
