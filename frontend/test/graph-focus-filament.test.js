import assert from "node:assert/strict";
import test from "node:test";
import {
  createRestingRouteIndex, createFocusedRestingRoutePlan, findFocusedRestingRoutes,
  getFocusedFilamentGain, writeFocusedRouteMask, writeFocusedSignalDistances,
  advanceFocusedSignalTravel, FOCUSED_SIGNAL_SPACING,
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
  const routes = findFocusedRestingRoutes(createRestingRouteIndex(nodes, edges),
    [edge("a", "b"), edge("a", "isolated")], ["a"]);
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
  assert.deepEqual(routeIds(edges, findFocusedRestingRoutes(index, relations, ["a", "d"])), ["a-b", "b-c", "c-d"]);
  assert.deepEqual(routeIds(edges, findFocusedRestingRoutes(index, relations, ["a", null])), ["a-b", "b-c"]);
  assert.equal(findFocusedRestingRoutes(index, relations, [null, null]).size, 0);
  assert.equal(findFocusedRestingRoutes(index, [edge("a", "missing")], ["a"]).size, 0);
});

test("equal-length routes are deterministic when nodes and edges are reordered", () => {
  const nodes = ["a", "b", "c", "d"].map((id) => ({ id }));
  const edges = [edge("a", "c"), edge("c", "d"), edge("a", "b"), edge("b", "d")];
  const routes = findFocusedRestingRoutes(createRestingRouteIndex(nodes, edges), [edge("a", "d")], ["a"]);
  const reversed = [...edges].reverse();
  const reversedRoutes = findFocusedRestingRoutes(createRestingRouteIndex([...nodes].reverse(), reversed), [edge("a", "d")], ["a"]);
  assert.deepEqual(routeIds(edges, routes), ["a-b", "b-d"]);
  assert.deepEqual(routeIds(reversed, reversedRoutes), routeIds(edges, routes));
});

function signalGeometry(curves) {
  const starts = [];
  const ends = [];
  for (const curve of curves) {
    for (let segment = 0; segment < curve.length - 1; segment += 1) {
      starts.push(...curve[segment]);
      ends.push(...curve[segment + 1]);
    }
  }
  return [new Float32Array(starts), new Float32Array(ends)];
}

test("signals follow curved arc distance continuously through reversed edges and branches", () => {
  const nodes = ["a", "hub", "b", "c", "unrelated", "isolated"].map((id) => ({ id }));
  const edges = [edge("a", "hub"), edge("b", "hub"), edge("hub", "c"), edge("hub", "unrelated")];
  const plan = createFocusedRestingRoutePlan(createRestingRouteIndex(nodes, edges),
    [edge("a", "b"), edge("a", "c"), edge("a", "isolated")], ["a"]);
  const geometry = signalGeometry([
    [[0, 0, 0], [3, 4, 0], [6, 4, 0]], // 5 + 3; cumulative distance 8 at hub
    [[6, 10, 0], [6, 8, 0], [6, 4, 0]], // reversed traversal: 4 + 2
    [[6, 4, 0], [6, 4, 3], [6, 4, 7]],
    [[6, 4, 0], [8, 4, 0], [10, 4, 0]],
  ]);
  const buffer = new Float32Array(edges.length * 2 * 4);
  assert.equal(writeFocusedSignalDistances(buffer, plan, 2, ...geometry), 15);
  const channel = (edgeIndex, which = 0) => [0, 1].flatMap((segment) =>
    [...buffer.slice((edgeIndex * 2 + segment) * 4 + which * 2, (edgeIndex * 2 + segment) * 4 + which * 2 + 2)]);
  assert.deepEqual(channel(0), [0, 5, 5, 8]);
  assert.deepEqual(channel(1), [14, 12, 12, 8]);
  assert.deepEqual(channel(2), [8, 11, 11, 15]);
  assert.deepEqual(channel(3), [-1, -1, -1, -1]);
  assert.deepEqual(channel(0, 1), [-1, -1, -1, -1]);
  assert.equal(plan.trees[0].steps.length, 3); // Shared trunk is never duplicated.

  // Moving model geometry refreshes physical travel distances without changing routes.
  writeFocusedSignalDistances(buffer, plan, 2, ...geometry.map((array) => array.map((value) => value * 2)));
  assert.deepEqual(channel(0), [0, 10, 10, 16]);
  assert.deepEqual(channel(1), [28, 24, 24, 16]);
});

test("signal travel preserves startup and packet phase during long-running selection", () => {
  let travel = 0;
  const farthest = 1212.88;
  const phase = (value) => ((value % FOCUSED_SIGNAL_SPACING) + FOCUSED_SIGNAL_SPACING) % FOCUSED_SIGNAL_SPACING;
  let wrapped = 0;
  // Six hours at 20 fps exercises the bounded GPU clock across many wraps.
  for (let frame = 1; frame <= 6 * 60 * 60 * 20; frame += 1) {
    const previous = travel;
    travel = advanceFocusedSignalTravel(travel, 0.05, farthest);
    if (frame * 12 < farthest) assert.equal(travel, frame * 12);
    if (travel < previous) {
      wrapped += 1;
      assert.ok(travel >= farthest);
      for (const point of [0, 8, 430, 876.5, farthest]) {
        assert.ok(Math.abs(phase(travel - point) - phase(previous + 12 - point)) < 1e-8);
      }
    }
    assert.ok(travel < farthest + FOCUSED_SIGNAL_SPACING * 2);
  }
  assert.ok(wrapped > 10_000);
  assert.equal(advanceFocusedSignalTravel(0, 10, farthest), 12); // resume after background pause
  assert.equal(advanceFocusedSignalTravel(0, 0.05, farthest, 2), 24);
});

test("two focused endpoints can send opposite signals on the same resting segments and clear cleanly", () => {
  const nodes = ["a", "hub", "b"].map((id) => ({ id }));
  const edges = [edge("a", "hub"), edge("hub", "b")];
  const index = createRestingRouteIndex(nodes, edges);
  const relations = [edge("a", "b")];
  const geometry = signalGeometry([
    [[0, 0, 0], [4, 0, 0], [10, 0, 0]],
    [[10, 0, 0], [10, 3, 0], [10, 8, 0]],
  ]);
  const buffer = new Float32Array(16);
  writeFocusedSignalDistances(buffer, createFocusedRestingRoutePlan(index, relations, ["a", "b"]), 2, ...geometry);
  assert.deepEqual([...buffer], [0, 4, 18, 14, 4, 10, 14, 8, 10, 13, 8, 5, 13, 18, 5, 0]);
  writeFocusedSignalDistances(buffer, createFocusedRestingRoutePlan(index, relations, ["a", "a"]), 2, ...geometry);
  assert.ok([...buffer].every((value, offset) => offset % 4 < 2 || value === -1));
  writeFocusedSignalDistances(buffer, createFocusedRestingRoutePlan(index, relations, [null, null]), 2, ...geometry);
  assert.ok(buffer.every((value) => value === -1));
});
