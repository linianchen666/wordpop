// WordPop 公共工具函数

/**
 * 格式化日期
 */
function formatDate(dateStr) {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;

  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';

  const month = d.getMonth() + 1;
  const day = d.getDate();
  return `${month}月${day}日`;
}

/**
 * 格式化数字
 */
function formatNumber(n) {
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

/**
 * 获取记忆阶段名称
 */
function getStageName(stage) {
  const names = [
    '新学', '5分钟', '30分钟', '12小时',
    '1天', '2天', '4天', '7天', '15天', '已掌握'
  ];
  return names[stage] || `阶段${stage}`;
}

/**
 * 获取阶段颜色
 */
function getStageColor(stage) {
  const colors = [
    '#E74C3C', '#E67E22', '#F39C12', '#F1C40F',
    '#2ECC71', '#27AE60', '#1ABC9C', '#3498DB', '#9B59B6', '#2C3E50'
  ];
  return colors[stage] || '#95A5A6';
}

/**
 * 防抖
 */
function debounce(fn, delay = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * 节流
 */
function throttle(fn, interval = 300) {
  let lastTime = 0;
  return function (...args) {
    const now = Date.now();
    if (now - lastTime >= interval) {
      lastTime = now;
      fn.apply(this, args);
    }
  };
}

/**
 * 简单 Canvas 柱状图
 * @param {HTMLCanvasElement} canvas
 * @param {Array<{label: string, value: number, color?: string}>} data
 */
function drawBarChart(canvas, data, options = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const W = rect.width;
  const H = rect.height;
  const padding = { top: 20, right: 20, bottom: 30, left: 40 };
  const chartW = W - padding.left - padding.right;
  const chartH = H - padding.top - padding.bottom;
  const barWidth = Math.min(40, (chartW / data.length) * 0.7);
  const gap = (chartW - barWidth * data.length) / (data.length + 1);

  const maxVal = Math.max(...data.map(d => d.value), 1);
  const theme = options.theme || 'light';
  const textColor = theme === 'dark' ? '#A0A0B0' : '#7F8C8D';
  const gridColor = theme === 'dark' ? '#3E3E56' : '#E0E4E8';

  // 清空
  ctx.clearRect(0, 0, W, H);

  // 网格线
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (chartH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(W - padding.right, y);
    ctx.stroke();

    // Y 轴标签
    const label = Math.round(maxVal * (1 - i / 4));
    ctx.fillStyle = textColor;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(String(label), padding.left - 8, y + 4);
  }

  // 柱状图
  data.forEach((d, i) => {
    const barH = (d.value / maxVal) * chartH;
    const x = padding.left + gap + i * (barWidth + gap);
    const y = padding.top + chartH - barH;

    // 渐变
    const gradient = ctx.createLinearGradient(x, y, x, padding.top + chartH);
    gradient.addColorStop(0, d.color || '#4A90D9');
    gradient.addColorStop(1, d.color ? d.color + '44' : '#4A90D944');
    ctx.fillStyle = gradient;

    // 圆角矩形
    const radius = Math.min(4, barWidth / 4);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + barWidth - radius, y);
    ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + radius);
    ctx.lineTo(x + barWidth, padding.top + chartH);
    ctx.lineTo(x, padding.top + chartH);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.fill();

    // 数值标签
    ctx.fillStyle = d.color || '#4A90D9';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(d.value), x + barWidth / 2, y - 6);

    // X 轴标签
    ctx.fillStyle = textColor;
    ctx.font = '11px sans-serif';
    ctx.fillText(d.label, x + barWidth / 2, padding.top + chartH + 16);
  });
}
