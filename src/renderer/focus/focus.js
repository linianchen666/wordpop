// WordPop 沉浸专注刷词逻辑

// === DOM 元素 ===
const focusLoading       = document.getElementById('focus-loading');
const focusCard          = document.getElementById('focus-card');
const focusSummary       = document.getElementById('focus-summary');
const focusFooter        = document.getElementById('focus-footer');
const focusProgressFill  = document.getElementById('focus-progress-fill');
const currentIndexEl     = document.getElementById('current-index');
const totalCountEl       = document.getElementById('total-count');
const comboBadge         = document.getElementById('combo-badge');
const comboText          = document.getElementById('combo-text');
const btnClose           = document.getElementById('btn-close');

// 卡片内元素
const wordStageTag       = document.getElementById('word-stage-tag');
const focusWordEl        = document.getElementById('focus-word');
const focusPhoneticEl    = document.getElementById('focus-phonetic');
const focusRevealPrompt  = document.getElementById('focus-reveal-prompt');
const focusDetail        = document.getElementById('focus-detail');
const focusTranslation   = document.getElementById('focus-translation');
const focusExampleEn     = document.getElementById('focus-example-en');
const focusExampleCn     = document.getElementById('focus-example-cn');
const focusEtymology     = document.getElementById('focus-etymology');
const focusEtymologyText = document.getElementById('focus-etymology-text');

// 按钮
const btnUnknown         = document.getElementById('btn-unknown');
const btnFuzzy           = document.getElementById('btn-fuzzy');
const btnKnown           = document.getElementById('btn-known');
const btnMastered        = document.getElementById('btn-mastered');

// 结算报告元素
const sumCount           = document.getElementById('sum-count');
const sumAccuracy        = document.getElementById('sum-accuracy');
const sumMaxCombo        = document.getElementById('sum-max-combo');
const sumTime            = document.getElementById('sum-time');
const btnAgain20         = document.getElementById('btn-again-20');
const btnFinish          = document.getElementById('btn-finish');

// === 状态变量 ===
let sessionWords = [];
let currentIndex = 0;
let phase = 'recall'; // 'recall' | 'reveal'
let combo = 0;
let maxCombo = 0;
let correctCount = 0;
let wrongCount = 0;
let sessionStartTime = Date.now();
let activeAudio = null;
let currentConfig = {};

// === 初始化 ===
async function initSession(targetCount = 20) {
  try {
    currentConfig = await window.wordpopAPI.getConfig();
  } catch (e) {
    currentConfig = {};
  }

  focusLoading.style.display = 'flex';
  focusCard.style.display = 'none';
  focusSummary.style.display = 'none';
  focusFooter.style.display = 'none';

  currentIndex = 0;
  combo = 0;
  maxCombo = 0;
  correctCount = 0;
  wrongCount = 0;
  sessionStartTime = Date.now();

  try {
    const res = await window.wordpopAPI.getFocusWords(targetCount);
    if (res.success && res.words && res.words.length > 0) {
      sessionWords = res.words;
      totalCountEl.textContent = sessionWords.length;
      focusLoading.style.display = 'none';
      focusCard.style.display = 'flex';
      focusFooter.style.display = 'flex';
      showCurrentWord();
    } else {
      focusLoading.innerHTML = '<div class="loading-text">🎉 太棒了！暂无待复习单词与新词</div>';
      setTimeout(() => window.wordpopAPI.closeFocusSession(), 1500);
    }
  } catch (err) {
    focusLoading.innerHTML = `<div class="loading-text">加载失败: ${err.message}</div>`;
  }
}

// === 显示当前单词 ===
function showCurrentWord() {
  if (currentIndex >= sessionWords.length) {
    showSummary();
    return;
  }

  const word = sessionWords[currentIndex];
  phase = 'recall';

  // 进度指示
  currentIndexEl.textContent = currentIndex + 1;
  const percent = Math.round((currentIndex / sessionWords.length) * 100);
  focusProgressFill.style.width = percent + '%';

  // 连击指示
  if (combo >= 2) {
    comboBadge.style.display = 'flex';
    comboText.textContent = `${combo} 连击`;
  } else {
    comboBadge.style.display = 'none';
  }

  // 单词内容
  focusWordEl.textContent = word.word;
  focusPhoneticEl.textContent = word.phonetic ? `/${word.phonetic}/ 🔊` : '🔊 发音';

  const isNew = !word.stage || word.stage === 0;
  wordStageTag.textContent = isNew ? '新词' : `复习 (阶段 ${word.stage}/9)`;

  focusTranslation.textContent = word.translation || '';

  if (word.example) {
    const parts = word.example.split('\n');
    focusExampleEn.textContent = parts[0] || '';
    focusExampleCn.textContent = parts[1] || '';
    document.getElementById('focus-example').style.display = 'block';
  } else {
    document.getElementById('focus-example').style.display = 'none';
  }

  // 词源分析
  if (window.analyzeWord) {
    try {
      const ety = window.analyzeWord(word.word);
      if (ety && ety.hasRoot) {
        focusEtymologyText.textContent = `${ety.prefix ? ety.prefix + ' + ' : ''}${ety.root || ''}${ety.suffix ? ' + ' + ety.suffix : ''}`;
        focusEtymology.style.display = 'block';
      } else {
        focusEtymology.style.display = 'none';
      }
    } catch (e) {
      focusEtymology.style.display = 'none';
    }
  }

  // 初始隐藏释义
  focusRevealPrompt.style.display = 'block';
  focusDetail.style.display = 'none';

  // 自动发音
  if (currentConfig.autoPronounce) {
    playVoice(word.word);
  }
}

// === 展开释义 ===
function revealDetail() {
  if (phase === 'reveal') return;
  phase = 'reveal';
  focusRevealPrompt.style.display = 'none';
  focusDetail.style.display = 'block';
}

// === 提交当前单词结果 ===
async function submitWord(action) {
  if (currentIndex >= sessionWords.length) return;
  const word = sessionWords[currentIndex];

  if (action === 'known' || action === 'mastered') {
    correctCount++;
    combo++;
    if (combo > maxCombo) maxCombo = combo;
  } else {
    wrongCount++;
    combo = 0;
  }

  // 提交数据库
  try {
    window.wordpopAPI.submitFocusWord(word.id, action);
  } catch (e) {
    console.error('submitFocusWord error:', e);
  }

  currentIndex++;
  showCurrentWord();
}

// === 总结报告 ===
function showSummary() {
  focusProgressFill.style.width = '100%';
  focusCard.style.display = 'none';
  focusFooter.style.display = 'none';
  focusSummary.style.display = 'flex';

  const total = sessionWords.length;
  const accuracy = total > 0 ? Math.round((correctCount / total) * 100) : 100;
  const durationSec = Math.max(1, Math.round((Date.now() - sessionStartTime) / 1000));
  const mins = Math.floor(durationSec / 60);
  const secs = durationSec % 60;

  sumCount.textContent = total;
  sumAccuracy.textContent = accuracy + '%';
  sumMaxCombo.textContent = maxCombo;
  sumTime.textContent = `${mins}分${secs}秒`;
}

// === 发音 ===
function playVoice(word) {
  if (!word) return;
  playWordAudio(word, currentConfig.pronounceVoice || 'dict-us');
}

// === 事件绑定 ===
focusWordEl.addEventListener('click', () => {
  if (sessionWords[currentIndex]) playVoice(sessionWords[currentIndex].word);
});
focusPhoneticEl.addEventListener('click', () => {
  if (sessionWords[currentIndex]) playVoice(sessionWords[currentIndex].word);
});
focusRevealPrompt.addEventListener('click', () => revealDetail());

btnUnknown.addEventListener('click', () => submitWord('unknown'));
btnFuzzy.addEventListener('click', () => submitWord('fuzzy'));
btnKnown.addEventListener('click', () => submitWord('known'));
btnMastered.addEventListener('click', () => submitWord('mastered'));

btnAgain20.addEventListener('click', () => initSession(20));
btnFinish.addEventListener('click', () => window.wordpopAPI.closeFocusSession());
btnClose.addEventListener('click', () => window.wordpopAPI.closeFocusSession());

// === 全键盘快捷键 ===
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    window.wordpopAPI.closeFocusSession();
    return;
  }

  if (focusSummary.style.display !== 'none') {
    if (e.key === 'Enter' || e.key === ' ') {
      btnAgain20.click();
    }
    return;
  }

  switch (e.key.toLowerCase()) {
    case ' ':
      e.preventDefault();
      if (phase === 'recall') revealDetail();
      else if (sessionWords[currentIndex]) playVoice(sessionWords[currentIndex].word);
      break;
    case 'a':
    case 'arrowleft':
      if (phase === 'reveal') submitWord('unknown');
      else revealDetail();
      break;
    case 's':
    case 'arrowdown':
      if (phase === 'reveal') submitWord('fuzzy');
      else revealDetail();
      break;
    case 'd':
    case 'arrowright':
    case 'enter':
      if (phase === 'recall') revealDetail();
      else submitWord('known');
      break;
    case 'm':
      submitWord('mastered');
      break;
  }
});

// 启动
initSession(20);
