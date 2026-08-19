import assert from "node:assert/strict";
import test from "node:test";
import {
  getVisualEffectsRuntimeSnapshot,
  markVisualEffectsRuntimeUnavailable,
  publishVisualEffectsRenderPlan,
} from "../src/visual-effects/visual-effects-runtime-state.js";

test("runtime status separates requested preferences from effective overlay state", () => {
  publishVisualEffectsRenderPlan({
    backend: "none",
    reason: "disabled",
    layerCount: 0,
  });
  assert.deepEqual(getVisualEffectsRuntimeSnapshot(), {
    status: "off",
    backend: "none",
    layerCount: 0,
    reason: "disabled",
  });

  publishVisualEffectsRenderPlan({
    backend: "css-overlay",
    reason: null,
    layerCount: 2,
  });
  assert.deepEqual(getVisualEffectsRuntimeSnapshot(), {
    status: "active",
    backend: "css-overlay",
    layerCount: 2,
    reason: null,
  });
});

test("runtime faults stay distinct from the persisted visual preset", () => {
  markVisualEffectsRuntimeUnavailable("runtime-fault");
  assert.deepEqual(getVisualEffectsRuntimeSnapshot(), {
    status: "unavailable",
    backend: "none",
    layerCount: 0,
    reason: "runtime-fault",
  });
});
