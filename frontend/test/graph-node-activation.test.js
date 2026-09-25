import assert from "node:assert/strict";
import test from "node:test";
import { createNodeActivationState, sampleNodeActivation, touchNodeActivation, chargeSignalContacts, updateNodeActivation } from "../src/graphics/graph/graph-node-activation.js";
import { createIdleSignalState, writeNextIdleSignalRoutes } from "../src/graphics/graph/graph-idle-signals.js";
import { shouldContinueGraphFrame } from "../src/graphics/graph/graph-frame-policy.js";
import { normalizeGraphFxProfile } from "../src/graphics/graph/graph-fx-profile.js";

const options = { chargeTime: 0.08, holdTime: 0.12, decayTime: 1.6 };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.00001, `${actual} != ${expected}`);

test("nodes charge to the same peak, retain residual energy on repeat arrivals, and settle completely", () => {
  const state = createNodeActivationState(3);
  const buffer = state.levels;
  touchNodeActivation(state, 1, 0, options);
  state.time = 0.04;
  assert.equal(updateNodeActivation(state, options), true);
  near(state.levels[1], 0.875);
  assert.equal(state.levels[0], 0);
  assert.equal(state.levels[2], 0);
  state.time = 0.18;
  updateNodeActivation(state, options);
  near(state.levels[1], 1);
  state.time = 1;
  updateNodeActivation(state, options);
  near(state.levels[1], 0.25);
  touchNodeActivation(state, 1, state.time, options);
  updateNodeActivation(state, options);
  near(state.levels[1], 0.25);
  state.time = 1.08;
  updateNodeActivation(state, options);
  near(state.levels[1], 1);
  state.time = 3;
  assert.equal(updateNodeActivation(state, options), false);
  assert.equal(state.changed, true);
  assert.deepEqual([...state.levels], [0, 0, 0]);
  updateNodeActivation(state, options);
  assert.equal(state.changed, false);
  assert.equal(state.levels, buffer);
  assert.equal(sampleNodeActivation(Infinity, 0, options), 0);
});

test("frame-sized arrival intervals do not miss small nodes or alter charge timing", () => {
  const simulate = (fps) => {
    const state = createNodeActivationState(2);
    const contacts = [{ node: 1, distance: 103 }];
    let travel = 0;
    for (let frame = 0; frame < fps; frame += 1) {
      state.time = (frame + 1) / fps;
      const next = (frame + 1) / fps * 240;
      chargeSignalContacts(state, contacts, travel, next, 240, 0, options);
      updateNodeActivation(state, options);
      travel = next;
    }
    return state;
  };
  const fast = simulate(120);
  const slow = simulate(20);
  near(fast.hits[1], 103 / 240);
  near(slow.hits[1], fast.hits[1]);
  near(slow.levels[1], fast.levels[1]);
  assert.equal(slow.levels[0], 0);
});

test("idle contacts start at the delayed source and follow each visible walk through its last endpoint", () => {
  const model = { nodeCount: 4, edges: [{ sourceIndex: 0, targetIndex: 1 }, { sourceIndex: 1, targetIndex: 2 }] };
  const state = createIdleSignalState(model, {
    segments: 1, starts: new Float32Array([0, 0, 0, 2, 0, 0]), ends: new Float32Array([2, 0, 0, 5, 0, 0]),
  }, 17);
  for (const route of state.routes) {
    assert.ok(state.contacts.some((contact) => contact.node === route.steps[0].parent && contact.distance === route.delay && contact.color === route.color));
    let distance = route.delay;
    for (const step of route.steps) {
      distance += state.lengths[step.edge][1];
      assert.ok(state.contacts.some((contact) => contact.node === step.node && contact.distance === distance && contact.color === route.color));
    }
  }
  assert.ok(state.contacts.length > 0);
  assert.ok(state.contacts.every((contact) => contact.node < 3));
  state.options.count = 0;
  writeNextIdleSignalRoutes(state);
  assert.deepEqual(state.contacts, []);
});

test("arriving packets color the entire cell, keep that hue during decay, and newest arrival wins", () => {
  const state = createNodeActivationState(2, true);
  const orange = [1, 0.15, 0.02];
  state.time = 0.1;
  chargeSignalContacts(state, [{ node: 0, distance: 0.05, color: orange }], 0, 0.1, 1, 0, options);
  updateNodeActivation(state, options);
  orange[1] = 0.9; // The cell snapshots its arriving particle, not a mutable palette.
  const inherited = [...state.colors.slice(0, 3)];
  near(inherited[1], 0.15);
  for (const time of [0.15, 0.25, 0.9]) {
    state.time = time;
    updateNodeActivation(state, options);
    assert.deepEqual([...state.colors.slice(0, 3)], inherited);
  }
  const pale = [1, 0.85, 0.75];
  touchNodeActivation(state, 0, 0.9, options, pale);
  touchNodeActivation(state, 0, 0.7, options, orange); // Unsorted older contacts cannot recolor it.
  updateNodeActivation(state, options);
  assert.deepEqual([...state.colors.slice(0, 3)], [...new Float32Array(pale)]);
  state.time = 1;
  updateNodeActivation(state, options);
  assert.equal(state.levels[0], 1);
  touchNodeActivation(state, 0, 1, options, orange); // Color changes even at an unchanged peak level.
  updateNodeActivation(state, options);
  assert.equal(state.levels[0], 1);
  assert.equal(state.changed, true);
  assert.deepEqual([...state.colors.slice(0, 3)], [...new Float32Array(orange)]);
  assert.equal(state.levels[1], 0);
});

test("disabled and reduced-motion states clear transient energy and decay stops requesting frames", () => {
  const state = createNodeActivationState(1);
  touchNodeActivation(state, 0, 0, options);
  state.time = 0.1;
  updateNodeActivation(state, options);
  assert.equal(shouldContinueGraphFrame({ nodeActivationActive: state.active }), true);
  assert.equal(shouldContinueGraphFrame({ nodeActivationActive: state.active, documentVisible: false }), false);
  assert.equal(shouldContinueGraphFrame({ nodeActivationActive: state.active, reducedMotion: true }), false);
  updateNodeActivation(state, options, false);
  assert.equal(state.levels[0], 0);
  assert.equal(shouldContinueGraphFrame({ nodeActivationActive: state.active }), false);
  assert.deepEqual(normalizeGraphFxProfile("3d", {}).node.activation,
    { enabled: true, strength: 1, restingBrightness: 0.55, ...options });
  const clamped = normalizeGraphFxProfile("3d", { node: { activation: {
    enabled: false, strength: 999, restingBrightness: -5, chargeTime: 0, holdTime: -1, decayTime: Infinity,
  } } }).node.activation;
  assert.deepEqual(clamped, { enabled: false, strength: 2, restingBrightness: 0.15, chargeTime: 0.02, holdTime: 0, decayTime: 1.6 });
});
