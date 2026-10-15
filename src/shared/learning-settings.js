// Learning preferences only. Appearance, credentials and review state stay local.
const GROUPS = ["selectedWordlists", "learningPlan", "autoBalanceLoad"];
const LISTS = ["cet4", "cet6", "kaoyan"];
function groups(config = {}) {
  if (
    config.selectedWordlists !== undefined &&
    !Array.isArray(config.selectedWordlists)
  )
    throw new Error("词库格式无效");
  const lists = [...new Set(config.selectedWordlists || ["cet4"])].sort();
  if (
    !lists.length ||
    lists.some(
      (id) => !LISTS.includes(id) && !/^custom_[A-Za-z0-9_-]+$/.test(id),
    )
  )
    throw new Error("请选择两端支持的词库");
  const mode = config.dailyNewWordsMode || "fixed";
  const daily = config.dailyNewWords ?? 20;
  const target = config.targetDate || null;
  if (
    !["fixed", "target"].includes(mode) ||
    !Number.isInteger(daily) ||
    daily < 1 ||
    daily > 200
  )
    throw new Error("学习计划格式无效");
  if (
    target &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(target) ||
      !Number.isFinite(Date.parse(target)) ||
      new Date(target).toISOString().slice(0, 10) !== target)
  )
    throw new Error("目标日期格式无效");
  if (mode === "target" && !target) throw new Error("智能规划需要目标日期");
  return {
    selectedWordlists: lists,
    learningPlan: {
      dailyNewWordsMode: mode,
      dailyNewWords: daily,
      targetDate: target,
    },
    autoBalanceLoad: config.autoBalanceLoad !== false,
  };
}
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function mergeDraft(latest, draft, base) {
  const original = groups(base),
    edited = groups({ ...base, ...draft }),
    current = groups(latest);
  const chosen = {};
  for (const key of GROUPS)
    chosen[key] = equal(original[key], edited[key])
      ? current[key]
      : edited[key];
  return {
    ...latest,
    ...draft,
    selectedWordlists: chosen.selectedWordlists,
    ...chosen.learningPlan,
    autoBalanceLoad: chosen.autoBalanceLoad,
  };
}
function capture(state, before, after, id) {
  const previous = groups(before),
    next = groups(after);
  const pending = { ...(state?.pending || {}) };
  for (const key of GROUPS)
    if (
      key === "selectedWordlists" &&
      next[key].some((id) => !LISTS.includes(id))
    )
      delete pending[key];
    else if (!equal(previous[key], next[key]))
      pending[key] = { id, value: next[key] };
  return { ...state, pending };
}
function seed(state, config, id) {
  const values = groups(config),
    pending = { ...(state?.pending || {}) };
  for (const key of GROUPS)
    if (
      !pending[key] &&
      (key !== "selectedWordlists" ||
        values[key].every((id) => LISTS.includes(id)))
    )
      pending[key] = { id, value: values[key] };
  return { ...state, pending };
}
function upload(state, userId) {
  return GROUPS.filter((key) => state?.pending?.[key]).map((key) => ({
    id: state.pending[key].id,
    user_id: userId,
    setting_key: key,
    value: state.pending[key].value,
  }));
}
function apply(state, config, rows, sent = []) {
  const pending = { ...(state?.pending || {}) };
  for (const row of sent)
    if (pending[row.setting_key]?.id === row.id)
      delete pending[row.setting_key];
  const values = groups(config);
  for (const row of rows)
    if (GROUPS.includes(row.setting_key) && !pending[row.setting_key]) {
      if (
        row.setting_key === "selectedWordlists" &&
        values.selectedWordlists.some((id) => !LISTS.includes(id))
      )
        continue;
      if (
        row.setting_key === "autoBalanceLoad" &&
        typeof row.value !== "boolean"
      )
        throw new Error("云端减负设置无效");
      if (row.setting_key === "selectedWordlists" && !Array.isArray(row.value))
        throw new Error("云端词库设置无效");
      if (
        row.setting_key === "selectedWordlists" &&
        row.value.some((id) => !LISTS.includes(id))
      )
        throw new Error("云端词库不受支持");
      if (
        row.setting_key === "learningPlan" &&
        (!row.value ||
          typeof row.value !== "object" ||
          Array.isArray(row.value) ||
          !["dailyNewWordsMode", "dailyNewWords", "targetDate"].every((key) =>
            Object.hasOwn(row.value, key),
          ))
      )
        throw new Error("云端学习计划无效");
      values[row.setting_key] = row.value;
    }
  const next = {
    ...config,
    selectedWordlists: values.selectedWordlists,
    dailyNewWordsMode: values.learningPlan.dailyNewWordsMode,
    dailyNewWords: values.learningPlan.dailyNewWords,
    targetDate: values.learningPlan.targetDate,
    autoBalanceLoad: values.autoBalanceLoad,
  };
  // Validate the whole result before acknowledging any pending changes.
  const valid = groups(next);
  return {
    state: { ...state, pending },
    config: next,
    changed: !equal(groups(config), valid),
  };
}
module.exports = { GROUPS, groups, capture, seed, upload, apply, mergeDraft };
