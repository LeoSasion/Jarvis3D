import assert from "node:assert/strict";
import test from "node:test";
import { createAdaptivePerformanceState, reduceAdaptivePerformanceState } from "../src/graphics/runtime/adaptive-performance.js";

const policy = {
  slowFrameMs: 28,
  slowFrameLimit: 2,
  downgradeCooldownMs: 100,
  recoveryCooldownMs: 200,
  stableDurationMs: 300,
  stableSampleLimit: 4,
  maxSampleGapMs: 150,
  sampleInterval: 1,
};
const sample = (state, time, duration = 16) => reduceAdaptivePerformanceState(state, {
  type: "frame-sample", now: time, durationMs: duration,
}, policy);
function recover(state, start) {
  for (let time = start; time <= start + 300; time += 100) state = sample(state, time);
  return state;
}

test("sustained headroom restores exactly one tier, then waits before another", () => {
  let state = createAdaptivePerformanceState({ adaptiveTier: 2 });
  state = recover(state, 0);
  assert.equal(state.adaptiveTier, 1);
  assert.equal(state.lastChangeReason, "recovered");
  state = sample(state, 400);
  assert.equal(state.stableSamples, 0);
  state = recover(state, 500);
  assert.equal(state.adaptiveTier, 0);
});

test("continuously ultra-slow sampled rendering still reduces quality", () => {
  let state = createAdaptivePerformanceState();
  for (let i = 1; i <= 4; i++) state = reduceAdaptivePerformanceState(state, {
    type: "frame-sample", durationMs: 500, now: i * 2000,
  }, { sampleInterval: 4 });
  assert.equal(state.adaptiveTier, 1);
});

test("an idle or hidden interval cannot count as sustained healthy rendering", () => {
  let state = createAdaptivePerformanceState({ adaptiveTier: 1 });
  state = sample(state, 0);
  state = sample(state, 100);
  state = sample(state, 10_000);
  assert.equal(state.adaptiveTier, 1);
  assert.equal(state.stableSince, 10_000);
  assert.equal(state.stableSamples, 1);
  state = sample(state, 10_100, 24);
  assert.equal(state.stableSince, null);
  assert.equal(state.stableSamples, 0);
});

test("slow recovery falls back promptly and increases the next retry delay", () => {
  let state = recover(createAdaptivePerformanceState({ adaptiveTier: 1 }), 0);
  state = sample(state, 320, 40);
  state = sample(state, 340, 40);
  assert.equal(state.adaptiveTier, 1);
  assert.equal(state.recoveryDelayMs, 400);
  state = recover(state, 440);
  assert.equal(state.adaptiveTier, 1);
  assert.equal(state.stableSamples, 1);
  state = recover(state, 740);
  assert.equal(state.adaptiveTier, 0);
});

test("context recovery does not immediately restore the quality that lost its context", () => {
  let state = reduceAdaptivePerformanceState(createAdaptivePerformanceState(), {
    type: "context-lost", now: 100,
  }, { ...policy, contextLossCooldownMs: 1000 });
  state = recover(state, 400);
  assert.equal(state.adaptiveTier, 1);
  assert.equal(state.stableSamples, 0);
  state = recover(state, 1100);
  assert.equal(state.adaptiveTier, 0);
});

test("bad samples and isolated slow frames do not alter the quality", () => {
  let state = createAdaptivePerformanceState();
  assert.equal(sample(state, 0, NaN), state);
  assert.equal(sample(state, 0, 0), state);
  state = sample(state, 0, 40);
  state = sample(state, 200, 40);
  assert.equal(state.adaptiveTier, 0);
});

test("a stopped animation clears partial recovery and slow-frame runs without changing quality", () => {
  let state = sample(createAdaptivePerformanceState({ adaptiveTier: 1 }), 0);
  state = sample(state, 100);
  state = reduceAdaptivePerformanceState(state, { type: "sampling-paused" });
  assert.equal(state.adaptiveTier, 1);
  assert.equal(state.stableSince, null);
  assert.equal(state.lastSampleAt, null);
  state = sample(state, 120, 40);
  assert.equal(state.consecutiveSlowFrames, 1);
  state = reduceAdaptivePerformanceState(state, { type: "sampling-paused" });
  state = sample(state, 130, 40);
  assert.equal(state.adaptiveTier, 1);
  assert.equal(state.consecutiveSlowFrames, 1);
});
