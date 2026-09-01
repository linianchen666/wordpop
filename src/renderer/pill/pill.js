const wordText = document.getElementById('pill-word');
const transText = document.getElementById('pill-trans');
const btnAudio = document.getElementById('btn-audio');
const btnClose = document.getElementById('btn-close');
const contentArea = document.getElementById('pill-content');

let currentWord = null;
let autoPronounce = false;
let voiceType = 'dict-us';

// 监听状态更新
window.wordpopAPI.onPillData((data) => {
  if (data.action === 'updateConfig') {
    document.documentElement.setAttribute('data-theme', data.theme || 'light');
    autoPronounce = !!data.autoPronounce;
    voiceType = data.pronounceVoice || 'dict-us';
  } else if (data.action === 'showWord') {
    currentWord = data.word;
    wordText.textContent = data.word.word || '--';
    transText.textContent = data.word.translation || '--';
    // 胶囊更新时不再自动发音
  }
});

document.body.addEventListener('mouseenter', () => {
  if (window.wordpopAPI.pillHover) window.wordpopAPI.pillHover(true);
});

document.body.addEventListener('mouseleave', () => {
  if (window.wordpopAPI.pillHover) window.wordpopAPI.pillHover(false);
});

btnAudio.addEventListener('click', () => {
  if (currentWord && currentWord.word) {
    playWordAudio(currentWord.word, voiceType);
  }
});

btnClose.addEventListener('click', () => {
  window.wordpopAPI.closePill();
});

contentArea.addEventListener('click', () => {
  // 点击中间区域也可以发音或者可以跳转
  if (currentWord && currentWord.word) {
    playWordAudio(currentWord.word, voiceType);
  }
});
