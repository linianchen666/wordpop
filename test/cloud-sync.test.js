const assert = require("assert"),
  fs = require("fs"),
  os = require("os"),
  path = require("path"),
  Module = require("module");
const Database = require("better-sqlite3");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wordpop-cloud-test-"));
const db = new Database(":memory:");
db.exec(`CREATE TABLE words(id INTEGER PRIMARY KEY,word TEXT);INSERT INTO words VALUES(1,'test');
CREATE TABLE progress(word_id INTEGER UNIQUE,stage,next_review_at,last_review_at,correct_count,wrong_count,mastered_count,efactor,interval,repetitions,fsrs_card);
CREATE TABLE review_history(id INTEGER PRIMARY KEY AUTOINCREMENT,word_id,reviewed_at,rating,card_before,card_after,log);
CREATE TABLE daily_stats(date TEXT PRIMARY KEY,words_reviewed,words_learned);`);
const { recordReview } = require("../src/main/review-progress");
const { MINUTE } = require("../src/main/review-algorithm");
const originalLoad = Module._load,
  originalFetch = global.fetch;
let baseline = null,
  serverEvents = [],
  injectOnPull = null,
  offline = false,
  lostUploadReply = false,
  holdPull = null,
  baselineReads = 0,
  reloads = 0,
  pulls = 0,
  counts = 0,
  uploadedBatches = [],
  countHeaderAvailable = true;
const realSetTimeout = global.setTimeout,
  realClearTimeout = global.clearTimeout;
const batches = [];
global.setTimeout = (fn, delay, ...args) => {
  if (delay !== 10000) return realSetTimeout(fn, delay, ...args);
  const timer = { batch: true, active: true, fn, unref() {} };
  batches.push(timer);
  return timer;
};
global.clearTimeout = (timer) => {
  if (timer?.batch) timer.active = false;
  else realClearTimeout(timer);
};
function flushBatch() {
  const next = batches.find((b) => b.active);
  assert(next, "automatic batch should be scheduled");
  next.active = false;
  next.fn();
}
try {
  Module._load = function (request, parent) {
    if (request === "electron")
      return {
        app: { getPath: () => dir },
        safeStorage: {
          isEncryptionAvailable: () => true,
          encryptString: (value) => Buffer.from(value),
          decryptString: (buffer) => buffer.toString(),
        },
      };
    if (parent?.filename.endsWith("cloud-sync.js") && request === "./scheduler")
      return {
        reloadQueue() {
          reloads++;
        },
        emit() {},
      };
    if (parent?.filename.endsWith("cloud-sync.js") && request === "./backup")
      return {
        createBackupData: () => ({
          data: {
            progress: db
              .prepare(
                "SELECT w.word,p.* FROM progress p JOIN words w ON p.word_id=w.id",
              )
              .all(),
            daily_stats: db.prepare("SELECT * FROM daily_stats").all(),
          },
        }),
      };
    return originalLoad.apply(this, arguments);
  };
  const cloud = require("../src/main/cloud-sync");
  cloud.start(db);
  global.fetch = async (url, options) => {
    if (offline) throw new Error("fixture offline");
    const parsed = new URL(url);
    const route = parsed.pathname;
    const body = options.body && JSON.parse(options.body);
    let result = null;
    if (route.includes("/auth/"))
      result = {
        access_token: "test-token",
        refresh_token: "test-refresh",
        expires_in: 3600,
        user: { id: "test-user" },
      };
    else if (route.endsWith("wordpop_baseline")) {
      if (options.method === "POST") baseline = body.state;
      else {
        baselineReads++;
        result = baseline ? [{ state: baseline }] : [];
      }
    } else if (route.endsWith("wordpop_events")) {
      if (options.method === "POST") {
        uploadedBatches.push(body);
        for (const event of body)
          if (!serverEvents.some((e) => e.id === event.id))
            serverEvents.push(event);
        if (lostUploadReply) {
          lostUploadReply = false;
          throw new Error("fixture lost reply");
        }
      } else if (options.headers.Prefer === "count=exact") {
        counts++;
        result = [];
      } else {
        pulls++;
        if (holdPull) await holdPull;
        if (injectOnPull) {
          const callback = injectOnPull;
          injectOnPull = null;
          callback();
        }
        const offset = Number(parsed.searchParams.get("offset") || 0);
        result = [...serverEvents]
          .sort(
            (a, b) => a.reviewed_at - b.reviewed_at || a.id.localeCompare(b.id),
          )
          .slice(offset, offset + 1000);
      }
    }
    return {
      ok: true,
      status: 200,
      headers: {
        get: (key) =>
          key === "Content-Range" && countHeaderAvailable
            ? "*/" + serverEvents.length
            : null,
      },
      text: async () => (result === null ? "" : JSON.stringify(result)),
    };
  };
  (async () => {
    try {
      const login = await cloud.login({
        url: "https://example.supabase.co",
        key: "public-key",
        email: "test@example.com",
        password: "fixture-password",
      });
      assert.ok(!login.error, login.message);
      const initialBaselineReads = baselineReads;
      const initialReloads = reloads;
      const initialChanges = db.prepare("SELECT total_changes() n").get().n;
      await cloud.sync();
      assert.equal(
        baselineReads,
        initialBaselineReads,
        "immutable baseline is cached",
      );
      assert.equal(
        reloads,
        initialReloads,
        "unchanged checks must not reset the study queue",
      );
      assert.equal(
        db.prepare("SELECT total_changes() n").get().n,
        initialChanges,
        "unchanged checks must not rewrite SQLite",
      );
      const initialPulls = pulls;
      await cloud.sync({ background: true });
      assert.equal(counts, 1);
      assert.equal(
        pulls,
        initialPulls,
        "unchanged background checks return only the count, not the full journal",
      );
      countHeaderAvailable = false;
      await cloud.sync({ background: true });
      assert.equal(
        pulls,
        initialPulls + 1,
        "missing count header safely falls back to a full pull",
      );
      countHeaderAvailable = true;
      const now = Date.now();
      recordReview(db, 1, "unknown", now);
      await cloud.sync();
      assert.equal(serverEvents.length, 1);
      const { createSession } = require("../src/shared/learning-core");
      const phone = createSession(null, [
        { word: "test", wordlists: ["cet4"], translation: "n. 测试" },
      ]);
      let phoneView = phone.dispatch(
        {
          type: "sync",
          userId: "test-user",
          seeds: {},
          events: serverEvents,
          dailySeeds: [],
        },
        now + MINUTE,
      );
      phoneView = phone.dispatch(
        { type: "reveal", nonce: phoneView.nonce },
        now + MINUTE,
      );
      phoneView = phone.dispatch(
        {
          type: "review",
          nonce: phoneView.nonce,
          id: "phone-review",
          action: "known",
        },
        now + MINUTE,
      );
      serverEvents.push(
        phoneView.state.events.find((e) => e.id === "phone-review"),
      );
      await cloud.sync();
      assert.equal(
        db.prepare("SELECT interval FROM progress").get().interval,
        10 * MINUTE,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) n FROM review_history").get().n,
        2,
      );
      await cloud.sync();
      assert.equal(
        db.prepare("SELECT COUNT(*) n FROM review_history").get().n,
        2,
      );
      assert.equal(
        db.prepare("SELECT words_reviewed FROM daily_stats").get()
          .words_reviewed,
        2,
      );
      phoneView = phone.dispatch(
        { type: "undo", id: "undo-phone", target_id: "phone-review" },
        now + 2 * MINUTE,
      );
      serverEvents.push(
        phoneView.state.events.find((e) => e.id === "undo-phone"),
      );
      await cloud.sync();
      assert.equal(
        db.prepare("SELECT interval FROM progress").get().interval,
        MINUTE,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) n FROM review_history").get().n,
        1,
      );
      serverEvents.push({
        id: "undo-first",
        word: "test",
        action: "undo",
        target_id: serverEvents[0].id,
        reviewed_at: now + 3 * MINUTE,
      });
      await cloud.sync();
      assert.equal(db.prepare("SELECT COUNT(*) n FROM progress").get().n, 0);
      assert.equal(
        db.prepare("SELECT words_reviewed FROM daily_stats").get()
          .words_reviewed,
        0,
      );
      injectOnPull = () => recordReview(db, 1, "unknown", now + 4 * MINUTE);
      await cloud.sync();
      assert.equal(
        db.prepare("SELECT wrong_count FROM progress").get().wrong_count,
        1,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) n FROM cloud_events WHERE sent=0").get().n,
        1,
      );
      const until = async (predicate) => {
        const deadline = Date.now() + 5000;
        while (!predicate()) {
          assert(Date.now() < deadline, "automatic upload timed out");
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      };
      flushBatch();
      await until(
        () => cloud.getStatus().pending === 0 && !cloud.getStatus().syncing,
      );
      assert.equal(
        serverEvents.length,
        5,
        "a rating during pull uploads without manual sync",
      );
      assert.equal(
        db
          .prepare("SELECT COUNT(*) n FROM cloud_events WHERE action='undo'")
          .get().n,
        2,
        "remote undo tombstones are durable",
      );

      offline = true;
      recordReview(db, 1, "fuzzy", now + 5 * MINUTE);
      const failed = await cloud.sync();
      assert(failed.error);
      assert.equal(cloud.getStatus().pending, 1);
      assert(cloud.getStatus().message.includes("已保存本地"));
      assert.equal(serverEvents.length, 5);
      offline = false;
      lostUploadReply = true;
      assert((await cloud.sync()).error);
      assert.equal(
        cloud.getStatus().pending,
        1,
        "no acknowledgement means keep the outbox",
      );
      await cloud.sync();
      assert.equal(
        serverEvents.length,
        6,
        "retry after a lost response must not duplicate a rating",
      );
      assert.equal(cloud.getStatus().pending, 0);

      // Offline events may arrive with older review times. Full pulls and UUID dedup retain them.
      const { fold } = require("../src/shared/learning-core");
      for (let i = 0; i < 1005; i++)
        serverEvents.push({
          id: "offline-phone-" + i,
          word: "missing",
          action: "unknown",
          reviewed_at: now - (2000 - i) * MINUTE,
        });
      const deferred = now + 7 * 24 * 60 * MINUTE;
      db.prepare("UPDATE progress SET next_review_at=? WHERE word_id=1").run(
        deferred,
      );
      const previousPulls = pulls;
      await cloud.sync();
      assert.equal(pulls - previousPulls, 2, "all pages must be fetched");
      assert.equal(
        db
          .prepare("SELECT COUNT(*) n FROM cloud_events WHERE word='missing'")
          .get().n,
        1005,
      );
      assert.equal(db.prepare("SELECT COUNT(*) n FROM progress").get().n, 1);
      assert.equal(
        db.prepare("SELECT next_review_at FROM progress WHERE word_id=1").get()
          .next_review_at,
        deferred,
        "syncing another word must preserve local backlog spreading",
      );
      db.prepare("INSERT INTO words VALUES(2,'missing')").run();
      await cloud.sync();
      assert.equal(
        db.prepare("SELECT COUNT(*) n FROM progress").get().n,
        2,
        "installing a dictionary materializes retained remote history",
      );
      assert.equal(
        db.prepare("SELECT wrong_count FROM progress WHERE word_id=2").get()
          .wrong_count,
        fold({}, serverEvents).progress.missing.wrong_count,
      );

      serverEvents.push({
        id: "new-after-deferral",
        word: "test",
        action: "known",
        reviewed_at: now + 6 * MINUTE,
      });
      await cloud.sync();
      assert.notEqual(
        db.prepare("SELECT next_review_at FROM progress WHERE word_id=1").get()
          .next_review_at,
        deferred,
        "a fresh review replaces the deferred queue time",
      );

      const beforeBatchedUploads = serverEvents.length;
      const beforePostCount = uploadedBatches.length;
      recordReview(db, 1, "unknown", now + 7 * MINUTE);
      const scheduled = batches.filter((b) => b.active).length;
      recordReview(db, 1, "fuzzy", now + 8 * MINUTE);
      recordReview(db, 1, "known", now + 9 * MINUTE);
      assert.equal(
        batches.filter((b) => b.active).length,
        scheduled,
        "later words must not reset or duplicate the ten-second window",
      );
      assert.equal(cloud.getStatus().pending, 3);
      assert.equal(
        serverEvents.length,
        beforeBatchedUploads,
        "grades remain local until the batch starts",
      );
      flushBatch();
      await until(
        () => cloud.getStatus().pending === 0 && !cloud.getStatus().syncing,
      );
      assert.equal(serverEvents.length, beforeBatchedUploads + 3);
      assert.equal(
        uploadedBatches.length,
        beforePostCount + 1,
        "three grades must upload in one POST",
      );
      assert.equal(uploadedBatches.at(-1).length, 3);
      const beforeIdlePull = pulls;
      await cloud.sync({ background: true });
      assert.equal(pulls, beforeIdlePull);
      serverEvents.push({
        id: "new-on-count-check",
        word: "test",
        action: "unknown",
        reviewed_at: now + 10 * MINUTE,
      });
      await cloud.sync({ background: true });
      assert.equal(
        pulls,
        beforeIdlePull + 2,
        "a changed count fetches all pages and merges the new remote rating",
      );

      const beforeLogout = db.prepare("SELECT total_changes() n").get().n;
      let release;
      holdPull = new Promise((resolve) => {
        release = resolve;
      });
      const beforeHeldPull = pulls;
      serverEvents.push({
        id: "late-after-logout",
        word: "test",
        action: "easy",
        reviewed_at: now + 6 * MINUTE,
      });
      const held = cloud.sync();
      await until(() => pulls > beforeHeldPull);
      cloud.logout();
      release();
      await held;
      holdPull = null;
      assert.equal(
        db.prepare("SELECT total_changes() n").get().n,
        beforeLogout,
        "logout must stop an in-flight pull from applying records",
      );
      assert.equal(cloud.getStatus().message, "已退出云账户");
      console.log(
        "Cloud sync checks passed: real SQLite persistence, desktop outbox, phone feedback, no-op polls, automatic followup, offline/lost-response retries, pagination, missing dictionaries, remote undo and logout cancellation.",
      );
    } finally {
      cloud.logout();
      global.setTimeout = realSetTimeout;
      global.clearTimeout = realClearTimeout;
      Module._load = originalLoad;
      global.fetch = originalFetch;
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  })().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} catch (error) {
  Module._load = originalLoad;
  throw error;
}
