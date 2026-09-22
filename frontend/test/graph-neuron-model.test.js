import assert from "node:assert/strict";
import test from "node:test";
import {
  createNeuronPositions,
  createNeuronStructure,
  NEURON_EDGE_SEGMENTS,
  writeNeuronCurve,
} from "../src/graphics/graph/graph-neuron-model.js";
import {
  getGraphVisualPresetId,
  getGraphVisualSettingsSnapshot,
  normalizeGraphVisualSettings,
  resetGraphVisualSettings,
  setGraphSharedNeuronStyle,
  setGraphVisualPreset,
  setGraphVisualSetting,
} from "../src/graphics/graph/graph-visual-settings.js";

function fixture() {
  const nodes = [];
  const edges = [];
  for (let group = 0; group < 5; group += 1) {
    for (let i = 0; i < 35; i += 1) {
      const id = `${group}:${i}`;
      nodes.push({ id, group: "vault", relativePath: `vault/category-${group}/${i === 0 ? "00-MOC-index" : i}.md` });
      if (i > 0) edges.push({ id: `root-${id}`, source: `${group}:0`, target: id });
      if (i > 1) edges.push({ id: `branch-${id}`, source: `${group}:${Math.floor((i - 1) / 3)}`, target: id });
    }
    if (group > 0) edges.push({ id: `cross-${group}`, source: `${group - 1}:0`, target: `${group}:0` });
  }
  return { nodes, edges };
}

test("neuron clusters split umbrella folders and retain only actual source relations", () => {
  const graph = fixture();
  const before = structuredClone(graph);
  const structure = createNeuronStructure(graph.nodes, graph.edges);
  const positions = createNeuronPositions(graph.nodes, structure);
  assert.equal(structure.roots.length, 2);
  assert.equal(structure.forestEdges.length, graph.nodes.length - 1);
  assert.ok(structure.members.every((members) => members.length > 10));
  const edgeIds = new Set(graph.edges.map((edge) => edge.id));
  for (const edge of structure.forestEdges) {
    assert.ok(edgeIds.has(edge.id));
    assert.equal(graph.nodes[edge.sourceIndex].id, edge.source);
    assert.equal(graph.nodes[edge.targetIndex].id, edge.target);
  }
  assert.ok([...positions].every(Number.isFinite));
  assert.ok([...positions].filter((_, index) => index % 3 === 2).every((value) => value === 0));
  assert.deepEqual(graph, before);
  assert.deepEqual(createNeuronPositions(graph.nodes, createNeuronStructure(graph.nodes, [...graph.edges].reverse())), positions);
});

test("curved branches and cross-cluster axons terminate at the original nodes", () => {
  const graph = fixture();
  const structure = createNeuronStructure(graph.nodes, graph.edges);
  const positions = createNeuronPositions(graph.nodes, structure);
  const buffer = new Float32Array(NEURON_EDGE_SEGMENTS * 6);
  for (const edge of structure.forestEdges) {
    writeNeuronCurve(buffer, 0, positions, edge, structure);
    assert.deepEqual([...buffer.slice(0, 2)], [...positions.slice(edge.sourceIndex * 3, edge.sourceIndex * 3 + 2)]);
    assert.deepEqual([...buffer.slice(-3, -1)], [...positions.slice(edge.targetIndex * 3, edge.targetIndex * 3 + 2)]);
    assert.ok([...buffer].every(Number.isFinite));
  }
});

test("empty, isolated and long-chain sources stay bounded without inventing edges", () => {
  for (const size of [0, 1, 20, 4096]) {
    const nodes = Array.from({ length: size }, (_, index) => ({ id: String(index) }));
    const edges = size === 4096 ? nodes.slice(1).map((node, index) => ({ source: String(index), target: node.id })) : [];
    const structure = createNeuronStructure(nodes, edges);
    const positions = createNeuronPositions(nodes, structure);
    assert.equal(positions.length, size * 3);
    assert.ok([...positions].every((value) => Number.isFinite(value) && Math.abs(value) < 1500));
    assert.equal(structure.forestEdges.length, edges.length);
  }
});

test("the independent 2D neuron template survives persistence and dimension changes", () => {
  resetGraphVisualSettings();
  setGraphSharedNeuronStyle(false);
  setGraphVisualPreset("nebula");
  const original = getGraphVisualSettingsSnapshot();
  setGraphVisualPreset("neuron");
  assert.equal(getGraphVisualSettingsSnapshot(), original);
  setGraphVisualSetting("view", "dimension", 2);
  setGraphVisualPreset("neuron");
  const applied = getGraphVisualSettingsSnapshot();
  assert.equal(applied.layout.mode, "neuron");
  assert.equal(getGraphVisualPresetId(applied), "neuron");
  assert.deepEqual(applied.dimensions["3d"], original.dimensions["3d"]);
  assert.deepEqual(applied.profiles["3d"], original.profiles["3d"]);
  setGraphVisualSetting("view", "dimension", 3);
  const stored = normalizeGraphVisualSettings(JSON.parse(JSON.stringify(getGraphVisualSettingsSnapshot())));
  assert.equal(stored.layout.mode, "force");
  assert.equal(stored.dimensions["2d"].layout.mode, "neuron");
  setGraphVisualSetting("view", "dimension", 2);
  assert.equal(getGraphVisualPresetId(getGraphVisualSettingsSnapshot()), "neuron");
  setGraphVisualPreset("obsidian");
  assert.equal(getGraphVisualSettingsSnapshot().layout.mode, "force");
  resetGraphVisualSettings();
});
