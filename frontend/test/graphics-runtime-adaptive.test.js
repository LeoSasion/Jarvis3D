import assert from "node:assert/strict";
import test from "node:test";
import {
  createAdaptivePerformanceState,
  reduceAdaptivePerformanceState,
} from "../src/graphics/runtime/adaptive-performance.js";
import {
  createGraphicsPassRegistry,
  getGraphicsPass,
} from "../src/graphics/runtime/pass-registry.js";
import {
  createFrameIntervalSamplerState,
  readFrameIntervalSample,
} from "../src/graphics/runtime/frame-interval-sampler.js";
import { graphicsQualityProfiles } from "../src/graphics/graphics-runtime-policy.js";

function sample(state, durationMs, now, policy) {
  return reduceAdaptivePerformanceState(
    state,
    { durationMs, now, type: "frame-sample" },
    policy,
  );
}

test("frame sampling reports the slowest real interval in each sample window", () => {
  const state = createFrameIntervalSamplerState();
  const options = { sampleInterval: 4, slowFrameMs: 28 };

  assert.equal(readFrameIntervalSample(state, { ...options, deltaMs: 16 }), null);
  assert.equal(readFrameIntervalSample(state, { ...options, deltaMs: 44 }), null);
  assert.equal(readFrameIntervalSample(state, { ...options, deltaMs: 17 }), null);
  assert.equal(readFrameIntervalSample(state, { ...options, deltaMs: 18 }), 44);
});

test("demand-driven idle gaps reset the sample window instead of looking like slow frames", () => {
  const state = createFrameIntervalSamplerState();
  const options = { sampleInterval: 2, slowFrameMs: 28 };

  assert.equal(readFrameIntervalSample(state, { ...options, deltaMs: 40 }), null);
  assert.equal(readFrameIntervalSample(state, { ...options, deltaMs: 800 }), null);
  assert.equal(readFrameIntervalSample(state, { ...options, deltaMs: 18 }), null);
  assert.equal(readFrameIntervalSample(state, { ...options, deltaMs: 20 }), 20);
});

test("continuous ultra-slow frames are sampled instead of being mistaken for idle gaps", () => {
  const state = createFrameIntervalSamplerState();
  const options = { sampleInterval: 4, slowFrameMs: 28 };

  assert.equal(readFrameIntervalSample(state, { ...options, deltaMs: 300 }), null);
  assert.equal(readFrameIntervalSample(state, { ...options, deltaMs: 310 }), null);
  assert.equal(readFrameIntervalSample(state, { ...options, deltaMs: 320 }), null);
  assert.equal(readFrameIntervalSample(state, { ...options, deltaMs: 330 }), 330);
});

test("one idle recovery gap never contaminates the next active sample window", () => {
  const state = createFrameIntervalSamplerState();
  const options = { sampleInterval: 3, slowFrameMs: 28 };

  assert.equal(readFrameIntervalSample(state, { ...options, deltaMs: 16 }), null);
  assert.equal(readFrameIntervalSample(state, { ...options, deltaMs: 900 }), null);
  assert.equal(readFrameIntervalSample(state, { ...options, deltaMs: 17 }), null);
  assert.equal(readFrameIntervalSample(state, { ...options, deltaMs: 18 }), null);
  assert.equal(readFrameIntervalSample(state, { ...options, deltaMs: 19 }), 19);
});

test("continuous sampled slow frames downgrade once and honor the cooldown", () => {
  const policy = { downgradeCooldownMs: 1_000, slowFrameLimit: 3, slowFrameMs: 20 };
  let state = createAdaptivePerformanceState();
  state = sample(state, 30, 10, policy);
  state = sample(state, 30, 20, policy);
  state = sample(state, 30, 30, policy);
  assert.equal(state.adaptiveTier, 1);
  assert.equal(state.cooldownUntil, 1_030);

  state = sample(state, 30, 40, policy);
  state = sample(state, 30, 50, policy);
  state = sample(state, 30, 60, policy);
  assert.equal(state.adaptiveTier, 1);
  state = sample(state, 10, 70, policy);
  assert.equal(state.consecutiveSlowFrames, 0);
});

test("context loss keeps a lower tier and starts a longer recovery cooldown", () => {
  const initial = createAdaptivePerformanceState({ adaptiveTier: 1 });
  const lost = reduceAdaptivePerformanceState(
    initial,
    { now: 500, type: "context-lost" },
    { contextLossCooldownMs: 60_000 },
  );
  assert.equal(lost.adaptiveTier, 2);
  assert.equal(lost.contextLossCount, 1);
  assert.equal(lost.cooldownUntil, 60_500);
  assert.equal(
    reduceAdaptivePerformanceState(lost, { now: 700, type: "context-restored" }),
    lost,
  );
});

test("the pass registry owns deterministic order and quality-aware bloom cost", () => {
  const registry = createGraphicsPassRegistry({
    bloom: true,
    bloomIntensity: 0.8,
    bloomRadius: 0.37,
    runtime: {
      forcedColors: false,
      qualityProfile: graphicsQualityProfiles.balanced,
    },
  });
  assert.deepEqual(registry.passes.map((pass) => pass.id), ["bloom", "tone-mapping"]);
  assert.equal(getGraphicsPass(registry, "bloom").enabled, true);
  assert.equal(getGraphicsPass(registry, "bloom").levels, 6);
  assert.equal(getGraphicsPass(registry, "bloom").radius, 0.37);

  const forcedColorsRegistry = createGraphicsPassRegistry({
    bloom: true,
    runtime: {
      forcedColors: true,
      qualityProfile: graphicsQualityProfiles.high,
    },
  });
  assert.equal(getGraphicsPass(forcedColorsRegistry, "bloom").enabled, false);
});

test("required bloom remains bounded on the low quality profile", () => {
  const registry = createGraphicsPassRegistry({
    bloom: "required",
    runtime: {
      forcedColors: false,
      qualityProfile: graphicsQualityProfiles.low,
    },
  });
  const bloom = getGraphicsPass(registry, "bloom");
  assert.equal(bloom.enabled, true);
  assert.equal(bloom.levels, 5);
  assert.equal(bloom.radius, 0.92);
});

test("an explicit Bloom radius overrides the quality fallback and stays bounded", () => {
  const explicit = createGraphicsPassRegistry({
    bloom: "required",
    bloomRadius: 0.44,
    runtime: {
      forcedColors: false,
      qualityProfile: graphicsQualityProfiles.high,
    },
  });
  assert.equal(getGraphicsPass(explicit, "bloom").radius, 0.44);

  const clamped = createGraphicsPassRegistry({
    bloom: false,
    bloomRadius: 4,
    runtime: {
      forcedColors: false,
      qualityProfile: graphicsQualityProfiles.balanced,
    },
  });
  assert.equal(getGraphicsPass(clamped, "bloom").enabled, false);
  assert.equal(getGraphicsPass(clamped, "bloom").radius, 1);
});
