const assert = require("assert");
const {
  empty,
  createSession,
  dispatch,
  fold,
} = require("../src/shared/learning-core");
const {
  calculateReview,
  MINUTE,
  DAY,
} = require("../src/main/review-algorithm");
const { localDateKey } = require("../src/main/study-policy");
const vocab = ["test", "next"].map((word) => ({
  word,
  wordlists: ["cet4"],
  translation: "n. 测试",
}));
const now = Date.UTC(2026, 9, 14, 12);
const clone = (x) => JSON.parse(JSON.stringify(x));
function setup(state = empty()) {
  state.config.autoBalanceLoad = false;
  let reference = clone(state);
  const session = createSession(clone(state), vocab);
  let view;
  function run(command, time = now) {
    const expectedCommand = { ...command };
    if (command.nonce === "current") {
      command = { ...command, nonce: view.nonce };
      expectedCommand.nonce = reference.current.nonce;
    }
    const expected = dispatch(reference, vocab, expectedCommand, time);
    reference = expected.state;
    view = session.dispatch(command, time);
    assert.deepEqual(view.state.progress, expected.state.progress);
    assert.deepEqual(view.state.events, expected.state.events);
    assert.deepEqual(view.undo, expected.undo);
    assert.deepEqual(view.quota, expected.quota);
    assert.equal(view.dueCount, expected.dueCount);
    assert.equal(view.newRemaining, expected.newRemaining);
    assert.equal(view.word?.word, expected.word?.word);
    assert.equal(view.revealed, expected.revealed);
    return view;
  }
  const grade = (id, action = "unknown", time = now) => {
    run({ type: "reveal", nonce: "current" }, time);
    return run({ type: "review", nonce: "current", id, action }, time);
  };
  run({ type: "view" });
  return { run, grade, session, current: () => view };
}

// A wrong first rating restores both new-word quota and a revealed card for correction.
let phone = setup();
const initial = clone(phone.current());
let view = phone.grade("first", "easy");
assert.equal(view.undo.id, "first");
assert.equal(view.newRemaining, initial.newRemaining - 1);
view = phone.run(
  { type: "undo", id: "undo-first", target_id: "first" },
  now + 1,
);
assert.equal(view.word.word, "test");
assert(view.revealed);
assert(!view.undo);
assert.deepEqual(view.state.progress, {});
assert.equal(view.newRemaining, initial.newRemaining);
assert.equal(view.state.events[1].target_id, "first");
const originalNonce = initial.nonce;
phone.run(
  { type: "review", nonce: originalNonce, id: "stale-rating", action: "easy" },
  now + 2,
);
assert.equal(
  phone.current().state.events.length,
  2,
  "stale widget click cannot re-rate the restored card",
);
assert.throws(
  () => phone.run({ type: "undo", id: "duplicate", target_id: "first" }),
  /无法撤销/,
);
view = phone.grade("corrected", "unknown", now + 3);
assert.equal(view.state.progress.test.interval, MINUTE);
assert.equal(view.state.progress.test.wrong_count, 1);
assert.equal(view.state.progress.test.correct_count, 0);
assert.equal(view.newRemaining, initial.newRemaining - 1);

// Undo an existing word restores the exact FSRS card; baseline statistics survive.
const state = empty();
state.seeds.test = calculateReview(null, "easy", now - 7 * DAY);
state.progress = clone(state.seeds);
state.dailySeeds = [
  { date: localDateKey(now), words_learned: 7, words_reviewed: 9 },
];
phone = setup(state);
phone.grade("old-word", "known");
view = phone.run(
  { type: "undo", id: "undo-old", target_id: "old-word" },
  now + 1,
);
assert.deepEqual(view.state.progress, state.progress);
assert.equal(view.state.dailySeeds[0].words_learned, 7);
assert.equal(fold(view.state.seeds, view.state.events).logs.length, 0);

// A cold restart keeps the last local undo offer, and stale server data cannot resurrect it.
phone = setup();
view = phone.grade("offline", "unknown");
phone = setup(clone(view.state));
assert.equal(phone.current().undo.id, "offline");
view = phone.run(
  { type: "undo", id: "offline-undo", target_id: "offline" },
  now + 1,
);
const journal = clone(view.state.events);
const sync = {
  type: "sync",
  userId: "user",
  seeds: {},
  dailySeeds: [],
  events: [journal[0]],
};
view = phone.run(sync, now + 2);
assert.deepEqual(view.state.progress, {});
assert(
  !view.state.cloudSyncedIds["offline-undo"],
  "offline undo remains pending upload",
);
view = phone.run({ ...sync, events: [...journal].reverse() }, now + 3);
assert(view.state.cloudSyncedIds["offline-undo"]);
assert.equal(view.state.events.length, 2);
assert.equal(view.newRemaining, vocab.length);

// An older offline rating received during sync must be included in the restored memory.
phone = setup();
view = phone.grade("local", "unknown");
const older = {
  id: "older-desktop",
  word: "test",
  action: "known",
  reviewed_at: now - 5 * MINUTE,
};
view = phone.run({ ...sync, events: [older, ...view.state.events] }, now + 1);
assert.equal(view.undo.id, "local");
view = phone.run(
  { type: "undo", id: "undo-local", target_id: "local" },
  now + 2,
);
assert.deepEqual(view.state.progress.test, fold({}, [older]).progress.test);

// Later ratings of other words preserve the offer; a later rating of this word cancels it.
phone = setup();
view = phone.grade("local-again", "known");
const other = {
  id: "other-desktop",
  word: "next",
  action: "unknown",
  reviewed_at: now + 1,
};
view = phone.run({ ...sync, events: [...view.state.events, other] }, now + 2);
assert.equal(view.undo.id, "local-again");
const later = {
  id: "later-desktop",
  word: "test",
  action: "easy",
  reviewed_at: now + 3,
};
view = phone.run({ ...sync, events: [...view.state.events, later] }, now + 4);
assert.equal(view.undo, null);
assert.throws(
  () => phone.run({ type: "undo", id: "stale-undo", target_id: "local-again" }),
  /无法撤销/,
);
assert.equal(view.state.events.length, 3);

phone = setup();
phone.grade("previous");
view = phone.grade("latest", "fuzzy", now + 1);
assert.equal(view.undo.id, "latest");
assert.throws(
  () => phone.run({ type: "undo", id: "wrong-target", target_id: "previous" }),
  /无法撤销/,
);
view = phone.run(
  { type: "config", config: { selectedWordlists: ["cet6"] } },
  now + 2,
);
assert.equal(view.undo, null);
console.log(
  "Mobile undo checks passed: exact FSRS/quotas restoration, correction, stale actions, cold restart, offline undo sync and concurrent desktop ratings.",
);
