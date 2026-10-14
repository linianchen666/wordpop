const fs = require("fs"),
  path = require("path"),
  crypto = require("crypto");
const { fold } = require("../shared/learning-core");
let session = null,
  timer = null,
  busy = false,
  authenticating = false,
  status = "尚未连接云服务",
  db = null;
function sessionFile() {
  return path.join(
    require("electron").app.getPath("userData"),
    "cloud-session.bin",
  );
}
function persist() {
  const { safeStorage } = require("electron");
  if (!safeStorage.isEncryptionAvailable())
    throw new Error("系统凭据加密不可用，无法保存云登录状态");
  fs.writeFileSync(
    sessionFile(),
    safeStorage.encryptString(JSON.stringify(session)),
    { mode: 0o600 },
  );
}
function tables(database) {
  database.exec(
    `CREATE TABLE IF NOT EXISTS cloud_events(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,word TEXT NOT NULL,action TEXT NOT NULL,reviewed_at INTEGER NOT NULL,history_id INTEGER,target_id TEXT,sent INTEGER DEFAULT 0);`,
  );
}
function captureReview(database, wordId, action, now, historyId) {
  if (!session?.user?.id || !db) return;
  const word = database
    .prepare("SELECT word FROM words WHERE id=?")
    .get(wordId)?.word;
  if (!word) return;
  database
    .prepare("INSERT INTO cloud_events VALUES(?,?,?,?,?,?,?,?)")
    .run(
      crypto.randomUUID(),
      session.user.id,
      word,
      action === "mastered" ? "easy" : action,
      now,
      historyId,
      null,
      0,
    );
}
async function request(route, method = "GET", body, credentials = session) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const net = require("electron").net;
    const fetchRequest = net?.fetch ? net.fetch.bind(net) : globalThis.fetch;
    const response = await fetchRequest(credentials.url + route, {
      method,
      headers: {
        apikey: credentials.key,
        ...(!route.startsWith("/auth/") && credentials.access_token
          ? { Authorization: "Bearer " + credentials.access_token }
          : {}),
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok)
      throw new Error(
        `云服务请求失败（${response.status}），请检查账户和数据库配置`,
      );
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timeout);
  }
}
async function sync() {
  if (!session) return { message: "请先登录云账户" };
  if (authenticating) return { message: "正在登录" };
  if (busy) return { message: status };
  busy = true;
  try {
    if (session.expires_at < Date.now() / 1000 + 60) {
      const fresh = await request(
        "/auth/v1/token?grant_type=refresh_token",
        "POST",
        { refresh_token: session.refresh_token },
      );
      session = {
        ...session,
        ...fresh,
        expires_at: Date.now() / 1000 + fresh.expires_in,
      };
      persist();
    }
    let baseline = await request(
      "/rest/v1/wordpop_baseline?select=state&limit=1",
    );
    if (!baseline.length) {
      const snapshot =
        session.initialBaseline || require("./backup").createBackupData();
      await request("/rest/v1/wordpop_baseline?on_conflict=user_id", "POST", {
        user_id: session.user.id,
        state: snapshot,
      });
      baseline = await request(
        "/rest/v1/wordpop_baseline?select=state&limit=1",
      );
    }
    if (session.initialBaseline) {
      delete session.initialBaseline;
      persist();
    }
    const upload = db
      .prepare(
        "SELECT id,word,action,reviewed_at,target_id FROM cloud_events WHERE user_id=? AND sent=0",
      )
      .all(session.user.id);
    if (upload.length)
      await request(
        "/rest/v1/wordpop_events?on_conflict=id",
        "POST",
        upload.map((event) => ({ ...event, user_id: session.user.id })),
      );
    for (const event of upload)
      db.prepare("UPDATE cloud_events SET sent=1 WHERE id=?").run(event.id);
    let events = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await request(
        "/rest/v1/wordpop_events?select=id,word,action,reviewed_at,target_id&order=reviewed_at.asc,id.asc&limit=1000&offset=" +
          offset,
      );
      events.push(...page);
      if (page.length < 1000) break;
    }
    events = [
      ...new Map(
        [
          ...events,
          ...db
            .prepare(
              "SELECT id,word,action,reviewed_at,target_id FROM cloud_events WHERE user_id=?",
            )
            .all(session.user.id),
        ].map((event) => [event.id, event]),
      ).values(),
    ];
    const data = baseline[0].state.data,
      seeds = Object.fromEntries(data.progress.map((row) => [row.word, row]));
    const result = fold(seeds, events);
    db.transaction(() => {
      const wordIds = new Map(
        db
          .prepare("SELECT id,word FROM words")
          .all()
          .map((w) => [w.word, w.id]),
      );
      for (const word of new Set(events.map((event) => event.word)))
        if (!result.progress[word] && wordIds.has(word))
          db.prepare("DELETE FROM progress WHERE word_id=?").run(
            wordIds.get(word),
          );
      const cancelled = new Set(
        events
          .filter((event) => event.action === "undo")
          .map((event) => event.target_id),
      );
      for (const id of cancelled) {
        const mapped = db
          .prepare("SELECT history_id FROM cloud_events WHERE id=?")
          .get(id);
        if (mapped?.history_id)
          db.prepare("DELETE FROM review_history WHERE id=?").run(
            mapped.history_id,
          );
      }
      for (const [word, progress] of Object.entries(result.progress)) {
        const id = wordIds.get(word);
        if (!id) continue;
        db.prepare(
          `INSERT INTO progress(word_id,stage,next_review_at,last_review_at,correct_count,wrong_count,mastered_count,efactor,interval,repetitions,fsrs_card) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(word_id) DO UPDATE SET stage=excluded.stage,next_review_at=excluded.next_review_at,last_review_at=excluded.last_review_at,correct_count=excluded.correct_count,wrong_count=excluded.wrong_count,mastered_count=excluded.mastered_count,efactor=excluded.efactor,interval=excluded.interval,repetitions=excluded.repetitions,fsrs_card=excluded.fsrs_card`,
        ).run(
          id,
          progress.stage,
          progress.next_review_at,
          progress.last_review_at || 0,
          progress.correct_count || 0,
          progress.wrong_count || 0,
          progress.mastered_count || 0,
          progress.efactor || 2.5,
          progress.interval || 0,
          progress.repetitions || 0,
          progress.fsrs_card || null,
        );
      }
      for (const log of result.logs) {
        const id = wordIds.get(log.word);
        if (!id) continue;
        let existing = db
          .prepare("SELECT history_id,sent FROM cloud_events WHERE id=?")
          .get(log.id);
        let historyId = existing?.history_id;
        if (historyId)
          db.prepare(
            "UPDATE review_history SET card_before=?,card_after=?,log=? WHERE id=?",
          ).run(log.fsrs_before, log.fsrs_card, log.fsrs_log, historyId);
        else
          historyId = db
            .prepare(
              "INSERT INTO review_history(word_id,reviewed_at,rating,card_before,card_after,log) VALUES(?,?,?,?,?,?)",
            )
            .run(
              id,
              log.reviewed_at,
              log.rating,
              log.fsrs_before,
              log.fsrs_card,
              log.fsrs_log,
            ).lastInsertRowid;
        db.prepare(
          "INSERT OR REPLACE INTO cloud_events VALUES(?,?,?,?,?,?,?,?)",
        ).run(
          log.id,
          session.user.id,
          log.word,
          log.action,
          log.reviewed_at,
          historyId,
          null,
          existing?.sent ?? 1,
        );
      }
      const daily = new Map(
        (data.daily_stats || []).map((row) => [row.date, { ...row }]),
      );
      const { localDateKey } = require("./study-policy");
      for (const log of result.logs) {
        const date = localDateKey(log.reviewed_at);
        const day = daily.get(date) || {
          date,
          words_reviewed: 0,
          words_learned: 0,
        };
        day.words_reviewed++;
        if (log.wasNew) day.words_learned++;
        daily.set(date, day);
      }
      for (const event of events) {
        const date = localDateKey(event.reviewed_at);
        if (!daily.has(date))
          daily.set(date, { date, words_reviewed: 0, words_learned: 0 });
      }
      for (const day of daily.values())
        db.prepare(
          "INSERT OR REPLACE INTO daily_stats(date,words_reviewed,words_learned) VALUES(?,?,?)",
        ).run(day.date, day.words_reviewed, day.words_learned);
    })();
    require("./scheduler").reloadQueue();
    require("./scheduler").emit("stats-updated");
    status = "已同步 · " + new Date().toLocaleTimeString("zh-CN");
    return { message: status };
  } catch (error) {
    status = error.message;
    return { message: status, error: true };
  } finally {
    busy = false;
  }
}
async function login(input) {
  if (busy || authenticating) return { message: "正在连接，请稍后再登录" };
  const url = new URL(input.url);
  if (url.protocol !== "https:")
    return { message: "云服务地址必须使用 HTTPS", error: true };
  const previous = session,
    credentials = { url: url.origin, key: input.key };
  authenticating = true;
  try {
    const response = await request(
      input.signup ? "/auth/v1/signup" : "/auth/v1/token?grant_type=password",
      "POST",
      { email: input.email, password: input.password },
      credentials,
    );
    if (!response.access_token) {
      session = previous;
      return { message: "请查收确认邮件，确认后登录" };
    }
    if (previous?.user?.id && previous.user.id !== response.user.id)
      throw new Error("请先导出当前记录并使用独立本地配置，再切换学习账户");
    session = {
      ...credentials,
      ...response,
      initialBaseline: require("./backup").createBackupData(),
      email: input.email,
      expires_at: Date.now() / 1000 + response.expires_in,
    };
    persist();
    authenticating = false;
    return await sync();
  } catch (error) {
    session = previous;
    return { message: error.message, error: true };
  } finally {
    authenticating = false;
  }
}
function start(database) {
  db = database;
  tables(db);
  try {
    const { safeStorage } = require("electron");
    if (fs.existsSync(sessionFile()) && safeStorage.isEncryptionAvailable())
      session = JSON.parse(
        safeStorage.decryptString(fs.readFileSync(sessionFile())),
      );
  } catch (_) {
    status = "云登录已失效，请重新登录";
  }
  timer = setInterval(() => {
    if (session) sync();
  }, 5000);
  timer.unref();
  if (session) sync();
}
function captureUndo(database, historyId, now = Date.now()) {
  if (!session?.user?.id || !db) return;
  const event = database
    .prepare("SELECT * FROM cloud_events WHERE history_id=? AND user_id=?")
    .get(historyId, session.user.id);
  if (event)
    database
      .prepare("INSERT INTO cloud_events VALUES(?,?,?,?,?,?,?,?)")
      .run(
        crypto.randomUUID(),
        session.user.id,
        event.word,
        "undo",
        now,
        null,
        event.id,
        0,
      );
}
function logout() {
  session = null;
  if (fs.existsSync(sessionFile())) fs.unlinkSync(sessionFile());
  status = "已退出云账户";
}
module.exports = {
  start,
  captureReview,
  captureUndo,
  login,
  sync,
  logout,
  getStatus: () => ({
    message: status,
    url: session?.url,
    email: session?.email,
  }),
};
