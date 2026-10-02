// This state belongs to the current editor session, never to a saved profile.
const listeners = new Set();
const EMPTY = Object.freeze({ reference: null, side: "b", frozen: false });
let snapshot = EMPTY;

function update(patch) {
  snapshot = Object.freeze({ ...snapshot, ...patch });
  listeners.forEach((listener) => listener());
}

export const getGraphVisualPreviewSnapshot = () => snapshot;
export function subscribeGraphVisualPreview(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function captureGraphVisualReference(settings) {
  update({ reference: settings, side: "b" });
}
export function selectGraphVisualPreview(side) {
  const next = side === "a" && snapshot.reference ? "a" : "b";
  if (snapshot.side !== next) update({ side: next });
}
export function setGraphVisualPreviewFrozen(frozen) {
  if (snapshot.frozen !== Boolean(frozen)) update({ frozen: Boolean(frozen) });
}
export function endGraphVisualPreview() {
  if (snapshot === EMPTY) return;
  snapshot = EMPTY;
  listeners.forEach((listener) => listener());
}
export function resolveGraphVisualPreview(settings) {
  return snapshot.side === "a" && snapshot.reference ? snapshot.reference : settings;
}

// Input focus, source graph, and presentation are part of the captured view.
// Queue live changes while comparing so a dimension change cannot remount the
// scene and discard its signal history. Resume uses the latest live input.
export function selectGraphComparisonView(previous, next, frozen) {
  if (frozen && previous) return previous;
  const view = {
    dimension: next.dimension,
    interactive: Boolean(next.interactive),
    scene: next.scene,
    motionMode: next.motionMode,
    graph: next.graph,
    hoveredNodeId: next.hoveredNodeId ?? null,
    selectedNodeId: next.selectedNodeId ?? null,
  };
  if (previous && Object.keys(view).every((key) => previous[key] === view[key])) return previous;
  return Object.freeze(view);
}

// Keep the renderer's clock continuous when a paused demand-driven canvas has
// produced no frames for a long time. Resuming never catches up the paused gap.
export function createGraphComparisonClock() {
  let lastRaw = null;
  let elapsed = 0;
  let wasFrozen = false;
  return {
    sample(rawTime, delta, frozen) {
      const raw = Number.isFinite(rawTime) ? rawTime : (lastRaw ?? 0);
      if (lastRaw === null) elapsed = raw;
      else if (!frozen && !wasFrozen) elapsed += Math.max(0, raw - lastRaw);
      lastRaw = raw;
      const frameDelta = frozen || wasFrozen ? 0 : Math.min(0.05, Math.max(0, delta || 0));
      wasFrozen = frozen;
      return { elapsed, frameDelta };
    },
  };
}
