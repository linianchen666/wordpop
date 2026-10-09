// Shared by popup and focus; the main process supplies actual FSRS predictions.
window.createReviewPreview = function ({ status, buttons, suffix = () => '' }) {
  let generation = 0;
  const labels = { new: '新词', learning: '学习中', review: '复习中',
    relearning: '重新学习', mastered: '已掌握' };
  function intervalText(ms) {
    if (ms < 60000) return `${Math.max(1, Math.ceil(ms / 1000))}秒后`;
    if (ms < 3600000) return `${Math.ceil(ms / 60000)}分钟后`;
    if (ms < 86400000) return `${Math.round(ms / 3600000 * 10) / 10}小时后`;
    return `${Math.round(ms / 86400000 * 10) / 10}天后`;
  }
  async function refresh(wordId) {
    const request = ++generation;
    status.textContent = '加载复习计划…' + suffix();
    status.title = '';
    for (const { button, hint } of Object.values(buttons)) {
      hint.textContent = '…';
      button.title = '正在计算下次复习时间';
    }
    try {
      const result = await window.wordpopAPI.getReviewPreview(wordId);
      if (request !== generation) return;
      if (!result?.success) throw new Error(result?.error || '预览不可用');
      const due = result.dueAt;
      status.textContent = labels[result.state] +
        (due ? (due <= result.generatedAt ? ' · 已到期' : ' · ' + intervalText(due - result.generatedAt)) : '') + suffix();
      status.title = due ? '本次计划复习：' + new Date(due).toLocaleString('zh-CN') : '首次学习';
      for (const [action, { button, hint }] of Object.entries(buttons)) {
        const prediction = result.intervals[action];
        hint.textContent = intervalText(prediction.interval);
        button.title = `选择后下次复习：${new Date(prediction.dueAt).toLocaleString('zh-CN')}（${hint.textContent}）`;
      }
    } catch (error) {
      if (request !== generation) return;
      status.textContent = '复习计划暂不可用' + suffix();
      status.title = error.message;
      for (const { button, hint } of Object.values(buttons)) {
        hint.textContent = '—';
        button.title = '暂时无法预览，评分后仍按当前学习状态保存';
      }
    }
  }
  function cancel() { generation++; }
  return { refresh, cancel };
};
