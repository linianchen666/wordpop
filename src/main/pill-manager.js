const { BrowserWindow, screen, app } = require('electron');
const path = require('path');
const { getDb } = require('./db');

let pillWindow = null;
let pillReady = false;
let updateTimer = null;
let wordList = [];
let currentIndex = 0;

let pillConfig = {
  enabled: false,
  intervalSeconds: 15,
  theme: 'light',
  autoPronounce: false,
  pronounceVoice: 'dict-us'
};

function getAsarPath(...segments) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar', ...segments);
  }
  return path.join(__dirname, '..', '..', ...segments);
}

const PILL_WIDTH = 140;
const PILL_HEIGHT = 48;

function createPillWindow() {
  if (pillWindow && !pillWindow.isDestroyed()) {
    return pillWindow;
  }
  pillReady = false;

  try {
    const primary = screen.getPrimaryDisplay();
    const { bounds, workArea } = primary;

    // 计算任务栏高度（假设任务栏在底部）
    const taskbarHeight = bounds.height - workArea.height;
    // 将胶囊居中放在任务栏区域内
    const pillX = Math.round(bounds.x + (bounds.width / 2) - (PILL_WIDTH / 2));
    const pillY = Math.round(bounds.y + bounds.height - taskbarHeight + (taskbarHeight - PILL_HEIGHT) / 2);

    pillWindow = new BrowserWindow({
      width: PILL_WIDTH,
      height: PILL_HEIGHT,
      x: pillX,
      y: pillY,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      transparent: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: getAsarPath('src', 'preload', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });

    const htmlPath = getAsarPath('src', 'renderer', 'pill', 'index.html');
    pillWindow.loadFile(htmlPath);

    // 必须用 'screen-saver' 最高层级，才能覆盖显示在任务栏窗口上方
    pillWindow.setAlwaysOnTop(true, 'screen-saver');

    pillWindow.once('ready-to-show', () => {
      pillReady = true;
      pillWindow.showInactive(); 
      sendConfig();
      fetchWords();
      startTimer();
    });

    // 防止点击其他地方后消失：任何导致窗口隐藏/最小化的行为都重新显示
    pillWindow.on('blur', () => {
      if (pillWindow && !pillWindow.isDestroyed() && pillConfig.enabled) {
        // 延迟一帧后重新确保置顶和可见
        setTimeout(() => {
          if (pillWindow && !pillWindow.isDestroyed()) {
            pillWindow.setAlwaysOnTop(true, 'screen-saver');
            pillWindow.showInactive();
          }
        }, 100);
      }
    });

    pillWindow.on('hide', () => {
      if (pillWindow && !pillWindow.isDestroyed() && pillConfig.enabled) {
        setTimeout(() => {
          if (pillWindow && !pillWindow.isDestroyed()) {
            pillWindow.showInactive();
          }
        }, 100);
      }
    });

    pillWindow.on('minimize', (e) => {
      e.preventDefault();
      if (pillWindow && !pillWindow.isDestroyed()) {
        pillWindow.showInactive();
      }
    });

    pillWindow.on('closed', () => {
      pillWindow = null;
      pillReady = false;
      stopTimer();
    });

    return pillWindow;
  } catch (err) {
    console.error('[Pill] create ERROR:', err.message);
    return null;
  }
}

function sendConfig() {
  if (pillWindow && !pillWindow.isDestroyed() && pillReady) {
    pillWindow.webContents.send('pill-data', {
      action: 'updateConfig',
      theme: pillConfig.theme,
      autoPronounce: pillConfig.autoPronounce,
      pronounceVoice: pillConfig.pronounceVoice
    });
  }
}

function fetchWords() {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT w.id, w.word, w.translation, p.wrong_count 
      FROM words w 
      JOIN progress p ON w.id = p.word_id 
      WHERE p.wrong_count > 0 
      ORDER BY p.wrong_count DESC, p.last_review_at DESC 
      LIMIT 100
    `).all();
    
    if (rows && rows.length > 0) {
      wordList = rows;
    } else {
      wordList = db.prepare(`
        SELECT w.id, w.word, w.translation 
        FROM words w 
        JOIN progress p ON w.id = p.word_id 
        ORDER BY p.last_review_at DESC 
        LIMIT 20
      `).all();
    }
    currentIndex = 0;
  } catch (err) {
    console.error('[Pill] fetchWords error:', err.message);
    wordList = [];
  }
}

function showNextWord() {
  if (!pillWindow || pillWindow.isDestroyed() || !pillReady || wordList.length === 0) return;
  
  const word = wordList[currentIndex];
  pillWindow.webContents.send('pill-data', {
    action: 'showWord',
    word: word
  });

  currentIndex = (currentIndex + 1) % wordList.length;
}

function startTimer() {
  stopTimer();
  if (pillConfig.enabled) {
    showNextWord();
    const ms = Math.max(2000, pillConfig.intervalSeconds * 1000);
    updateTimer = setInterval(() => {
      showNextWord();
    }, ms);
  }
}

function stopTimer() {
  if (updateTimer) {
    clearInterval(updateTimer);
    updateTimer = null;
  }
}

function updateConfig(cfg) {
  if (cfg.pillEnabled !== undefined) pillConfig.enabled = cfg.pillEnabled;
  if (cfg.pillIntervalSeconds !== undefined) pillConfig.intervalSeconds = cfg.pillIntervalSeconds;
  if (cfg.theme !== undefined) pillConfig.theme = cfg.theme;
  if (cfg.autoPronounce !== undefined) pillConfig.autoPronounce = cfg.autoPronounce;
  if (cfg.pronounceVoice !== undefined) pillConfig.pronounceVoice = cfg.pronounceVoice;

  if (pillConfig.enabled) {
    if (!pillWindow || pillWindow.isDestroyed()) {
      createPillWindow();
    } else {
      sendConfig();
      startTimer();
    }
  } else {
    if (pillWindow && !pillWindow.isDestroyed()) {
      pillWindow.close();
    }
  }
}

module.exports = {
  updateConfig
};
