const { BrowserWindow, app } = require('electron');
const scheduler = require('./scheduler');
const popupManager = require('./popup-manager');
const { createFocusWindow } = require('./focus-window');
const { createFocusSession } = require('./focus-session');
const { createLearningRepository } = require('./learning-repository');
const { getDb } = require('./db');
const { recordReview } = require('./review-progress');

const session = createFocusSession({
  repository: createLearningRepository(getDb),
  recordReview: (wordId, action, now) => recordReview(getDb(), wordId, action, now)
});

// Keep the public entry point stable while separating UI lifecycle from learning.
const focusWindow = createFocusWindow({
  BrowserWindow,
  app,
  hidePopup() {
    if (popupManager.isVisible()) popupManager.hide();
  },
  onClose() {
    scheduler.reloadQueue();
  }
});

module.exports = {
  openFocusWindow: focusWindow.openFocusWindow,
  closeFocusWindow: focusWindow.closeFocusWindow,
  getFocusWords: session.getFocusWords,
  submitFocusWord: session.submitFocusWord
};
