const listeners = new Set();

const EMPTY_SNAPSHOT = Object.freeze({
  adaptiveTier: 0,
  devicePixelRatio: 1,
  effectiveDpr: 1,
  effectiveQuality: "unavailable",
  maxTextureSize: 0,
  rendererStatus: "unavailable",
  requestedQuality: "unavailable",
  updatedAt: null,
});

let snapshot = EMPTY_SNAPSHOT;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function publishGraphicsDiagnostics(value = {}, status = null) {
  snapshot = Object.freeze({
    adaptiveTier: Math.max(0, Math.floor(finiteNumber(value.adaptiveTier))),
    devicePixelRatio: Math.max(0.1, finiteNumber(value.devicePixelRatio, 1)),
    effectiveDpr: Math.max(0.1, finiteNumber(value.effectiveDpr, 1)),
    effectiveQuality: String(value.qualityProfile?.id ?? value.effectiveQuality ?? "unavailable"),
    maxTextureSize: Math.max(0, Math.floor(finiteNumber(value.maxTextureSize))),
    rendererStatus: String(status ?? value.rendererStatus ?? "unavailable"),
    requestedQuality: String(
      value.requestedQualityProfile?.id ?? value.requestedQuality ?? "unavailable",
    ),
    updatedAt: new Date().toISOString(),
  });
  listeners.forEach((listener) => listener());
  return snapshot;
}

export function getGraphicsDiagnosticsSnapshot() {
  return snapshot;
}

export function subscribeGraphicsDiagnostics(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const graphicsDiagnosticsEmptySnapshot = EMPTY_SNAPSHOT;
