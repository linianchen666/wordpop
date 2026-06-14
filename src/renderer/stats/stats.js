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

// === 加载统计数据 ===
async function loadStats() {
  try {
    const [stats, dailyStats, stageDist] = await Promise.all([
      window.wordpopAPI.getStats(),
      window.wordpopAPI.getDailyStats(7),
      window.wordpopAPI.getStageDistribution()
    ]);

    renderOverview(stats);
    renderDailyChart(dailyStats);
    renderStageChart(stageDist);
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

// === 渲染概览数据 ===
function renderOverview(stats) {
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
  const stageNames = ['新学', '5分', '30分', '12时', '1天', '2天', '4天', '7天', '15天'];
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
  // 关闭当前窗口，通过 IPC 通知主进程打开设置
  window.close();
  // 注意：主进程会在窗口关闭后自动打开设置（如果是从托盘打开的）
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
