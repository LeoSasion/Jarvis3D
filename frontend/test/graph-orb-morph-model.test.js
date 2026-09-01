import assert from "node:assert/strict";
import test from "node:test";
import {
  createGraphOrbMorphModel,
  createGraphPlanarMorphModel,
  easeGraphOrbMorph,
  mixGraphOrbPositionBuffers,
} from "../src/graphics/graph/graph-orb-morph-model.js";

const nodes = Array.from({ length: 97 }, (_, index) => ({ id: `node-${index}` }));

test("graph orb morph model is deterministic, bounded, and keeps shell edges valid", () => {
  const first = createGraphOrbMorphModel(nodes, 120);
  const second = createGraphOrbMorphModel(nodes, 120);
  const denseShell = createGraphOrbMorphModel(nodes, 120, { shellEdgeCount: 291 });

  assert.deepEqual(first.positions, second.positions);
  assert.deepEqual(first.shellEdgePairs, second.shellEdgePairs);
  assert.equal(first.positions.length, nodes.length * 3);
  assert.equal(first.shellEdgePairs.length, 240);
  assert.equal(first.signalEdgeIndices.length, 12);
  assert.equal(denseShell.shellEdgePairs.length, 582);
  assert.ok(denseShell.signalEdgeIndices.every((edgeIndex) => edgeIndex < 120));

  for (let index = 0; index < nodes.length; index += 1) {
    const offset = index * 3;
    const distance = Math.hypot(
      first.positions[offset],
      first.positions[offset + 1],
      first.positions[offset + 2],
    );
    assert.ok(distance >= first.radius * 0.67);
    assert.ok(distance <= first.radius * 1.02);
  }
  for (let index = 0; index < first.shellEdgePairs.length; index += 2) {
    const source = first.shellEdgePairs[index];
    const target = first.shellEdgePairs[index + 1];
    assert.ok(source >= 0 && source < nodes.length);
    assert.ok(target >= 0 && target < nodes.length);
    assert.notEqual(source, target);
  }
});

test("planar neural morph model is deterministic, flat, and fills an organic disc", () => {
  const first = createGraphPlanarMorphModel(nodes, 120, { shellEdgeCount: 291 });
  const second = createGraphPlanarMorphModel(nodes, 120, { shellEdgeCount: 291 });

  assert.deepEqual(first.positions, second.positions);
  assert.deepEqual(first.shellEdgePairs, second.shellEdgePairs);
  assert.equal(first.positions.length, nodes.length * 3);
  assert.equal(first.shellEdgePairs.length, 582);
  assert.equal(first.signalEdgeIndices.length, 12);

  let innerNodes = 0;
  let outerNodes = 0;
  for (let index = 0; index < nodes.length; index += 1) {
    const offset = index * 3;
    const x = first.positions[offset];
    const y = first.positions[offset + 1];
    assert.equal(first.positions[offset + 2], 0);
    assert.ok(Math.abs(x) <= first.radius * 1.18);
    assert.ok(Math.abs(y) <= first.radius * 0.76);
    const normalizedRadius = Math.hypot(
      x / (first.radius * 1.14),
      y / (first.radius * 0.72),
    );
    if (normalizedRadius < 0.45) innerNodes += 1;
    if (normalizedRadius > 0.78) outerNodes += 1;
  }
  assert.ok(innerNodes >= 12);
  assert.ok(outerNodes >= 24);
});

test("graph orb morph easing and buffer mixing preserve exact endpoints", () => {
  const orb = new Float32Array([0, 10, -10, 4, 8, 12]);
  const graph = new Float32Array([20, 30, 10, 14, -2, 2]);

  assert.equal(easeGraphOrbMorph(-1), 0);
  assert.equal(easeGraphOrbMorph(0), 0);
  assert.equal(easeGraphOrbMorph(1), 1);
  assert.equal(easeGraphOrbMorph(2), 1);
  assert.deepEqual(mixGraphOrbPositionBuffers(orb, graph, 0), orb);
  assert.deepEqual(mixGraphOrbPositionBuffers(orb, graph, 1), graph);

  const middle = mixGraphOrbPositionBuffers(orb, graph, 0.5);
  assert.deepEqual(middle, new Float32Array([10, 20, 0, 9, 3, 7]));
});
