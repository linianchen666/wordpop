const { app, BrowserWindow } = require("electron");
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
  window.WordPopAndroid = { command: (raw) => commands.push(JSON.parse(raw)) };
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
  el("reveal").click();
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
  };
  receive(next, null, commands[1].clientRequestId);
  check(
    el("word").textContent === "next" && !visible("ratings"),
    "review did not show next recall card",
  );
  receive({ ...v, revision: 2, revealed: true }, null, "");
  check(el("word").textContent === "next", "old callback restored prior word");
  el("reveal").click();
  receive(null, "写入失败", commands.at(-1).clientRequestId);
  check(!visible("ratings"), "failed reveal was not rolled back");
  check(
    el("cloudStatus").textContent === "写入失败",
    "native error was hidden",
  );
  WordPopAndroid.command = () => {
    throw Error("bridge failed");
  };
  el("reveal").click();
  check(!visible("ratings"), "bridge error left fake revealed state");
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
    fs.rmSync(profile, { recursive: true, force: true });
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    fs.rmSync(profile, { recursive: true, force: true });
    app.exit(1);
  });
