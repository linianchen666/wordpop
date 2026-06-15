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
  const stats = await safeInvoke(() => window.wordpopAPI.getStats(), {
    today: { words_reviewed: 0, words_learned: 0 },
    total: { words: 0, correct: 0, wrong: 0, mastered: 0 },
    streak: 0
  });

  const dailyStats = await safeInvoke(() => window.wordpopAPI.getDailyStats(7), []);
  const stageDist = await safeInvoke(() => window.wordpopAPI.getStageDistribution(), []);

  renderOverview(stats);
  renderDailyChart(dailyStats);
  renderStageChart(stageDist);
}

// === 渲染概览数据 ===
function renderOverview(stats) {
  if (!stats) return;

  statTodayReviewed.textContent = stats.today?.words_reviewed || 0;
  statTodayLearned.textContent = stats.today?.words_learned || 0;
  statTotalWords.textContent = formatNumber(stats.total?.words || 0);
  statStreak.textContent = (stats.streak || 0) + ' 天';

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

// === 监听统计更新 ===
window.wordpopAPI.onStatsUpdated(() => {
  loadStats();
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
