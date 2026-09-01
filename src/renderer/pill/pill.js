const wordText = document.getElementById('pill-word');
const transText = document.getElementById('pill-trans');
const btnClose = document.getElementById('btn-close');
const container = document.getElementById('pill-container');

let currentWord = null;
let voiceType = 'dict-us';

// 监听状态更新
window.wordpopAPI.onPillData((data) => {
  if (data.action === 'updateConfig') {
    document.documentElement.setAttribute('data-theme', data.theme || 'light');
    voiceType = data.pronounceVoice || 'dict-us';
  } else if (data.action === 'showWord') {
    currentWord = data.word;
    wordText.textContent = data.word.word || '--';
    transText.textContent = data.word.translation || '--';
  }
});

btnClose.addEventListener('click', (e) => {
  e.stopPropagation();
  window.wordpopAPI.closePill();
});

container.addEventListener('click', () => {
  if (currentWord && currentWord.word) {
    playWordAudio(currentWord.word, voiceType);
  }
});
