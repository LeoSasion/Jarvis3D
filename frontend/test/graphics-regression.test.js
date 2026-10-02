import assert from "node:assert/strict";
import test from "node:test";
import { GRAPHICS_REGRESSION_MANIFEST, createGraphicsRegressionClock, createGraphicsRegressionGraph, digestRegressionNumbers, summarizeRegressionIntervals } from "../src/graphics/regression/regression-model.js";

test("browser and native share a stable synthetic graph with valid source-backed clusters", () => {
  const a = createGraphicsRegressionGraph();
  assert.deepEqual(a, createGraphicsRegressionGraph());
  assert.equal(a.nodes.length, 96);
  assert.equal(a.edges.length, 186);
  const ids = new Set(a.nodes.map((node) => node.id));
  assert.equal(ids.size, 96);
  assert.equal(new Set(a.edges.map((edge) => `${edge.source}:${edge.target}`)).size, a.edges.length);
  assert.ok(a.edges.every((edge) => edge.source !== edge.target && ids.has(edge.source) && ids.has(edge.target)));
  assert.equal(new Set(a.nodes.map((node) => node.group)).size, 6);
  assert.equal(GRAPHICS_REGRESSION_MANIFEST.cases.length, 8);
});

test("the validation clock advances exact frames regardless of wall time and pauses without catch-up", () => {
  const clock = createGraphicsRegressionClock();
  assert.deepEqual(clock.sample(500, 80, false), { elapsed: 0, frameDelta: 0 });
  clock.advance(240);
  for (let frame = 0; frame < 240; frame++) clock.sample(frame * 100, 100, false);
  assert.equal(clock.elapsed, 4);
  assert.equal(clock.remaining, 0);
  assert.deepEqual(clock.sample(99_999, 900, false), { elapsed: 4, frameDelta: 0 });
  clock.advance(60);
  assert.deepEqual(clock.sample(100_000, 1, true), { elapsed: 4, frameDelta: 0 });
  assert.equal(clock.remaining, 60);
  assert.throws(() => clock.advance(1), /idle regression clock/u);
  for (let frame = 0; frame < 60; frame++) clock.sample(100_001 + frame, 1, false);
  assert.equal(clock.elapsed, 5);
  assert.throws(() => clock.advance(601));
});

test("regression statistics retain actual slow intervals independently of the simulation step", () => {
  assert.equal(summarizeRegressionIntervals([1, 2]), null);
  const summary = summarizeRegressionIntervals([0, NaN, ...Array(18).fill(8), 90, 100]);
  assert.equal(summary.count, 20);
  assert.equal(summary.p50Ms, 8);
  assert.equal(summary.p95Ms, 90);
  assert.equal(summary.maxMs, 100);
  assert.equal(summarizeRegressionIntervals(Array(800).fill(22)).count, 600);
  assert.equal(digestRegressionNumbers([1, 2, 3]), digestRegressionNumbers(new Float32Array([1, 2, 3])));
  assert.notEqual(digestRegressionNumbers([1, 2, 3]), digestRegressionNumbers([1, 3, 2]));
});
