import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_VISUAL_EFFECTS,
  createVisualEffectsRenderPlan,
  getVisualEffectsPresetId,
  getVisualEffectsSnapshot,
  initializeVisualEffects,
  normalizeVisualEffects,
  resetVisualEffects,
  setVisualEffectEnabled,
  setVisualEffectsEnabled,
  setVisualEffectsPreset,
} from "../src/visual-effects/visual-effects-system.js";

test("visual effects fail closed for missing, malformed, and unknown schemas", () => {
  assert.deepEqual(normalizeVisualEffects(null), DEFAULT_VISUAL_EFFECTS);
  assert.deepEqual(normalizeVisualEffects({
    enabled: true,
    cadence: "balanced",
    effects: { scanlines: true, grain: true, vignette: true },
  }), DEFAULT_VISUAL_EFFECTS);
  assert.deepEqual(normalizeVisualEffects({
    version: 9,
    enabled: true,
    cadence: "turbo",
    effects: { scanlines: true, grain: true, vignette: true },
  }), DEFAULT_VISUAL_EFFECTS);
  assert.deepEqual(normalizeVisualEffects({
    version: 1,
    enabled: true,
    cadence: "turbo",
    effects: { scanlines: false, unknown: true },
  }), {
    version: 1,
    enabled: true,
    cadence: "economy",
    effects: {
      scanlines: false,
      grain: false,
      vignette: true,
    },
  });
});

test("master Off produces an empty render plan instead of zero-strength layers", () => {
  const plan = createVisualEffectsRenderPlan({
    version: 1,
    enabled: false,
    cadence: "balanced",
    effects: { scanlines: true, grain: true, vignette: true },
  });

  assert.deepEqual(plan, {
    backend: "none",
    surface: "desktop",
    reason: "disabled",
    staticEffects: [],
    grain: null,
    layerCount: 0,
  });
});

test("cheap static effects share a layer while grain keeps an independent lifecycle", () => {
  const plan = createVisualEffectsRenderPlan({
    version: 1,
    enabled: true,
    cadence: "balanced",
    effects: { scanlines: true, grain: true, vignette: true },
  });

  assert.equal(plan.backend, "css-overlay");
  assert.deepEqual(plan.staticEffects, ["scanlines", "vignette"]);
  assert.deepEqual(plan.grain, { animated: true, cadence: "balanced" });
  assert.equal(plan.layerCount, 2);

  const withoutGrain = createVisualEffectsRenderPlan({
    version: 1,
    enabled: true,
    cadence: "balanced",
    effects: { scanlines: true, grain: false, vignette: true },
  });
  assert.equal(withoutGrain.layerCount, 1);
  assert.equal(withoutGrain.grain, null);
});

test("surface, visibility, forced colors, and reduced motion are explicit policies", () => {
  const balanced = {
    version: 1,
    enabled: true,
    cadence: "balanced",
    effects: { scanlines: true, grain: true, vignette: true },
  };

  assert.equal(createVisualEffectsRenderPlan(balanced, { surface: "taskbar" }).reason, "surface-policy");
  assert.equal(createVisualEffectsRenderPlan(balanced, { visible: false }).reason, "hidden");
  assert.equal(createVisualEffectsRenderPlan(balanced, { forcedColors: true }).reason, "forced-colors");
  assert.equal(createVisualEffectsRenderPlan(balanced, { forcedOff: true }).reason, "recovery-override");
  assert.deepEqual(
    createVisualEffectsRenderPlan(balanced, { reducedMotion: true }).grain,
    { animated: false, cadence: "balanced" },
  );
});

test("bounded presets and individual switches preserve independent configuration", () => {
  resetVisualEffects();
  assert.equal(getVisualEffectsPresetId(getVisualEffectsSnapshot()), "off");

  setVisualEffectsEnabled(true);
  assert.equal(getVisualEffectsPresetId(getVisualEffectsSnapshot()), "low");

  setVisualEffectEnabled("grain", true);
  assert.equal(getVisualEffectsPresetId(getVisualEffectsSnapshot()), "custom");

  setVisualEffectsPreset("balanced");
  assert.equal(getVisualEffectsPresetId(getVisualEffectsSnapshot()), "balanced");

  setVisualEffectsEnabled(false);
  assert.equal(createVisualEffectsRenderPlan(getVisualEffectsSnapshot()).layerCount, 0);
  resetVisualEffects();
});

test("same-origin storage updates synchronize without being written back", () => {
  const writes = [];
  let storageListener = null;
  global.window = {
    localStorage: {
      getItem: () => null,
      setItem: (key, value) => writes.push([key, value]),
    },
    addEventListener: (type, listener) => {
      if (type === "storage") storageListener = listener;
    },
  };
  global.document = {
    documentElement: { dataset: {} },
  };

  initializeVisualEffects();
  assert.equal(typeof storageListener, "function");
  storageListener({
    key: "jarvis.visual-effects.v1",
    newValue: JSON.stringify({
      version: 1,
      enabled: true,
      cadence: "balanced",
      effects: { scanlines: false, grain: true, vignette: false },
    }),
  });

  assert.equal(getVisualEffectsSnapshot().effects.grain, true);
  assert.equal(global.document.documentElement.dataset.visualEffects, "custom");
  assert.equal(writes.length, 0);

  resetVisualEffects();
  delete global.window;
  delete global.document;
});
