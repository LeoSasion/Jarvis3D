export const GRAPHICS_REGRESSION_MANIFEST = Object.freeze({
  schemaVersion: 1,
  fixture: "six-clusters-96-v1",
  seed: "jarvis-webgl-v1",
  width: 960,
  height: 640,
  dpr: 1,
  quality: "balanced",
  theme: "nexus",
  stepSeconds: 1 / 60,
  captureFrames: 240,
  warmupFrames: 60,
  cases: Object.freeze([
    "idle", "explore-2d", "explore-3d", "frozen-a", "frozen-b",
    "frozen-a-restored", "reentry", "context-restored",
  ]),
});

export function createGraphicsRegressionGraph() {
  const nodes = Array.from({ length: 96 }, (_, index) => Object.freeze({
    id: `jarvis-webgl-v1-${index.toString().padStart(3, "0")}`,
    title: `Baseline ${index.toString().padStart(3, "0")}`,
    path: `Cluster-${Math.floor(index / 16)}/Note-${index}.md`,
    group: `Cluster-${Math.floor(index / 16)}`,
    tags: ["synthetic", `cluster-${Math.floor(index / 16)}`],
    weight: index % 16 === 0 ? 6 : 1,
  }));
  const edges = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const cluster = Math.floor(index / 16) * 16;
    const target = cluster + (index + 1) % 16;
    edges.push(Object.freeze({ source: nodes[index].id, target: nodes[target].id, weight: 1 }));
    if (index % 16 > 1) edges.push(Object.freeze({ source: nodes[cluster].id, target: nodes[index].id, weight: 1 }));
    if (index % 16 === 0) edges.push(Object.freeze({ source: nodes[index].id, target: nodes[(index + 16) % 96].id, weight: 1 }));
  }
  return Object.freeze({ nodes: Object.freeze(nodes), edges: Object.freeze(edges) });
}

// Only the standalone validation surface supplies this clock to GraphScene.
// Each real rendered frame advances one fixed step; wall-clock performance is
// measured separately, never substituted with the simulation's 16.67 ms step.
export function createGraphicsRegressionClock() {
  let frame = 0;
  let remaining = 0;
  let advanced = false;
  return Object.freeze({
    get frame() { return frame; },
    get remaining() { return remaining; },
    get advanced() { return advanced; },
    get elapsed() { return frame * GRAPHICS_REGRESSION_MANIFEST.stepSeconds; },
    advance(frames) {
      if (!Number.isInteger(frames) || frames < 1 || frames > 600 || remaining) {
        throw new Error("Expected 1–600 frames and an idle regression clock.");
      }
      remaining = frames;
    },
    sample(_rawTime, _delta, frozen) {
      advanced = !frozen && remaining > 0;
      if (advanced) { frame += 1; remaining -= 1; }
      return {
        elapsed: frame * GRAPHICS_REGRESSION_MANIFEST.stepSeconds,
        frameDelta: advanced ? GRAPHICS_REGRESSION_MANIFEST.stepSeconds : 0,
      };
    },
  });
}

export function summarizeRegressionIntervals(intervals) {
  const samples = intervals.filter((value) => Number.isFinite(value) && value > 0).slice(-600).sort((a, b) => a - b);
  if (samples.length < 8) return null;
  return Object.freeze({
    count: samples.length,
    p50Ms: samples[Math.ceil(samples.length * 0.5) - 1],
    p95Ms: samples[Math.ceil(samples.length * 0.95) - 1],
    maxMs: samples.at(-1),
    meanMs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
    measurement: "actual active frame intervals; not GPU execution time",
  });
}

export function digestRegressionNumbers(values = []) {
  let hash = 2166136261;
  for (const value of values) {
    hash = Math.imul(hash ^ Math.round(value * 10_000), 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
