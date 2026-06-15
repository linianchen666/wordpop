// WordPop 设置面板逻辑

// === DOM 引用 ===
const dailyNewWords = document.getElementById('dailyNewWords');
const customDailyInput = document.getElementById('customDailyNewWords');
const showExample = document.getElementById('showExample');
const autoPronounce = document.getElementById('autoPronounce');
const fontSize = document.getElementById('fontSize');
const autoStart = document.getElementById('autoStart');
const autoCheckUpdate = document.getElementById('autoCheckUpdate');
const pronounceAccent = document.getElementById('pronounceAccent');
const pronounceAccentRow = document.getElementById('pronounce-accent-row');
const wordlistOptions = document.getElementById('wordlist-options');
const positionSelector = document.getElementById('position-selector');
const btnSave = document.getElementById('btn-save');
const btnCancel    = document.getElementById('btn-cancel');
const btnLogs      = document.getElementById('btn-logs');
const btnImportCustom = document.getElementById('btn-import-custom');

// 预测卡片 DOM
const predictionEmpty   = document.getElementById('prediction-empty');
const predictionContent = document.getElementById('prediction-content');
const progressBarFill   = document.getElementById('progress-bar-fill');
const progressPercent   = document.getElementById('progress-percent');
const statTotal         = document.getElementById('stat-total');
const statLearned       = document.getElementById('stat-learned');
const statMastered      = document.getElementById('stat-mastered');
const statRemaining     = document.getElementById('stat-remaining');
const predictedDays     = document.getElementById('predicted-days');
const predictedDate     = document.getElementById('predicted-date');
const targetDateInput   = document.getElementById('targetDate');
const btnClearTarget    = document.getElementById('btn-clear-target');
const targetResult      = document.getElementById('target-result');

let currentConfig = {};
let selectedWordlists = [];
let selectedPosition = 'bottom-right';
let availableWordlists = [];
let progressData = null; // 缓存预测数据

// === 防抖工具 ===
function debounce(fn, delay) {
  let timer = null;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// === 初始化：加载当前配置 ===
async function init() {
  try {
    currentConfig = await window.wordpopAPI.getConfig();
    availableWordlists = await window.wordpopAPI.getWordlists();
  } catch (err) {
    console.error('Failed to load config:', err);
    return;
  }

  // 填充表单 — 每日新词（支持自定义值）
  const dailyVal = currentConfig.dailyNewWords || 20;
  const presetValues = [5, 10, 20, 30, 50];
  if (presetValues.includes(dailyVal)) {
    dailyNewWords.value = dailyVal;
  } else {
    dailyNewWords.value = 'custom';
    customDailyInput.value = dailyVal;
    customDailyInput.style.display = 'block';
  }

  showExample.checked = currentConfig.showExample !== false;
  autoPronounce.checked = currentConfig.autoPronounce || false;
  pronounceAccent.value = currentConfig.pronounceAccent || 'en-US';
  pronounceAccentRow.style.display = autoPronounce.checked ? 'flex' : 'none';
  fontSize.value = currentConfig.fontSize || 'medium';
  autoStart.checked = currentConfig.autoStart || false;
  autoCheckUpdate.checked = currentConfig.autoCheckUpdate !== false;
  selectedWordlists = [...(currentConfig.selectedWordlists || ['cet4'])];
  selectedPosition = currentConfig.popupPosition || 'bottom-right';

  // 自动发音开关联动
  autoPronounce.addEventListener('change', () => {
    pronounceAccentRow.style.display = autoPronounce.checked ? 'flex' : 'none';
  });

  // 渲染词库列表
  renderWordlists();

  // 设置位置选择器
  document.querySelectorAll('.position-option').forEach(el => {
    el.classList.toggle('active', el.dataset.pos === selectedPosition);
  });

  // 目标日期
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  targetDateInput.min = tomorrow.toISOString().split('T')[0];
  if (currentConfig.targetDate && new Date(currentConfig.targetDate) > new Date()) {
    targetDateInput.value = currentConfig.targetDate;
  }

  // 如果这是首次设置，显示提示
  if (!currentConfig.setupComplete) {
    document.querySelector('.settings-subtitle').textContent = '首次使用，请选择学习偏好';
  }

  // 加载预测数据
  loadPrediction();
}

// === 渲染词库列表 ===
function renderWordlists() {
  wordlistOptions.innerHTML = '';

  availableWordlists.forEach(wl => {
    const div = document.createElement('div');
    div.className = 'wordlist-item' + (selectedWordlists.includes(wl.id) ? ' selected' : '');

    div.innerHTML = `
      <input type="checkbox" value="${wl.id}" ${selectedWordlists.includes(wl.id) ? 'checked' : ''}>
      <div class="wordlist-info">
        <div class="wordlist-name">${wl.name}</div>
        <div class="wordlist-count">${wl.count || wl.wordCount || 0} 个单词</div>
      </div>
      <span class="wordlist-status ${wl.isImported ? 'imported' : 'not-imported'}">
        ${wl.isImported ? '已导入' : '未导入'}
      </span>
    `;

    div.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const checkbox = div.querySelector('input[type="checkbox"]');
      checkbox.checked = !checkbox.checked;
      updateWordlistSelection();
    });

    div.querySelector('input').addEventListener('change', () => {
      updateWordlistSelection();
    });

    wordlistOptions.appendChild(div);
  });
}

function updateWordlistSelection() {
  selectedWordlists = [];
  wordlistOptions.querySelectorAll('input:checked').forEach(cb => {
    selectedWordlists.push(cb.value);
  });
  // 更新选中状态样式
  wordlistOptions.querySelectorAll('.wordlist-item').forEach(item => {
    const cb = item.querySelector('input');
    item.classList.toggle('selected', cb.checked);
  });
  // 词库选择变更 → 防抖加载预测
  debouncedLoadPrediction();
}

// === 位置选择 ===
positionSelector.addEventListener('click', (e) => {
  const option = e.target.closest('.position-option');
  if (!option) return;

  selectedPosition = option.dataset.pos;
  document.querySelectorAll('.position-option').forEach(el => {
    el.classList.toggle('active', el.dataset.pos === selectedPosition);
  });
});

// ════════════════════════════════════════════╗
//  预测功能
// ════════════════════════════════════════════╝

const debouncedLoadPrediction = debounce(loadPrediction, 500);

async function loadPrediction() {
  if (selectedWordlists.length === 0) {
    renderEmptyPrediction();
    return;
  }
  try {
    progressData = await window.wordpopAPI.getProgressSummary(selectedWordlists);
    renderPrediction();
  } catch (err) {
    console.error('loadPrediction failed:', err);
    renderEmptyPrediction();
  }
}

function renderEmptyPrediction() {
  progressData = null;
  predictionEmpty.style.display = 'block';
  predictionContent.style.display = 'none';
  predictionEmpty.textContent = selectedWordlists.length === 0 ? '请先选择词库' : '数据加载失败';
}

function renderPrediction() {
  if (!progressData) { renderEmptyPrediction(); return; }

  const { totalWords, learnedWords, masteredWords, remainingWords } = progressData;

  if (totalWords === 0) {
    predictionEmpty.style.display = 'block';
    predictionContent.style.display = 'none';
    predictionEmpty.textContent = '词库尚未导入，请先保存设置后查看';
    return;
  }

  predictionEmpty.style.display = 'none';
  predictionContent.style.display = 'block';

  // 进度条
  const doneWords = learnedWords + masteredWords;
  const percent = totalWords > 0 ? Math.round(doneWords / totalWords * 100) : 0;
  progressBarFill.style.width = percent + '%';
  progressPercent.textContent = percent + '%';

  // 统计数字
  statTotal.textContent = '总计 ' + totalWords + ' 个';
  statLearned.textContent = '已学 ' + learnedWords + ' 个';
  statMastered.textContent = '已掌握 ' + masteredWords + ' 个';
  statRemaining.textContent = '剩余 ' + remainingWords + ' 个';

  // 预测天数
  const dailyNew = getDailyNewWordsValue();

  if (remainingWords <= 0) {
    predictedDays.textContent = '已完成!';
    predictedDays.classList.add('completed');
    predictedDate.textContent = '';
  } else if (dailyNew <= 0) {
    predictedDays.textContent = '-- 天';
    predictedDays.classList.remove('completed');
    predictedDate.textContent = '';
  } else {
    const days = Math.ceil(remainingWords / dailyNew);
    predictedDays.textContent = days + ' 天';
    predictedDays.classList.remove('completed');
    const est = new Date();
    est.setDate(est.getDate() + days);
    predictedDate.textContent = '（约 ' + (est.getMonth()+1) + '月' + est.getDate() + '日）';
  }

  // 目标日期反推
  updateTargetResult();
}

function getDailyNewWordsValue() {
  if (dailyNewWords.value === 'custom') {
    return Math.min(200, Math.max(1, parseInt(customDailyInput.value) || 0));
  }
  return parseInt(dailyNewWords.value) || 20;
}

function updateTargetResult() {
  const targetDateStr = targetDateInput.value;
  if (!targetDateStr || !progressData) {
    targetResult.textContent = '';
    targetResult.className = 'target-result';
    return;
  }

  const targetDate = new Date(targetDateStr);
  const today = new Date();
  today.setHours(0,0,0,0);
  targetDate.setHours(0,0,0,0);

  const remainingDays = Math.ceil((targetDate - today) / 86400000);
  const remaining = progressData.remainingWords;

  if (remaining <= 0) {
    targetResult.textContent = '所有单词已学完!';
    targetResult.className = 'target-result success';
    return;
  }

  if (remainingDays <= 0) {
    targetResult.textContent = '目标日期已过，请选择未来的日期';
    targetResult.className = 'target-result warning';
    return;
  }

  const requiredDaily = Math.ceil(remaining / remainingDays);

  if (requiredDaily > 200) {
    targetResult.textContent = '需每天学 ' + requiredDaily + ' 个（超出合理范围）';
    targetResult.className = 'target-result impossible';
  } else {
    targetResult.textContent = '需每天学 ' + requiredDaily + ' 个新词即可完成';
    targetResult.className = 'target-result';
  }
}

// === 自定义每日词量 ===
dailyNewWords.addEventListener('change', () => {
  if (dailyNewWords.value === 'custom') {
    customDailyInput.style.display = 'block';
    customDailyInput.focus();
  } else {
    customDailyInput.style.display = 'none';
  }
  renderPrediction();
});

customDailyInput.addEventListener('input', () => {
  renderPrediction();
});

// === 目标日期联动 ===
targetDateInput.addEventListener('change', () => {
  updateTargetResult();
});

btnClearTarget.addEventListener('click', () => {
  targetDateInput.value = '';
  targetResult.textContent = '';
  targetResult.className = 'target-result';
});

// === 保存设置 ===
btnSave.addEventListener('click', async () => {
  // 检查是否至少选择了一个词库
  if (selectedWordlists.length === 0) {
    alert('请至少选择一个词库！');
    return;
  }

  btnSave.disabled = true;
  btnSave.textContent = '保存中...';

  const newConfig = {
    dailyNewWords: dailyNewWords.value === 'custom'
      ? Math.min(200, Math.max(1, parseInt(customDailyInput.value) || 20))
      : parseInt(dailyNewWords.value),
    popupPosition: selectedPosition,
    selectedWordlists: selectedWordlists,
    showExample: showExample.checked,
    autoPronounce: autoPronounce.checked,
    pronounceAccent: pronounceAccent.value,
    fontSize: fontSize.value,
    autoStart: autoStart.checked,
    autoCheckUpdate: autoCheckUpdate.checked,
    setupComplete: true,
    targetDate: targetDateInput.value || null
  };

  // 先导入未导入的词库
  for (const wlId of selectedWordlists) {
    const wl = availableWordlists.find(w => w.id === wlId);
    if (wl && !wl.isImported) {
      btnSave.textContent = `导入 ${wl.name}...`;
      try {
        const result = await window.wordpopAPI.importWordlist(wlId);
        if (!result.success) {
          alert(`导入 ${wl.name} 失败: ${result.error}`);
        }
      } catch (err) {
        alert(`导入 ${wl.name} 失败: ${err.message}`);
      }
    }
  }

  // 保存配置
  try {
    const result = await window.wordpopAPI.saveConfig(newConfig);
    if (result.success) {
      btnSave.textContent = '✓ 已保存';
      setTimeout(() => {
        window.close();
      }, 500);
    } else {
      btnSave.textContent = '保存失败';
      btnSave.disabled = false;
      alert('保存失败: ' + (result.error || '未知错误'));
    }
  } catch (err) {
    btnSave.textContent = '保存失败';
    btnSave.disabled = false;
    alert('保存失败: ' + err.message);
  }
});

// === 取消 ===
btnCancel.addEventListener('click', () => {
  window.close();
});

// === 导入自定义词表 ===
btnImportCustom.addEventListener('click', async () => {
  btnImportCustom.disabled = true;
  btnImportCustom.textContent = '导入中...';

  try {
    const result = await window.wordpopAPI.importCustomWordlist();
    if (result.success) {
      alert(`成功导入 ${result.imported || result.total} 个单词！`);
      // 刷新词库列表
      availableWordlists = await window.wordpopAPI.getWordlists();
      renderWordlists();
    } else if (result.error !== '用户取消') {
      alert('导入失败: ' + result.error);
    }
  } catch (err) {
    alert('导入失败: ' + err.message);
  }

  btnImportCustom.disabled = false;
  btnImportCustom.textContent = '📂 导入自定义词表';
});

// === 启动 ===
init();

// === 查看日志 ===
if (btnLogs) {
  btnLogs.addEventListener('click', async () => {
    try {
      await window.wordpopAPI.openLogFolder();
    } catch (err) {
      try {
        const result = await window.wordpopAPI.getLogs();
        const logs = result && result.logs ? result.logs : (result || '');
        const win = window.open('', '_blank', 'width=600,height=500');
        if (win) {
          win.document.write(`
            <pre style="white-space:pre-wrap;padding:12px;font-size:12px;background:#f5f5f5">
              ${logs.slice(-5000).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
            </pre>
          `);
        } else {
          alert(logs.slice(-3000));
        }
      } catch (e2) {
        alert('读取日志失败：' + e2.message);
      }
    }
  });
}
