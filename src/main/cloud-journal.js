// Download the append-only journal using server time, never the device review time.
// created_at is transaction-start time, not commit order: exact counts detect a
// late commit behind the cursor and force a complete reconciliation before saving.
const PAGE_SIZE = 1000;
const MAX_AGE = 24 * 60 * 60 * 1000;
const SELECT =
  "/rest/v1/wordpop_events?select=id,word,action,reviewed_at,target_id,created_at&order=created_at.asc,id.asc&limit=" +
  PAGE_SIZE;
const COUNT = "/rest/v1/wordpop_events?select=id&limit=0";
function timestamp(value) {
  const match =
    typeof value === "string" &&
    value.match(
      /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(?:Z|\+00:00)$/,
    );
  if (!match || !Number.isFinite(Date.parse(match[1] + "Z")))
    throw new Error("云端记录时间无效，请重试同步");
  return match[1] + "." + (match[2] || "").padEnd(6, "0");
}
function compare(a, b) {
  const ta = timestamp(a.created_at),
    tb = timestamp(b.created_at);
  return ta < tb ? -1 : ta > tb ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
function validate(event) {
  if (!event || typeof event.id !== "string" || !/^[a-z0-9-]+$/i.test(event.id))
    throw new Error("云端记录 ID 无效");
  timestamp(event.created_at);
}
function usable(snapshot, now) {
  try {
    if (
      snapshot?.version !== 1 ||
      !Array.isArray(snapshot.events) ||
      snapshot.count !== snapshot.events.length ||
      !Number.isFinite(snapshot.validatedAt) ||
      now < snapshot.validatedAt ||
      now - snapshot.validatedAt >= MAX_AGE
    )
      return false;
    const ids = new Set();
    for (const event of snapshot.events) {
      validate(event);
      ids.add(event.id);
    }
    return ids.size === snapshot.count;
  } catch (_) {
    return false;
  }
}
async function downloadJournal(
  fetch,
  { snapshot = null, forceFull = false, now = Date.now() } = {},
) {
  const readCount = async () => {
    const count = await fetch(COUNT, "GET", undefined, undefined, true);
    return Number.isSafeInteger(count) && count >= 0 ? count : null;
  };
  const before = await readCount();
  let full =
    forceFull ||
    !usable(snapshot, now) ||
    before === null ||
    before < snapshot.count;
  if (!full && before === snapshot.count)
    return { events: snapshot.events, snapshot, downloaded: false };
  // A retry starts from the beginning. No partial page or advanced cursor is
  // returned on failure; the caller saves this snapshot only after applying it.
  for (let attempt = 0; attempt < 2; attempt++) {
    const records = new Map(
      (full ? [] : snapshot.events).map((e) => [e.id, e]),
    );
    let cursor = [...records.values()].sort(compare).at(-1);
    for (;;) {
      const filter = cursor
        ? "&or=" +
          encodeURIComponent(
            `(created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id}))`,
          )
        : "";
      const page = await fetch(SELECT + filter);
      if (!Array.isArray(page)) throw new Error("云端记录响应无效");
      for (const event of page) {
        validate(event);
        if (cursor && compare(event, cursor) <= 0)
          throw new Error("云端记录分页顺序无效，请重试同步");
        records.set(event.id, event);
        cursor = event;
      }
      // Also works when a project caps REST pages below our requested size.
      if (!page.length || (before !== null && records.size >= before)) break;
    }
    const events = [...records.values()];
    const after = await readCount();
    if (after === events.length)
      return {
        events,
        downloaded: true,
        snapshot: {
          version: 1,
          count: after,
          validatedAt: full ? now : snapshot.validatedAt,
          events,
        },
      };
    if (after === null && full)
      return { events, snapshot: null, downloaded: true };
    full = true;
  }
  throw new Error("云端记录正在变化或数量不一致，已保留本地记录，将重试同步");
}
module.exports = { downloadJournal };
