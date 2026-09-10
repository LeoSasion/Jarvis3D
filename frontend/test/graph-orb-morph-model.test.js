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

test("a dense vault keeps every note while the idle shell has independent density", () => {
  const vaultNodes = Array.from({ length: 808 }, (_, index) => ({ id: `note-${index}` }));
  const options = { shellRatio: 0.28, shellEdgeCount: 542 };
  const orb = createGraphOrbMorphModel(vaultNodes, 7809, options);
  assert.equal(orb.nodeCount, 808);
  assert.equal(orb.positions.length, 808 * 3);
  assert.equal(orb.shellNodeCount, 226);
  assert.equal(orb.shellEdgePairs.length, 542 * 2);
  assert.deepEqual(orb, createGraphOrbMorphModel(vaultNodes, 7809, options));
  const unique = new Set();
  let totalDistance = 0;
  for (let index = 0; index < orb.shellEdgePairs.length; index += 2) {
    const source = orb.shellEdgePairs[index];
    const target = orb.shellEdgePairs[index + 1];
    assert.notEqual(source, target);
    unique.add([source, target].sort((a, b) => a - b).join(":"));
    const a = orb.positions.subarray(source * 3, source * 3 + 3);
    const b = orb.positions.subarray(target * 3, target * 3 + 3);
    assert.ok(Math.hypot(...a) > orb.radius * 0.98);
    assert.ok(Math.hypot(...b) > orb.radius * 0.98);
    totalDistance += Math.hypot(...a.map((value, axis) => value - b[axis]));
  }
  assert.equal(unique.size, 542);
  assert.ok(totalDistance / unique.size < orb.radius * 0.4, "neighbors must form a local shell, not cross-sphere bands");
  assert.equal(Array.from(orb.scales).filter((value) => value < 0.4).length, 582);
});

test("spatial shell generation remains local above the former 512-node boundary", () => {
  const largeNodes = Array.from({ length: 4096 }, (_, index) => ({ id: `note-${index}` }));
  const orb = createGraphOrbMorphModel(largeNodes, 12000, { shellEdgeCount: 8192 });
  let longest = 0;
  for (let index = 0; index < orb.shellEdgePairs.length; index += 2) {
    const a = orb.shellEdgePairs[index] * 3;
    const b = orb.shellEdgePairs[index + 1] * 3;
    longest = Math.max(longest, Math.hypot(...[0, 1, 2].map((axis) => orb.positions[a + axis] - orb.positions[b + axis])));
  }
  assert.equal(orb.positions.length, 4096 * 3);
  assert.equal(orb.shellEdgePairs.length, 8192 * 2);
  assert.ok(longest < orb.radius * 0.3);
});
