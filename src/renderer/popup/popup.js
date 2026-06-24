// WordPop 弹窗交互逻辑

// === 两阶段交互状态 ===
// phase = 'recall': 只显示英文单词+音标，等待用户主动回忆
// phase = 'reveal': 显示释义+按钮，等待用户判断认识/模糊/不认识
let phase = 'recall';

// === DOM 引用 ===
const container = document.getElementById('popup-container');
const wordText = document.getElementById('word-text');
const phoneticText = document.getElementById('phonetic-text');
const translationText = document.getElementById('translation-text');
const exampleText = document.getElementById('example-text');
const progressText = document.getElementById('progress-text');
const progressFill = document.getElementById('progress-fill');
const btnKnown = document.getElementById('btn-known');
const btnUnknown = document.getElementById('btn-unknown');
const btnFuzzy = document.getElementById('btn-fuzzy');
const btnMastered = document.getElementById('btn-mastered');
const btnMinimize = document.getElementById('btn-minimize');
const btnReveal = document.getElementById('btn-reveal');
const revealArea = document.getElementById('reveal-area');
const wordDetail = document.getElementById('word-detail');
const actionButtons = document.getElementById('action-buttons');
const exampleEn = document.getElementById('example-en');
const exampleCn = document.getElementById('example-cn');
const etymologySection = document.getElementById('etymology-section');
const etymologyContent = document.getElementById('etymology-content');

let currentWord = null;

// === 切换到回忆阶段（新单词出现时） ===
function enterRecallPhase() {
  phase = 'recall';
  revealArea.classList.remove('hidden');
  wordDetail.classList.add('hidden');
  actionButtons.classList.add('hidden');
  btnMastered.classList.add('hidden');
  // 回忆阶段居中显示
  document.querySelector('.popup-body').classList.remove('reveal-mode');
}

// === 切换到显示阶段（用户点击显示释义后） ===
function enterRevealPhase() {
  phase = 'reveal';
  revealArea.classList.add('hidden');
  wordDetail.classList.remove('hidden');
  actionButtons.classList.remove('hidden');
  btnMastered.classList.remove('hidden');
  // 揭示阶段内容多时靠顶对齐，避免单词被挤出视口
  document.querySelector('.popup-body').classList.add('reveal-mode');

  // 启用按钮
  btnKnown.disabled = false;
  btnUnknown.disabled = false;
  btnFuzzy.disabled = false;
  btnMastered.disabled = false;

  // 自动发音
  if (currentWord && currentWord.config && currentWord.config.autoPronounce && currentWord.word) {
    pronounceWord(currentWord.word, currentWord.config.pronounceAccent || 'en-US');
  }
}

// === 发音函数 ===
function pronounceWord(word, accent) {
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = accent || 'en-US';
    utterance.rate = 0.8;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  } catch (e) {}
}

// === 接收单词数据 ===
window.wordpopAPI.onWordData((data) => {
  currentWord = data;

  // 更新显示
  wordText.textContent = data.word;
  wordText.className = 'word-main' + (data.isNew ? ' new-word' : '');
  phoneticText.textContent = data.phonetic ? `/${data.phonetic}/` : '';
  translationText.textContent = data.translation || '';

  if (data.config && data.config.showExample && data.example) {
    // 拆分英文和中文：找第一个中文字符的位置
    const exampleStr = data.example;
    const cnIndex = exampleStr.search(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/);
    if (cnIndex > 0) {
      exampleEn.textContent = exampleStr.substring(0, cnIndex).trim();
      exampleCn.textContent = exampleStr.substring(cnIndex).trim();
    } else {
      exampleEn.textContent = exampleStr;
      exampleCn.textContent = '';
    }
    exampleText.style.display = 'block';
  } else {
    exampleText.style.display = 'none';
  }

  // 字体大小
  if (data.config && data.config.fontSize) {
    wordText.setAttribute('data-font', data.config.fontSize);
  }

  // 词源助记（始终显示）
  etymologySection.style.display = 'block';
  etymologySection.open = true; // 默认展开

  // 更新 summary 文本：有拆分时显示"词源助记"，无拆分时显示"词源"
  const etymologySummary = document.getElementById('etymology-summary');

  // 构造词源内容
  etymologyContent.innerHTML = '';

  if (data.etymology && data.etymology.parts && data.etymology.parts.length > 0) {
    etymologySummary.textContent = '🔍 词源助记';

    const analysisDiv = document.createElement('div');
    analysisDiv.className = 'etymology-analysis';
    analysisDiv.textContent = data.etymology.analysis || '';

    const partsDiv = document.createElement('div');
    partsDiv.className = 'etymology-parts';
    for (const part of data.etymology.parts) {
      const span = document.createElement('span');
      span.className = 'etymology-part';
      span.setAttribute('data-type', part.type);
      span.innerHTML = `<span class="etymology-type">${part.type}</span><span class="etymology-pattern">${part.pattern}</span>「${part.meaning}」`;
      partsDiv.appendChild(span);
    }

    etymologyContent.appendChild(analysisDiv);
    etymologyContent.appendChild(partsDiv);
  } else if (data.etymology && data.etymology.relatedRoots && data.etymology.relatedRoots.length > 0) {
    etymologySummary.textContent = '🔍 词源';

    const analysisDiv = document.createElement('div');
    analysisDiv.className = 'etymology-analysis';
    analysisDiv.textContent = data.etymology.analysis || '';

    const relatedDiv = document.createElement('div');
    relatedDiv.className = 'etymology-parts';
    for (const root of data.etymology.relatedRoots) {
      const span = document.createElement('span');
      span.className = 'etymology-part';
      span.setAttribute('data-type', '相关词根');
      span.innerHTML = `<span class="etymology-pattern">${root.pattern}</span>「${root.meaning}」`;
      relatedDiv.appendChild(span);
    }

    etymologyContent.appendChild(analysisDiv);
    etymologyContent.appendChild(relatedDiv);
  } else {
    etymologySummary.textContent = '🔍 词源';

    const analysisDiv = document.createElement('div');
    analysisDiv.className = 'etymology-analysis';
    analysisDiv.textContent = '此词为基础词汇，暂无词源分析';
    etymologyContent.appendChild(analysisDiv);
  }

  // 主题
  if (data.config && data.config.theme) {
    document.documentElement.setAttribute('data-theme', data.config.theme);
  }

  // 进度信息（9 阶段：0-8，共 9 格；stage 9 = 已掌握）
  if (data.progress) {
    const stage = data.progress.stage;
    if (stage >= 9) {
      progressText.textContent = '已掌握';
      progressFill.style.width = '100%';
    } else {
      progressText.textContent = `阶段 ${stage + 1}/9`;
      progressFill.style.width = `${((stage + 1) / 9) * 100}%`;
    }
  } else {
    progressText.textContent = '新词';
    progressFill.style.width = '0%';
  }

  if (data.queueRemaining !== undefined && data.queueRemaining > 0) {
    progressText.textContent += ` | 剩余 ${data.queueRemaining}`;
  }

  // 确保弹窗内容可见（移除 hiding 状态）
  container.classList.remove('hiding');

  // 新词边框提醒动画（不抢焦点时用视觉提示让用户注意）
  container.classList.remove('new-word-alert');
  void container.offsetHeight; // 触发 reflow 重置动画
  container.classList.add('new-word-alert');

  // 新词弹入动画
  if (data.isNew) {
    wordText.style.animation = 'none';
    // 触发 reflow 重置动画
    void wordText.offsetHeight;
    wordText.style.animation = '';
  }

  // 进入回忆阶段：只显示单词，隐藏释义和按钮
  enterRecallPhase();
});

// === 接收隐藏信号 ===
window.wordpopAPI.onHide(() => {
  container.classList.add('hiding');
});

// === 监听配置变更，立即刷新当前显示 ===
window.wordpopAPI.onConfigChanged((newConfig) => {
  if (!currentWord) return;

  // 更新 currentWord 中的 config 引用
  currentWord.config = {
    ...currentWord.config,
    ...newConfig
  };

  // 立即应用主题
  if (newConfig.theme) {
    document.documentElement.setAttribute('data-theme', newConfig.theme);
  }

  // 立即应用字号
  if (newConfig.fontSize) {
    wordText.setAttribute('data-font', newConfig.fontSize);
  }

  // 立即应用例句显示/隐藏
  if (newConfig.showExample !== undefined) {
    if (newConfig.showExample && currentWord.example) {
      exampleText.style.display = 'block';
    } else {
      exampleText.style.display = 'none';
    }
  }
});

// === 点击「显示释义」按钮 ===
btnReveal.addEventListener('click', () => {
  if (!currentWord) return;
  enterRevealPhase();
});

// === 禁用所有操作按钮 ===
function disableActionButtons() {
  btnKnown.disabled = true;
  btnUnknown.disabled = true;
  btnFuzzy.disabled = true;
  btnMastered.disabled = true;
}

// === 视觉反馈闪烁 ===
function flashContainer() {
  container.style.opacity = '0.7';
  setTimeout(() => { container.style.opacity = ''; }, 100);
}

// === 点击「认识」 ===
btnKnown.addEventListener('click', () => {
  if (!currentWord || phase !== 'reveal') return;
  disableActionButtons();

  btnKnown.style.transform = 'scale(0.95)';
  setTimeout(() => { btnKnown.style.transform = ''; }, 150);

  window.wordpopAPI.markKnown();
  currentWord = null;
  flashContainer();
});

// === 点击「不认识」 ===
btnUnknown.addEventListener('click', () => {
  if (!currentWord || phase !== 'reveal') return;
  disableActionButtons();

  btnUnknown.style.transform = 'scale(0.95)';
  setTimeout(() => { btnUnknown.style.transform = ''; }, 150);

  window.wordpopAPI.markUnknown();
  currentWord = null;
  flashContainer();
});

// === 点击「模糊」 ===
btnFuzzy.addEventListener('click', () => {
  if (!currentWord || phase !== 'reveal') return;
  disableActionButtons();

  btnFuzzy.style.transform = 'scale(0.95)';
  setTimeout(() => { btnFuzzy.style.transform = ''; }, 150);

  window.wordpopAPI.markFuzzy();
  currentWord = null;
  flashContainer();
});

// === 点击「熟知」(右上角) ===
btnMastered.addEventListener('click', () => {
  if (!currentWord || phase !== 'reveal') return;
  disableActionButtons();

  window.wordpopAPI.markMastered();
  currentWord = null;
  flashContainer();
});

// === 最小化 ===
btnMinimize.addEventListener('click', () => {
  window.wordpopAPI.minimizePopup();
});

// === 点击单词发音（Web Speech API） ===
wordText.addEventListener('click', () => {
  if (!currentWord || !currentWord.word) return;
  const accent = (currentWord.config && currentWord.config.pronounceAccent) || 'en-US';
  pronounceWord(currentWord.word, accent);

  // 视觉反馈
  wordText.style.color = 'var(--color-primary)';
  setTimeout(() => { wordText.style.color = ''; }, 500);
});

// === 键盘快捷键 ===
document.addEventListener('keydown', (e) => {
  // Ctrl+Z / Cmd+Z 撤销
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    window.wordpopAPI.undo();
    return;
  }

  if (!currentWord) return;

  // 忽略带有修饰键的快捷键（如 Win+Shift+S、Ctrl+S 等）
  if (e.altKey || e.ctrlKey || e.metaKey) return;

  switch (e.key.toLowerCase()) {
    case ' ':
      e.preventDefault();
      if (phase === 'recall') {
        btnReveal.click();
      } else {
        wordText.click();
      }
      break;
    case 'arrowleft':
    case 'a':
      // 不认识 — 仅在显示阶段可用
      if (phase === 'reveal' && !btnUnknown.disabled) {
        btnUnknown.click();
      }
      break;
    case 'arrowdown':
    case 's':
      // 模糊 — 仅在显示阶段可用
      if (phase === 'reveal' && !btnFuzzy.disabled) {
        btnFuzzy.click();
      }
      break;
    case 'arrowright':
    case 'd':
      if (phase === 'recall') {
        btnReveal.click();
      } else if (!btnKnown.disabled) {
        btnKnown.click();
      }
      break;
    case 'enter':
      if (phase === 'recall') {
        btnReveal.click();
      } else if (!btnKnown.disabled) {
        // 回车 = 认识（最常用的操作）
        btnKnown.click();
      }
      break;
    case 'm':
      // 熟知 — 仅在显示阶段可用
      if (phase === 'reveal' && !btnMastered.disabled) {
        btnMastered.click();
      }
      break;
    case 'escape':
      btnMinimize.click();
      break;
  }
});
