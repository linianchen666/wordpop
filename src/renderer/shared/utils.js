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
    '新学', '5分钟', '30分钟', '4小时',
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

/**
 * ══════════════════════════════════════════════════════════
 * 全局统一多音色发音引擎 (WordPop Multi-Voice Audio Engine)
 * ══════════════════════════════════════════════════════════
 * 支持角色音色：
 *  - dict-us: 🇺🇸 标准美音（有道高保真词典原声）
 *  - dict-uk: 🇬🇧 标准英音（有道高保真词典原声）
 *  - loli: 🎀 软萌少女（萝莉音 / 高音调欢快女声）
 *  - mature: 👠 知性御姐（成熟女声 / 低音调温和女声）
 *  - deep-male: 🎩 磁性大叔（沉稳男声 / 低音调男声）
 *  - fast: ⚡ 极速突击（1.25x 强化听觉刺激）
 */

// ==========================================
// 🔊 音频播放引擎 (统管发音与音效)
// ==========================================

// 提前触发语音库加载 (解决第一次 getVoices() 为空的问题)
if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    // 强制触发内部加载
    window.speechSynthesis.getVoices();
  };
  window.speechSynthesis.getVoices();
}

const _audioCache = new Map();
let _activeAudio = null;

function playWordAudio(word, voiceType = 'dict-us', options = {}) {
  if (!word || typeof word !== 'string') return;
  const cleanWord = word.trim();
  if (!cleanWord) return;

  const resolvedVoice = voiceType || 'dict-us';

  // 判断是否使用英音基础库（知性御姐使用英音底子更合适）
  const isUK = resolvedVoice === 'dict-uk' || resolvedVoice === 'en-GB' || resolvedVoice === 'uk' || resolvedVoice === 'mature';
  const type = isUK ? 1 : 2; // 1: UK, 2: US
  const audioUrl = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(cleanWord)}&type=${type}`;

  // 统一走在线高保真音频流，利用 HTML5 Audio 的 preservesPitch 来实现完美变声
  _playOnlineStream(audioUrl, resolvedVoice, () => _playSynthesizedVoice(cleanWord, resolvedVoice));
}

function _playOnlineStream(audioUrl, voiceType, fallbackFn) {
  try {
    if (_activeAudio) {
      _activeAudio.pause();
      _activeAudio.currentTime = 0;
    }

    let audio = _audioCache.get(audioUrl);
    if (!audio) {
      audio = new Audio(audioUrl);
      if (_audioCache.size > 100) {
        const firstKey = _audioCache.keys().next().value;
        _audioCache.delete(firstKey);
      }
      _audioCache.set(audioUrl, audio);
    } else {
      audio.currentTime = 0;
    }

    // 重置变声参数
    audio.playbackRate = 1.0;
    audio.preservesPitch = true;
    if (typeof audio.mozPreservesPitch !== 'undefined') audio.mozPreservesPitch = true;
    if (typeof audio.webkitPreservesPitch !== 'undefined') audio.webkitPreservesPitch = true;

    // 应用声色魔法
    if (voiceType === 'loli') {
      audio.playbackRate = 1.35;
      audio.preservesPitch = false;
      if (typeof audio.mozPreservesPitch !== 'undefined') audio.mozPreservesPitch = false;
      if (typeof audio.webkitPreservesPitch !== 'undefined') audio.webkitPreservesPitch = false;
    } else if (voiceType === 'deep-male') {
      audio.playbackRate = 0.75;
      audio.preservesPitch = false;
      if (typeof audio.mozPreservesPitch !== 'undefined') audio.mozPreservesPitch = false;
      if (typeof audio.webkitPreservesPitch !== 'undefined') audio.webkitPreservesPitch = false;
    } else if (voiceType === 'mature') {
      audio.playbackRate = 0.92;
    } else if (voiceType === 'fast') {
      audio.playbackRate = 1.25;
    }

    _activeAudio = audio;
    let fallbackTriggered = false;

    const triggerFallback = () => {
      if (!fallbackTriggered) {
        fallbackTriggered = true;
        if (fallbackFn) fallbackFn();
      }
    };

    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => triggerFallback());
    }
    audio.onerror = () => triggerFallback();
  } catch (err) {
    if (fallbackFn) fallbackFn();
  }
}

function _playSynthesizedVoice(word, voiceType, fallbackToOnline = true) {
  try {
    if (!('speechSynthesis' in window)) {
      if (fallbackToOnline) {
        _playOnlineStream(`https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=2`);
      }
      return;
    }

    if (window.speechSynthesis.paused) {
      try { window.speechSynthesis.resume(); } catch (_) {}
    }
    try { window.speechSynthesis.cancel(); } catch (_) {}

    const utterance = new SpeechSynthesisUtterance(word);
    window._wordpopUtterance = utterance; // 防止垃圾回收

    const isUK = voiceType === 'dict-uk' || voiceType === 'en-GB' || voiceType === 'uk';
    utterance.lang = isUK ? 'en-GB' : 'en-US';

    let pitch = 1.0;
    let rate = 0.92;
    let gender = 'female';

    switch (voiceType) {
      case 'loli': // 软萌少女
        pitch = 1.45;
        rate = 1.05;
        gender = 'female';
        break;
      case 'mature': // 知性御姐
        pitch = 0.90;
        rate = 0.90;
        gender = 'female';
        break;
      case 'deep-male': // 磁性大叔
        pitch = 0.75;
        rate = 0.85;
        gender = 'male';
        break;
      case 'fast': // 极速突击
        pitch = 1.05;
        rate = 1.25;
        gender = 'female';
        break;
      default:
        pitch = 1.0;
        rate = 0.92;
        break;
    }

    utterance.pitch = pitch;
    utterance.rate = rate;

    // 匹配最适合的英语发音人
    const voices = window.speechSynthesis.getVoices();
    if (voices && voices.length > 0) {
      const enVoices = voices.filter(v => /^en/i.test(v.lang));
      const ukVoices = voices.filter(v => /en[-_]gb/i.test(v.lang));
      const usVoices = voices.filter(v => /en[-_]us/i.test(v.lang));

      let targetList = isUK ? (ukVoices.length ? ukVoices : enVoices) : (usVoices.length ? usVoices : enVoices);
      if (targetList.length === 0) targetList = voices;

      let matchedVoice = null;
      
      // 根据角色特征更精细地匹配声音名字 (利用系统中不同的音色)
      if (voiceType === 'loli') {
        // 软萌：偏好比较清脆年轻的声音（如 Aria, Jenny），没有则退而求其次
        matchedVoice = targetList.find(v => /aria|jenny|samantha|karen|female/i.test(v.name)) || targetList.find(v => /zira/i.test(v.name));
      } else if (voiceType === 'mature') {
        // 御姐：偏好低沉/成熟/英伦风的女声
        matchedVoice = targetList.find(v => /hazel|susan|victoria|catherine|mature/i.test(v.name)) || ukVoices.find(v => /female|woman/i.test(v.name)) || targetList.find(v => /zira/i.test(v.name));
      } else if (voiceType === 'deep-male') {
        // 大叔：偏好低沉男声
        matchedVoice = targetList.find(v => /david|mark|george|richard|deep|male/i.test(v.name));
      } else if (gender === 'female') {
        matchedVoice = targetList.find(v => /female|zira|aria|jenny|samantha/i.test(v.name));
      } else if (gender === 'male') {
        matchedVoice = targetList.find(v => /male|david|guy|mark/i.test(v.name));
      }

      if (matchedVoice) {
        utterance.voice = matchedVoice;
      } else if (targetList.length > 0) {
        utterance.voice = targetList[0];
      }
    }

    let hasSpoken = false;
    utterance.onstart = () => { hasSpoken = true; };
    utterance.onerror = (err) => {
      console.warn('[AudioEngine] Utterance error, fallback to online stream:', err);
      if (fallbackToOnline && !hasSpoken) {
        const type = isUK ? 1 : 2;
        _playOnlineStream(`https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${type}`, voiceType);
      }
    };

    setTimeout(() => {
      try {
        window.speechSynthesis.speak(utterance);
      } catch (err) {
        if (fallbackToOnline) {
          const type = isUK ? 1 : 2;
          _playOnlineStream(`https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${type}`, voiceType);
        }
      }
    }, 30);

  } catch (e) {
    console.error('[AudioEngine] Synthesis error:', e);
    if (fallbackToOnline) {
      _playOnlineStream(`https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=2`);
    }
  }
}

