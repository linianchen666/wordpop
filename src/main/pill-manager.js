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

let isSnapped = false; // 'left', 'right', or false
let isHovered = false;
const PILL_WIDTH = 160;
const PILL_HEIGHT = 64;
const SNAP_THRESHOLD = 20;
const VISIBLE_EDGE = 24;

function createPillWindow() {
  if (pillWindow && !pillWindow.isDestroyed()) {
    return pillWindow;
  }
  pillReady = false;
  isSnapped = false;
  isHovered = false;

  try {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    let x = pillConfig.x !== null ? pillConfig.x : width - PILL_WIDTH - 40;
    let y = pillConfig.y !== null ? pillConfig.y : height - 120;

    pillWindow = new BrowserWindow({
      width: PILL_WIDTH,
      height: PILL_HEIGHT,
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
      pillWindow.showInactive(); 
      sendConfig();
      fetchWords();
      startTimer();
      checkSnapPosition(); // check if initially snapped
    });

    pillWindow.on('moved', () => {
      if (pillWindow && !pillWindow.isDestroyed()) {
        checkSnapPosition();
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

function checkSnapPosition() {
  if (!pillWindow || pillWindow.isDestroyed()) return;
  const [nx, ny] = pillWindow.getPosition();
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
  
  // 检查是否靠近边缘
  if (nx < SNAP_THRESHOLD && isHovered) {
    isSnapped = 'left';
  } else if (nx + PILL_WIDTH > sw - SNAP_THRESHOLD && isHovered) {
    isSnapped = 'right';
  } else {
    // 只有在拖拽（hover=true）远离边缘时才解除吸附，或者如果已经被挤出去
    if (nx > SNAP_THRESHOLD && nx + PILL_WIDTH < sw - SNAP_THRESHOLD) {
      isSnapped = false;
    }
  }

  if (!isSnapped) {
    pillConfig.x = nx;
    pillConfig.y = ny;
  } else {
    updateSnapBounds();
  }
}

function updateSnapBounds() {
  if (!pillWindow || pillWindow.isDestroyed() || !isSnapped) return;
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
  const [cx, cy] = pillWindow.getPosition();
  
  let targetX = cx;
  if (isSnapped === 'left') {
    targetX = isHovered ? 0 : -(PILL_WIDTH - VISIBLE_EDGE);
  } else if (isSnapped === 'right') {
    targetX = isHovered ? sw - PILL_WIDTH : sw - VISIBLE_EDGE;
  }
  
  if (cx !== targetX) {
    pillWindow.setPosition(targetX, cy);
  }
}

function setHover(hover) {
  isHovered = hover;
  if (isSnapped) {
    updateSnapBounds();
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
    const rows = db.prepare(\
      SELECT w.id, w.word, w.translation, p.wrong_count 
      FROM words w 
      JOIN progress p ON w.id = p.word_id 
      WHERE p.wrong_count > 0 
      ORDER BY p.wrong_count DESC, p.last_review_at DESC 
      LIMIT 100
    \).all();
    
    if (rows && rows.length > 0) {
      wordList = rows;
    } else {
      // Fallback to latest learning words if no wrong words
      wordList = db.prepare(\
        SELECT w.id, w.word, w.translation 
        FROM words w 
        JOIN progress p ON w.id = p.word_id 
        ORDER BY p.last_review_at DESC 
        LIMIT 20
      \).all();
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
  setPosition,
  setHover
};
