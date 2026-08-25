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
const btnExportBackup = document.getElementById('btn-export-backup');
const btnImportBackup = document.getElementById('btn-import-backup');

// 新词模式与负荷平衡 DOM
const modeOptTarget       = document.getElementById('mode-opt-target');
const modeOptFixed        = document.getElementById('mode-opt-fixed');
const fixedModeContainer  = document.getElementById('fixed-mode-container');
const targetModeContainer = document.getElementById('target-mode-container');
const targetDynamicBadge  = document.getElementById('target-dynamic-badge');
const targetDynamicDesc   = document.getElementById('target-dynamic-desc');
const autoBalanceLoad     = document.getElementById('autoBalanceLoad');

// 积压平摊 DOM
const backlogOverdueCount = document.getElementById('backlog-overdue-count');
const btnSmooth3          = document.getElementById('btn-smooth-3');
const btnSmooth5          = document.getElementById('btn-smooth-5');
const btnSmooth7          = document.getElementById('btn-smooth-7');

let selectedDailyMode = 'fixed'; // 'fixed' | 'target'

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

  // 模式与智能负荷
  selectedDailyMode = currentConfig.dailyNewWordsMode || 'fixed';
  setDailyMode(selectedDailyMode);
  if (autoBalanceLoad) {
    autoBalanceLoad.checked = currentConfig.autoBalanceLoad !== false;
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

  // 加载预测与配额数据
  await loadPrediction();
  await refreshQuotaAndBacklogInfo();
}

// === 每日新词模式切换 ===
function setDailyMode(mode) {
  selectedDailyMode = mode;
  if (modeOptTarget && modeOptFixed) {
    modeOptTarget.classList.toggle('active', mode === 'target');
    modeOptFixed.classList.toggle('active', mode === 'fixed');
  }
  if (fixedModeContainer) {
    fixedModeContainer.style.display = mode === 'fixed' ? 'flex' : 'none';
  }
  if (targetModeContainer) {
    targetModeContainer.style.display = mode === 'target' ? 'block' : 'none';
  }
  renderPrediction();
  refreshQuotaAndBacklogInfo();
}

if (modeOptTarget) {
  modeOptTarget.addEventListener('click', () => setDailyMode('target'));
}
if (modeOptFixed) {
  modeOptFixed.addEventListener('click', () => setDailyMode('fixed'));
}

// === 刷新动态配额与积压状态 ===
async function refreshQuotaAndBacklogInfo() {
  try {
    const quotaInfo = await window.wordpopAPI.getDynamicQuotaInfo();
    if (quotaInfo && targetDynamicBadge && targetDynamicDesc) {
      if (selectedDailyMode === 'target') {
        if (!targetDateInput.value) {
          targetDynamicBadge.textContent = `🎯 智能目标规划模式`;
          targetDynamicDesc.textContent = `请在下方「预测卡片」设定目标完成日期，系统将每天自适应计算新词量。`;
        } else {
          targetDynamicBadge.textContent = `今日推荐新词：${quotaInfo.effectiveLimit} 词`;
          targetDynamicDesc.textContent = quotaInfo.reason;
        }
      }
    }
    if (backlogOverdueCount && quotaInfo) {
      if (quotaInfo.dueCount > 0) {
        backlogOverdueCount.textContent = `当前逾期待复习：${quotaInfo.dueCount} 个单词`;
        backlogOverdueCount.style.color = 'var(--color-warning)';
      } else {
        backlogOverdueCount.textContent = `当前没有逾期积压单词，状态极佳！`;
        backlogOverdueCount.style.color = 'var(--color-success)';
      }
    }
  } catch (err) {
    console.error('refreshQuotaAndBacklogInfo error:', err);
  }
}

// === 积压平摊减负处理 ===
async function handleSmooth(days) {
  try {
    const quota = await window.wordpopAPI.getDynamicQuotaInfo();
    const count = quota ? quota.dueCount : 0;
    if (count === 0) {
      alert('当前没有逾期积压单词，无需平摊！');
      return;
    }

    const confirmed = confirm(
      `确定将当前的 ${count} 个逾期积压单词智能平摊到未来 ${days} 天吗？\n\n` +
      `• 系统将把复习时间均匀分散在未来 ${days} 天\n` +
      `• 今天的待复习量将大幅压降至舒适水平\n` +
      `• 记忆较稳固的词适当后移，生疏词保持在近处`
    );
    if (!confirmed) return;

    const res = await window.wordpopAPI.smoothOverdueReviews(days);
    if (res.success) {
      alert(`✅ 成功将 ${res.count} 个积压单词智能平摊至未来 ${res.days} 天！\n今日复习压力已成功减负。`);
      await init();
    } else {
      alert('平摊失败: ' + (res.error || '未知错误'));
    }
  } catch (e) {
    alert('平摊操作异常: ' + e.message);
  }
}

if (btnSmooth3) btnSmooth3.addEventListener('click', () => handleSmooth(3));
if (btnSmooth5) btnSmooth5.addEventListener('click', () => handleSmooth(5));
if (btnSmooth7) btnSmooth7.addEventListener('click', () => handleSmooth(7));

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
    dailyNewWordsMode: selectedDailyMode,
    autoBalanceLoad: autoBalanceLoad ? autoBalanceLoad.checked : true,
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

// === 导出备份 ===
if (btnExportBackup) {
  btnExportBackup.addEventListener('click', async () => {
    btnExportBackup.disabled = true;
    btnExportBackup.textContent = '导出中...';
    try {
      const res = await window.wordpopAPI.exportBackup();
      if (res.success) {
        alert(`✅ 备份导出成功！\n\n已备份 ${res.counts.progressCount} 条单词进度与 ${res.counts.statsCount} 天打卡记录。\n文件保存在: ${res.filePath}`);
      } else if (res.error !== '用户取消') {
        alert('导出失败: ' + res.error);
      }
    } catch (e) {
      alert('导出备份失败: ' + e.message);
    }
    btnExportBackup.disabled = false;
    btnExportBackup.textContent = '📤 导出备份数据';
  });
}

// === 导入恢复 ===
if (btnImportBackup) {
  btnImportBackup.addEventListener('click', async () => {
    const confirmed = confirm('导入备份将恢复/合并单词复习进度、打卡统计和个性化设置。是否继续？');
    if (!confirmed) return;

    btnImportBackup.disabled = true;
    btnImportBackup.textContent = '恢复中...';
    try {
      const res = await window.wordpopAPI.importBackup();
      if (res.success) {
        alert(`✅ 备份恢复成功！\n\n共恢复 ${res.counts.restoredProgress} 个单词学习进度和 ${res.counts.restoredStats} 天打卡记录。\n设置已同步更新。`);
        // 重新初始化设置页面状态
        await init();
      } else if (res.error !== '用户取消') {
        alert('恢复失败: ' + res.error);
      }
    } catch (e) {
      alert('恢复备份失败: ' + e.message);
    }
    btnImportBackup.disabled = false;
    btnImportBackup.textContent = '📥 导入恢复数据';
  });
}

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
