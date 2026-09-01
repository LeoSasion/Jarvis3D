import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createNeuralOrbTopology,
  selectNeuralOrbBudget,
} from "../src/graphics/orb/neural-orb-model.js";

const sourceRoot = new URL("../src/", import.meta.url);

test("neural orb topology is deterministic and keeps nodes near the spherical shell", () => {
  const options = {
    ambientCount: 24,
    bridgeCount: 10,
    neighborCount: 4,
    nodeCount: 92,
    radius: 180,
    seed: 42,
    signalRouteCount: 5,
  };
  const first = createNeuralOrbTopology(options);
  const second = createNeuralOrbTopology(options);

  assert.deepEqual(first.positions, second.positions);
  assert.deepEqual(first.edgePairs, second.edgePairs);
  assert.deepEqual(first.signalRoutes, second.signalRoutes);
  assert.deepEqual(first.edgeSignalTimes, second.edgeSignalTimes);
  assert.deepEqual(first.nodeSignalTimes, second.nodeSignalTimes);
  assert.equal(first.positions.length, options.nodeCount * 3);
  assert.equal(first.nodeScales.length, options.nodeCount);
  assert.equal(first.ambientPositions.length, options.ambientCount * 3);

  for (let index = 0; index < options.nodeCount; index += 1) {
    const offset = index * 3;
    const distance = Math.hypot(
      first.positions[offset],
      first.positions[offset + 1],
      first.positions[offset + 2],
    );
    assert.ok(distance >= options.radius * 0.93);
    assert.ok(distance <= options.radius * 1.05);
    assert.ok(first.degrees[index] >= options.neighborCount);
  }
});

test("neural orb connections are unique, bounded, and never self-link", () => {
  const topology = createNeuralOrbTopology({
    bridgeCount: 14,
    neighborCount: 4,
    nodeCount: 116,
  });
  const keys = new Set();
  topology.edgePairs.forEach(([source, target]) => {
    assert.notEqual(source, target);
    assert.ok(source < target);
    keys.add(`${source}:${target}`);
  });
  assert.equal(keys.size, topology.edgePairs.length);
  assert.equal(topology.edgePositions.length, topology.edgePairs.length * 6);
  assert.equal(topology.edgeEnergy.length, topology.edgePairs.length * 2);
  assert.equal(topology.edgeSignalStrengths.length, topology.edgePairs.length * 2);
  assert.equal(topology.edgeSignalTimes.length, topology.edgePairs.length * 2);
  assert.equal(topology.nodeSignalStrengths.length, 116);
  assert.equal(topology.nodeSignalTimes.length, 116);
  assert.ok(topology.edgePairs.length > 220);
  assert.ok(topology.edgePairs.length < 420);
});

test("neural signal routes are connected and arrive every two to four seconds", () => {
  const topology = createNeuralOrbTopology({
    bridgeCount: 16,
    neighborCount: 4,
    nodeCount: 120,
    seed: 73,
    signalRouteCount: 7,
  });
  const usedEdges = new Set();
  const usedNodes = new Set();

  assert.equal(topology.signalRoutes.length, 7);
  assert.equal(topology.signalRouteStarts.length, 7);
  topology.signalRoutes.forEach((route, routeIndex) => {
    assert.ok(route.edgeIndexes.length >= 3);
    assert.equal(route.nodes.length, route.edgeIndexes.length + 1);
    assert.ok(
      Math.abs(route.startTime - topology.signalRouteStarts[routeIndex]) < 0.00001,
    );
    route.nodes.forEach((node) => {
      assert.equal(usedNodes.has(node), false);
      assert.ok(topology.nodeSignalStrengths[node] > 0);
      usedNodes.add(node);
    });
    route.edgeIndexes.forEach((edgeIndex, step) => {
      const [left, right] = topology.edgePairs[edgeIndex];
      const source = route.nodes[step];
      const target = route.nodes[step + 1];
      assert.equal(usedEdges.has(edgeIndex), false);
      assert.equal(
        (left === source && right === target) || (left === target && right === source),
        true,
      );
      assert.ok(topology.edgeSignalStrengths[edgeIndex * 2] > 0);
      usedEdges.add(edgeIndex);
    });
  });

  assert.equal(topology.signalPointDurations.length, usedEdges.size);
  assert.equal(topology.signalPointPositions.length, usedEdges.size * 3);
  assert.equal(topology.signalPointStrengths.length, usedEdges.size);
  assert.equal(topology.signalPointTargets.length, usedEdges.size * 3);
  assert.equal(topology.signalPointTimes.length, usedEdges.size);

  const starts = [...topology.signalRouteStarts];
  const gaps = starts.slice(1).map((start, index) => start - starts[index]);
  gaps.push(topology.signalCycle + starts[0] - starts[starts.length - 1]);
  gaps.forEach((gap) => {
    assert.ok(gap >= 2.19);
    assert.ok(gap <= 3.76);
  });
});

test("neural orb budgets scale with the graphics quality tier", () => {
  assert.ok(selectNeuralOrbBudget("low").nodeCount < selectNeuralOrbBudget("balanced").nodeCount);
  assert.ok(selectNeuralOrbBudget("balanced").nodeCount < selectNeuralOrbBudget("high").nodeCount);
  assert.ok(
    selectNeuralOrbBudget("low").signalRouteCount
      < selectNeuralOrbBudget("high").signalRouteCount,
  );
  assert.equal(selectNeuralOrbBudget("unknown"), selectNeuralOrbBudget("balanced"));
});

test("the orb is a scene module inside the shared graphics owner", async () => {
  const [canvas, coreStage, scene, surface, main] = await Promise.all([
    readFile(new URL("graphics/CoreVisualCanvas.jsx", sourceRoot), "utf8"),
    readFile(new URL("components/CoreStage.jsx", sourceRoot), "utf8"),
    readFile(new URL("graphics/orb/NeuralOrbScene.jsx", sourceRoot), "utf8"),
    readFile(new URL("NeuralOrbSurface.jsx", sourceRoot), "utf8"),
    readFile(new URL("main.jsx", sourceRoot), "utf8"),
  ]);

  assert.match(canvas, /<NeuralOrbScene/u);
  assert.match(canvas, /data-visual-scene="neural-orb"/u);
  assert.match(surface, /<CoreVisualCanvas/u);
  assert.match(surface, /scene="neural-orb"/u);
  assert.doesNotMatch(surface, /#[0-9a-f]{6}/iu);
  assert.match(canvas, /getVisualThemeDefinition/u);
  assert.match(main, /surface === "orb"/u);
  assert.match(scene, /aSignalTime/u);
  assert.match(scene, /uSignalCycle/u);
  assert.match(surface, /motionMode/u);
  assert.match(coreStage, /getDesktopGraphMotionMode/u);
  assert.match(coreStage, /motionMode=\{graphMotionMode\}/u);
  assert.match(canvas, /resolveCanvasReducedMotion/u);
  assert.match(canvas, /data-motion=\{reducedMotion \? "reduced" : "full"\}/u);
  assert.match(canvas, /orbEnergyPresentation/u);
  assert.doesNotMatch(scene, /<Canvas|requestAnimationFrame/u);
});
