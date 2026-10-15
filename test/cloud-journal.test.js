const assert = require("assert");
const { downloadJournal } = require("../src/main/cloud-journal");
const { fold } = require("../src/shared/learning-core");
const now = Date.parse("2026-10-15T01:00:00Z");
const event = (
  n,
  time = `2026-10-15T00:00:00.${String(n).padStart(6, "0")}+00:00`,
) => ({
  id: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
  created_at: time,
  word: "test",
  action: "known",
  reviewed_at: now + n,
  target_id: null,
});
function server(events = [], cap = 1000) {
  const state = {
    events,
    pages: [],
    delivered: [],
    missingCount: false,
    onPage: null,
    onCount: null,
    failPage: false,
  };
  state.fetch = async (route, method, body, credentials, count) => {
    if (count) {
      if (state.onCount) state.onCount();
      return state.missingCount ? null : state.events.length;
    }
    if (state.failPage) throw new Error("offline page");
    state.pages.push(route);
    if (state.onPage) {
      const fn = state.onPage;
      state.onPage = null;
      fn();
    }
    const filter = new URL("https://example.org" + route).searchParams.get(
      "or",
    );
    const cursor =
      filter &&
      filter.match(
        /^\(created_at.gt.(.*),and\(created_at.eq.*?,id.gt.([a-z0-9-]+)\)\)$/i,
      );
    const micros = (e) =>
      e.created_at.replace(/(\.\d+)?(?:\+00:00|Z)$/, (_, f) =>
        (f || ".").padEnd(7, "0"),
      );
    const after = (e) =>
      !cursor ||
      micros(e) > micros({ created_at: cursor[1] }) ||
      (micros(e) === micros({ created_at: cursor[1] }) && e.id > cursor[2]);
    const page = state.events
      .slice()
      .sort(
        (a, b) =>
          micros(a).localeCompare(micros(b)) || a.id.localeCompare(b.id),
      )
      .filter(after)
      .slice(0, cap);
    state.delivered.push(...page);
    return page;
  };
  return state;
}
(async () => {
  const remote = server(
    Array.from({ length: 1005 }, (_, i) => event(i + 1)),
    400,
  );
  let result = await downloadJournal(remote.fetch, { now });
  assert.equal(result.events.length, 1005);
  assert.equal(remote.pages.length, 3, "honor server caps below 1000");
  const saved = JSON.parse(JSON.stringify(result.snapshot));
  remote.pages.length = remote.delivered.length = 0;
  result = await downloadJournal(remote.fetch, {
    snapshot: saved,
    now: now + 1000,
  });
  assert.equal(
    remote.pages.length,
    0,
    "restored cache survives restart without a full download",
  );
  assert.equal(
    result.snapshot,
    saved,
    "idle polls do not rewrite durable checkpoints",
  );
  const offline = { ...event(1006), reviewed_at: now - 86400000 };
  const undo = {
    ...event(1007),
    action: "undo",
    target_id: offline.id,
    reviewed_at: now + 86400000,
  };
  remote.events.push(offline, undo);
  result = await downloadJournal(remote.fetch, {
    snapshot: saved,
    now: now + 2000,
  });
  assert.deepEqual(
    remote.delivered.map((e) => e.id),
    [offline.id, undo.id],
    "download only new offline review and undo",
  );
  assert.deepEqual(
    fold({}, result.events),
    fold({}, remote.events),
    "incremental replay equals full-history replay",
  );
  assert.equal(
    result.snapshot.validatedAt,
    saved.validatedAt,
    "increments do not postpone the daily full validation",
  );
  // Fractional seconds stay at microsecond precision; equal timestamps use UUID.
  const precision = server([event(1, "2026-10-15T00:00:00.001+00:00")]);
  let precise = await downloadJournal(precision.fetch, { now });
  precision.events.push(
    event(2, "2026-10-15T00:00:00.001000+00:00"),
    event(3, "2026-10-15T00:00:00.001001+00:00"),
  );
  precision.delivered.length = 0;
  precise = await downloadJournal(precision.fetch, {
    snapshot: precise.snapshot,
    now,
  });
  assert.equal(
    precision.delivered.length,
    2,
    "equal-time ID and the next microsecond both survive",
  );
  // A late transaction is visible behind our high watermark.
  const late = event(1008, "2026-10-14T00:00:00Z");
  remote.events.push(late);
  remote.pages.length = 0;
  const recovered = await downloadJournal(remote.fetch, {
    snapshot: result.snapshot,
    now: now + 3000,
  });
  assert.equal(recovered.events.length, remote.events.length);
  assert(
    remote.pages.some((route) => !route.includes("&or=")),
    "count mismatch must reconcile all rows",
  );
  assert(recovered.events.some((e) => e.id === late.id));
  // Failed pages never mutate the saved snapshot; a retry still sees every event.
  const checkpoint = JSON.stringify(recovered.snapshot);
  remote.events.push(event(1009));
  remote.failPage = true;
  await assert.rejects(
    downloadJournal(remote.fetch, {
      snapshot: recovered.snapshot,
      now: now + 4000,
    }),
    /offline page/,
  );
  assert.equal(JSON.stringify(recovered.snapshot), checkpoint);
  remote.failPage = false;
  const retried = await downloadJournal(remote.fetch, {
    snapshot: recovered.snapshot,
    now: now + 4000,
  });
  assert.equal(retried.events.length, remote.events.length);
  for (const options of [
    { forceFull: true, now: now + 5000 },
    { now: retried.snapshot.validatedAt + 86400001 },
    { snapshot: { ...retried.snapshot, count: 2 }, now: now + 5000 },
  ]) {
    remote.pages.length = 0;
    await downloadJournal(remote.fetch, {
      snapshot: retried.snapshot,
      ...options,
    });
    assert(
      !remote.pages[0].includes("&or="),
      "manual, expired or corrupt checkpoints require full validation",
    );
  }
  // Missing count metadata disables incremental checkpoints and uses full pages.
  remote.missingCount = true;
  const fallback = await downloadJournal(remote.fetch, {
    snapshot: retried.snapshot,
    now: now + 5000,
  });
  assert.equal(fallback.snapshot, null);
  assert.equal(fallback.events.length, remote.events.length);
  remote.missingCount = false;
  // Count decreases are never treated as an empty increment.
  remote.events.pop();
  remote.pages.length = 0;
  await downloadJournal(remote.fetch, {
    snapshot: retried.snapshot,
    now: now + 5000,
  });
  assert(!remote.pages[0].includes("&or="));
  // A concurrent insert after a page is caught by the final count and retried.
  const concurrent = server([event(1)]);
  const base = await downloadJournal(concurrent.fetch, { now });
  concurrent.pages.length = 0;
  concurrent.events.push(event(2));
  let counts = 0;
  concurrent.onCount = () => {
    if (++counts === 2) concurrent.events.push(event(3));
  };
  const complete = await downloadJournal(concurrent.fetch, {
    snapshot: base.snapshot,
    now,
  });
  assert.equal(complete.events.length, 3);
  assert(
    concurrent.pages.every((route) => route.includes("&or=")),
    "concurrent tail inserts must stay incremental",
  );
  // Continuous changes fail safely instead of publishing an incomplete cursor.
  concurrent.events.push(event(4));
  concurrent.onCount = () => concurrent.events.push(event(100 + ++counts));
  await assert.rejects(
    downloadJournal(concurrent.fetch, { snapshot: complete.snapshot, now }),
    /数量不一致|持续新增/,
  );
  console.log(
    "Cloud journal checks passed: durable incremental cache, precise keysets, small server pages, offline reviews/undos, late commits, concurrent inserts, failed pages and full-validation fallbacks.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
