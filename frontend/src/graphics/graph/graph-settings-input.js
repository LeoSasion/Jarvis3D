export function normalizeGraphRangeInput(raw, range, format, previous) {
  if (String(raw).trim() === "") return previous;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return previous;
  const value = format === "percent" ? numeric / 100 : numeric;
  if (Math.abs(value - previous) < 1e-9) return previous;
  const bounded = Math.max(range.min, Math.min(range.max, value));
  const stepped = range.min + Math.round((bounded - range.min) / range.step) * range.step;
  return Number(Math.max(range.min, Math.min(range.max, stepped)).toFixed(8));
}
