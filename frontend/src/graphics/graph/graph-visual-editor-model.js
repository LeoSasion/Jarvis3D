export function graphSettingChanged(value, defaultValue) {
  if (typeof value === "number" && typeof defaultValue === "number") {
    return Math.abs(value - defaultValue) > 1e-8;
  }
  return defaultValue !== undefined && value !== defaultValue;
}

export function matchesGraphControlFilter(filter, control) {
  if (filter.changedOnly && !graphSettingChanged(control.value, control.defaultValue)) return false;
  const normalize = (value) => String(value ?? "").normalize("NFKC").toLocaleLowerCase().replace(/[._-]/gu, " ");
  const terms = normalize(filter.query).trim().split(/\s+/u).filter(Boolean);
  const text = normalize([control.label, control.detail, control.path].join(" "));
  return terms.every((term) => text.includes(term));
}

export function graphSettingDefault(defaults, dimension, section, setting) {
  return (defaults.dimensions?.[`${dimension}d`]?.[section] ?? defaults[section])?.[setting];
}

export const GRAPH_EDITOR_COPY = Object.freeze({
  "en-US": Object.freeze({
    search: "Search all parameters", changed: "Modified only", reset: "Reset this parameter",
    empty: "No parameters match. Clear the search or Modified only filter.",
    capture: "Capture A", recapture: "Replace A", a: "A · Reference", b: "B · Current", end: "End comparison",
    freeze: "Freeze camera & signals", frozen: "Camera and animation time are frozen. Unfreeze to continue.",
    reference: "Showing A. Switch to B to edit your current settings.",
    comparing: "A is a temporary reference. Switching views does not save or undo your edits.",
    results: "Search results across all categories", modified: "Parameters changed from the startup defaults",
    clearFilters: "Clear filters",
    palette: "Color source", theme: "Follow theme", custom: "Custom colors",
  }),
  "zh-CN": Object.freeze({
    search: "搜索全部参数", changed: "仅看修改项", reset: "恢复此项默认值",
    empty: "没有匹配的参数，请清空搜索或关闭「仅看修改项」。",
    capture: "记录 A", recapture: "重新记录 A", a: "A · 参照", b: "B · 当前", end: "结束对比",
    freeze: "固定镜头与信号时间", frozen: "镜头和动画时间已固定，解除后连续播放。",
    reference: "正在显示 A；切回 B 可继续调整当前参数。",
    comparing: "A 是临时参照，切换不会保存参照或撤销你的调整。",
    results: "在全部分类中搜索", modified: "显示与启动默认值不同的参数",
    clearFilters: "清空筛选",
    palette: "颜色来源", theme: "跟随主题", custom: "自定义颜色",
  }),
});
