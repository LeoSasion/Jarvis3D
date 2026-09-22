import assert from "node:assert/strict";
import test from "node:test";
import { createFilamentActivationState, writeFilamentActivationContacts, chargeBackgroundFilament } from "../src/graphics/graph/graph-filament-activation.js";
import { chargeSignalContacts, updateNodeActivation } from "../src/graphics/graph/graph-node-activation.js";

const options = { chargeTime: 0.08, holdTime: 0.12, decayTime: 1.6 };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.00001, `${actual} != ${expected}`);

test("ribbon joins activate in route order, including reverse travel, without lighting unrelated hub branches", () => {
  const state = createFilamentActivationState(4);
  const distances = new Float32Array([
    0, 20, -1, -1, 20, 40, -1, -1,
    60, 40, -1, -1, -1, -1, -1, -1,
  ]);
  writeFilamentActivationContacts(state, distances);
  state.time = 0.3;
  chargeSignalContacts(state, state.contacts, 0, 30, 100, 0, options);
  updateNodeActivation(state, options);
  assert.ok(state.levels[0] > 0);
  near(state.levels[1], 1);
  near(state.levels[2], 1); // Adjacent segments agree at their shared join.
  assert.deepEqual([...state.levels.slice(3)], [0, 0, 0, 0, 0]);
  state.time = 0.5;
  chargeSignalContacts(state, state.contacts, 30, 50, 100, 0, options);
  updateNodeActivation(state, options);
  near(state.levels[3], 1);
  near(state.levels[5], 1); // Reversed segment: its end arrives first.
  assert.equal(state.levels[4], 0);
  assert.deepEqual([...state.levels.slice(6)], [0, 0]);

  // Replacing the route (or clearing focus) stops new charges, not the old tail.
  const buffer = state.levels;
  distances.fill(-1);
  writeFilamentActivationContacts(state, distances);
  state.time = 1;
  assert.equal(updateNodeActivation(state, options), true);
  assert.ok(state.levels[5] > 0 && state.levels[5] < 1);
  state.time = 3;
  assert.equal(updateNodeActivation(state, options), false);
  assert.ok(state.levels.every((level) => level === 0));
  assert.equal(state.levels, buffer);
});

test("two opposing packets recharge the same ribbon independently and respect initial fronts", () => {
  const state = createFilamentActivationState(1);
  writeFilamentActivationContacts(state, new Float32Array([0, 100, 150, 50]));
  state.time = 0.6;
  chargeSignalContacts(state, state.contacts, 0, 60, 100, 200, options);
  updateNodeActivation(state, options);
  near(state.hits[0], 0);
  near(state.hits[1], 0.5);
  near(state.levels[1], 1);
  state.time = 1.6;
  chargeSignalContacts(state, state.contacts, 60, 160, 100, 200, options);
  updateNodeActivation(state, options);
  near(state.hits[0], 1.5);
  near(state.hits[1], 1);
  assert.equal(updateNodeActivation(state, options, false), false);
  assert.deepEqual([...state.levels], [0, 0]);
});

test("background charging follows eased particle positions, including cycle wrap and both sides of joins", () => {
  const state = createFilamentActivationState(8);
  state.time = 1;
  chargeBackgroundFilament(state, 1, 4, 0.4, 0.6, 0.2, options);
  near(state.hits[11], 0.5); // Middle join at raw progress 0.5.
  near(state.hits[12], 0.5);
  assert.ok(state.hits.slice(0, 8).every((hit) => hit === -Infinity));
  assert.equal(state.hits[8], -Infinity);
  assert.equal(state.hits[15], -Infinity);
  state.time = 2;
  chargeBackgroundFilament(state, 1, 4, 0.95, 0.05, 0.2, options);
  near(state.hits[8], 1.75);
  near(state.hits[15], 1.75);
});
