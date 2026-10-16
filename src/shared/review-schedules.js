const { deserializeCard, reviewPriority } = require("../main/review-algorithm");
const TABLE = "/rest/v1/wordpop_review_schedules";
const CURRENT = "/rest/v1/wordpop_current_review_schedules";
const COUNT = TABLE + "?select=id&limit=0";
function planFor(state, word) {
  if (state?.pending && Object.hasOwn(state.pending, word))
    return state.pending[word];
  if (state?.remote && Object.hasOwn(state.remote, word))
    return state.remote[word];
  return null;
}

// Compare memory, not the locally adjusted queue date or JSON property order.
function key(progress) {
  if (!progress) return null;
  let memory;
  if (progress.fsrs_card) {
    const c = deserializeCard(progress.fsrs_card);
    memory = [
      c.stability,
      c.difficulty,
      c.elapsed_days,
      c.scheduled_days,
      c.learning_steps,
      c.reps,
      c.lapses,
      c.state,
      c.due.getTime(),
      c.last_review?.getTime() ?? null,
    ];
  } else {
    memory = [
      "legacy",
      progress.stage,
      progress.interval,
      progress.last_review_at,
      progress.repetitions,
      progress.efactor,
    ];
  }
  return JSON.stringify([
    ...memory,
    progress.correct_count || 0,
    progress.wrong_count || 0,
  ]);
}
function baseDue(progress, prior) {
  if (progress.fsrs_card)
    return deserializeCard(progress.fsrs_card).due.getTime();
  return prior?.base_key === key(progress)
    ? prior.original_due_at
    : progress.next_review_at;
}
function spread(records, days, now, currentWord, metadata = {}) {
  days = Math.max(1, Math.min(30, parseInt(days) || 3));
  const overdue = records
    .filter(
      (p) => p.word !== currentWord && p.stage < 9 && p.next_review_at <= now,
    )
    .map((row) => ({ row, priority: reviewPriority(row, now) }))
    .sort(
      (a, b) =>
        a.priority.learning - b.priority.learning ||
        a.priority.recall - b.priority.recall ||
        a.priority.stability - b.priority.stability ||
        a.row.next_review_at - b.row.next_review_at ||
        a.row.word.localeCompare(b.row.word),
    );
  const slots = Math.min(days, overdue.length);
  const changes = overdue.map(({ row }, index) => {
    const offset = Math.floor((index * slots) / overdue.length);
    const date = new Date(now);
    date.setDate(date.getDate() + offset);
    let due = now;
    if (offset) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      due = Math.max(
        start.getTime(),
        Math.min(
          end.getTime(),
          date.getTime() + (Math.random() - 0.5) * 2 * 3600 * 1000,
        ),
      );
    }
    const prior = planFor(metadata, row.word);
    return {
      word: row.word,
      base_key: key(row),
      original_due_at: baseDue(row, prior),
      due_at: Math.round(due),
    };
  });
  return { count: changes.length, days, changes };
}
function validate(rows, withId = true) {
  if (!Array.isArray(rows)) throw new Error("复习安排响应无效");
  return rows.map((row) => {
    if (
      !row ||
      typeof row.word !== "string" ||
      row.word.length < 1 ||
      row.word.length > 200 ||
      typeof row.base_key !== "string" ||
      !row.base_key.length ||
      row.base_key.length > 2048 ||
      !Number.isSafeInteger(row.due_at) ||
      row.due_at <= 0 ||
      row.due_at > 8640000000000000 ||
      !Number.isSafeInteger(row.original_due_at) ||
      row.original_due_at < 0 ||
      row.original_due_at > 8640000000000000 ||
      (withId && (typeof row.id !== "string" || !/^[a-z0-9-]+$/i.test(row.id)))
    )
      throw new Error("复习安排内容无效，已保留本地安排");
    return {
      ...(withId ? { id: row.id } : {}),
      word: row.word,
      base_key: row.base_key,
      original_due_at: row.original_due_at,
      due_at: row.due_at,
    };
  });
}
function bind(state, owner) {
  state = state || {
    owner: null,
    pending: {},
    remote: {},
    count: null,
    initialized: false,
  };
  if (state.owner && state.owner !== owner)
    throw new Error("复习安排属于其他云账户，请使用原账户或独立本地配置");
  return {
    ...state,
    owner,
    pending: { ...state.pending },
    remote: { ...state.remote },
  };
}
function capture(state, changes, id) {
  state = bind(state, state?.owner || null);
  if (typeof id !== "string" || !/^[a-z0-9-]+$/i.test(id))
    throw new Error("复习安排缺少操作 ID");
  state.pending = Object.fromEntries([
    ...Object.entries(state.pending),
    ...validate(changes, false).map((row) => [row.word, { ...row, id }]),
  ]);
  return state;
}
function upload(state) {
  return Object.values(state?.pending || {});
}
function merge(state, owner, rows, sent, count) {
  state = bind(state, owner);
  const remote = rows == null ? null : validate(rows);
  const acknowledged = validate(sent || []);
  if (remote)
    state.remote = Object.fromEntries(remote.map((row) => [row.word, row]));
  for (const row of acknowledged)
    if (state.pending[row.word]?.id === row.id) delete state.pending[row.word];
  if (remote)
    state.count = Number.isSafeInteger(count) && count >= 0 ? count : null;
  state.initialized = true;
  return state;
}
function apply(progress, state, previous = {}) {
  const updates = [];
  for (const word of new Set([
    ...Object.keys(previous.remote || {}),
    ...Object.keys(previous.pending || {}),
    ...Object.keys(state.remote || {}),
    ...Object.keys(state.pending || {}),
  ])) {
    const p = Object.hasOwn(progress, word) ? progress[word] : null;
    if (!p || p.stage >= 9) continue;
    const latest = planFor(state, word);
    const prior = planFor(previous, word);
    let due;
    if (latest?.base_key === key(p)) due = latest.due_at;
    else if (prior?.base_key === key(p) && p.next_review_at === prior.due_at)
      due = baseDue(p, prior);
    if (due != null && due !== p.next_review_at) updates.push([word, due]);
  }
  return Object.fromEntries(updates);
}
// Download only current per-word arrangements after the append-only count changes.
// A count check around paging catches inserts that would shift an offset page.
async function download(fetch, state, force = false) {
  let count = await fetch(COUNT, "GET", undefined, undefined, true);
  if (
    !force &&
    Number.isSafeInteger(count) &&
    count >= 0 &&
    count === state.count
  )
    return { rows: null, count };
  for (let attempt = 0; attempt < 2; attempt++) {
    const rows = [];
    const seen = new Set();
    for (let offset = 0; ; ) {
      const page = await fetch(
        CURRENT +
          "?select=id,word,base_key,original_due_at,due_at&order=word.asc&limit=500&offset=" +
          offset,
      );
      if (!Array.isArray(page)) throw new Error("复习安排响应无效");
      for (const row of page) {
        if (seen.has(row.word))
          throw new Error("复习安排分页正在变化，请重试同步");
        seen.add(row.word);
      }
      rows.push(...page);
      if (!page.length) break;
      offset += page.length;
    }
    const after = await fetch(COUNT, "GET", undefined, undefined, true);
    if (
      count == null ||
      count < 0 ||
      after == null ||
      after < 0 ||
      after === count
    )
      return { rows: validate(rows), count: after };
    count = after;
  }
  throw new Error("复习安排正在更新，已保留本地安排，将重试同步");
}
module.exports = {
  TABLE,
  CURRENT,
  COUNT,
  key,
  baseDue,
  spread,
  bind,
  capture,
  upload,
  merge,
  apply,
  download,
};
