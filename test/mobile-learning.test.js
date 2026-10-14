const assert = require("assert");
const { empty, dispatch, fold } = require("../src/shared/learning-core");
const {
  calculateReview,
  MINUTE,
  DAY,
} = require("../src/main/review-algorithm");
const vocabulary = [
  {
    word: "test",
    wordlists: ["cet4"],
    translation: "n. 测试, 检查, 测验",
    phonetic: "test",
  },
];
const now = Date.UTC(2026, 9, 14, 8);
let state = empty();
state.config.dailyNewWords = 1;
state.config.autoBalanceLoad = false;
function run(command, time = now) {
  const result = dispatch(state, vocabulary, command, time);
  state = result.state;
  return result;
}
let view = run({ type: "view" });
const firstNonce = view.nonce;
assert.equal(view.revealed, false);
view = run({ type: "reveal", nonce: view.nonce });
assert.equal(view.revealed, true);
view = run({ type: "review", nonce: view.nonce, id: "a", action: "unknown" });
assert.equal(view.word, null);
assert.equal(state.progress.test.interval, MINUTE);
view = run({ type: "view" }, now + MINUTE);
assert.equal(view.word.word, "test");
run(
  { type: "review", nonce: firstNonce, id: "stale", action: "easy" },
  now + MINUTE,
);
assert.equal(state.events.length, 1);
view = run({ type: "reveal", nonce: view.nonce }, now + MINUTE);
view = run(
  { type: "review", nonce: view.nonce, id: "b", action: "known" },
  now + MINUTE,
);
assert.equal(state.progress.test.interval, 10 * MINUTE);
view = run({ type: "view" }, now + 11 * MINUTE);
view = run({ type: "reveal", nonce: view.nonce }, now + 11 * MINUTE);
run(
  { type: "review", nonce: view.nonce, id: "c", action: "known" },
  now + 11 * MINUTE,
);
assert.equal(state.progress.test.interval, DAY);
console.log(
  "  ✓ Android uses the desktop 1m → 10m → FSRS flow and rejects stale widget actions",
);
const events = state.events;
assert.deepEqual(
  fold({}, events),
  fold({}, [...events].reverse().concat(events)),
);
console.log(
  "  ✓ Reversed delivery and repeated sync converge without duplicated reviews",
);
const undone = fold({}, [
  ...events,
  {
    id: "undo",
    word: "test",
    action: "undo",
    target_id: "c",
    reviewed_at: now + 12 * MINUTE,
  },
]);
assert.equal(undone.logs.length, 2);
assert.equal(undone.progress.test.interval, 10 * MINUTE);
const allUndone = fold({}, [
  events[0],
  {
    id: "undo-first",
    word: "test",
    action: "undo",
    target_id: "a",
    reviewed_at: now + MINUTE,
  },
]);
assert.equal(allUndone.logs.length, 0);
assert.deepEqual(allUndone.progress, {});
console.log(
  "  ✓ Synced undo restores the prior learning step, including removal of a first review",
);
const seed = calculateReview(null, "easy", now);
const snapshot = JSON.stringify(seed);
const result = fold({ test: seed }, [
  {
    id: "later",
    word: "test",
    action: "known",
    reviewed_at: seed.next_review_at,
  },
]);
assert.equal(
  result.progress.test.fsrs_card,
  calculateReview(seed, "known", seed.next_review_at).fsrs_card,
);
assert.equal(JSON.stringify(seed), snapshot);
console.log(
  "  ✓ Desktop initial records keep FSRS state and are not mutated during replay",
);
console.log("Mobile shared-core checks passed.");
