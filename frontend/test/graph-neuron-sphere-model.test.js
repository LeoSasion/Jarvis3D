import assert from "node:assert/strict";
import test from "node:test";
import { createNeuronSphereModel, createNeuronSphereCurves } from "../src/graphics/graph/graph-neuron-sphere-model.js";

const notes = (count) => Array.from({ length: count }, (_, i) => Object.freeze({ id: `note:${i}`, label: `Note ${i}` }));

test("idle sphere preserves every note and creates bounded connected branches", () => {
  for (const count of [0, 1, 2, 12, 808, 4096]) {
    const nodes = Object.freeze(notes(count));
    const model = createNeuronSphereModel(nodes);
    assert.equal(model.nodeCount, count);
    assert.equal(model.positions.length, count * 3);
    assert.ok(model.positions.every(Number.isFinite));
    assert.ok(model.roots.length <= 18);
    assert.ok(model.edges.length <= count + 100);
    const reached = new Set(count ? [0] : []);
    const pairs = new Set();
    for (const edge of model.edges) {
      assert.ok(edge.sourceIndex >= 0 && edge.sourceIndex < count);
      assert.ok(edge.targetIndex >= 0 && edge.targetIndex < count);
      assert.notEqual(edge.sourceIndex, edge.targetIndex);
      const key = [edge.sourceIndex, edge.targetIndex].sort((a, b) => a - b).join(":");
      assert.ok(!pairs.has(key));
      pairs.add(key);
    }
    let previous = -1;
    while (previous !== reached.size) {
      previous = reached.size;
      for (const edge of model.edges) {
        if (reached.has(edge.sourceIndex) || reached.has(edge.targetIndex)) {
          reached.add(edge.sourceIndex); reached.add(edge.targetIndex);
        }
      }
    }
    assert.equal(reached.size, count);
    assert.deepEqual(createNeuronSphereModel(nodes), model);
  }
});

test("sphere controls change geometry without dropping or inventing source nodes", () => {
  const nodes = notes(808);
  const shell = createNeuronSphereModel(nodes, { radius: 200, shellRatio: 1 });
  const interior = createNeuronSphereModel(nodes, { radius: 200, shellRatio: 0.1, density: 4, branchSpread: 1.4 });
  assert.equal(shell.shellNodeCount, 808);
  assert.ok(interior.shellNodeCount < 150);
  assert.ok(interior.edges.length > shell.edges.length);
  assert.equal(interior.nodeCount, shell.nodeCount);
  for (let i = 0; i < 808; i += 1) {
    const radius = Math.hypot(...shell.positions.slice(i * 3, i * 3 + 3));
    assert.ok(radius >= 194.9 && radius <= 203.1);
  }
  const larger = createNeuronSphereModel(nodes, { radius: 300, shellRatio: 1 });
  shell.positions.forEach((value, i) => assert.ok(Math.abs(larger.positions[i] - value * 1.5) < 0.0001));
  const wider = createNeuronSphereModel(nodes, { radius: 200, shellRatio: 1, branchSpread: 1.4 });
  assert.notDeepEqual(wider.positions, shell.positions);
  assert.deepEqual(wider.rootMask, shell.rootMask);
});

test("curved shell axons have continuous segments and exact neuron endpoints", () => {
  const model = createNeuronSphereModel(notes(808));
  const curves = createNeuronSphereCurves(model, 24, 0.8);
  assert.equal(curves.strengths.length, model.edges.length * 24);
  assert.ok(curves.starts.every(Number.isFinite));
  assert.ok(curves.ends.every(Number.isFinite));
  assert.notDeepEqual(curves.starts, createNeuronSphereCurves(model, 24, 0).starts);
  model.edges.forEach((edge, index) => {
    assert.deepEqual(curves.starts.slice(index * 72, index * 72 + 3), model.positions.slice(edge.sourceIndex * 3, edge.sourceIndex * 3 + 3));
    assert.deepEqual(curves.ends.slice(index * 72 + 69, index * 72 + 72), model.positions.slice(edge.targetIndex * 3, edge.targetIndex * 3 + 3));
    for (let segment = 1; segment < 24; segment += 1) {
      const offset = (index * 24 + segment) * 3;
      assert.deepEqual(curves.starts.slice(offset, offset + 3), curves.ends.slice(offset - 3, offset));
    }
  });
});
