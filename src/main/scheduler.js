// Runtime composition: the scheduler core does not import Electron or execute SQL.
const { createScheduler } = require('./study-scheduler');
const { createLearningRepository } = require('./learning-repository');
const { getDb } = require('./db');
const { loadConfig } = require('./config');
const { recordReview } = require('./review-progress');
const { attachSchedulerPresenter } = require('./scheduler-presenter');
const popupManager = require('./popup-manager');
const { analyzeWord } = require('./etymology');

const scheduler = createScheduler({
  repository: createLearningRepository(getDb),
  getConfig: loadConfig,
  recordReview: (wordId, action, now) => recordReview(getDb(), wordId, action, now)
});
attachSchedulerPresenter(scheduler, { popupManager, analyzeWord, getConfig: loadConfig });

module.exports = scheduler;
