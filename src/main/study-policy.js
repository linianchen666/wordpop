const { localDateKey, daysUntilInclusive } = require('../shared/plan-date');

function selectedWordlists(config) {
  return config?.selectedWordlists?.length ? config.selectedWordlists : ['cet4'];
}

function endOfDay(now) {
  const date = new Date(now);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

function batchSettings(config = {}) {
  return {
    batchSize: config.batchSize !== undefined ? config.batchSize : 3,
    cooldownMinutes: config.cooldownMinutes !== undefined ? config.cooldownMinutes : 10
  };
}

/** Pure quota policy; persistence and the clock are supplied by its caller. */
function calculateDailyQuota(config = {}, { unlearnedCount = 0, dueCount = 0, todayLearned = 0 } = {}, now = Date.now()) {
  let baseLimit = parseInt(config.dailyNewWords) || 20;
  const mode = config.dailyNewWordsMode || 'fixed';
  const daysLeft = daysUntilInclusive(config.targetDate, now);
  let requiredDaily = null, planState = 'fixed';
  if (mode === 'target') {
    planState = daysLeft === null ? 'invalid' : daysLeft <= 0 ? 'expired' : 'active';
    if (daysLeft > 0) {
      requiredDaily = unlearnedCount > 0 ? Math.ceil((unlearnedCount + todayLearned) / daysLeft) : 0;
      const cap = Math.min(200, Math.max(1, parseInt(config.maxDynamicNewWords) || 50));
      baseLimit = Math.min(cap, requiredDaily);
      if (requiredDaily > cap) planState = 'capped';
    }
  }
  let effectiveLimit = baseLimit;
  let loadState = 'normal';
  let reason = '复习负荷正常，按计划推新';
  if (config.autoBalanceLoad !== false && baseLimit > 0) {
    if (dueCount >= 80) {
      effectiveLimit = 0;
      loadState = 'overload';
      reason = `检测到 ${dueCount} 个复习积压，已自动暂停今日推新，全力消化旧词`;
    } else if (dueCount >= 40) {
      effectiveLimit = Math.max(1, Math.floor(baseLimit / 2));
      loadState = 'heavy';
      reason = `检测到 ${dueCount} 个待复习单词，新词配额自动减半（${baseLimit} → ${effectiveLimit}）`;
    }
  }
  if (mode === 'target') {
    if (planState === 'invalid' || planState === 'expired') reason = '目标日期未设置、无效或已过期，暂按固定词量推新，请重新设置日期。' + reason;
    else if (planState === 'capped') reason = `按期完成需每天 ${requiredDaily} 词，已受每日上限 ${baseLimit} 词限制，目标可能延期。` + reason;
    else if (effectiveLimit < baseLimit) reason += '；目标完成日期可能延期';
  }
  return { effectiveLimit, baseLimit, mode, dueCount, loadState, reason, daysLeft, requiredDaily, planState, todayLearned };
}

module.exports = { selectedWordlists, localDateKey, endOfDay, batchSettings, calculateDailyQuota };
