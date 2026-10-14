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
function view(state, vocab, now = Date.now()) {
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
  const logs = fold(state.seeds, state.events).logs;
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
  };
}
function dispatch(state, vocab, command, now = Date.now()) {
  state = state || empty();
  if (command.type === "config") {
    state.config = { ...state.config, ...command.config };
    state.current = null;
  }
  if (command.type === "reveal" && state.current?.nonce === command.nonce)
    state.current.revealed = true;
  if (
    command.type === "review" &&
    state.current?.nonce === command.nonce &&
    state.current.revealed
  ) {
    state.events.push({
      id: command.id,
      word: state.current.word,
      action: command.action,
      reviewed_at: now,
    });
    state.progress = fold(state.seeds, state.events).progress;
    state.current = null;
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
    state.seeds = command.seeds;
    state.dailySeeds = command.dailySeeds || [];
    state.events = [
      ...new Map(
        [...state.events, ...command.events].map((e) => [e.id, e]),
      ).values(),
    ];
    state.progress = fold(state.seeds, state.events).progress;
  }
  return view(state, vocab, now);
}
module.exports = { empty, fold, dispatch, calculateReview };
