const fs = require("fs"),
  path = require("path"),
  crypto = require("crypto");
const { fold } = require("../shared/learning-core");
const { downloadJournal } = require("./cloud-journal");
const learningSettings = require("../shared/learning-settings");
const scheduleStore = require("./review-schedule-store");
const SETTINGS_ROUTE =
  "/rest/v1/wordpop_current_settings?select=setting_key,value,id&limit=3";
let session = null,
  timer = null,
  busy = false,
  authenticating = false,
  followupTimer = null,
  syncAgain = false,
  generation = 0,
  cachedBaseline = null,
  appliedFingerprint = null,
  downloadCache = null,
  appliedWordKey = null,
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
    `CREATE TABLE IF NOT EXISTS cloud_events(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,word TEXT NOT NULL,action TEXT NOT NULL,reviewed_at INTEGER NOT NULL,history_id INTEGER,target_id TEXT,sent INTEGER DEFAULT 0);
     CREATE INDEX IF NOT EXISTS cloud_events_outbox ON cloud_events(user_id,sent);
     CREATE INDEX IF NOT EXISTS cloud_events_history ON cloud_events(user_id,history_id);
     CREATE TABLE IF NOT EXISTS cloud_download_cache(owner TEXT PRIMARY KEY,snapshot TEXT NOT NULL);
     CREATE TABLE IF NOT EXISTS cloud_learning_settings(owner TEXT PRIMARY KEY,state TEXT NOT NULL);`,
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
  queueSync();
}
function queueSync(delay = 10000) {
  if (!session) return;
  if (busy) {
    syncAgain = true;
    return;
  }
  if (followupTimer && delay > 0) return;
  if (followupTimer) clearTimeout(followupTimer);
  followupTimer = setTimeout(() => {
    followupTimer = null;
    sync({ background: true });
  }, delay);
  followupTimer.unref();
}
function settingsState(owner) {
  const row = db
    .prepare("SELECT state FROM cloud_learning_settings WHERE owner=?")
    .get(owner);
  return row ? JSON.parse(row.state) : { pending: {}, initialized: false };
}
function saveSettingsState(owner, state) {
  const serialized = JSON.stringify(state);
  if (
    db
      .prepare("SELECT state FROM cloud_learning_settings WHERE owner=?")
      .get(owner)?.state === serialized
  )
    return;
  db.prepare("INSERT OR REPLACE INTO cloud_learning_settings VALUES(?,?)").run(
    owner,
    serialized,
  );
}
function captureSettings(before, after) {
  if (!session?.user?.id || !db) return;
  const owner = session.url + ":" + session.user.id;
  const previous = settingsState(owner);
  const next = learningSettings.capture(
    previous,
    before,
    after,
    crypto.randomUUID(),
  );
  if (JSON.stringify(previous.pending) === JSON.stringify(next.pending)) return;
  saveSettingsState(owner, next);
  queueSync(0);
}
function captureSchedules(database, changes) {
  scheduleStore.capture(
    database,
    changes,
    session?.user?.id ? session.url + ":" + session.user.id : null,
  );
  queueSync(0);
}
async function syncSchedules(fetch, owner, background) {
  try {
    return await scheduleStore.sync(
      fetch,
      db,
      owner,
      session.user.id,
      !background,
      () => {
        require("./scheduler").reloadQueue();
        require("./scheduler").emit("stats-updated");
      },
    );
  } catch (error) {
    if (!session || error.message === "云账户已退出，停止同步") throw error;
    return "；复习平摊安排未同步：" + error.message;
  }
}
async function syncSettings(fetch, owner) {
  const config = require("./config");
  let state = settingsState(owner);
  const rows = await fetch(SETTINGS_ROUTE);
  if (!Array.isArray(rows)) throw new Error("云端学习设置响应无效");
  state = settingsState(owner);
  // The first upgraded Windows client seeds current preferences, rather than an
  // old baseline. Android waits for these unless its user explicitly edits them.
  if (!state.initialized) {
    const seeded = learningSettings.seed(
      state,
      config.loadConfig(),
      crypto.randomUUID(),
    );
    const pending = { ...state.pending };
    for (const key of learningSettings.GROUPS)
      if (!rows.some((row) => row.setting_key === key) && !pending[key])
        pending[key] = seeded.pending[key];
    state = { ...state, pending };
    saveSettingsState(owner, state);
  }
  const sent = learningSettings.upload(state, session.user.id);
  if (sent.length)
    await fetch(
      "/rest/v1/wordpop_settings_changes?on_conflict=id,setting_key",
      "POST",
      sent,
    );
  const latest = sent.length ? await fetch(SETTINGS_ROUTE) : rows;
  const result = learningSettings.apply(
    settingsState(owner),
    config.loadConfig(),
    latest,
    sent,
  );
  if (result.changed) {
    const { importWordlist } = require("./db");
    for (const id of result.config.selectedWordlists) {
      if (
        !db
          .prepare("SELECT COUNT(*) n FROM word_wordlists WHERE wordlist=?")
          .get(id).n
      )
        importWordlist(id);
    }
    const saved = config.saveConfig({
      selectedWordlists: result.config.selectedWordlists,
      dailyNewWordsMode: result.config.dailyNewWordsMode,
      dailyNewWords: result.config.dailyNewWords,
      targetDate: result.config.targetDate,
      autoBalanceLoad: result.config.autoBalanceLoad,
    });
    if (!saved.success) throw new Error(saved.error || "保存云端学习设置失败");
    require("./scheduler").applyConfig(saved.config);
    require("./popup-manager").updateConfig(saved.config);
    require("./ambient-pill").updateConfig(saved.config);
    const { BrowserWindow } = require("electron");
    for (const window of BrowserWindow.getAllWindows())
      if (!window.isDestroyed())
        window.webContents.send("config:changed", saved.config);
  }
  saveSettingsState(owner, { ...result.state, initialized: true });
  return Object.keys(result.state.pending).length ? "；学习设置等待上传" : "";
}
function pendingCount() {
  return session && db
    ? db
        .prepare(
          "SELECT COUNT(*) n FROM cloud_events WHERE user_id=? AND sent=0",
        )
        .get(session.user.id).n
    : 0;
}
async function request(
  route,
  method = "GET",
  body,
  credentials = session,
  countOnly = false,
) {
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
        Prefer: countOnly
          ? "count=exact"
          : "resolution=ignore-duplicates,return=minimal",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      let code;
      try {
        code = JSON.parse(text).error_code || JSON.parse(text).code;
      } catch (_) {}
      if (
        route.startsWith("/rest/v1/wordpop_review_schedules") ||
        route.startsWith("/rest/v1/wordpop_current_review_schedules")
      ) {
        if (["PGRST205", "42P01"].includes(code) || response.status === 404)
          throw new Error(
            "复习平摊云表尚未配置，请执行新版 cloud/supabase.sql",
          );
        throw new Error(
          `复习平摊请求失败（HTTP ${response.status}${/^[A-Za-z0-9_]{1,64}$/.test(code || "") ? " / " + code : ""}）`,
        );
      }
      if (
        route.startsWith("/rest/v1/wordpop_current_settings") ||
        route.startsWith("/rest/v1/wordpop_settings_changes")
      ) {
        if (["PGRST205", "42P01"].includes(code))
          throw new Error(
            "学习设置云表尚未配置，请执行新版 cloud/supabase.sql",
          );
        throw new Error(
          `学习设置请求失败（HTTP ${response.status}${/^[A-Za-z0-9_]{1,64}$/.test(code || "") ? " / " + code : ""}）`,
        );
      }
      const messages = {
        email_not_confirmed:
          "邮箱尚未确认。请点击确认邮件中的链接，再回到软件登录；若最后跳到 localhost 并打不开，邮箱可能已确认，可再次尝试登录。",
        invalid_credentials: "邮箱或密码不正确，请检查后重试。",
        user_already_exists: "此邮箱已注册，请直接登录。",
        email_exists: "此邮箱已注册，请直接登录。",
        weak_password: "密码不符合项目要求，请使用更长、更复杂的密码。",
        signup_disabled:
          "项目未开放注册，请在 Supabase Authentication 设置中启用用户注册。",
        over_email_send_rate_limit:
          "确认邮件发送太频繁或邮件额度已用完，请稍后再试。",
        over_request_rate_limit: "请求过于频繁，请稍后再试。",
        email_address_invalid: "邮箱格式不正确，请检查邮箱地址。",
        email_address_not_authorized:
          "当前邮件服务不允许发送到此邮箱，请在 Supabase 配置自定义 SMTP。",
      };
      throw new Error(
        messages[code] ||
          `云服务请求失败（${response.status}），请检查账户和数据库配置`,
      );
    }
    if (countOnly) {
      const range = response.headers?.get("Content-Range");
      return range && /\/\d+$/.test(range)
        ? Number(range.split("/").pop())
        : null;
    }
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timeout);
  }
}
async function sync({ background = false } = {}) {
  if (!session) return { message: "请先登录云账户" };
  if (authenticating) return { message: "正在登录" };
  if (busy) {
    if (!background) syncAgain = true;
    return { message: "正在同步学习记录…" };
  }
  clearTimeout(followupTimer);
  followupTimer = null;
  busy = true;
  syncAgain = false;
  const activeGeneration = generation;
  let succeeded = false;
  const checkSession = () => {
    if (generation !== activeGeneration || !session)
      throw new Error("云账户已退出，停止同步");
  };
  const fetch = async (...args) => {
    const result = await request(...args);
    checkSession();
    return result;
  };
  status = "正在同步学习记录…";
  try {
    if (session.expires_at < Date.now() / 1000 + 60) {
      const fresh = await fetch(
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
    let baseline =
      cachedBaseline ||
      (await fetch("/rest/v1/wordpop_baseline?select=state&limit=1"));
    if (!baseline.length) {
      const snapshot =
        session.initialBaseline || require("./backup").createBackupData();
      await fetch("/rest/v1/wordpop_baseline?on_conflict=user_id", "POST", {
        user_id: session.user.id,
        state: snapshot,
      });
      baseline = await fetch("/rest/v1/wordpop_baseline?select=state&limit=1");
    }
    if (!baseline.length) throw new Error("云端初始记录尚未建立，请稍后重试");
    cachedBaseline = baseline;
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
      await fetch(
        "/rest/v1/wordpop_events?on_conflict=id",
        "POST",
        upload.map((event) => ({ ...event, user_id: session.user.id })),
      );
    for (const event of upload)
      db.prepare("UPDATE cloud_events SET sent=1 WHERE id=?").run(event.id);
    const owner = session.url + ":" + session.user.id;
    let settingsWarning = "";
    try {
      settingsWarning = await syncSettings(fetch, owner);
    } catch (error) {
      checkSession();
      settingsWarning = "；学习设置未同步：" + error.message;
    }
    const wordRows = db.prepare("SELECT id,word FROM words ORDER BY id").all();
    const wordKey = JSON.stringify(wordRows);
    if (!downloadCache || downloadCache.owner !== owner) {
      let snapshot = null;
      try {
        snapshot = JSON.parse(
          db
            .prepare("SELECT snapshot FROM cloud_download_cache WHERE owner=?")
            .get(owner)?.snapshot || "null",
        );
      } catch (_) {}
      downloadCache = { owner, snapshot };
    }
    const journal = await downloadJournal(fetch, {
      snapshot: downloadCache.snapshot,
      forceFull: !background,
    });
    if (
      !journal.downloaded &&
      appliedWordKey === wordKey &&
      !upload.length &&
      !pendingCount()
    ) {
      status =
        "已同步 · " +
        new Date().toLocaleTimeString("zh-CN") +
        settingsWarning +
        (await syncSchedules(fetch, owner, background));
      succeeded = true;
      return { message: status };
    }
    let events = journal.events;
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
    const fingerprint = crypto
      .createHash("sha256")
      .update(
        JSON.stringify([
          data,
          wordRows,
          [...events]
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((e) => [
              e.id,
              e.word,
              e.action,
              e.reviewed_at,
              e.target_id || null,
            ]),
        ]),
      )
      .digest("hex");
    if (fingerprint !== appliedFingerprint) {
      const result = fold(seeds, events);
      db.transaction(() => {
        const wordIds = new Map(wordRows.map((w) => [w.word, w.id]));
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
        // Persist every event, including undo tombstones and words not installed locally.
        // Repeated pulls must never resurrect a cancelled review or duplicate a local event.
        for (const event of events)
          db.prepare(
            "INSERT OR IGNORE INTO cloud_events VALUES(?,?,?,?,?,?,?,?)",
          ).run(
            event.id,
            session.user.id,
            event.word,
            event.action,
            event.reviewed_at,
            null,
            event.target_id || null,
            1,
          );
        for (const [word, progress] of Object.entries(result.progress)) {
          const id = wordIds.get(word);
          if (!id) continue;
          const current = db
            .prepare("SELECT * FROM progress WHERE word_id=?")
            .get(id);
          // Backlog spreading is a local queue adjustment, not a review. Preserve
          // it while the underlying memory is identical; a new review replaces it.
          const sameMemory =
            current &&
            [
              "stage",
              "last_review_at",
              "correct_count",
              "wrong_count",
              "mastered_count",
              "efactor",
              "interval",
              "repetitions",
              "fsrs_card",
            ].every(
              (key) => (current[key] ?? null) === (progress[key] ?? null),
            );
          const nextReview = sameMemory
            ? Math.max(current.next_review_at, progress.next_review_at)
            : progress.next_review_at;
          db.prepare(
            `INSERT INTO progress(word_id,stage,next_review_at,last_review_at,correct_count,wrong_count,mastered_count,efactor,interval,repetitions,fsrs_card) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(word_id) DO UPDATE SET stage=excluded.stage,next_review_at=excluded.next_review_at,last_review_at=excluded.last_review_at,correct_count=excluded.correct_count,wrong_count=excluded.wrong_count,mastered_count=excluded.mastered_count,efactor=excluded.efactor,interval=excluded.interval,repetitions=excluded.repetitions,fsrs_card=excluded.fsrs_card`,
          ).run(
            id,
            progress.stage,
            nextReview,
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
      appliedFingerprint = fingerprint;
      appliedWordKey = wordKey;
    }
    // Advance the durable download checkpoint only after the merge succeeds.
    if (journal.snapshot !== downloadCache.snapshot) {
      if (journal.snapshot)
        db.prepare(
          "INSERT OR REPLACE INTO cloud_download_cache VALUES(?,?)",
        ).run(owner, JSON.stringify(journal.snapshot));
      else
        db.prepare("DELETE FROM cloud_download_cache WHERE owner=?").run(owner);
      downloadCache = { owner, snapshot: journal.snapshot };
    }
    const pending = pendingCount();
    status = pending
      ? `已保存本地 · ${pending} 条记录等待上传`
      : "已同步 · " + new Date().toLocaleTimeString("zh-CN");
    status += settingsWarning;
    status += await syncSchedules(fetch, owner, background);
    succeeded = true;
    return { message: status };
  } catch (error) {
    if (generation === activeGeneration) {
      const pending = pendingCount();
      status = pending
        ? `已保存本地 · ${pending} 条记录等待联网重试：${error.message}`
        : "同步失败，将自动重试：" + error.message;
    }
    return { message: status, error: true };
  } finally {
    busy = false;
    if (
      succeeded &&
      generation === activeGeneration &&
      (syncAgain || pendingCount())
    )
      queueSync();
  }
}
async function login(input) {
  if (busy || authenticating) return { message: "正在连接，请稍后再登录" };
  const previous = session;
  authenticating = true;
  status = "正在验证账号和密码，请稍候…";
  try {
    const credentials = authCredentials(input);
    const email = authEmail(input);
    if (typeof input.password !== "string" || !input.password)
      throw new Error("请填写密码");
    if (input.signup && input.password.length < 6)
      throw new Error("注册密码至少需要 6 个字符，建议使用 8 个以上字符");
    const response = await request(
      input.signup ? "/auth/v1/signup" : "/auth/v1/token?grant_type=password",
      "POST",
      { email, password: input.password },
      credentials,
    );
    if (!response.access_token) {
      session = previous;
      status =
        "注册请求已提交，请查收确认邮件（包括垃圾邮件），点击链接后回到软件登录。若最后跳到 localhost 并打不开，可先尝试登录；已有账户请直接登录。";
      return { message: status, authenticated: false };
    }
    if (previous?.user?.id && previous.user.id !== response.user.id)
      throw new Error("请先导出当前记录并使用独立本地配置，再切换学习账户");
    session = {
      ...credentials,
      ...response,
      initialBaseline: require("./backup").createBackupData(),
      email,
      expires_at: Date.now() / 1000 + response.expires_in,
    };
    generation++;
    cachedBaseline = null;
    appliedFingerprint = null;
    downloadCache = null;
    appliedWordKey = null;
    persist();
    authenticating = false;
    status = "登录成功，密码验证通过；正在同步学习记录…";
    const result = await sync();
    return {
      ...result,
      authenticated: true,
      message: result.error
        ? "已登录，但同步失败：" + result.message
        : result.message,
    };
  } catch (error) {
    session = previous;
    status = error.message;
    return { message: error.message, error: true };
  } finally {
    authenticating = false;
  }
}
function authCredentials(input) {
  let url;
  try {
    url = new URL(String(input.url || "").trim());
  } catch (_) {
    throw new Error("请填写有效的 Supabase 项目网址");
  }
  if (url.protocol !== "https:") throw new Error("云服务地址必须使用 HTTPS");
  const key = String(input.key || "").trim();
  if (!key) throw new Error("请填写项目公开 API 密钥");
  return { url: url.origin, key };
}
function authEmail(input) {
  const email = String(input.email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("请填写有效的邮箱地址");
  return email;
}
async function resendConfirmation(input) {
  if (busy || authenticating) return { message: "正在连接，请稍后再试" };
  authenticating = true;
  try {
    await request(
      "/auth/v1/resend",
      "POST",
      { type: "signup", email: authEmail(input) },
      authCredentials(input),
    );
    return {
      message:
        "已提交重新发送请求，请查收最新确认邮件。若已确认，请直接登录；发送受项目邮件额度限制。",
    };
  } catch (error) {
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
    if (session && !followupTimer) sync({ background: true });
  }, 15000);
  timer.unref();
  if (session) sync({ background: true });
}
function captureUndo(database, historyId, now = Date.now()) {
  if (!session?.user?.id || !db) return;
  const event = database
    .prepare("SELECT * FROM cloud_events WHERE history_id=? AND user_id=?")
    .get(historyId, session.user.id);
  if (event) {
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
    queueSync();
  }
}
function logout() {
  generation++;
  cachedBaseline = null;
  appliedFingerprint = null;
  downloadCache = null;
  appliedWordKey = null;
  clearTimeout(followupTimer);
  followupTimer = null;
  syncAgain = false;
  session = null;
  if (fs.existsSync(sessionFile())) fs.unlinkSync(sessionFile());
  status = "已退出云账户";
}
module.exports = {
  start,
  captureReview,
  captureUndo,
  captureSettings,
  captureSchedules,
  login,
  resendConfirmation,
  sync,
  logout,
  getStatus: () => ({
    message:
      pendingCount() && !busy && !status.includes("等待")
        ? `已保存本地 · ${pendingCount()} 条记录等待上传`
        : status,
    pending: pendingCount(),
    syncing: busy,
    url: session?.url,
    key: session?.key,
    email: session?.email,
  }),
};
