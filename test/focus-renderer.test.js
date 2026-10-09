/** Run the real focus renderer with a minimal DOM and asynchronous IPC shell. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../src/renderer/focus/focus.js'), 'utf8');
const ratingIds = ['btn-unknown', 'btn-fuzzy', 'btn-known', 'btn-mastered'];
let passed = 0;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function createHarness() {
  const elements = new Map();
  const documentListeners = new Map();
  const calls = [];
  const errors = [];
  const responses = [];
  const words = [
    { id: 11, word: 'apple', translation: '苹果', stage: 1 },
    { id: 12, word: 'boat', translation: '船', stage: 0 },
    { id: 13, word: 'cat', translation: '猫', stage: 2 }
  ];
  function element(id) {
    if (!elements.has(id)) {
      const listeners = new Map();
      elements.set(id, {
        style: { display: 'none' }, textContent: '', innerHTML: '', disabled: false,
        addEventListener(event, callback) { listeners.set(event, callback); },
        click() { if (!this.disabled) return listeners.get('click')?.(); }
      });
    }
    return elements.get(id);
  }
  const context = vm.createContext({
    document: {
      getElementById: element,
      addEventListener(event, callback) { documentListeners.set(event, callback); }
    },
    window: {
      wordpopAPI: {
        getConfig: async () => ({}),
        getReviewPreview: async id => ({ success: true, wordId: id, state: 'new',
          generatedAt: Date.now(), dueAt: null, intervals: Object.fromEntries(
            ['unknown', 'fuzzy', 'known', 'easy'].map(action => [action, { interval: 60000, dueAt: Date.now() + 60000 }])) }),
        getFocusWords: async () => ({ success: true, words }),
        submitFocusWord(id, action) {
          calls.push({ id, action });
          assert.ok(responses.length, 'The test must specify each IPC response');
          return responses.shift();
        },
        closeFocusSession() {}
      }
    },
    console: { error: (...args) => errors.push(args) },
    setTimeout,
    playWordAudio() {}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/shared/review-preview.js'), 'utf8'), context);
  vm.runInContext(source, context, { filename: 'focus.js' });
  // Allow the renderer's actual initSession() config and word-list IPCs to settle.
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(element('focus-word').textContent, 'apple');
  const state = () => JSON.parse(vm.runInContext(`JSON.stringify({ currentIndex,
    correctCount, wrongCount, combo, maxCombo, isSubmitting, phase })`, context));
  return {
    element, calls, errors, responses, state,
    submit: action => vm.runInContext('submitWord(' + JSON.stringify(action) + ')', context),
    reveal: () => vm.runInContext('revealDetail()', context),
    key: key => documentListeners.get('keydown')({ key, preventDefault() {} })
  };
}

async function test(name, callback) {
  await callback();
  passed++;
  console.log('  ✓ ' + name);
}

async function run() {
  await test('成功保存后才更新计数、连击与当前词，并继续原有结算流程', async () => {
    const h = await createHarness();
    const pending = deferred();
    h.responses.push(pending.promise);
    const submission = h.element('btn-known').click();
    assert.deepStrictEqual(h.state(), { currentIndex: 0, correctCount: 0, wrongCount: 0,
      combo: 0, maxCombo: 0, isSubmitting: true, phase: 'recall' });
    assert.strictEqual(h.element('focus-word').textContent, 'apple');
    ratingIds.forEach(id => assert.strictEqual(h.element(id).disabled, true));
    pending.resolve({ success: true });
    await submission;
    assert.deepStrictEqual(h.state(), { currentIndex: 1, correctCount: 1, wrongCount: 0,
      combo: 1, maxCombo: 1, isSubmitting: false, phase: 'recall' });
    assert.strictEqual(h.element('focus-word').textContent, 'boat');
    ratingIds.forEach(id => assert.strictEqual(h.element(id).disabled, false));
    h.responses.push(Promise.resolve({ success: true }));
    await h.element('btn-mastered').click();
    assert.strictEqual(h.state().combo, 2);
    assert.strictEqual(h.element('combo-text').textContent, '2 连击');
    assert.deepStrictEqual(h.calls[1], { id: 12, action: 'easy' });
    h.responses.push(Promise.resolve({ success: true }));
    await h.element('btn-unknown').click();
    assert.strictEqual(h.state().wrongCount, 1);
    assert.strictEqual(h.state().combo, 0);
    assert.strictEqual(h.element('focus-summary').style.display, 'flex');
    assert.strictEqual(h.element('sum-count').textContent, 3);
    assert.strictEqual(h.element('sum-accuracy').textContent, '67%');
    assert.strictEqual(h.element('sum-max-combo').textContent, 2);
    assert.strictEqual(h.errors.length, 0);
  });

  await test('数据库失败保留当前词、原连击和统计，记录错误后允许重试', async () => {
    const h = await createHarness();
    h.responses.push(Promise.resolve({ success: true }));
    await h.submit('known');
    h.reveal();
    const before = h.state();
    h.responses.push(Promise.resolve({ success: false, error: 'database busy' }));
    await h.element('btn-unknown').click();
    assert.deepStrictEqual(h.state(), before);
    assert.strictEqual(h.element('focus-word').textContent, 'boat');
    assert.strictEqual(h.element('focus-detail').style.display, 'block');
    assert.strictEqual(h.errors.length, 1);
    assert.match(h.errors[0][1].message, /database busy/);
    ratingIds.forEach(id => assert.strictEqual(h.element(id).disabled, false));
    h.responses.push(Promise.resolve({ success: true }));
    await h.element('btn-fuzzy').click();
    assert.strictEqual(h.state().currentIndex, 2);
    assert.strictEqual(h.state().correctCount, 1);
    assert.strictEqual(h.state().wrongCount, 1);
    assert.strictEqual(h.state().combo, 0);
    assert.deepStrictEqual(h.calls.slice(1), [
      { id: 12, action: 'unknown' }, { id: 12, action: 'fuzzy' }
    ]);
  });

  await test('IPC Promise 拒绝不会推进词或统计，评分按钮恢复后可重试', async () => {
    const h = await createHarness();
    h.reveal();
    const before = h.state();
    const rejected = deferred();
    h.responses.push(rejected.promise);
    const submission = h.element('btn-known').click();
    rejected.reject(new Error('IPC disconnected'));
    await submission;
    assert.deepStrictEqual(h.state(), before);
    assert.strictEqual(h.element('focus-word').textContent, 'apple');
    assert.match(h.errors[0][1].message, /IPC disconnected/);
    ratingIds.forEach(id => assert.strictEqual(h.element(id).disabled, false));
    h.responses.push(Promise.resolve({ success: true }));
    await h.element('btn-known').click();
    assert.strictEqual(h.state().currentIndex, 1);
    assert.strictEqual(h.state().correctCount, 1);
    assert.deepStrictEqual(h.calls, [
      { id: 11, action: 'known' }, { id: 11, action: 'known' }
    ]);
  });

  await test('等待保存时重复点击、快捷键和直接调用均只提交一次', async () => {
    const h = await createHarness();
    h.reveal();
    const pending = deferred();
    h.responses.push(pending.promise);
    const submission = h.element('btn-known').click();
    h.element('btn-known').click();
    h.element('btn-mastered').click();
    h.key('Enter');
    h.key('m');
    await h.submit('unknown');
    assert.deepStrictEqual(h.calls, [{ id: 11, action: 'known' }]);
    assert.strictEqual(h.state().currentIndex, 0);
    pending.resolve({ success: true });
    await submission;
    assert.strictEqual(h.state().currentIndex, 1);
    assert.strictEqual(h.state().correctCount, 1);
    assert.strictEqual(h.state().wrongCount, 0);
    ratingIds.forEach(id => assert.strictEqual(h.element(id).disabled, false));
  });

  await test('IPC 同步异常和缺失成功响应同样保留可重试状态', async () => {
    const h = await createHarness();
    const before = h.state();
    // An unspecified response causes the API shell to throw synchronously.
    await h.submit('known');
    assert.deepStrictEqual(h.state(), before);
    h.responses.push(Promise.resolve(undefined));
    await h.submit('known');
    assert.deepStrictEqual(h.state(), before);
    assert.strictEqual(h.errors.length, 2);
    assert.match(h.errors[1][1].message, /保存学习结果失败/);
    ratingIds.forEach(id => assert.strictEqual(h.element(id).disabled, false));
  });

  console.log('Focus renderer persistence tests passed: ' + passed + '.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
