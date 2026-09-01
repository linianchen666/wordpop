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
  x: null,
  y: null,
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

function createPillWindow() {
  if (pillWindow && !pillWindow.isDestroyed()) {
    return pillWindow;
  }
  pillReady = false;

  try {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    let x = pillConfig.x !== null ? pillConfig.x : width - 340;
    let y = pillConfig.y !== null ? pillConfig.y : height - 80;

    pillWindow = new BrowserWindow({
      width: 320,
      height: 56,
      x: x,
      y: y,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      transparent: true,
      hasShadow: true,
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

    pillWindow.once('ready-to-show', () => {
      pillReady = true;
      pillWindow.showInactive(); // Use showInactive to avoid stealing focus
      sendConfig();
      fetchWords();
      startTimer();
    });

    pillWindow.on('moved', () => {
      if (pillWindow && !pillWindow.isDestroyed()) {
        const [nx, ny] = pillWindow.getPosition();
        pillConfig.x = nx;
        pillConfig.y = ny;
        // Optionally save to config file via config.js here
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
    // Fetch stubborn words (wrong_count > 0, order by wrong_count DESC)
    const rows = db.prepare(
      SELECT w.id, w.word, w.translation, p.wrong_count 
      FROM words w 
      JOIN progress p ON w.id = p.word_id 
      WHERE p.wrong_count > 0 
      ORDER BY p.wrong_count DESC, p.last_review_at DESC 
      LIMIT 100
    ).all();
    
    if (rows && rows.length > 0) {
      wordList = rows;
    } else {
      // Fallback to latest learning words if no wrong words
      wordList = db.prepare(
        SELECT w.id, w.word, w.translation 
        FROM words w 
        JOIN progress p ON w.id = p.word_id 
        ORDER BY p.last_review_at DESC 
        LIMIT 20
      ).all();
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

function getPosition() {
  return { x: pillConfig.x, y: pillConfig.y };
}

function setPosition(x, y) {
  pillConfig.x = x;
  pillConfig.y = y;
}

module.exports = {
  updateConfig,
  getPosition,
  setPosition
};
