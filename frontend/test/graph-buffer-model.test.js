import assert from "node:assert/strict";
import test from "node:test";
import {
  createDeterministicStarField,
  createGraphAdjacentNodeSet,
  createGraphBufferModel,
  createGraphEdgeView,
  createGraphFocusedEdgeView,
  createGraphLayoutEdgeView,
  createGraphTopologyModel,
} from "../src/graphics/graph/graph-buffer-model.js";

const graph = {
  nodes: [
    { id: "home", title: "Home", kind: "home", degree: 2, weight: 4, x: 1, y: 2 },
    { id: "note", title: "Note", kind: "note", degree: 1, weight: 1 },
  ],
  edges: [{ source: "home", target: "note", kind: "wikilink", weight: 1 }],
};

test("graph buffer model produces packed positions, edge pairs, and sparse labels", () => {
  const model = createGraphBufferModel(graph, { dimension: 2, labelBudget: 1 });

  assert.deepEqual([...model.initialPositions.slice(0, 3)], [1, 2, 0]);
  assert.deepEqual([...model.edgePairs], [0, 1]);
  assert.deepEqual(model.labelIndices, [0]);
  assert.equal(model.sizes.length, 2);
  assert.ok(model.sizes[0] >= 4.2);
  assert.equal(model.hubMask[0], 1);
  assert.equal(model.layoutEdges.length, 1);
});

test("edge rendering is capped without dropping layout topology", () => {
  const denseGraph = {
    nodes: [
      { id: "a", title: "A", kind: "note", degree: 2, weight: 1 },
      { id: "b", title: "B", kind: "note", degree: 2, weight: 1 },
      { id: "c", title: "C", kind: "note", degree: 2, weight: 1 },
    ],
    edges: [
      { id: "light", source: "a", target: "b", weight: 1 },
      { id: "heavy", source: "b", target: "c", weight: 4 },
      { id: "medium", source: "a", target: "c", weight: 2 },
    ],
  };
  const model = createGraphBufferModel(denseGraph, { edgeBudget: 2, labelBudget: 0 });

  assert.equal(model.layoutEdges.length, 3);
  assert.deepEqual(model.edges.map((edge) => edge.id), ["heavy", "medium"]);
});

test("topology is stable while render edges prioritize the selected neighborhood", () => {
  const denseGraph = {
    nodes: [
      { id: "a", title: "A", kind: "note" },
      { id: "b", title: "B", kind: "note" },
      { id: "c", title: "C", kind: "note" },
      { id: "d", title: "D", kind: "note" },
    ],
    edges: [
      { id: "ab", source: "a", target: "b", weight: 1 },
      { id: "bc", source: "b", target: "c", weight: 8 },
      { id: "cd", source: "c", target: "d", weight: 4 },
      { id: "ad", source: "a", target: "d", weight: 2 },
    ],
  };
  const topology = createGraphTopologyModel(denseGraph, { labelBudget: 0 });
  const selectedView = createGraphEdgeView(topology, 1, "a");

  assert.equal(topology.layoutEdges.length, 4);
  assert.deepEqual(selectedView.map((edge) => edge.id), ["ab"]);
  assert.equal(topology.layoutEdges.length, 4);
});

test("incident and adjacency indexes serve focus changes without scanning all edges", () => {
  const topology = createGraphTopologyModel({
    nodes: [
      { id: "a" },
      { id: "b" },
      { id: "c" },
      { id: "d" },
    ],
    edges: [
      { id: "ab", source: "a", target: "b" },
      { id: "bc", source: "b", target: "c" },
      { id: "cd", source: "c", target: "d" },
      { id: "ad", source: "a", target: "d" },
    ],
  }, { labelBudget: 0 });
  const guardedLayoutEdges = new Proxy(topology.layoutEdges, {
    get(target, property, receiver) {
      if (property === "filter" || property === Symbol.iterator) {
        throw new Error("focus lookup scanned layoutEdges");
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const indexedTopology = { ...topology, layoutEdges: guardedLayoutEdges };

  assert.deepEqual(
    createGraphEdgeView(indexedTopology, 1, "a").map((edge) => edge.id),
    ["ab"],
  );
  assert.deepEqual(
    createGraphFocusedEdgeView(indexedTopology, 3, "a", "c").map((edge) => edge.id),
    ["bc", "cd", "ab"],
  );
  assert.deepEqual(
    [...createGraphAdjacentNodeSet(indexedTopology, "a", "c")].sort(),
    ["a", "b", "c", "d"],
  );
});

test("layout edge caps always preserve a spanning forest", () => {
  const connectedGraph = {
    nodes: [
      { id: "a" },
      { id: "b" },
      { id: "c" },
      { id: "d" },
    ],
    edges: [
      { id: "ab", source: "a", target: "b", weight: 5 },
      { id: "bc", source: "b", target: "c", weight: 4 },
      { id: "cd", source: "c", target: "d", weight: 3 },
      { id: "ad", source: "a", target: "d", weight: 2 },
    ],
  };
  const topology = createGraphTopologyModel(connectedGraph, { labelBudget: 0 });
  const layoutView = createGraphLayoutEdgeView(topology, 1);

  assert.equal(topology.spanningEdges.length, 3);
  assert.equal(layoutView.length, 3);
  assert.deepEqual(
    new Set(layoutView.map((edge) => edge.id)),
    new Set(topology.spanningEdges.map((edge) => edge.id)),
  );
});

test("star field generation is deterministic and packed", () => {
  const left = createDeterministicStarField(12);
  const right = createDeterministicStarField(12);

  assert.equal(left.length, 36);
  assert.deepEqual([...left], [...right]);
});
