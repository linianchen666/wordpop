const assert = require('assert');
const { EventEmitter } = require('events');
const { attachSchedulerPresenter } = require('../src/main/scheduler-presenter');

let passed = 0;
function test(name, callback) {
  callback();
  passed++;
  console.log(`  ✓ ${name}`);
}

function harness(overrides = {}) {
  const scheduler = new EventEmitter();
  const calls = [];
  const errors = [];
  let visible = true;
  const popupManager = {
    show: payload => calls.push(['show', payload]),
    hide: () => { visible = false; calls.push(['hide']); },
    restore: () => { visible = true; calls.push(['restore']); },
    isVisible: () => visible,
    showBatchCompletion: payload => calls.push(['completion', payload])
  };
  const detach = attachSchedulerPresenter(scheduler, {
    popupManager,
    analyzeWord: word => ({ root: word }),
    getConfig: () => ({ batchSize: 3, cooldownMinutes: 10 }),
    logger: { error: (...args) => errors.push(args) },
    ...overrides
  });
  return { scheduler, calls, errors, detach };
}

test('调度事件生成兼容的弹窗数据，保留进度与批次信息', () => {
  const h = harness();
  h.scheduler.emit('word', { word: {
    id: 7, word: 'example', phonetic: '/test/', translation: '例子',
    example: 'An example.', stage: 2, correct_count: 3, wrong_count: 1
  }, queueRemaining: 8, batchCount: 1 });
  assert.deepStrictEqual(h.calls, [['show', {
    id: 7, word: 'example', phonetic: '/test/', translation: '例子',
    example: 'An example.', isNew: false,
    progress: { stage: 2, total: 9, correct: 3, wrong: 1 },
    queueRemaining: 8, etymology: { root: 'example' },
    batchIndex: 2, batchSize: 3, cooldownMinutes: 10
  }]]);
});

test('新词缺少可选字段时仍能展示，连续模式使用配置值', () => {
  const h = harness({ getConfig: () => ({ batchSize: 0, cooldownMinutes: 2 }) });
  h.scheduler.emit('word', { word: { id: 1, word: 'first' }, queueRemaining: 0, batchCount: 4 });
  const payload = h.calls[0][1];
  assert.strictEqual(payload.isNew, true);
  assert.strictEqual(payload.progress, null);
  assert.strictEqual(payload.phonetic, '');
  assert.strictEqual(payload.translation, '');
  assert.strictEqual(payload.example, '');
  assert.strictEqual(payload.batchIndex, 1);
  assert.strictEqual(payload.batchSize, 0);
  assert.strictEqual(payload.cooldownMinutes, 2);
});

test('暂停、恢复、空队列和批次完成控制对应窗口行为', () => {
  const h = harness();
  const summary = { batchSize: 3, cooldownMinutes: 10, queueRemaining: 12 };
  h.scheduler.emit('paused');
  h.scheduler.emit('idle');
  h.scheduler.emit('resumed');
  h.scheduler.emit('idle');
  h.scheduler.emit('batch-complete', summary);
  assert.deepStrictEqual(h.calls, [['hide'], ['restore'], ['hide'], ['completion', summary]]);
});

test('词源分析失败仍能展示单词，窗口错误不会中断调度事件', () => {
  const h = harness({ analyzeWord: () => { throw Error('analysis failed'); } });
  h.scheduler.emit('word', { word: { id: 1, word: 'first' }, queueRemaining: 0, batchCount: 0 });
  assert.strictEqual(h.calls[0][1].etymology, null);
  assert.strictEqual(h.errors.length, 1);
  const broken = harness({ popupManager: { hide: () => { throw Error('window closed'); } } });
  assert.doesNotThrow(() => broken.scheduler.emit('paused'));
  assert.strictEqual(broken.errors.length, 1);
});

test('移除展示适配器释放监听，不影响其他订阅者', () => {
  const h = harness();
  let otherCalls = 0;
  h.scheduler.on('paused', () => otherCalls++);
  h.detach();
  h.detach();
  h.scheduler.emit('paused');
  h.scheduler.emit('word', { word: { id: 1, word: 'first' }, queueRemaining: 0, batchCount: 0 });
  assert.strictEqual(otherCalls, 1);
  assert.deepStrictEqual(h.calls, []);
  assert.strictEqual(h.scheduler.listenerCount('word'), 0);
  assert.strictEqual(h.scheduler.listenerCount('review-failed'), 0);
});

test('评分保存失败重新发送当前词，让界面恢复评分按钮', () => {
  const h = harness();
  const word = { id: 1, word: 'retry', stage: 1, correct_count: 1 };
  h.scheduler.emit('review-failed', { word, action: 'known', error: Error('write failed'),
    queueRemaining: 5, batchCount: 2 });
  assert.strictEqual(h.calls.length, 1);
  const [method, payload] = h.calls[0];
  assert.strictEqual(method, 'show');
  assert.strictEqual(payload.id, word.id);
  assert.strictEqual(payload.word, word.word);
  assert.strictEqual(payload.batchIndex, 3);
  assert.strictEqual(payload.queueRemaining, 5);
});

console.log(`Scheduler presenter: ${passed} tests passed.`);
