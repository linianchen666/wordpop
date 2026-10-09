const DAY = 24 * 60 * 60 * 1000;

function selectedWordlists(config) {
  return config?.selectedWordlists?.length ? config.selectedWordlists : ['cet4'];
}

function localDateKey(now) {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
function calculateDailyQuota(config = {}, { unlearnedCount = 0, dueCount = 0 } = {}, now = Date.now()) {
  let baseLimit = parseInt(config.dailyNewWords) || 20;
  const mode = config.dailyNewWordsMode || 'fixed';
  if (mode === 'target' && config.targetDate) {
    const targetTime = new Date(config.targetDate);
    targetTime.setHours(23, 59, 59, 999);
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const daysLeft = Math.ceil((targetTime.getTime() - today.getTime()) / DAY);
    if (daysLeft > 0) {
      baseLimit = unlearnedCount > 0
        ? Math.min(parseInt(config.maxDynamicNewWords) || 50, Math.max(1, Math.ceil(unlearnedCount / daysLeft)))
        : 0;
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
  return { effectiveLimit, baseLimit, mode, dueCount, loadState, reason };
}

module.exports = { selectedWordlists, localDateKey, endOfDay, batchSettings, calculateDailyQuota };
