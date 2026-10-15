const assert = require("assert");
const crypto = require("crypto");
const settings = require("../src/shared/learning-settings");
const { createSession, empty } = require("../src/shared/learning-core");
const clone = (value) => JSON.parse(JSON.stringify(value));
const base = {
  selectedWordlists: ["cet4"],
  dailyNewWordsMode: "fixed",
  dailyNewWords: 20,
  targetDate: null,
  autoBalanceLoad: true,
  popupPosition: "top-left",
};
const plan = {
  ...base,
  dailyNewWordsMode: "target",
  dailyNewWords: 98,
  targetDate: "2027-06-01",
};
const id = () => crypto.randomUUID();
const rows = (config) =>
  Object.entries(settings.groups(config)).map(([setting_key, value]) => ({
    setting_key,
    value,
    id: id(),
  }));
const savedForm = settings.mergeDraft(
  { ...base, selectedWordlists: ["cet6"] },
  plan,
  base,
);
assert.deepStrictEqual(savedForm.selectedWordlists, ["cet6"]);
assert.equal(savedForm.dailyNewWordsMode, "target");
const custom = { ...base, selectedWordlists: ["custom_123"] };
const customOutbox = settings.seed(
  { pending: {} },
  { ...custom, dailyNewWords: 42 },
  id(),
);
assert(!customOutbox.pending.selectedWordlists);
assert(customOutbox.pending.learningPlan);
assert.deepStrictEqual(
  settings.apply({ pending: {} }, custom, rows(plan)).config.selectedWordlists,
  ["custom_123"],
);

// Changes are grouped so a mode and its target date travel together; appearances
// never enter the outbox, including when a whole settings form is saved.
let state = settings.capture(
  { pending: {} },
  base,
  { ...plan, popupPosition: "bottom-right" },
  id(),
);
assert.deepStrictEqual(Object.keys(state.pending), ["learningPlan"]);
let sent = settings.upload(state, "user-a");
assert.equal(sent.length, 1);
assert.equal(sent[0].value.dailyNewWords, 98);
assert.equal(sent[0].value.targetDate, "2027-06-01");
assert(!JSON.stringify(sent).includes("popupPosition"));

// A new edit made during a request cannot be acknowledged by the old response.
const first = clone(sent);
const newer = { ...plan, targetDate: "2027-07-01" };
state = settings.capture(state, plan, newer, id());
let applied = settings.apply(state, newer, rows(plan), first);
assert.equal(applied.config.targetDate, newer.targetDate);
assert.equal(Object.keys(applied.state.pending).length, 1);
sent = settings.upload(applied.state, "user-a");
applied = settings.apply(applied.state, newer, rows(newer), sent);
assert.equal(Object.keys(applied.state.pending).length, 0);

// Disjoint remote edits merge while an offline local plan remains pending.
state = settings.capture({ pending: {} }, base, plan, id());
applied = settings.apply(
  clone(state),
  plan,
  rows({ ...base, selectedWordlists: ["cet6"], autoBalanceLoad: false }),
);
assert.deepStrictEqual(applied.config.selectedWordlists, ["cet6"]);
assert.equal(applied.config.dailyNewWordsMode, "target");
assert.equal(applied.config.autoBalanceLoad, false);
assert.equal(applied.config.popupPosition, "top-left");

// Only supported keys are applied, even if a remote JSON object contains extras.
const remote = rows(plan);
remote.find((r) => r.setting_key === "learningPlan").value.autoStart = true;
applied = settings.apply(
  { pending: {} },
  { ...base, autoStart: false },
  remote,
);
assert.equal(applied.config.autoStart, false);
for (const invalid of [
  [{ setting_key: "selectedWordlists", value: [] }],
  [{ setting_key: "autoBalanceLoad", value: "false" }],
  [
    {
      setting_key: "learningPlan",
      value: {
        dailyNewWordsMode: "target",
        dailyNewWords: 20,
        targetDate: null,
      },
    },
  ],
]) {
  const durable = settings.capture({ pending: {} }, base, plan, id());
  const before = JSON.stringify(durable);
  assert.throws(() =>
    settings.apply(durable, plan, invalid, settings.upload(durable, "a")),
  );
  assert.equal(JSON.stringify(durable), before);
}

// Real shared engine: new phones do not publish defaults; remote preferences
// change the active deck without altering ratings or local appearance.
const vocab = [
  { word: "four", translation: "四", wordlists: ["cet4"] },
  { word: "six", translation: "六", wordlists: ["cet6"] },
];
const engine = createSession(null, vocab);
const legacy = empty();
legacy.config.theme = "dark";
const migrated = createSession(legacy, vocab).dispatch({
  type: "sync",
  userId: "a",
  seeds: {},
  events: [],
  dailySeeds: [],
  initialConfig: { ...plan, theme: "light" },
});
assert.equal(migrated.state.config.theme, "dark");
assert.equal(migrated.state.config.dailyNewWordsMode, "target");
assert.deepStrictEqual(
  engine.settings({ type: "settingsBind", owner: "project:user-a" })
    .settingsSync.pending,
  {},
);
assert.equal(engine.dispatch({ type: "view" }).word.word, "four");
const changed = engine.settings({
  type: "settingsApply",
  owner: "project:user-a",
  rows: rows({ ...plan, selectedWordlists: ["cet6"] }),
  sent: [],
});
assert(changed.changed);
const view = engine.dispatch({ type: "view" });
assert.equal(view.word.word, "six");
assert.equal(view.state.events.length, 0);
assert.equal(view.state.config.dailyNewWordsMode, "target");
assert.equal(
  engine.settings({
    type: "settingsApply",
    owner: "project:user-a",
    rows: rows(view.state.config),
    sent: [],
  }).changed,
  false,
);
engine.dispatch({
  type: "config",
  config: { dailyNewWordsMode: "fixed" },
  settingsEditId: id(),
});
assert.throws(() =>
  engine.settings({ type: "settingsBind", owner: "project:user-b" }),
);
const restored = createSession(
  clone(engine.dispatch({ type: "view" }).state),
  vocab,
);
assert.equal(
  Object.keys(
    restored.settings({ type: "settingsBind", owner: "project:user-a" })
      .settingsSync.pending,
  ).length,
  1,
);

// Lost acknowledgements cannot reorder a replayed settings change. Production
// uses the same append-only (id,setting_key) conflict key and server arrival order.
const journal = new Map();
const append = (batch) => {
  for (const r of batch)
    if (!journal.has(r.id + r.setting_key))
      journal.set(r.id + r.setting_key, r);
};
const latest = () => [
  ...new Map([...journal.values()].map((r) => [r.setting_key, r])).values(),
];
let local = settings.seed({ pending: {} }, base, id());
const seed = settings.upload(local, "a");
append(seed);
const update = settings.upload(
  settings.capture({ pending: {} }, base, plan, id()),
  "a",
);
append(update);
append(seed); // retry after losing the first upload reply
assert.equal(
  settings.apply(local, base, latest(), seed).config.dailyNewWordsMode,
  "target",
);
console.log(
  "Learning settings: offline merges, concurrent edits, atomic plans, retry ordering, account isolation and real deck switching passed.",
);
