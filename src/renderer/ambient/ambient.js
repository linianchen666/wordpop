const wordText = document.getElementById('ambient-word');
const translation = document.getElementById('ambient-translation');
window.wordpopAPI.onAmbientWord(data => {
  document.documentElement.dataset.theme = data.theme;
  if (!data.word) {
    wordText.textContent = data.error ? '暂时无法加载' : '暂无待巩固单词';
    translation.textContent = data.error ? '稍后自动重试' : '完成复习后，会自动显示需要加强记忆的词';
  } else {
    wordText.textContent = data.word.word;
    translation.textContent = window.wordpopTranslations.summarize(data.word.translation,
      { maxGroups: 1, maxSenses: 1, maxLength: 18 }).summary;
  }
  wordText.style.fontSize = '15px';
  for (let size = 14; size >= 10 && wordText.scrollWidth > wordText.clientWidth; size--) {
    wordText.style.fontSize = `${size}px`;
  }
  wordText.title = wordText.textContent;
  translation.title = data.word?.translation || translation.textContent;
});
