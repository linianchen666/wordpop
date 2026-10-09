/** Real session, SQLite persistence and browser audio regressions. */
const assert = require('assert');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createScheduler } = require('../src/main/study-scheduler');
const { attachSchedulerPresenter } = require('../src/main/scheduler-presenter');
const { createFocusSession } = require('../src/main/focus-session');
const { createLearningRepository } = require('../src/main/learning-repository');
const { recordReview } = require('../src/main/review-progress');

const initialNow = new Date(2026, 9, 9, 12).getTime();
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`  ✓ ${name}`); }
console.log('=== 真实微批次、专注模式与浏览器音色回归 ===');

// Only the clock/timer mechanism is fake; all learning rules execute production modules.
function createClock() {
  let now = initialNow;
  let nextId = 0;
  const tasks = new Map();
  return {
    now: () => now,
    setTimeout(callback, delay) {
      const id = ++nextId;
      tasks.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout: id => tasks.delete(id),
    pending: () => tasks.size,
    advance(milliseconds) {
      const until = now + milliseconds;
      for (;;) {
        const next = [...tasks].filter(([, task]) => task.at <= until)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        const [id, task] = next;
        tasks.delete(id);
        now = task.at;
        task.callback();
      }
      now = until;
    }
  };
}

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wordpop-sessions-'));
const dbModulePath = require.resolve('../src/main/db');
const cachedDb = require.cache[dbModulePath];
const originalLoad = Module._load;
const activeSchedulers = [];
let productionDb;
try {
  Module._load = function(request) {
    if (request === 'electron') return { app: { isPackaged: false, getPath: () => testDir } };
    return originalLoad.apply(this, arguments);
  };
  delete require.cache[dbModulePath];
  productionDb = require('../src/main/db');
  Module._load = originalLoad;
  const db = productionDb.initDatabase();
  const repository = createLearningRepository(() => db);
  const logger = { error() {} };
  const insert = db.prepare('INSERT INTO words (id,word,translation,wordlist,frequency_rank) VALUES (?,?,?,?,?)');
  const relate = db.prepare('INSERT INTO word_wordlists (word_id,wordlist) VALUES (?,?)');
  function seed(dueCount = 0) {
    for (const scheduler of activeSchedulers) scheduler.stop();
    db.exec('DELETE FROM review_history; DELETE FROM progress; DELETE FROM daily_stats; DELETE FROM word_wordlists; DELETE FROM words;');
    db.transaction(() => {
      for (let id = 1; id <= 100; id++) {
        insert.run(id, `focus_word_${id}`, `释义_${id}`, 'cet4', id);
        relate.run(id, 'cet4');
        if (id <= dueCount) recordReview(db, id, 'known', initialNow - (100 - id) * 3600000);
      }
    })();
  }
  function makeScheduler(clock, overrides = {}) {
    const scheduler = createScheduler({ repository, now: clock.now,
      getConfig: () => ({ selectedWordlists: ['cet4'], dailyNewWords: 20,
        autoBalanceLoad: false, batchSize: 3, cooldownMinutes: 3, ...overrides }),
      recordReview: (id, action, now) => recordReview(db, id, action, now),
      setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, logger });
    activeSchedulers.push(scheduler);
    return scheduler;
  }
  function makeFocus(clock) {
    return createFocusSession({ repository, now: clock.now, logger,
      recordReview: (id, action, now) => recordReview(db, id, action, now) });
  }
  const progress = id => db.prepare('SELECT * FROM progress WHERE word_id=?').get(id);
  const history = () => db.prepare('SELECT * FROM review_history ORDER BY id').all();

  test('真实调度在第三词后发出结算事件，并完整等待三分钟冷却', () => {
    seed();
    const clock = createClock();
    const scheduler = makeScheduler(clock);
    const words = [];
    const completions = [];
    scheduler.on('word', event => words.push(event));
    scheduler.on('batch-complete', event => completions.push(event));
    scheduler.start();
    assert.strictEqual(scheduler.currentWord.id, 1);
    scheduler.markKnown();
    assert.strictEqual(scheduler.currentBatchCount, 1);
    clock.advance(299);
    assert.strictEqual(scheduler.currentWord, null);
    clock.advance(1);
    assert.strictEqual(scheduler.currentWord.id, 2);
    scheduler.markFuzzy();
    clock.advance(300);
    assert.strictEqual(scheduler.currentWord.id, 3);
    scheduler.markEasy();
    assert.strictEqual(scheduler.currentBatchCount, 0);
    assert.strictEqual(completions.length, 1);
    assert.strictEqual(completions[0].batchSize, 3);
    assert.strictEqual(completions[0].cooldownMinutes, 3);
    assert.strictEqual(scheduler.currentWord, null);
    clock.advance(3 * 60000 - 1);
    assert.strictEqual(scheduler.currentWord, null);
    clock.advance(1);
    assert.strictEqual(scheduler.currentWord.id, 2, '冷却后优先复习模糊词的一分钟重学');
    assert.deepStrictEqual(words.map(event => event.word.id), [1, 2, 3, 2]);
    assert.deepStrictEqual(words.map(event => event.batchCount), [0, 1, 2, 0]);
    assert.strictEqual(history().length, 3);
    assert.strictEqual(scheduler.getStatus().dailyNewWordsCount, 3);
  });

  test('立即下一批取消旧冷却计时器，不重复弹出正在显示的词', () => {
    seed();
    const clock = createClock();
    const scheduler = makeScheduler(clock, { batchSize: 1, cooldownMinutes: 10 });
    const seen = [];
    scheduler.on('word', event => seen.push(event.word.id));
    scheduler.start();
    scheduler.markEasy();
    assert.strictEqual(clock.pending(), 1);
    clock.advance(1000);
    scheduler.triggerNextBatchNow();
    assert.strictEqual(scheduler.currentWord.id, 2);
    assert.strictEqual(clock.pending(), 0);
    clock.advance(10 * 60000);
    assert.deepStrictEqual(seen, [1, 2]);
    assert.strictEqual(scheduler.currentWord.id, 2);
  });

  test('暂停取消待弹计时器，恢复保留当前词并继续真实队列', () => {
    seed();
    const clock = createClock();
    const scheduler = makeScheduler(clock);
    let pauses = 0;
    let resumes = 0;
    scheduler.on('paused', () => pauses++);
    scheduler.on('resumed', () => resumes++);
    scheduler.start();
    scheduler.pause();
    scheduler.resume();
    assert.strictEqual(scheduler.currentWord.id, 1, '恢复不能跳过未反馈单词');
    scheduler.markEasy();
    scheduler.pause();
    assert.strictEqual(clock.pending(), 0);
    clock.advance(5000);
    assert.strictEqual(scheduler.currentWord, null);
    scheduler.resume();
    assert.strictEqual(scheduler.currentWord.id, 2);
    assert.strictEqual(pauses, 2);
    assert.strictEqual(resumes, 2);
    scheduler.stop();
    assert.strictEqual(clock.pending(), 0);
    assert.strictEqual(scheduler.currentWord, null);
  });

  test('连续模式不触发批次冷却，每个反馈后继续弹词', () => {
    seed();
    const clock = createClock();
    const scheduler = makeScheduler(clock, { batchSize: 0 });
    let completions = 0;
    scheduler.on('batch-complete', () => completions++);
    scheduler.start();
    for (let id = 1; id <= 4; id++) {
      assert.strictEqual(scheduler.currentWord.id, id);
      scheduler.markEasy();
      clock.advance(300);
    }
    assert.strictEqual(scheduler.currentWord.id, 5);
    assert.strictEqual(completions, 0);
    assert.strictEqual(history().length, 4);
  });

  test('保存失败保留当前词、回滚FSRS数据，修复数据库后可以重试', () => {
    seed();
    const clock = createClock();
    const scheduler = makeScheduler(clock);
    const shown = [];
    const detachPresenter = attachSchedulerPresenter(scheduler, {
      popupManager: { show: word => shown.push(word), hide() {}, restore() {},
        isVisible: () => true, showBatchCompletion() {} },
      analyzeWord: () => null, getConfig: scheduler.getConfig, logger
    });
    let failures = 0;
    scheduler.on('review-failed', () => failures++);
    try {
      scheduler.start();
      scheduler.markEasy();
      clock.advance(300);
      const original = shown[shown.length - 1];
      assert.strictEqual(original.id, 2);
      assert.strictEqual(original.batchIndex, 2);
      db.exec("CREATE TRIGGER reject_stats BEFORE INSERT ON daily_stats BEGIN SELECT RAISE(ABORT,'test write failure'); END;");
      try {
        scheduler.markKnown();
        assert.strictEqual(scheduler.currentWord.id, 2);
        assert.strictEqual(scheduler.currentBatchCount, 1);
        assert.strictEqual(clock.pending(), 0);
        assert.strictEqual(progress(2), undefined);
        assert.strictEqual(history().length, 1);
        assert.strictEqual(failures, 1);
        assert.strictEqual(shown.length, 3, '实际 presenter 应再次显示失败的单词以允许重试');
        assert.deepStrictEqual(shown[shown.length - 1], original, '重试展示应保留词ID、队列数量和原批次索引');
      } finally {
        db.exec('DROP TRIGGER reject_stats');
      }
      scheduler.markKnown();
      assert.strictEqual(scheduler.currentWord, null);
      assert.ok(progress(2).fsrs_card);
      assert.strictEqual(clock.pending(), 1);
      clock.advance(300);
      assert.strictEqual(scheduler.currentWord.id, 3);
      assert.strictEqual(shown[shown.length - 1].id, 3);
      assert.strictEqual(shown[shown.length - 1].batchIndex, 3);
      assert.strictEqual(history().length, 2, '只有成功保存才推进学习数据和批次');
    } finally {
      detachPresenter();
    }
  });

  test('实际专注挑词按到期顺序优先复习，再补新词并遵守词库筛选', () => {
    seed(15);
    const focus = makeFocus(createClock());
    const selection = focus.getFocusWords(20, ['cet4']);
    assert.strictEqual(selection.success, true);
    assert.strictEqual(selection.totalDue, 15);
    assert.deepStrictEqual(selection.words.map(word => word.id), Array.from({ length: 20 }, (_, i) => i + 1));
    assert.strictEqual(focus.getFocusWords(0, ['cet4']).words.length, 15);
    assert.deepStrictEqual(focus.getFocusWords(20, ['cet6']).words, []);
    assert.deepStrictEqual(focus.getFocusWords(20, []).words, []);
    seed();
    assert.strictEqual(focus.getFocusWords(0, ['cet4']).words.length, 20, '没有到期词时默认补20个新词');
  });

  test('实际专注提交保存FSRS状态与评级日志，统计区分旧词和新词', () => {
    seed(15);
    const clock = createClock();
    const focus = makeFocus(clock);
    const previousCount = progress(1).correct_count;
    const first = focus.submitFocusWord(1, 'known');
    const second = focus.submitFocusWord(16, 'easy');
    assert.strictEqual(first.success, true);
    assert.strictEqual(second.success, true);
    assert.strictEqual(progress(1).correct_count, previousCount + 1);
    assert.strictEqual(progress(16).correct_count, 1);
    assert.ok(progress(16).stage < 9, 'Easy仍继续安排复习');
    assert.ok(second.nextReviewAt > clock.now());
    assert.strictEqual(second.nextReviewAt, progress(16).next_review_at);
    const latest = history().slice(-2);
    assert.deepStrictEqual(latest.map(row => row.rating), [3, 4]);
    assert.strictEqual(latest[1].card_after, progress(16).fsrs_card);
    assert.deepStrictEqual(repository.getStats(null, clock.now()).today, { words_reviewed: 2, words_learned: 1 });
  });

  test('非法专注反馈或数据库失败不产生部分进度、日志或统计', () => {
    seed();
    const focus = makeFocus(createClock());
    for (const [id, action] of [[0, 'known'], ['bad', 'known'], [1, 'invalid'], [999, 'known']]) {
      assert.strictEqual(focus.submitFocusWord(id, action).success, false);
    }
    db.exec("CREATE TRIGGER reject_stats BEFORE INSERT ON daily_stats BEGIN SELECT RAISE(ABORT,'test focus failure'); END;");
    try {
      assert.strictEqual(focus.submitFocusWord(1, 'known').success, false);
      assert.strictEqual(progress(1), undefined);
      assert.strictEqual(history().length, 0);
      assert.deepStrictEqual(repository.getStats(null, initialNow).today, { words_reviewed: 0, words_learned: 0 });
    } finally {
      db.exec('DROP TRIGGER reject_stats');
    }
  });
} finally {
  Module._load = originalLoad;
  for (const scheduler of activeSchedulers) scheduler.stop();
  if (productionDb) productionDb.closeDatabase();
  if (cachedDb) require.cache[dbModulePath] = cachedDb;
  else delete require.cache[dbModulePath];
  fs.rmSync(testDir, { recursive: true, force: true });
}

const spoken = [];
const streams = [];
const female = { name: 'Microsoft Zira', lang: 'en-US' };
const male = { name: 'Microsoft David', lang: 'en-US' };
const renderer = vm.createContext({
  window: { speechSynthesis: { paused: false, cancel() {},
    getVoices: () => [female, male], speak: utterance => spoken.push(utterance) } },
  SpeechSynthesisUtterance: class { constructor(word) { this.text = word; } },
  Audio: class {
    constructor(url) { this.url = url; streams.push(this); }
    play() { return Promise.resolve(); }
    pause() {}
  },
  setTimeout: callback => { callback(); return 1; }
});
const utilsPath = path.join(__dirname, '..', 'src', 'renderer', 'shared', 'utils.js');
vm.runInContext(fs.readFileSync(utilsPath, 'utf8'), renderer, { filename: utilsPath });

test('实际角色发音引擎使用对应音高、语速和发音人', () => {
  for (const [voice, pitch, rate, selected] of [['loli', 1.45, 1.05, female],
    ['mature', 0.9, 0.9, female], ['deep-male', 0.75, 0.85, male], ['fast', 1.05, 1.25, female]]) {
    renderer.playWordAudio('example', voice);
    const utterance = spoken[spoken.length - 1];
    assert.strictEqual(utterance.text, 'example');
    assert.strictEqual(utterance.pitch, pitch);
    assert.strictEqual(utterance.rate, rate);
    assert.strictEqual(utterance.voice, selected);
    assert.strictEqual(utterance.lang, 'en-US');
  }
});

test('实际词典发音选择英美音并编码词语，空输入不会播放', () => {
  renderer.playWordAudio('my word', 'dict-us');
  assert.strictEqual(streams[streams.length - 1].url, 'https://dict.youdao.com/dictvoice?audio=my%20word&type=2');
  renderer.playWordAudio('example', 'dict-uk');
  assert.strictEqual(streams[streams.length - 1].url, 'https://dict.youdao.com/dictvoice?audio=example&type=1');
  const streamCount = streams.length;
  renderer.playWordAudio('   ');
  renderer.playWordAudio(null);
  assert.strictEqual(streams.length, streamCount);
});
console.log(`\n🎉 ${passed} 项真实业务回归测试全部通过！\n`);
