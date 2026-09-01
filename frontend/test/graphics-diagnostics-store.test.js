import assert from "node:assert/strict";
import test from "node:test";
import {
  getGraphicsDiagnosticsSnapshot,
  publishGraphicsDiagnostics,
  subscribeGraphicsDiagnostics,
} from "../src/graphics/runtime/graphics-diagnostics-store.js";

test("graphics diagnostics expose only bounded runtime facts", () => {
  let notifications = 0;
  const unsubscribe = subscribeGraphicsDiagnostics(() => {
    notifications += 1;
  });
  publishGraphicsDiagnostics({
    adaptiveTier: 2.8,
    devicePixelRatio: 2,
    effectiveDpr: 1.25,
    maxTextureSize: 16_384,
    qualityProfile: { id: "balanced" },
    requestedQualityProfile: { id: "high" },
  }, "ready");
  unsubscribe();

  assert.equal(notifications, 1);
  assert.deepEqual(
    {
      adaptiveTier: getGraphicsDiagnosticsSnapshot().adaptiveTier,
      effectiveDpr: getGraphicsDiagnosticsSnapshot().effectiveDpr,
      effectiveQuality: getGraphicsDiagnosticsSnapshot().effectiveQuality,
      rendererStatus: getGraphicsDiagnosticsSnapshot().rendererStatus,
      requestedQuality: getGraphicsDiagnosticsSnapshot().requestedQuality,
    },
    {
      adaptiveTier: 2,
      effectiveDpr: 1.25,
      effectiveQuality: "balanced",
      rendererStatus: "ready",
      requestedQuality: "high",
    },
  );
});
