const wordText = document.getElementById('ambient-word');
const translation = document.getElementById('ambient-translation');
const reason = document.getElementById('ambient-reason');
const counter = document.getElementById('ambient-counter');
window.wordpopAPI.onAmbientWord(data => {
  document.documentElement.dataset.theme = data.theme;
  if (!data.word) {
    wordText.textContent = data.error ? '暂时无法加载' : '暂无待巩固单词';
    translation.textContent = data.error ? '稍后自动重试' : '完成复习后，会自动显示需要加强记忆的词';
    reason.textContent = '巩固提醒'; counter.textContent = '';
  } else {
    wordText.textContent = data.word.word;
    translation.textContent = data.word.translation;
    reason.textContent = data.word.latest_rating === 1 ? '最近回忆失败' : '困难反馈 ' + Math.round(data.word.error_rate * 100) + '%';
    counter.textContent = `${data.index} / ${data.total}`;
  }
  wordText.title = wordText.textContent;
  translation.title = translation.textContent;
});
