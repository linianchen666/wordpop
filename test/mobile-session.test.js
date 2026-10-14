const assert = require("assert");
const Module = require("module");
const algorithm = require("../src/main/review-algorithm");
const originalLoad = Module._load;
let calls = 0;
Module._load = function (name, parent) {
  if (
    parent?.filename.endsWith("/shared/learning-core.js") &&
    name === "../main/review-algorithm"
  )
    return {
      ...algorithm,
      calculateReview(...args) {
        calls++;
        return algorithm.calculateReview(...args);
      },
    };
  return originalLoad.apply(this, arguments);
};
const {
  empty,
  fold,
  dispatch,
  createSession,
} = require("../src/shared/learning-core");
Module._load = originalLoad;
const vocab = ["test", "next", "third"].map((word) => ({
  word,
  wordlists: ["cet4"],
  translation: "n. 测试",
}));
const now = Date.UTC(2026, 9, 14, 9);
let reference = empty();
reference.config.autoBalanceLoad = false;
reference.events = Array.from({ length: 300 }, (_, i) => ({
  id: "history-" + i,
  word: "history",
  action: "unknown",
  reviewed_at: now - (600 - i) * 60000,
}));
reference.progress = fold({}, reference.events).progress;
const session = createSession(JSON.parse(JSON.stringify(reference)), vocab);
let fast;
function step(command, time = now) {
  const rCommand = { ...command };
  if (command.nonce === "current") {
    command = { ...command, nonce: fast.nonce };
    rCommand.nonce = reference.current?.nonce;
  }
  const generic = dispatch(reference, vocab, rCommand, time);
  reference = generic.state;
  calls = 0;
  fast = session.dispatch(command, time);
  const used = calls;
  assert.deepEqual(fast.state.progress, reference.progress);
  assert.deepEqual(fast.state.events, reference.events);
  assert.deepEqual(fast.quota, generic.quota);
  assert.equal(fast.word?.word, generic.word?.word);
  assert.equal(fast.newRemaining, generic.newRemaining);
  assert.equal(fast.dueCount, generic.dueCount);
  assert.deepEqual(fast.intervals, generic.intervals);
  return used;
}
step({ type: "view" });
assert(
  step({ type: "reveal", nonce: "current" }) <= 4,
  "reveal must not replay history",
);
assert(
  step(
    { type: "review", nonce: "current", id: "new-1", action: "unknown" },
    now + 1,
  ) <= 5,
  "ordered local review should calculate only current card",
);
step({ type: "reveal", nonce: "current" }, now + 2);
assert(
  step(
    { type: "review", nonce: "current", id: "new-2", action: "known" },
    now + 3,
  ) <= 5,
);
let sync = {
  type: "sync",
  userId: "same-user",
  seeds: {},
  dailySeeds: [],
  events: JSON.parse(JSON.stringify(reference.events)),
};
assert(step(sync, now + 4) <= 4, "unchanged sync must not replay history");
const undo = {
  id: "undo-new",
  word: "test",
  action: "undo",
  target_id: "new-1",
  reviewed_at: now + 5,
};
sync = { ...sync, events: [...sync.events, undo] };
step(sync, now + 6);
step({ ...sync, events: [...sync.events].reverse() }, now + 7);
step({ type: "reveal", nonce: "current" }, now + 8);
step(
  { type: "review", nonce: "current", id: "backwards", action: "known" },
  now - 1000,
);
step({ type: "view" }, now + 86400000);
const small = session.render(
  { type: "reveal", nonce: fast.nonce },
  now + 86400001,
  false,
);
assert(!small.state, "ordinary display should not transfer full journal");
assert("current" in small && "intervals" in small);
console.log(
  "Mobile session checks passed: incremental FSRS equals full replay, unchanged sync, undo, reordered events, clock reversal and small display payloads.",
);

const fresh = createSession(null, vocab);
const first = fresh.render({ type: "view" }, now, true);
let mirror = JSON.parse(JSON.stringify(first.state));
const revealed = fresh.render(
  { type: "reveal", nonce: first.nonce },
  now + 1,
  false,
);
mirror.current = revealed.current;
const scored = fresh.render(
  { type: "review", nonce: first.nonce, id: "patch-event", action: "known" },
  now + 2,
  false,
);
assert(
  !scored.state && scored.reviewPatch,
  "ordinary review should transfer only its changed row and event",
);
mirror.events.push(scored.reviewPatch.event);
mirror.progress[scored.reviewPatch.word] = scored.reviewPatch.progress;
mirror.current = scored.current;
const canonical = fresh.render({ type: "view" }, now + 2, true).state;
assert.deepEqual(mirror, canonical);
console.log(
  "Native state patch is equivalent to full session state after reveal and review.",
);
