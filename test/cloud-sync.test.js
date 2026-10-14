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
  injectOnPull = null;
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
      return { reloadQueue() {}, emit() {} };
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
    const route = new URL(url).pathname;
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
      else result = baseline ? [{ state: baseline }] : [];
    } else if (route.endsWith("wordpop_events")) {
      if (options.method === "POST") {
        for (const event of body)
          if (!serverEvents.some((e) => e.id === event.id))
            serverEvents.push(event);
      } else {
        if (injectOnPull) {
          const callback = injectOnPull;
          injectOnPull = null;
          callback();
        }
        result = serverEvents;
      }
    }
    return {
      ok: true,
      status: 200,
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
      const now = Date.now();
      recordReview(db, 1, "unknown", now);
      await cloud.sync();
      assert.equal(serverEvents.length, 1);
      serverEvents.push({
        id: "phone-review",
        word: "test",
        action: "known",
        reviewed_at: now + MINUTE,
        user_id: "test-user",
      });
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
      serverEvents.push({
        id: "undo-phone",
        word: "test",
        action: "undo",
        target_id: "phone-review",
        reviewed_at: now + 2 * MINUTE,
      });
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
      await cloud.sync();
      assert.equal(
        db.prepare("SELECT COUNT(*) n FROM cloud_events WHERE sent=0").get().n,
        0,
      );
      assert.equal(serverEvents.length, 5);
      console.log(
        "Cloud sync checks passed: real SQLite persistence, desktop outbox, phone feedback, idempotent replay, daily statistics and remote undo.",
      );
    } finally {
      cloud.logout();
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
