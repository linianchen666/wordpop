const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const profile = fs.mkdtempSync(
  path.join(os.tmpdir(), "wordpop-mobile-reveal-"),
);
app.setPath("userData", profile);
async function checkFlow() {
  const check = (value, message) => {
    if (!value) throw Error(message);
  };
  const el = (id) => document.getElementById(id);
  const visible = (id) => el(id).getBoundingClientRect().height > 0;
  window.commands = [];
  window.speeches = [];
  let updateChecks = 0;
  let savedAccount = { signedIn: false, signingOut: false };
  let logouts = 0;
  window.WordPopAndroid = {
    versionName: () => "0.1.4",
    checkUpdates: () => updateChecks++,
    command: (raw) => commands.push(JSON.parse(raw)),
    speakOnReveal: (word) => speeches.push(word),
    account: () => JSON.stringify(savedAccount),
    logout: () => {
      logouts++;
    },
  };
  const v = {
    revision: 1,
    nonce: "first",
    revealed: false,
    word: {
      word: "test",
      phonetic: "/test/",
      translationPreview: "n. 测试",
      translation: "n. 测试",
    },
    dueCount: 20,
    spreadCount: 19,
    newRemaining: 5,
    quota: { reason: "" },
    intervals: { unknown: 60000, fuzzy: 60000, known: 600000, easy: 86400000 },
    state: {
      config: {
        selectedWordlists: ["cet4"],
        dailyNewWordsMode: "fixed",
        dailyNewWords: 20,
      },
    },
  };
  render(v);
  notice("已同步 · 12:30");
  check(
    !visible("cloudStatus"),
    "study page must not show background sync status",
  );
  check(
    el("meaning").hidden && el("meaning").textContent === "",
    "recall should not repeat instructional copy",
  );
  check(
    el("reveal").textContent === "显示释义",
    "reveal button should use just four characters",
  );
  check(speeches.length === 0, "word appearance must stay silent");
  el("reveal").click();
  check(
    speeches.length === 1 && speeches[0] === "test",
    "reveal must speak current word",
  );
  check(visible("ratings"), "buttons wait for native reply");
  check(
    el("meaning").textContent === "n. 测试",
    "meaning waits for native reply",
  );
  check(!el("easy").disabled, "easy star remains disabled after reveal");
  receive(v, null, "");
  check(visible("ratings"), "queued poll hid optimistic reveal");
  await new Promise((resolve) => setTimeout(resolve, 500));
  check(visible("ratings"), "slow native engine hid immediate buttons");
  el("known").click();
  rate("known");
  check(
    commands.filter((c) => c.type === "review").length === 1,
    "rapid taps created duplicate ratings",
  );
  check(commands[1].nonce === "first", "review lost original nonce");
  check(el("known").disabled, "rating pending state is not locked");
  receive(
    { ...v, revision: 2, revealed: true },
    null,
    commands[0].clientRequestId,
  );
  check(el("known").disabled, "reveal reply unlocked pending review");
  const next = {
    ...v,
    revision: 3,
    nonce: "second",
    word: { ...v.word, word: "next" },
    undo: { id: "first-rating", word: "test", action: "known" },
  };
  receive(next, null, commands[1].clientRequestId);
  check(speeches.length === 1, "review switching words must not auto speak");
  check(
    el("word").textContent === "next" && !visible("ratings"),
    "review did not show next recall card",
  );
  receive({ ...v, revision: 2, revealed: true }, null, "");
  check(el("word").textContent === "next", "old callback restored prior word");
  check(visible("undo"), "grading must expose a touch undo control");
  el("undo").click();
  undoReview();
  check(
    commands.filter((c) => c.type === "undo").length === 1,
    "rapid taps duplicated undo",
  );
  check(
    commands.at(-1).target_id === "first-rating",
    "undo did not bind the exact rating",
  );
  check(el("undo").disabled, "undo must lock while native save is pending");
  receive(null, "撤销保存失败", commands.at(-1).clientRequestId);
  check(
    !el("undo").disabled && el("word").textContent === "next",
    "failed undo should retain the current card and allow retry",
  );
  el("undo").click();
  const undoRequest = commands.at(-1);
  receive(
    { ...v, revision: 4, nonce: "restored", revealed: true, undo: null },
    null,
    undoRequest.clientRequestId,
  );
  check(
    el("word").textContent === "test" && visible("ratings"),
    "undo should return the prior word ready for correction",
  );
  check(!visible("undo"), "undo should be offered only once");
  check(speeches.length === 1, "undo must not auto speak");
  receive({ ...next, revision: 3 }, null, "");
  check(
    el("word").textContent === "test",
    "stale sync callback overwrote the restored word",
  );
  receive({ ...next, revision: 5, undo: null }, null, "");
  el("reveal").click();
  receive(null, "写入失败", commands.at(-1).clientRequestId);
  check(!visible("ratings"), "failed reveal was not rolled back");
  check(
    el("studyNotice").textContent === "写入失败" && visible("studyNotice"),
    "native error was hidden",
  );
  el("menu").click();
  check(
    el("appVersion").textContent === "当前版本：0.1.4",
    "installed Android version missing",
  );
  el("checkUpdates").click();
  check(updateChecks === 1, "update menu must call the native checker");
  el("spreadOverdue").click();
  check(
    el("spreadDialog").open && el("spreadCount").textContent.includes("19"),
    "spread menu should show eligible count",
  );
  el("spreadDays").value = "5";
  el("spreadConfirm").click();
  confirmSpread();
  const spreadRequest = commands.at(-1);
  check(
    spreadRequest.type === "spread" && spreadRequest.days === 5,
    "spread selection must reach native engine",
  );
  check(
    commands.filter((c) => c.type === "spread").length === 1 &&
      el("spreadConfirm").disabled,
    "pending spread should block duplicate requests",
  );
  receive(null, "平摊保存失败", spreadRequest.clientRequestId);
  check(
    el("spreadDialog").open &&
      !el("spreadConfirm").disabled &&
      !el("spreadNotice").hidden,
    "failure should keep dialog available for retry",
  );
  el("spreadConfirm").click();
  receive(
    {
      ...next,
      revision: 6,
      dueCount: 5,
      spreadCount: 4,
      spreadResult: { count: 19, days: 5 },
    },
    null,
    commands.at(-1).clientRequestId,
  );
  check(
    !el("spreadDialog").open && el("settingsNotice").textContent.includes("19"),
    "spread needs confirmed feedback",
  );
  check(
    el("word").textContent === "next" && el("counts").textContent.includes("5"),
    "spread should preserve card and refresh counts",
  );
  const cloud = [...document.querySelectorAll("#settings > details")].find(
    (d) => d.querySelector("summary")?.textContent.includes("云同步"),
  );
  cloud.open = true;
  check(
    visible("email") && !visible("logoutButton"),
    "signed-out account should offer login only",
  );
  check(
    !visible("url") && !visible("key"),
    "project configuration should start hidden",
  );
  check(
    !document.body.textContent.includes("三星折叠外屏"),
    "outer-screen help should not be a setting",
  );
  const logins = [];
  WordPopAndroid.login = (raw, signup) =>
    logins.push({ ...JSON.parse(raw), signup });
  el("email").value = "user@example.com";
  el("password").value = "example-password";
  el("loginButton").click();
  login(false);
  check(logins.length === 1, "duplicate login was submitted");
  check(
    el("password").value === "example-password",
    "password disappeared before validation",
  );
  check(
    el("loginButton").disabled && el("authStatus").textContent.includes("验证"),
    "login lacks busy feedback",
  );
  authResult({
    id: logins[0].requestId,
    phase: "error",
    message: "邮箱或密码不正确",
  });
  check(
    !el("loginButton").disabled && el("password").value === "example-password",
    "error should retain password for correction",
  );
  el("showPassword").click();
  check(el("password").type === "text", "password visibility toggle failed");
  el("loginButton").click();
  savedAccount = { signedIn: true, displayName: "用户昵称", signingOut: false };
  authResult({
    id: logins[1].requestId,
    phase: "authenticated",
    message: "登录成功，正在同步",
    account: savedAccount,
  });
  check(
    el("password").value === "" &&
      el("authStatus").textContent.includes("登录成功"),
    "success must be shown before sync completion",
  );
  check(
    el("loginButton").disabled,
    "login must stay locked during initial sync",
  );
  check(
    visible("accountCard") &&
      el("accountName").textContent === "用户昵称" &&
      !visible("email") &&
      !visible("password") &&
      !visible("signupButton") &&
      visible("logoutButton") &&
      el("logoutButton").disabled,
    "validated login should show the account and hide credentials before sync completes",
  );
  authResult({
    id: logins[1].requestId,
    phase: "complete",
    message: "已登录，但同步失败：网络不可用",
    account: savedAccount,
  });
  check(!el("loginButton").disabled, "sync completion must release controls");
  check(
    !visible("email") &&
      !el("logoutButton").disabled &&
      el("cloudStatus").textContent.includes("同步失败"),
    "sync failure must not sign the user out or bring back the password form",
  );
  login(false);
  check(
    logins.length === 2,
    "hidden login entry must not submit another authentication",
  );
  el("settings").close();
  notice("已同步 · 12:31");
  check(!visible("cloudStatus"), "sync polling must never restore the footer");
  el("menu").click();
  check(
    el("accountName").textContent === "用户昵称" && !visible("email"),
    "reopening settings must restore the saved account instead of the login form",
  );
  el("logoutButton").click();
  logout();
  check(
    logouts === 1 && el("logoutButton").disabled,
    "sign-out must prevent repeated taps",
  );
  accountStatus({ ...savedAccount, signingOut: true }, "已同步");
  check(
    el("cloudStatus").textContent === "正在退出账户…",
    "late sync status must not hide sign-out progress",
  );
  savedAccount = { signedIn: false, signingOut: false };
  accountStatus(savedAccount, "已退出账户，本地学习记录已保留");
  check(
    visible("email") &&
      !visible("accountCard") &&
      !visible("logoutButton") &&
      el("email").value === "" &&
      el("password").value === "" &&
      !el("loginButton").disabled,
    "completed sign-out must clear credentials and restore login controls",
  );
  authResult({
    id: logins[1].requestId,
    phase: "complete",
    message: "旧的登录回调",
    account: { signedIn: true, displayName: "过期账户" },
  });
  check(
    !visible("accountCard"),
    "late login callback must not restore a signed-out account",
  );
  // Cold start with a persisted account must work without another login callback.
  savedAccount = {
    signedIn: true,
    displayName: "<b>旧账户</b>",
    signingOut: false,
  };
  el("settings").close();
  el("menu").click();
  check(
    el("accountName").textContent === "<b>旧账户</b>" &&
      !el("accountName").querySelector("b") &&
      !visible("email"),
    "restored names must use text and keep credentials hidden",
  );
  WordPopAndroid.logout = () => {
    throw Error("bridge failed");
  };
  el("logoutButton").click();
  check(
    !el("logoutButton").disabled && visible("accountCard"),
    "failed sign-out must retain the account and allow retry",
  );
  el("settings").close();
  WordPopAndroid.command = () => {
    throw Error("bridge failed");
  };
  el("reveal").click();
  check(!visible("ratings"), "bridge error left fake revealed state");
}
async function checkDesktop() {
  let resolveLogin;
  const logins = [];
  ipcMain.handle("cloud:status", () => ({ message: "未连接" }));
  ipcMain.handle("cloud:login", (_event, input) => {
    logins.push(input);
    return new Promise((resolve) => {
      resolveLogin = resolve;
    });
  });
  const win = new BrowserWindow({
    show: false,
    width: 560,
    height: 680,
    webPreferences: {
      preload: path.join(__dirname, "../../src/preload/preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  async function until(fn) {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      if (await fn()) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw Error("Desktop auth check timed out");
  }
  try {
    await win.loadFile(
      path.join(__dirname, "../../src/renderer/cloud/index.html"),
    );
    await until(() =>
      win.webContents.executeJavaScript(
        'document.getElementById("status").textContent === "未连接"',
      ),
    );
    await win.webContents.executeJavaScript(`
      if(document.getElementById("url").getBoundingClientRect().height)throw Error("desktop project should be hidden");
      document.getElementById("email").value="user@example.com";
      document.getElementById("password").value="example-password";
      document.getElementById("login").click();document.getElementById("signup").click();
      if(document.getElementById("password").value!=="example-password")throw Error("desktop cleared password too early");
      if(!document.getElementById("login").disabled || !document.getElementById("signup").disabled)throw Error("desktop permits duplicate auth");
    `);
    await until(() => logins.length === 1);
    resolveLogin({ error: true, message: "密码不正确" });
    await until(() =>
      win.webContents.executeJavaScript(
        '!document.getElementById("login").disabled',
      ),
    );
    await win.webContents.executeJavaScript(
      `if(document.getElementById("password").value!=="example-password")throw Error("desktop should retain rejected password");document.getElementById("login").click()`,
    );
    await until(() => logins.length === 2);
    resolveLogin({ authenticated: true, message: "已同步" });
    await until(() =>
      win.webContents.executeJavaScript(
        'document.getElementById("password").value === ""',
      ),
    );
  } finally {
    win.destroy();
    ipcMain.removeHandler("cloud:status");
    ipcMain.removeHandler("cloud:login");
  }
}

app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({
      show: false,
      width: 412,
      height: 430,
      useContentSize: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    const errors = [];
    win.webContents.on("console-message", (_event, level, message) => {
      if (level === 3) errors.push(message);
    });
    await win.loadFile(
      path.join(__dirname, "../../android/app/src/main/assets/index.html"),
    );
    await win.webContents.executeJavaScript(`(${checkFlow.toString()})()`);
    if (errors.length) throw Error(errors.join("; "));
    console.log(
      "Android reveal Chromium checks passed: instant buttons, 500ms native delay, queued polls, duplicate taps, ordered replies and failure rollback.",
    );
    win.destroy();
    await checkDesktop();
    fs.rmSync(profile, { recursive: true, force: true });
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    fs.rmSync(profile, { recursive: true, force: true });
    app.exit(1);
  });
