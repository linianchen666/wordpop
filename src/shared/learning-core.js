const {
  calculateReview,
  stageForInterval,
} = require("../main/review-algorithm");
const { calculateDailyQuota, localDateKey } = require("../main/study-policy");
const translations = require("../renderer/shared/translations");
function empty() {
  return {
    config: {
      selectedWordlists: ["cet4"],
      dailyNewWords: 20,
      dailyNewWordsMode: "fixed",
      autoBalanceLoad: true,
    },
    progress: {},
    events: [],
    seeds: {},
    dailySeeds: [],
    current: null,
    undo: null,
  };
}
function fold(seeds, events) {
  const progress = JSON.parse(JSON.stringify(seeds || {})),
    logs = [];
  const unique = new Map(events.map((e) => [e.id, e]));
  const undone = new Set(
    events.filter((e) => e.action === "undo").map((e) => e.target_id),
  );
  for (const event of [...unique.values()].sort(
    (a, b) => a.reviewed_at - b.reviewed_at || a.id.localeCompare(b.id),
  )) {
    const before = progress[event.word];
    if (event.action === "undo" || undone.has(event.id)) continue;
    const next = calculateReview(
      before,
      event.action,
      Math.max(event.reviewed_at, before?.last_review_at || 0),
    );
    progress[event.word] = {
      ...next,
      correct_count: (before?.correct_count || 0) + next.correct_count,
      wrong_count: (before?.wrong_count || 0) + next.wrong_count,
    };
    logs.push({ ...event, ...next, wasNew: !before });
  }
  return { progress, logs };
}
// Only the most recent local rating is offered. A later rating for the same
// word (including one received from another device) makes that offer stale.
function undoTarget(state, logs) {
  if (!state.undo) return null;
  for (let i = logs.length - 1; i >= 0; i--)
    if (logs[i].word === state.undo.word)
      return logs[i].id === state.undo.id ? state.undo : null;
  return null;
}
function view(state, vocab, now = Date.now(), logs) {
  const selected = state.config.selectedWordlists || ["cet4"];
  const words = vocab.filter((w) =>
    w.wordlists.some((l) => selected.includes(l)),
  );
  const due = words.filter(
    (w) =>
      state.progress[w.word]?.stage < 9 &&
      state.progress[w.word].next_review_at <= now,
  );
  due.sort((a, b) => {
    const p = state.progress[a.word],
      q = state.progress[b.word];
    const short = (r) =>
      now - r.last_review_at < 86400000 &&
      r.interval < 86400000 &&
      [1, 3].includes(JSON.parse(r.fsrs_card).state);
    return (
      Number(short(q)) - Number(short(p)) ||
      p.next_review_at - q.next_review_at ||
      a.word.localeCompare(b.word)
    );
  });
  const newWords = words.filter((w) => !state.progress[w.word]);
  const today = localDateKey(now);
  logs = logs || fold(state.seeds, state.events).logs;
  const learned =
    (state.dailySeeds.find((d) => d.date === today)?.words_learned || 0) +
    logs.filter((e) => e.wasNew && localDateKey(e.reviewed_at) === today)
      .length;
  const quota = calculateDailyQuota(
    state.config,
    {
      unlearnedCount: newWords.length,
      dueCount: due.length,
      todayLearned: learned,
    },
    now,
  );
  const remaining = Math.min(
    newWords.length,
    Math.max(0, quota.effectiveLimit - learned),
  );
  let word = state.current && words.find((w) => w.word === state.current.word);
  if (!word || state.progress[word.word]?.stage >= 9) {
    word = due[0] || (remaining > 0 ? newWords[0] : null);
    state.current = word
      ? {
          word: word.word,
          revealed: false,
          nonce: `${now}:${state.events.length}:${Math.random()}`,
        }
      : null;
  }
  const intervals = {};
  if (word)
    for (const action of ["unknown", "fuzzy", "known", "easy"])
      intervals[action] = calculateReview(
        state.progress[word.word],
        action,
        Math.max(now, state.progress[word.word]?.last_review_at || 0),
      ).interval;
  return {
    state,
    word: word
      ? {
          ...word,
          translationPreview: translations.summarize(word.translation).summary,
        }
      : null,
    revealed: !!state.current?.revealed,
    nonce: state.current?.nonce,
    dueCount: due.length,
    newRemaining: remaining,
    quota,
    intervals,
    undo: undoTarget(state, logs),
  };
}
function dispatch(state, vocab, command, now = Date.now(), runtime) {
  state = state || empty();
  state.undo ??= null;
  let logs = runtime?.logs;
  if (command.type === "config") {
    state.config = { ...state.config, ...command.config };
    state.current = null;
    state.undo = null;
  }
  if (command.type === "reveal" && state.current?.nonce === command.nonce)
    state.current.revealed = true;
  if (
    command.type === "review" &&
    state.current?.nonce === command.nonce &&
    state.current.revealed
  ) {
    const event = {
      id: command.id,
      word: state.current.word,
      action: command.action,
      reviewed_at: now,
    };
    const last = runtime?.last;
    const ordered =
      !last ||
      now > last.reviewed_at ||
      (now === last.reviewed_at &&
        String(event.id).localeCompare(String(last.id)) > 0);
    const incremental = runtime && ordered && !runtime.ids.has(event.id);
    const before = state.progress[event.word];
    state.events.push(event);
    if (incremental) {
      const next = calculateReview(
        before,
        event.action,
        Math.max(now, before?.last_review_at || 0),
      );
      state.progress[event.word] = {
        ...next,
        correct_count: (before?.correct_count || 0) + next.correct_count,
        wrong_count: (before?.wrong_count || 0) + next.wrong_count,
      };
      logs.push({ ...event, ...next, wasNew: !before });
    } else {
      const folded = fold(state.seeds, state.events);
      state.progress = folded.progress;
      logs = folded.logs;
    }
    state.undo = { id: event.id, word: event.word, action: event.action };
    state.current = null;
  }
  if (command.type === "undo") {
    logs = logs || fold(state.seeds, state.events).logs;
    const target = undoTarget(state, logs);
    if (!target || command.target_id !== target.id)
      throw new Error("这条评分已无法撤销，请查看当前单词的最新记录");
    if (!command.id || state.events.some((e) => e.id === command.id))
      throw new Error("撤销请求重复，请刷新后重试");
    state.events.push({
      id: command.id,
      word: target.word,
      action: "undo",
      target_id: target.id,
      reviewed_at: now,
    });
    if (runtime) {
      const seeds = state.seeds[target.word]
        ? { [target.word]: state.seeds[target.word] }
        : {};
      const restored = fold(
        seeds,
        state.events.filter((e) => e.word === target.word),
      );
      if (restored.progress[target.word])
        state.progress[target.word] = restored.progress[target.word];
      else delete state.progress[target.word];
      logs = [
        ...logs.filter((e) => e.word !== target.word),
        ...restored.logs,
      ].sort(
        (a, b) => a.reviewed_at - b.reviewed_at || a.id.localeCompare(b.id),
      );
    } else {
      const restored = fold(state.seeds, state.events);
      state.progress = restored.progress;
      logs = restored.logs;
    }
    state.undo = null;
    state.current = {
      word: target.word,
      revealed: true,
      nonce: `${now}:undo:${command.id}`,
    };
  }
  if (command.type === "sync") {
    if (state.cloudUser && state.cloudUser !== command.userId)
      throw new Error("学习记录属于其他账户");
    if (!state.cloudUser) {
      state.current = null;
      if (command.initialConfig)
        state.config = { ...state.config, ...command.initialConfig };
    }
    state.cloudUser = command.userId;
    state.cloudSyncedIds = Object.fromEntries(
      command.events.map((event) => [event.id, true]),
    );
    const identicalEvent = (a, b) =>
      a &&
      ["id", "word", "action", "reviewed_at"].every((k) => a[k] === b[k]) &&
      (a.target_id || null) === (b.target_id || null);
    const priorEvents = runtime && new Map(state.events.map((e) => [e.id, e]));
    const unchanged =
      runtime &&
      JSON.stringify(state.seeds) === JSON.stringify(command.seeds) &&
      command.events.every((e) => identicalEvent(priorEvents.get(e.id), e));
    state.seeds = command.seeds;
    state.dailySeeds = command.dailySeeds || [];
    state.events = [
      ...new Map(
        [...state.events, ...command.events].map((e) => [e.id, e]),
      ).values(),
    ];
    if (!unchanged) {
      const folded = fold(state.seeds, state.events);
      state.progress = folded.progress;
      logs = folded.logs;
    }
    if (!undoTarget(state, logs)) state.undo = null;
  }
  if (runtime) {
    runtime.logs = logs;
    runtime.ids = new Set(state.events.map((e) => e.id));
    runtime.last = state.events.reduce(
      (last, e) =>
        !last ||
        e.reviewed_at > last.reviewed_at ||
        (e.reviewed_at === last.reviewed_at &&
          String(e.id).localeCompare(String(last.id)) > 0)
          ? e
          : last,
      null,
    );
  }
  return view(state, vocab, now, logs);
}
function createSession(initialState, vocab) {
  let state = initialState || empty();
  state.undo ??= null;
  const runtime = {
    logs: fold(state.seeds, state.events).logs,
    ids: new Set(state.events.map((e) => e.id)),
    last: null,
  };
  runtime.last = state.events.reduce(
    (last, e) =>
      !last ||
      e.reviewed_at > last.reviewed_at ||
      (e.reviewed_at === last.reviewed_at &&
        String(e.id).localeCompare(String(last.id)) > 0)
        ? e
        : last,
    null,
  );
  return {
    dispatch(command, now = Date.now()) {
      const result = dispatch(state, vocab, command, now, runtime);
      state = result.state;
      return result;
    },
    render(command, now, fullState) {
      const prior = state.current;
      const last = runtime.last;
      const canPatch =
        command.type === "review" &&
        prior?.nonce === command.nonce &&
        prior.revealed &&
        !runtime.ids.has(command.id) &&
        (!last ||
          now > last.reviewed_at ||
          (now === last.reviewed_at &&
            String(command.id).localeCompare(String(last.id)) > 0));
      const result = this.dispatch(command, now);
      const { state: memory, ...display } = result;
      display.current = memory.current;
      if (
        fullState ||
        ["sync", "config", "undo"].includes(command.type) ||
        (command.type === "review" && !canPatch)
      )
        display.state = memory;
      else if (canPatch)
        display.reviewPatch = {
          word: prior.word,
          progress: memory.progress[prior.word],
          event: memory.events[memory.events.length - 1],
        };
      return display;
    },
  };
}
module.exports = { empty, fold, dispatch, calculateReview, createSession };
