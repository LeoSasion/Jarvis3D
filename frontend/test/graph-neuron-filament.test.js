import assert from "node:assert/strict";
import test from "node:test";
import { createNeuronFilamentWeights, writeNeuronRibbonTangents } from "../src/graphics/graph/graph-neuron-filament.js";
import { createNeuronSphereModel, createNeuronSphereCurves } from "../src/graphics/graph/graph-neuron-sphere-model.js";

test("branches narrow continuously through nodes even when source links point toward the soma", () => {
  const structure = { roots: [0], parents: Int32Array.from([-1, 0, 1, 1]) };
  const edges = [{ sourceIndex: 0, targetIndex: 1 }, { sourceIndex: 2, targetIndex: 1 }, { sourceIndex: 1, targetIndex: 3 }];
  const segments = 24;
  const weights = createNeuronFilamentWeights(4, structure, edges, segments);
  const stride = segments * 2;
  assert.equal(weights[0], 1);
  assert.equal(weights[stride - 1], weights[stride * 2 - 1]);
  assert.equal(weights[stride - 1], weights[stride * 2]);
  assert.ok(weights[0] > weights[stride - 1]);
  assert.ok(weights[stride] < weights[stride * 2 - 1]);
  assert.ok(weights[stride] < 0.1);
  assert.ok(weights.at(-1) < 0.1);
  for (let edge = 0; edge < edges.length; edge += 1) {
    for (let segment = 1; segment < segments; segment += 1) {
      const slot = edge * stride + segment * 2;
      assert.equal(weights[slot], weights[slot - 1]);
    }
  }
  assert.deepEqual(createNeuronFilamentWeights(4, structure, edges, segments), weights);
});

test("inter-cluster axons flare at both somas and stay fine in the middle", () => {
  const weights = createNeuronFilamentWeights(2, { roots: [0, 1], parents: [-1, -1] }, [{ sourceIndex: 0, targetIndex: 1 }], 24);
  assert.equal(weights[0], 1);
  assert.equal(weights.at(-1), 1);
  assert.ok(weights[24] < 0.2);
  assert.equal(weights[23], weights[24]);
});

test("tangents close adjacent ribbon joins without bleeding into another relation", () => {
  const starts = Float32Array.from([0, 0, 0, 1, 1, 0, 2, 1, 1, 100, 50, 30, 101, 50, 30, 102, 50, 30]);
  const ends = Float32Array.from([1, 1, 0, 2, 1, 1, 3, 2, 2, 101, 50, 30, 102, 50, 30, 103, 50, 30]);
  const tangentStarts = new Float32Array(starts.length);
  const tangentEnds = new Float32Array(starts.length);
  writeNeuronRibbonTangents(starts, ends, 3, tangentStarts, tangentEnds);
  for (const segment of [1, 2, 4, 5]) {
    const offset = segment * 3;
    assert.deepEqual(tangentStarts.slice(offset, offset + 3), tangentEnds.slice(offset - 3, offset));
  }
  assert.deepEqual([...tangentEnds.slice(6, 9)], [1, 1, 1]);
  assert.deepEqual([...tangentStarts.slice(9, 12)], [1, 0, 0]);
});

test("full-size sphere and deep source branches keep bounded finite filament buffers", () => {
  const count = 4096;
  const chain = Array.from({ length: count - 1 }, (_, i) => ({ sourceIndex: i, targetIndex: i + 1 }));
  const structure = { roots: [0], parents: Int32Array.from({ length: count }, (_, i) => i - 1) };
  const weights = createNeuronFilamentWeights(count, structure, chain, 24);
  assert.equal(weights.length, chain.length * 48);
  assert.ok(weights.every((value) => Number.isFinite(value) && value > 0 && value <= 1));
  const sphere = createNeuronSphereModel(Array.from({ length: count }, (_, i) => ({ id: `note:${i}` })));
  const curves = createNeuronSphereCurves(sphere);
  assert.equal(curves.filamentWeights.length, sphere.edges.length * 48);
  assert.equal(curves.tangentStarts.length, curves.starts.length);
  assert.equal(curves.tangentEnds.length, curves.ends.length);
  assert.ok(curves.tangentStarts.every(Number.isFinite));
  assert.ok(curves.tangentEnds.every(Number.isFinite));
  assert.ok(curves.filamentWeights.every((value) => Number.isFinite(value) && value > 0 && value <= 1));
});
