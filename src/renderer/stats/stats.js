// WordPop 统计面板逻辑

// === DOM 引用 ===
const statTodayReviewed = document.getElementById('stat-today-reviewed');
const statTodayLearned = document.getElementById('stat-today-learned');
const statTotalWords = document.getElementById('stat-total-words');
const statStreak = document.getElementById('stat-streak');
const statTotalCorrect = document.getElementById('stat-total-correct');
const statMastered = document.getElementById('stat-mastered');
const statAccuracy = document.getElementById('stat-accuracy');
const chartDaily = document.getElementById('chart-daily');
const chartStage = document.getElementById('chart-stage');
const btnRefresh = document.getElementById('btn-refresh');
const btnSettings = document.getElementById('btn-settings');
const btnDiagnose = document.getElementById('btn-diagnose');
const dbWarning = document.getElementById('db-warning');
const dbWarningText = document.getElementById('db-warning-text');
const btnRepairDb = document.getElementById('btn-repair-db');

// === 安全的 IPC 调用（不抛异常） ===
async function safeInvoke(apiFn, fallback) {
  try {
    return await apiFn();
  } catch (err) {
    console.error('IPC call failed:', err);
    return fallback;
  }
}

// === 加载统计数据 ===
async function loadStats() {
  // 每个接口独立调用，互不影响
  let stats;
  try {
    stats = await window.wordpopAPI.getStats();
    console.log('[Stats] getStats result:', JSON.stringify(stats));
  } catch (err) {
    console.error('[Stats] getStats FAILED:', err);
    stats = { today: { words_reviewed: 0, words_learned: 0 }, total: { words: 0, correct: 0, wrong: 0, mastered: 0 }, streak: 0 };
  }

  let dailyStats;
  try {
    dailyStats = await window.wordpopAPI.getDailyStats(7);
    console.log('[Stats] getDailyStats result:', JSON.stringify(dailyStats));
  } catch (err) {
    console.error('[Stats] getDailyStats FAILED:', err);
    dailyStats = [];
  }

  let stageDist;
  try {
    stageDist = await window.wordpopAPI.getStageDistribution();
    console.log('[Stats] getStageDistribution result:', JSON.stringify(stageDist));
  } catch (err) {
    console.error('[Stats] getStageDistribution FAILED:', err);
    stageDist = [];
  }

  renderOverview(stats);
  renderDailyChart(dailyStats);
  renderStageChart(stageDist);
  loadStubbornWords();
}

// === 渲染概览数据 ===
function renderOverview(stats) {
  if (!stats) { console.error('[Stats] renderOverview: stats is null'); return; }

  console.log('[Stats] renderOverview:', JSON.stringify(stats));

  statTodayReviewed.textContent = stats.today?.words_reviewed ?? 0;
  statTodayLearned.textContent = stats.today?.words_learned ?? 0;
  statTotalWords.textContent = formatNumber(stats.total?.words ?? 0);
  statStreak.textContent = (stats.streak ?? 0) + ' 天';

  statTotalCorrect.textContent = (stats.total?.correct || 0) + ' 次';
  statMastered.textContent = formatNumber(stats.total?.mastered || 0) + ' 个';

  const total = (stats.total?.correct || 0) + (stats.total?.wrong || 0);
  const accuracy = total > 0 ? Math.round((stats.total?.correct || 0) / total * 100) : 0;
  statAccuracy.textContent = accuracy + '%';
}

// === 渲染每日趋势图 ===
function renderDailyChart(dailyStats) {
  if (!Array.isArray(dailyStats)) return;

  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const found = dailyStats.find(s => s.date === dateStr);
    last7Days.push({
      label: (d.getMonth() + 1) + '/' + d.getDate(),
      value: found ? found.words_reviewed : 0,
      color: '#4A90D9'
    });
  }

  drawBarChart(chartDaily, last7Days, { theme: 'light' });
}

// === 渲染阶段分布图 ===
function renderStageChart(stageDist) {
  if (!Array.isArray(stageDist)) return;

  const stageNames = ['新学', '5分', '30分', '4时', '1天', '2天', '4天', '7天', '15天'];
  const colors = ['#E74C3C', '#E67E22', '#F39C12', '#F1C40F', '#2ECC71', '#27AE60', '#1ABC9C', '#3498DB', '#9B59B6'];

  const data = stageNames.map((name, i) => {
    const found = stageDist.find(s => s.stage === i);
    return {
      label: name,
      value: found ? found.count : 0,
      color: colors[i]
    };
  });

  drawBarChart(chartStage, data, { theme: 'light' });
}

// === 加载顽固单词 ===
async function loadStubbornWords() {
  let words;
  try {
    words = await window.wordpopAPI.getStubbornWords(3);
  } catch (err) {
    console.error('[Stats] getStubbornWords FAILED:', err);
    words = [];
  }
  renderStubbornWords(words);
}

function renderStubbornWords(words) {
  const listEl = document.getElementById('stubborn-list');
  const emptyEl = document.getElementById('stubborn-empty');
  const countEl = document.getElementById('stubborn-count');
  const hintEl = document.getElementById('stubborn-hint');

  if (!words || words.length === 0) {
    listEl.innerHTML = '';
    listEl.appendChild(emptyEl);
    emptyEl.style.display = 'block';
    countEl.textContent = '';
    hintEl.style.display = 'block';
    return;
  }

  emptyEl.style.display = 'none';
  countEl.textContent = `(${words.length})`;
  hintEl.style.display = 'block';

  listEl.innerHTML = words.map(w => {
    const stageNames = ['新学', '5分', '30分', '4时', '1天', '2天', '4天', '7天', '15天'];
    const stageLabel = stageNames[w.stage] || ('阶段' + w.stage);
    const rate = w.correct_count + w.wrong_count > 0
      ? Math.round(w.correct_count / (w.correct_count + w.wrong_count) * 100)
      : 0;
    return `
      <div class="stubborn-item" data-word-id="${w.id}">
        <div class="stubborn-main">
          <span class="stubborn-word">${w.word}</span>
          <span class="stubborn-phonetic">${w.phonetic ? '/' + w.phonetic + '/' : ''}</span>
        </div>
        <div class="stubborn-translation">${w.translation || ''}</div>
        <div class="stubborn-meta">
          <span class="stubborn-wrong">❌ ${w.wrong_count}次</span>
          <span class="stubborn-stage">${stageLabel}</span>
          <span class="stubborn-rate">正确率${rate}%</span>
        </div>
      </div>
    `;
  }).join('');
}

// === 监听统计更新 ===
window.wordpopAPI.onStatsUpdated(() => {
  loadStats();
});

// === 从托盘打开时滚动到顽固单词区域 ===
window.wordpopAPI.onScrollToStubborn(() => {
  const section = document.querySelector('.stats-section:nth-last-of-type(2)');
  if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// === 刷新 ===
btnRefresh.addEventListener('click', () => {
  btnRefresh.textContent = '刷新中...';
  loadStats().then(() => {
    btnRefresh.textContent = '🔄 刷新数据';
  });
});

// === 打开设置 ===
btnSettings.addEventListener('click', () => {
  window.close();
});

// === 数据库诊断 ===
async function runDiagnose() {
  try {
    const diag = await window.wordpopAPI.diagnoseDatabase();
    if (!diag.healthy) {
      dbWarningText.textContent = '数据库异常：' + (diag.error || '未知错误') + '。点击"修复数据库"重建（学习数据将丢失）。';
      dbWarning.style.display = 'block';
    } else if (diag.wordCount === 0) {
      dbWarningText.textContent = '词库未导入（0 个单词）。请在设置中选择并导入词库。';
      dbWarning.style.display = 'block';
    } else if (diag.progressCount === 0) {
      dbWarningText.textContent = '数据库正常（' + diag.wordCount + ' 个单词），但尚未开始学习。背几个单词后统计数据就会出现。';
      dbWarning.style.display = 'block';
    } else {
      dbWarning.style.display = 'none';
    }
    return diag;
  } catch (err) {
    console.error('Diagnose failed:', err);
    dbWarningText.textContent = '诊断失败：' + err.message;
    dbWarning.style.display = 'block';
    return null;
  }
}

btnDiagnose.addEventListener('click', () => {
  btnDiagnose.textContent = '诊断中...';
  runDiagnose().then((diag) => {
    btnDiagnose.textContent = '🩺 诊断';
    if (diag && diag.healthy) {
      let info = '数据库状态正常\n\n';
      info += '词库单词：' + diag.wordCount + ' 个\n';
      info += '学习记录：' + diag.progressCount + ' 条\n';
      info += '统计记录：' + diag.statsCount + ' 条\n\n';
      info += 'SQLite 当前日期：' + (diag.sqliteToday?.today || '未知') + '\n';
      info += 'SQLite 当前时间：' + (diag.sqliteToday?.now || '未知') + '\n\n';
      if (diag.todayStats && diag.todayStats.length > 0) {
        info += 'daily_stats 最近记录：\n';
        diag.todayStats.forEach(s => {
          info += '  ' + s.date + ' → 复习' + s.words_reviewed + ' 新学' + s.words_learned + '\n';
        });
      } else {
        info += 'daily_stats 无记录\n';
      }
      if (diag.sampleProgress && diag.sampleProgress.length > 0) {
        info += '\nprogress 样本：\n';
        diag.sampleProgress.forEach(p => {
          info += '  ' + (p.word || '?') + ' stage=' + p.stage + ' correct=' + p.correct_count + '\n';
        });
      }
      // 新增：统计查询结果
      if (diag.statsQueryResult) {
        info += '\n═══ 统计查询结果 ═══\n';
        if (diag.statsQueryResult.error) {
          info += '查询出错：' + diag.statsQueryResult.error + '\n';
        } else {
          info += 'today: ' + JSON.stringify(diag.statsQueryResult.today) + '\n';
          info += 'total: ' + JSON.stringify(diag.statsQueryResult.total) + '\n';
          info += 'raw_total: ' + JSON.stringify(diag.statsQueryResult.raw_total) + '\n';
        }
      }
      alert(info);
    }
  });
});

// === 修复数据库 ===
btnRepairDb.addEventListener('click', async () => {
  const confirmed = confirm('修复数据库将删除所有学习数据并重建。\n\n确定要继续吗？');
  if (!confirmed) return;

  btnRepairDb.textContent = '修复中...';
  btnRepairDb.disabled = true;
  try {
    const result = await window.wordpopAPI.repairDatabase();
    if (result.success) {
      alert('修复成功！请重新打开设置导入词库。');
      dbWarning.style.display = 'none';
      loadStats();
    } else {
      alert('修复失败：' + result.message);
    }
  } catch (err) {
    alert('修复出错：' + err.message);
  }
  btnRepairDb.textContent = '🔧 修复数据库';
  btnRepairDb.disabled = false;
});

// === 窗口大小变化时重绘图表 ===
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    loadStats();
  }, 500);
});

// === 初始化 ===
loadStats();
runDiagnose(); // 自动检查数据库健康状态
