const schedules = require("../shared/review-schedules");
const crypto = require("crypto");
function load(db) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS review_schedule_state(id INTEGER PRIMARY KEY CHECK(id=1),json TEXT NOT NULL)",
  );
  const row = db
    .prepare("SELECT json FROM review_schedule_state WHERE id=1")
    .get();
  return row ? JSON.parse(row.json) : null;
}
function save(db, state) {
  const json = JSON.stringify(state);
  if (
    db.prepare("SELECT json FROM review_schedule_state WHERE id=1").get()
      ?.json !== json
  )
    db.prepare("INSERT OR REPLACE INTO review_schedule_state VALUES(1,?)").run(
      json,
    );
}
function capture(db, changes, owner) {
  const previous = load(db);
  const state = owner ? schedules.bind(previous, owner) : previous;
  save(db, schedules.capture(state, changes, crypto.randomUUID()));
}
function records(db) {
  return db
    .prepare("SELECT p.*,w.word FROM progress p JOIN words w ON w.id=p.word_id")
    .all();
}
function commit(db, previous, next, notify) {
  const progress = Object.fromEntries(
    records(db).map((row) => [row.word, row]),
  );
  const updates = schedules.apply(progress, next, previous || {});
  db.transaction(() => {
    const update = db.prepare(
      "UPDATE progress SET next_review_at=? WHERE word_id=(SELECT id FROM words WHERE word=?)",
    );
    for (const [word, due] of Object.entries(updates)) update.run(due, word);
    save(db, next);
  })();
  if (Object.keys(updates).length) notify();
}
async function sync(fetch, db, owner, userId, force, notify) {
  const initial = schedules.bind(load(db), owner);
  const downloaded = await schedules.download(fetch, initial, force);
  let previous = load(db);
  let state = schedules.merge(
    previous,
    owner,
    downloaded.rows,
    [],
    downloaded.count,
  );
  // Upgrade pre-sync local spreading once, but never overwrite cloud plans.
  if (!previous?.initialized) {
    const legacy = records(db).filter(
      (row) =>
        row.stage < 9 &&
        row.fsrs_card &&
        row.next_review_at > schedules.baseDue(row) &&
        !Object.hasOwn(state.remote, row.word) &&
        !Object.hasOwn(state.pending, row.word),
    );
    state = schedules.capture(
      state,
      legacy.map((row) => ({
        word: row.word,
        base_key: schedules.key(row),
        original_due_at: schedules.baseDue(row),
        due_at: row.next_review_at,
      })),
      crypto.randomUUID(),
    );
  }
  commit(db, previous, state, notify);
  const sent = schedules.upload(state);
  for (let offset = 0; offset < sent.length; offset += 500)
    await fetch(
      schedules.TABLE + "?on_conflict=id,word",
      "POST",
      sent
        .slice(offset, offset + 500)
        .map((row) => ({ ...row, user_id: userId })),
    );
  if (sent.length) {
    const latest = await schedules.download(fetch, state, true);
    previous = load(db);
    state = schedules.merge(previous, owner, latest.rows, sent, latest.count);
    commit(db, previous, state, notify);
  }
  return schedules.upload(load(db)).length ? "；复习安排等待上传" : "";
}
module.exports = { load, save, capture, records, sync };
