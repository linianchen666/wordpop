// WordPop 设置面板逻辑

// === DOM 引用 ===
const dailyNewWords = document.getElementById('dailyNewWords');
const showExample = document.getElementById('showExample');
const autoPronounce = document.getElementById('autoPronounce');
const fontSize = document.getElementById('fontSize');
const autoStart = document.getElementById('autoStart');
const wordlistOptions = document.getElementById('wordlist-options');
const positionSelector = document.getElementById('position-selector');
const btnSave = document.getElementById('btn-save');
const btnCancel    = document.getElementById('btn-cancel');
const btnLogs      = document.getElementById('btn-logs');
const btnImportCustom = document.getElementById('btn-import-custom');

let currentConfig = {};
let selectedWordlists = [];
let selectedPosition = 'bottom-right';
let availableWordlists = [];

// === 初始化：加载当前配置 ===
async function init() {
  try {
    currentConfig = await window.wordpopAPI.getConfig();
    availableWordlists = await window.wordpopAPI.getWordlists();
  } catch (err) {
    console.error('Failed to load config:', err);
    return;
  }

  // 填充表单
  dailyNewWords.value = currentConfig.dailyNewWords || 20;
  showExample.checked = currentConfig.showExample !== false;
  autoPronounce.checked = currentConfig.autoPronounce || false;
  fontSize.value = currentConfig.fontSize || 'medium';
  autoStart.checked = currentConfig.autoStart || false;
  selectedWordlists = [...(currentConfig.selectedWordlists || ['cet4'])];
  selectedPosition = currentConfig.popupPosition || 'bottom-right';

  // 渲染词库列表
  renderWordlists();

  // 设置位置选择器
  document.querySelectorAll('.position-option').forEach(el => {
    el.classList.toggle('active', el.dataset.pos === selectedPosition);
  });

  // 如果这是首次设置，显示提示
  if (!currentConfig.setupComplete) {
    document.querySelector('.settings-subtitle').textContent = '首次使用，请选择学习偏好';
  }
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

// === 保存设置 ===
btnSave.addEventListener('click', async () => {
  btnSave.disabled = true;
  btnSave.textContent = '保存中...';

  const newConfig = {
    dailyNewWords: parseInt(dailyNewWords.value),
    popupPosition: selectedPosition,
    selectedWordlists: selectedWordlists,
    showExample: showExample.checked,
    autoPronounce: autoPronounce.checked,
    fontSize: fontSize.value,
    autoStart: autoStart.checked,
    setupComplete: true
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

// === 查看日志（新增）===
if (btnLogs) {
  btnLogs.addEventListener('click', async () => {
    try {
      const result = await window.wordpopAPI.getLogs();
      if (result && result.logs) {
        alert(result.logs.slice(-3000));
      }
    } catch (err) {
      alert('读取日志失败：' + err.message);
    }
  });
}
