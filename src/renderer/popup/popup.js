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
let autoHideTimer = null;

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

  // 进度信息
  if (data.progress) {
    progressText.textContent = `阶段 ${data.progress.stage}/8`;
    progressFill.style.width = `${(data.progress.stage / 8) * 100}%`;
  } else {
    progressText.textContent = '新词';
    progressFill.style.width = '0%';
  }

  if (data.queueRemaining !== undefined && data.queueRemaining > 0) {
    progressText.textContent += ` | 剩余 ${data.queueRemaining}`;
  }

  // 淡入
  container.classList.remove('hiding');

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

  // 准备淡出
  container.classList.add('hiding');
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

  container.classList.add('hiding');
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
