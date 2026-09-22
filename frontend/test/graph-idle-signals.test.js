import assert from "node:assert/strict";
import test from "node:test";
import { createIdleSignalState, writeNextIdleSignalRoutes, advanceIdleSignals } from "../src/graphics/graph/graph-idle-signals.js";
import { createNeuronSphereModel, createNeuronSphereCurves } from "../src/graphics/graph/graph-neuron-sphere-model.js";
import { FOCUSED_SIGNAL_SPEED } from "../src/graphics/graph/graph-focus-filament.js";
import { createNodeActivationState, chargeSignalContacts, updateNodeActivation } from "../src/graphics/graph/graph-node-activation.js";

function sphere(count) {
  const model = createNeuronSphereModel(Array.from({ length: count }, (_, i) => ({ id: `note:${i}` })));
  return [model, createNeuronSphereCurves(model)];
}

test("idle signals follow only connected existing curves, continuously in either direction", () => {
  const [model, curves] = sphere(808);
  const state = createIdleSignalState(model, curves, 418);
  let reverseCount = 0;
  let multiHopCount = 0;
  const batchSignatures = new Set();
  for (let batch = 0; batch < 24; batch += 1) {
    const occupied = new Set();
    assert.equal(state.routes.length, 48);
    assert.ok(state.routes.every((route) => route.delay < 1.5 * FOCUSED_SIGNAL_SPEED));
    for (const route of state.routes) {
      let previousNode = route.steps[0].parent;
      let distance = route.delay;
      if (route.steps.length > 1) multiHopCount += 1;
      for (const step of route.steps) {
        const edge = model.edges[step.edge];
        assert.equal(step.parent, previousNode);
        assert.equal(step.parent, step.forward ? edge.sourceIndex : edge.targetIndex);
        assert.equal(step.node, step.forward ? edge.targetIndex : edge.sourceIndex);
        assert.equal(occupied.has(step.edge), false);
        occupied.add(step.edge);
        if (!step.forward) reverseCount += 1;
        const startOffset = step.edge * curves.segments * 4;
        const finishOffset = startOffset + (curves.segments - 1) * 4 + 1;
        const entry = state.distances[step.forward ? startOffset : finishOffset];
        const exit = state.distances[step.forward ? finishOffset : startOffset];
        assert.ok(Math.abs(entry - distance) < 0.001);
        distance += state.lengths[step.edge][curves.segments];
        assert.ok(Math.abs(exit - distance) < 0.001);
        previousNode = step.node;
      }
      assert.ok(state.endTravel >= distance + 42 * route.size - 0.001);
    }
    // Unused curves and the second channel remain completely inactive.
    state.distances.forEach((value, offset) => {
      if (offset % 4 >= 2 || !occupied.has(Math.floor(offset / (curves.segments * 4)))) assert.equal(value, -1);
    });
    batchSignatures.add(state.routes.map((route) => route.steps.map((step) => step.edge).join(",")).join(";"));
    writeNextIdleSignalRoutes(state);
  }
  assert.ok(reverseCount > 0 && multiHopCount > 0);
  assert.equal(batchSignatures.size, 24);
});

test("random walks are reproducible without changing the sphere topology or geometry", () => {
  const [model, curves] = sphere(70);
  const topology = JSON.stringify(model.edges);
  const positions = curves.starts.slice();
  const a = createIdleSignalState(model, curves, 23);
  const b = createIdleSignalState(model, curves, 23);
  for (let batch = 0; batch < 10; batch += 1) {
    assert.deepEqual(a.distances, b.distances);
    assert.deepEqual(a.sizes, b.sizes);
    writeNextIdleSignalRoutes(a);
    writeNextIdleSignalRoutes(b);
  }
  assert.equal(JSON.stringify(model.edges), topology);
  assert.deepEqual(curves.starts, positions);
});

test("batches start every three seconds while older packets finish on their own curves", () => {
  const [model, curves] = sphere(808);
  const state = createIdleSignalState(model, curves, 23);
  const initial = state.distances.slice();
  assert.equal(advanceIdleSignals(state, 0.01), false);
  assert.equal(state.travel, 2.4);
  assert.deepEqual(state.distances, initial);
  for (let frame = 0; frame < 59; frame += 1) advanceIdleSignals(state, 0.05);
  assert.equal(state.batch, 1);
  const surviving = state.routes.filter((route) => route.endTravel > state.travel + 12);
  assert.ok(surviving.length > 0);
  assert.equal(advanceIdleSignals(state, 10), true); // resume delta stays bounded to 0.05 s
  assert.ok(Math.abs(state.time - 3.01) < 0.000001);
  assert.equal(state.batch, 2);
  assert.equal(state.nextBatchAt, 6);
  assert.ok(surviving.every((route) => state.routes.includes(route)));
  const second = state.routes.filter((route) => route.batch === 1);
  assert.equal(second.length, 48);
  assert.ok(second.every((route) => route.launchAt >= 3 && route.launchAt <= 4.5));
  const allEdges = state.routes.flatMap((route) => route.steps.map((step) => step.edge));
  assert.equal(new Set(allEdges).size, allEdges.length);
  const buffer = state.distances;
  for (let frame = 0; frame < 6_000; frame += 1) advanceIdleSignals(state, 0.05);
  assert.equal(state.distances, buffer);
  assert.ok(state.travel < 65_536);
  assert.ok(state.travel < state.endTravel);
  assert.ok(state.routes.length <= model.edges.length);
});

test("empty, singleton and single-edge spheres need no invented routes", () => {
  for (const count of [0, 1, 2]) {
    const [model, curves] = sphere(count);
    const state = createIdleSignalState(model, curves);
    assert.ok(state.distances.every(Number.isFinite));
    if (count < 2) {
      assert.equal(state.routes.length, 0);
      assert.equal(advanceIdleSignals(state, 0.05), false);
    } else {
      assert.equal(state.routes.length, 1);
      assert.equal(state.routes[0].steps.length, 1);
    }
  }
});

test("clock rebasing preserves visible fronts and wakes without clipping them as inactive", () => {
  const [model, curves] = sphere(808);
  const state = createIdleSignalState(model, curves, 23);
  while (state.travel < 65_524) advanceIdleSignals(state, 0.05);
  const previous = state.travel;
  const visible = Array.from(state.distances, (distance, index) => ({ distance, index }))
    .filter(({ distance }) => distance >= previous - 42 && distance <= previous);
  assert.ok(visible.length > 0);
  const beforeRoutes = state.routes.filter((route) => route.endTravel > previous + 12);
  assert.equal(advanceIdleSignals(state, 0.05), true);
  const shift = previous + 12 - state.travel;
  assert.ok(shift > 0);
  for (const { distance, index } of visible) {
    const after = state.distances[index];
    if (after === -1) continue; // A fully finished walk can release its curves.
    assert.ok(after >= 0);
    assert.ok(Math.abs((state.travel - after) - (previous + 12 - distance)) < 0.01);
  }
  assert.ok(beforeRoutes.every((route) => state.routes.includes(route)));
});

test("synchronized new batches charge their launch nodes on the boundary frame", () => {
  const [model, curves] = sphere(808);
  const state = createIdleSignalState(model, curves, 71);
  state.options.launchSpread = 0;
  writeNextIdleSignalRoutes(state);
  for (let frame = 0; frame < 59; frame += 1) advanceIdleSignals(state, 0.05);
  const previous = state.travel;
  advanceIdleSignals(state, 0.05);
  const nodes = createNodeActivationState(model.nodeCount);
  nodes.time = state.time;
  const envelope = { chargeTime: 0.08, holdTime: 0.12, decayTime: 1.6 };
  chargeSignalContacts(nodes, state.contacts, previous, state.travel, FOCUSED_SIGNAL_SPEED, 0, envelope);
  const batch = state.routes.filter((route) => route.batch === 1);
  assert.equal(batch.length, 48);
  for (const route of batch) assert.ok(Math.abs(nodes.hits[route.steps[0].parent] - 3) < 0.000001);
});

test("idle controls bound signal density, path length and the full configured wake", () => {
  const [model, curves] = sphere(808);
  const state = createIdleSignalState(model, curves, 71);
  state.options = { count: 2, hops: 3, batchInterval: 2, headLength: 1, wakeLength: 3 };
  writeNextIdleSignalRoutes(state);
  assert.ok(state.routes.length <= 2);
  for (const route of state.routes) {
    assert.ok(route.steps.length <= 3);
    const length = route.steps.reduce((sum, step) => sum + state.lengths[step.edge][curves.segments], 0);
    assert.ok(state.endTravel >= route.delay + length + 126 * route.size - 0.001);
  }
  state.options.count = 0;
  writeNextIdleSignalRoutes(state);
  assert.equal(state.routes.length, 0);
  assert.ok(state.distances.every((value) => value === -1));
  assert.equal(advanceIdleSignals(state, 0.05), false);
});

test("random signal sizes stay fixed across a walk and frames, including the full scaled wake", () => {
  const [model, curves] = sphere(808);
  const state = createIdleSignalState(model, curves, 71);
  assert.equal(state.routes.length, 48);
  const samples = state.routes.map((route) => route.size);
  assert.ok(Math.min(...samples) >= 0.7 && Math.max(...samples) <= 1.3);
  assert.ok(Math.min(...samples) < 0.85 && Math.max(...samples) > 1.15);
  for (const route of state.routes) {
    for (const step of route.steps) {
      const sizes = state.sizes.slice(step.edge * curves.segments, (step.edge + 1) * curves.segments);
      assert.ok(sizes.every((size) => Math.abs(size - route.size) < 0.000001));
    }
    const end = route.steps.at(-1).distance + 42 * route.size;
    assert.ok(state.endTravel >= end - 0.000001);
  }
  const before = state.sizes.slice();
  const buffer = state.sizes;
  for (let frame = 0; frame < 20; frame += 1) advanceIdleSignals(state, 0.01);
  assert.deepEqual(state.sizes, before);
  state.options.sizeVariation = 0;
  writeNextIdleSignalRoutes(state);
  assert.equal(state.sizes, buffer);
  assert.ok(state.sizes.every((size) => size === 1));
  assert.ok(state.routes.every((route) => route.size === 1));
});

test("dispersion uses a percentage of the batch interval, independent of travel speed", () => {
  const [model, curves] = sphere(808);
  const schedule = (launchSpread, speed = 1, batchInterval = 3) => {
    const state = createIdleSignalState(model, curves, 71);
    state.options.launchSpread = launchSpread;
    state.options.batchInterval = batchInterval;
    state.options.speed = speed;
    writeNextIdleSignalRoutes(state);
    return state;
  };
  const regular = schedule(0);
  const jittered = schedule(0.5);
  const faster = schedule(0.5, 2);
  const full = schedule(1);
  const slowerBatches = schedule(0.5, 1, 6);
  const routeEdges = (state) => state.routes.map((route) => route.steps.map((step) => step.edge));
  assert.deepEqual(routeEdges(regular), routeEdges(jittered));
  assert.deepEqual(routeEdges(jittered), routeEdges(faster));
  const offsets = jittered.routes.map((route, index) => {
    assert.equal(regular.routes[index].delay, 0);
    const seconds = route.delay / FOCUSED_SIGNAL_SPEED;
    assert.ok(seconds >= 0 && seconds <= 1.5);
    assert.ok(Math.abs(faster.routes[index].delay / (FOCUSED_SIGNAL_SPEED * 2) - seconds) < 0.000001);
    assert.ok(Math.abs(full.routes[index].launchAt - seconds * 2) < 0.000001);
    assert.ok(Math.abs(slowerBatches.routes[index].launchAt - seconds * 2) < 0.000001);
    return seconds;
  });
  assert.ok(Math.min(...offsets) < 0.15 && Math.max(...offsets) > 1.35);
  assert.equal(new Set(offsets).size, 48);
  assert.ok(jittered.routes.some((route, index) => index > 0 && route.delay < jittered.routes[index - 1].delay));
  const delays = jittered.routes.map((route) => route.delay);
  advanceIdleSignals(jittered, 0.01);
  assert.deepEqual(jittered.routes.map((route) => route.delay), delays);

  // The activation front uses the same delayed origin as the visible packet.
  const nodes = createNodeActivationState(model.nodeCount);
  const firstDeparture = Math.min(...delays);
  nodes.time = firstDeparture / FOCUSED_SIGNAL_SPEED / 2;
  const envelope = { chargeTime: 0.08, holdTime: 0.12, decayTime: 1.6 };
  chargeSignalContacts(nodes, jittered.contacts, 0, firstDeparture / 2, FOCUSED_SIGNAL_SPEED, 0, envelope);
  assert.equal(updateNodeActivation(nodes, envelope), false);
  assert.ok(nodes.levels.every((level) => level === 0));
});
