// A bounded window of active frame intervals, not GPU execution timings.
export function createFrameStatisticsWindow() {
  return { intervals: new Float64Array(600), count: 0, cursor: 0, lastAt: null, publishedAt: 0 };
}

export function recordFrameStatistics(state, durationMs, now) {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || !Number.isFinite(now)) return null;
  if (state.lastAt !== null && (now < state.lastAt || now - state.lastAt > Math.max(1_000, durationMs * 1.5))) {
    state.count = 0;
    state.cursor = 0;
  }
  state.lastAt = now;
  state.intervals[state.cursor] = durationMs;
  state.cursor = (state.cursor + 1) % state.intervals.length;
  state.count = Math.min(state.count + 1, state.intervals.length);
  if (state.count < 8 || now - state.publishedAt < 1_000) return null;
  state.publishedAt = now;
  const samples = Array.from(state.intervals.subarray(0, state.count)).sort((a, b) => a - b);
  const total = samples.reduce((sum, value) => sum + value, 0);
  return Object.freeze({
    count: state.count,
    meanMs: total / samples.length,
    p50Ms: samples[Math.ceil(samples.length * 0.5) - 1],
    p95Ms: samples[Math.ceil(samples.length * 0.95) - 1],
    maxMs: samples[samples.length - 1],
    sampledDurationMs: total,
  });
}
