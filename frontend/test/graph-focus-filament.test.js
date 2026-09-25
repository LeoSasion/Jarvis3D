import assert from "node:assert/strict";
import test from "node:test";
import {
  createRestingRouteIndex, createFocusedRestingRoutePlan,
  getFocusedFilamentGain, writeFocusedRouteMask,
} from "../src/graphics/graph/graph-focus-filament.js";
import { shouldContinueGraphFrame } from "../src/graphics/graph/graph-frame-policy.js";

test("focus breathing always adds light, preserves the gradient and honors reduced motion", () => {
  for (let sample = 0; sample <= 1000; sample += 1) {
    const time = sample * 0.028;
    const gain = getFocusedFilamentGain(time);
    assert.ok(gain >= 1.3 && gain <= 1.85);
    assert.equal(getFocusedFilamentGain(time, true), 1.3);
    for (const baseline of [0.01, 0.15, 0.4, 0.9]) {
      assert.ok(baseline * gain > baseline);
    }
  }
  assert.equal(getFocusedFilamentGain(0), getFocusedFilamentGain(2.8));
  assert.equal(shouldContinueGraphFrame({ focusedFilamentActive: true }), true);
  assert.equal(shouldContinueGraphFrame({ focusedFilamentActive: false }), false);
  assert.equal(shouldContinueGraphFrame({ focusedFilamentActive: true, reducedMotion: true }), false);
  assert.equal(shouldContinueGraphFrame({ focusedFilamentActive: true, documentVisible: false }), false);
});

const edge = (source, target) => ({ id: `${source}-${target}`, source, target });
const routeIds = (edges, indices) => [...indices].map((index) => edges[index].id).sort();

test("hidden associations take the existing multi-hop route without adding terminal shortcuts", () => {
  const nodes = ["a", "left", "hub", "right", "b", "branch", "isolated"].map((id) => ({ id }));
  const edges = [edge("a", "left"), edge("left", "hub"), edge("hub", "right"), edge("right", "b"), edge("hub", "branch")];
  const routes = createFocusedRestingRoutePlan(createRestingRouteIndex(nodes, edges),
    [edge("a", "b"), edge("a", "isolated")], ["a"]).edges;
  assert.deepEqual(routeIds(edges, routes), ["a-left", "hub-right", "left-hub", "right-b"]);
  assert.equal(edges.length, 5);
  const mask = new Float32Array(edges.length * 24);
  writeFocusedRouteMask(mask, routes, 24, true);
  assert.equal(mask.filter(Boolean).length, 4 * 24);
  assert.ok(mask.slice(4 * 24).every((value) => value === 0));
  writeFocusedRouteMask(mask, routes, 24, false);
  assert.ok(mask.every((value) => value === 0));
});

test("selected and hovered routes share segments and clear independently", () => {
  const nodes = ["a", "b", "c", "d", "unrelated"].map((id) => ({ id }));
  const edges = [edge("a", "b"), edge("b", "c"), edge("c", "d"), edge("b", "unrelated")];
  const index = createRestingRouteIndex(nodes, edges);
  const relations = [edge("a", "c"), edge("d", "b")];
  assert.deepEqual(routeIds(edges, createFocusedRestingRoutePlan(index, relations, ["a", "d"]).edges), ["a-b", "b-c", "c-d"]);
  assert.deepEqual(routeIds(edges, createFocusedRestingRoutePlan(index, relations, ["a", null]).edges), ["a-b", "b-c"]);
  assert.equal(createFocusedRestingRoutePlan(index, relations, [null, null]).edges.size, 0);
  assert.equal(createFocusedRestingRoutePlan(index, [edge("a", "missing")], ["a"]).edges.size, 0);
});

test("equal-length routes are deterministic when nodes and edges are reordered", () => {
  const nodes = ["a", "b", "c", "d"].map((id) => ({ id }));
  const edges = [edge("a", "c"), edge("c", "d"), edge("a", "b"), edge("b", "d")];
  const routes = createFocusedRestingRoutePlan(createRestingRouteIndex(nodes, edges), [edge("a", "d")], ["a"]).edges;
  const reversed = [...edges].reverse();
  const reversedRoutes = createFocusedRestingRoutePlan(createRestingRouteIndex([...nodes].reverse(), reversed), [edge("a", "d")], ["a"]).edges;
  assert.deepEqual(routeIds(edges, routes), ["a-b", "b-d"]);
  assert.deepEqual(routeIds(reversed, reversedRoutes), routeIds(edges, routes));
});
