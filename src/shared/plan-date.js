(function(root) {
  const DAY = 86400000;
  function localDateKey(now = Date.now()) {
    const date = new Date(now);
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }
  function daysUntilInclusive(value, now = Date.now()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const [year, month, day] = value.split('-').map(Number);
    const target = new Date(Date.UTC(year, month-1, day));
    if (target.getUTCFullYear() !== year || target.getUTCMonth() !== month-1 || target.getUTCDate() !== day) return null;
    const today = new Date(now);
    return Math.round((target.getTime()-Date.UTC(today.getFullYear(),today.getMonth(),today.getDate()))/DAY)+1;
  }
  const api = { localDateKey, daysUntilInclusive };
  if (root) root.wordpopPlanDate = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window === 'undefined' ? null : window);
