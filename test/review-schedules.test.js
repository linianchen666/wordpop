const assert = require("assert");
const Database = require("better-sqlite3");
const s = require("../src/shared/review-schedules");
const store = require("../src/main/review-schedule-store");
const { empty, createSession } = require("../src/shared/learning-core");
const { calculateReview } = require("../src/main/review-algorithm");
const now = new Date(2026, 9, 16, 12).getTime(),
  DAY = 86400000;
const owner = "project:user",
  clone = (v) => JSON.parse(JSON.stringify(v));
const vocab = Array.from({ length: 71 }, (_, n) => ({
  word: "word" + String(n).padStart(2, "0"),
  wordlists: ["cet4"],
  translation: "测试",
}));
const memory = (p) =>
  Object.fromEntries(
    Object.entries(p).filter(
      ([k]) => !["fsrs_before", "fsrs_log", "rating"].includes(k),
    ),
  );
const seeds = Object.fromEntries(
  vocab.map((w) => [
    w.word,
    memory(calculateReview(null, "known", now - 2 * DAY)),
  ]),
);
function phone() {
  const state = empty();
  state.seeds = clone(seeds);
  state.progress = clone(seeds);
  return createSession(state, vocab);
}
function desktop() {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE words(id INTEGER PRIMARY KEY,word TEXT UNIQUE); CREATE TABLE progress(word_id INTEGER UNIQUE,stage,next_review_at,last_review_at,correct_count,wrong_count,mastered_count,efactor,interval,repetitions,fsrs_card)",
  );
  for (const [n, w] of vocab.entries()) {
    db.prepare("INSERT INTO words VALUES(?,?)").run(n + 1, w.word);
    const p = seeds[w.word],
      cols = Object.keys(p);
    db.prepare(
      `INSERT INTO progress(word_id,${cols.join(",")}) VALUES(?,${cols.map(() => "?").join(",")})`,
    ).run(n + 1, ...Object.values(p));
  }
  return db;
}
function server() {
  const history = [],
    calls = [];
  let lost = false,
    offline = false,
    inject = null;
  const fetch = async (url, method = "GET", rows) => {
    calls.push(url);
    if (offline) throw Error("offline");
    if (method === "POST") {
      for (const row of rows)
        if (!history.some((old) => old.id === row.id && old.word === row.word))
          history.push(clone(row));
      if (lost) {
        lost = false;
        throw Error("lost response");
      }
      return null;
    }
    if (url === s.COUNT) return history.length;
    if (inject) {
      const callback = inject;
      inject = null;
      callback();
    }
    const current = [
      ...new Map(history.map((row) => [row.word, row])).values(),
    ].sort((a, b) => a.word.localeCompare(b.word));
    const offset = Number(
      new URL("https://test" + url).searchParams.get("offset"),
    );
    return clone(current.slice(offset, offset + 11)); // Simulate a server page cap below 500.
  };
  return {
    fetch,
    history,
    calls,
    setLost: () => {
      lost = true;
    },
    setOffline: (v) => {
      offline = v;
    },
    setInject: (f) => {
      inject = f;
    },
  };
}
async function mobileSync(session, cloud, force = false) {
  const before = session.schedules({ type: "scheduleBind", owner });
  for (const row of before.pending)
    await cloud.fetch(s.TABLE, "POST", [{ ...row, user_id: "user" }]);
  const downloaded = await s.download(
    cloud.fetch,
    before,
    force || before.pending.length > 0,
  );
  return session.schedules({
    type: "scheduleApply",
    owner,
    ...downloaded,
    sent: before.pending,
  });
}
const dueMap = (db) =>
  Object.fromEntries(store.records(db).map((p) => [p.word, p.next_review_at]));
async function main() {
  const cloud = server(),
    db = desktop(),
    mobile = phone();
  try {
    const original = clone(seeds);
    const card = mobile.dispatch({ type: "view" }, now);
    const spread = mobile.dispatch(
      { type: "spread", days: 7, scheduleId: "mobile-plan" },
      now,
    );
    assert.equal(spread.spreadResult.count, 70);
    assert.equal(spread.dueCount, 11);
    assert.equal(spread.word.word, card.word.word);
    assert.equal(spread.nonce, card.nonce);
    assert.equal(spread.state.events.length, 0);
    for (const [word, p] of Object.entries(spread.state.progress)) {
      const { next_review_at: ignored, ...memory } = p;
      const { next_review_at: oldDue, ...before } = original[word];
      assert.deepEqual(
        memory,
        before,
        "spreading must preserve FSRS and counters",
      );
    }
    await mobileSync(mobile, cloud);
    let notifications = 0;
    await store.sync(
      cloud.fetch,
      db,
      owner,
      "user",
      false,
      () => notifications++,
    );
    assert.equal(notifications, 1);
    assert.deepEqual(
      dueMap(db),
      Object.fromEntries(
        Object.entries(spread.state.progress).map(([w, p]) => [
          w,
          p.next_review_at,
        ]),
      ),
    );
    const writes = db.prepare("SELECT total_changes() AS n").get().n,
      idleCalls = cloud.calls.length;
    await store.sync(
      cloud.fetch,
      db,
      owner,
      "user",
      false,
      () => notifications++,
    );
    assert.equal(
      db.prepare("SELECT total_changes() AS n").get().n,
      writes,
      "idle sync must not rewrite DB",
    );
    assert.deepEqual(
      cloud.calls.slice(idleCalls),
      [s.COUNT],
      "idle sync must only check count",
    );
    assert.equal(notifications, 1);
    const idle = await mobileSync(mobile, cloud);
    assert(
      !idle.scheduleSync && !idle.changed && !idle.state && !idle.events,
      "idle native payload should stay small",
    );

    // A newer desktop plan may move a date earlier; do not merge dates with MAX.
    const target = spread.state.progress.word70;
    const earlier = {
      ...cloud.history.find((p) => p.word === "word70"),
      due_at: now + DAY,
    };
    delete earlier.user_id;
    delete earlier.id;
    store.capture(db, [earlier], owner);
    await store.sync(cloud.fetch, db, owner, "user", false, () => {});
    await mobileSync(mobile, cloud);
    assert.equal(
      mobile.dispatch({ type: "view" }, now).state.progress.word70
        .next_review_at,
      now + DAY,
    );

    // A new rating invalidates an old plan, including a late offline upload.
    const changed = memory(calculateReview(seeds.word70, "unknown", now));
    const cols = Object.keys(changed);
    db.prepare(
      "UPDATE progress SET " +
        cols.map((c) => c + "=?").join(",") +
        " WHERE word_id=71",
    ).run(...Object.values(changed));
    cloud.history.push({
      ...earlier,
      id: "late-offline",
      due_at: now + 20 * DAY,
    });
    await store.sync(cloud.fetch, db, owner, "user", false, () => {});
    assert.equal(dueMap(db).word70, changed.next_review_at);
    const rating = {
      id: "remote-rating",
      word: "word70",
      action: "unknown",
      reviewed_at: now,
    };
    const afterRating = mobile.dispatch(
      {
        type: "sync",
        userId: "user",
        seeds: clone(seeds),
        events: [rating],
        dailySeeds: [],
      },
      now,
    );
    await mobileSync(mobile, cloud);
    assert.equal(
      afterRating.state.progress.word70.next_review_at,
      changed.next_review_at,
    );
    assert.equal(afterRating.state.events.length, 1, "plans are not ratings");

    // Reordering JSON does not invalidate the same underlying FSRS state.
    const reordered = {
      ...target,
      fsrs_card: JSON.stringify(
        Object.fromEntries(
          Object.entries(JSON.parse(target.fsrs_card)).reverse(),
        ),
      ),
    };
    assert.equal(s.key(reordered), s.key(target));
    assert.equal(s.key({ ...target, next_review_at: 0 }), s.key(target));
    assert.notEqual(s.key({ ...target, wrong_count: 99 }), s.key(target));
    assert.throws(() => s.bind(store.load(db), "other:user"), /其他云账户/);

    // Offline and lost responses retain pending IDs; retrying an old ID is idempotent.
    const local = {
      ...earlier,
      word: "word69",
      base_key: s.key(seeds.word69),
      original_due_at: seeds.word69.next_review_at,
    };
    store.capture(db, [local], owner);
    const id = store.load(db).pending.word69.id;
    cloud.setOffline(true);
    await assert.rejects(
      store.sync(cloud.fetch, db, owner, "user", false, () => {}),
      /offline/,
    );
    assert.equal(store.load(db).pending.word69.id, id);
    cloud.setOffline(false);
    cloud.setLost();
    await assert.rejects(
      store.sync(cloud.fetch, db, owner, "user", false, () => {}),
      /lost response/,
    );
    assert.equal(store.load(db).pending.word69.id, id);
    await store.sync(cloud.fetch, db, owner, "user", false, () => {});
    assert(!store.load(db).pending.word69);
    assert.equal(
      cloud.history.filter((p) => p.id === id && p.word === "word69").length,
      1,
    );

    // An edit made during a download survives the stale response / acknowledgement.
    store.capture(db, [local], owner);
    cloud.setInject(() =>
      store.capture(db, [{ ...local, due_at: now + 3 * DAY }], owner),
    );
    await store.sync(cloud.fetch, db, owner, "user", true, () => {});
    assert.equal(dueMap(db).word69, now + 3 * DAY);
    let meta = s.capture(null, [local], "first-edit");
    const sent = s.upload(meta);
    meta = s.capture(
      meta,
      [{ ...local, due_at: now + 4 * DAY }],
      "second-edit",
    );
    meta = s.merge(meta, owner, sent, sent, 1);
    assert.equal(meta.pending.word69.id, "second-edit");
    assert.throws(
      () => s.merge(meta, owner, [{ ...sent[0], due_at: NaN }], sent, 1),
      /内容无效/,
    );
    assert.equal(meta.pending.word69.id, "second-edit");

    // Preserve an unrelated undo offer/current card when receiving queue dates.
    const current = mobile.dispatch({ type: "view" }, now);
    mobile.dispatch({ type: "reveal", nonce: current.nonce }, now);
    const reviewed = mobile.dispatch(
      {
        type: "review",
        nonce: current.nonce,
        id: "local-review",
        action: "known",
      },
      now + 1,
    );
    const undo = clone(reviewed.undo),
      nonce = reviewed.nonce;
    await mobileSync(mobile, cloud, true);
    const still = mobile.dispatch({ type: "view" }, now + 2);
    assert.deepEqual(still.undo, undo);
    assert.equal(still.nonce, nonce);
    const restored = mobile.dispatch(
      { type: "undo", id: "local-undo", target_id: undo.id },
      now + 3,
    );
    assert.equal(restored.word.word, undo.word);
    assert.equal(restored.state.events.length, 3);
    assert.throws(
      () =>
        mobile.dispatch({ type: "spread", days: 100, scheduleId: "bad" }, now),
      /3、5 或 7/,
    );
  } finally {
    db.close();
  }

  // Upgrade an already-spread desktop without inventing any rating history.
  const legacyDb = desktop(),
    legacyCloud = server(),
    legacyPhone = phone();
  try {
    legacyDb
      .prepare("UPDATE progress SET next_review_at=? WHERE word_id=1")
      .run(now + 6 * DAY);
    await store.sync(
      legacyCloud.fetch,
      legacyDb,
      owner,
      "user",
      false,
      () => {},
    );
    assert.equal(legacyCloud.history.length, 1);
    await mobileSync(legacyPhone, legacyCloud);
    assert.equal(
      legacyPhone.dispatch({ type: "view" }, now).state.progress.word00
        .next_review_at,
      now + 6 * DAY,
    );
    assert.equal(
      legacyPhone.dispatch({ type: "view" }, now).state.events.length,
      0,
    );
    await store.sync(
      legacyCloud.fetch,
      legacyDb,
      owner,
      "user",
      false,
      () => {},
    );
    assert.equal(legacyCloud.history.length, 1);
  } finally {
    legacyDb.close();
  }

  // Count changes mid-download must trigger a fresh snapshot, not partial apply.
  let counts = [0, 1, 1],
    pageReads = 0;
  const download = await s.download(
    async (url) => {
      if (url === s.COUNT) return counts.shift();
      pageReads++;
      return [];
    },
    { count: null },
  );
  assert.equal(pageReads, 2);
  assert.equal(download.count, 1);
  await assert.rejects(
    s.download(
      async (url) =>
        url === s.COUNT ? Math.random() : [{ id: "id", word: "x" }],
      { count: null },
    ),
    /分页正在变化/,
  );
  console.log(
    "Review schedules passed: Android/SQLite bidirectional dates, 7-day counts, legacy upgrade, immutable memory/history, stale plans, earlier replacements, offline/retry/concurrent edits, undo and count-only idle sync.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
