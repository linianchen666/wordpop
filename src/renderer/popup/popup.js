// WordPop 弹窗交互逻辑

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
const btnMinimize = document.getElementById('btn-minimize');

let currentWord = null;

// === 接收单词数据 ===
window.wordpopAPI.onWordData((data) => {
  currentWord = data;

  // 更新显示
  wordText.textContent = data.word;
  wordText.className = 'word-main' + (data.isNew ? ' new-word' : '');
  phoneticText.textContent = data.phonetic ? `/${data.phonetic}/` : '';
  translationText.textContent = data.translation || '';

  if (data.config && data.config.showExample && data.example) {
    exampleText.textContent = data.example;
    exampleText.style.display = 'block';
  } else {
    exampleText.style.display = 'none';
  }

  // 字体大小
  if (data.config && data.config.fontSize) {
    wordText.setAttribute('data-font', data.config.fontSize);
  }

  // 主题
  if (data.config && data.config.theme) {
    document.documentElement.setAttribute('data-theme', data.config.theme);
  }

  // 进度信息（9 阶段：0-8，共 9 格）
  if (data.progress) {
    progressText.textContent = `阶段 ${data.progress.stage + 1}/9`;
    progressFill.style.width = `${((data.progress.stage + 1) / 9) * 100}%`;
  } else {
    progressText.textContent = '新词';
    progressFill.style.width = '0%';
  }

  if (data.queueRemaining !== undefined && data.queueRemaining > 0) {
    progressText.textContent += ` | 剩余 ${data.queueRemaining}`;
  }

  // 确保弹窗内容可见（移除 hiding 状态）
  container.classList.remove('hiding');

  // 新词弹入动画
  if (data.isNew) {
    wordText.style.animation = 'none';
    // 触发 reflow 重置动画
    void wordText.offsetHeight;
    wordText.style.animation = '';
  }

  // 启用按钮
  btnKnown.disabled = false;
  btnUnknown.disabled = false;
});

// === 接收隐藏信号 ===
window.wordpopAPI.onHide(() => {
  container.classList.add('hiding');
});

// === 点击「认识」 ===
btnKnown.addEventListener('click', () => {
  if (!currentWord) return;
  btnKnown.disabled = true;
  btnUnknown.disabled = true;

  // 视觉反馈
  btnKnown.style.transform = 'scale(0.95)';
  setTimeout(() => { btnKnown.style.transform = ''; }, 150);

  window.wordpopAPI.markKnown();
  currentWord = null;

  // 不添加 hiding 类！下一个单词会立即替换内容
  // 只在视觉上做一个快速闪烁表示反馈
  container.style.opacity = '0.7';
  setTimeout(() => { container.style.opacity = ''; }, 100);
});

// === 点击「不认识」 ===
btnUnknown.addEventListener('click', () => {
  if (!currentWord) return;
  btnKnown.disabled = true;
  btnUnknown.disabled = true;

  btnUnknown.style.transform = 'scale(0.95)';
  setTimeout(() => { btnUnknown.style.transform = ''; }, 150);

  window.wordpopAPI.markUnknown();
  currentWord = null;

  // 不添加 hiding 类！
  container.style.opacity = '0.7';
  setTimeout(() => { container.style.opacity = ''; }, 100);
});

// === 最小化 ===
btnMinimize.addEventListener('click', () => {
  window.wordpopAPI.minimizePopup();
});

// === 点击单词发音（Web Speech API） ===
wordText.addEventListener('click', () => {
  if (!currentWord || !currentWord.word) return;

  // 停止之前的发音
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(currentWord.word);
  utterance.lang = 'en-US';
  utterance.rate = 0.8;
  utterance.pitch = 1.0;

  // 视觉反馈
  wordText.style.color = 'var(--color-primary)';
  utterance.onend = () => {
    wordText.style.color = '';
  };

  window.speechSynthesis.speak(utterance);
});

// === 键盘快捷键 ===
document.addEventListener('keydown', (e) => {
  if (!currentWord) return;
  switch (e.key.toLowerCase()) {
    case 'arrowleft':
    case 'a':
      btnUnknown.click();
      break;
    case 'arrowright':
    case 'd':
    case 'enter':
      btnKnown.click();
      break;
    case ' ':
      // 空格发音
      e.preventDefault();
      wordText.click();
      break;
    case 'escape':
      btnMinimize.click();
      break;
  }
});
