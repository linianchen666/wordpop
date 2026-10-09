const { BrowserWindow, screen } = require('electron');
const { createAmbientPill } = require('./ambient-pill-window');
const { loadConfig } = require('./config');
const { getDb } = require('./db');
const { getAmbientWords } = require('./ambient-words');

module.exports = createAmbientPill({ BrowserWindow, screen, getConfig: loadConfig,
  getWords: lists => getAmbientWords(getDb(), lists) });
