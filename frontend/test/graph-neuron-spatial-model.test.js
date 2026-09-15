import assert from "node:assert/strict";
import test from "node:test";
import { createGraphTopologyModel, createGraphFocusedEdgeView } from "../src/graphics/graph/graph-buffer-model.js";
import { createNeuronStructure, createNeuronPositions } from "../src/graphics/graph/graph-neuron-model.js";
import { createSpatialNeuronPositions, createSpatialNeuronEdgeView, writeSpatialNeuronCurve } from "../src/graphics/graph/graph-neuron-spatial-model.js";
import {
  getGraphVisualPresetId, getGraphVisualSettingsSnapshot, normalizeGraphVisualSettings,
  resetGraphVisualSettings, setGraphVisualPreset, setGraphVisualSetting,
} from "../src/graphics/graph/graph-visual-settings.js";

function fixture() {
  const nodes = [];
  const edges = [];
  for (let group = 0; group < 5; group += 1) {
    for (let i = 0; i < 100; i += 1) {
      const id = `${group}:${i}`;
      nodes.push({ id, group: `category-${group}`, kind: i === 0 ? "moc" : "note" });
      if (i > 0) edges.push({ id: `root-${id}`, source: `${group}:0`, target: id });
      if (i > 1) edges.push({ id: `branch-${id}`, source: `${group}:${Math.floor((i - 1) / 3)}`, target: id });
      if (i > 2) edges.push({ id: `loop-${id}`, source: `${group}:${i - 1}`, target: id });
    }
    if (group > 0) edges.push({ id: `cross-${group}`, source: `${group - 1}:0`, target: `${group}:0` });
  }
  const model = createGraphTopologyModel({ nodes, edges }, { dimension: 3 });
  model.neuron = createNeuronStructure(model.nodes, model.layoutEdges);
  return model;
}

test("spatial neurons have real volume within each cluster, remain deterministic, and preserve 2D positions", () => {
  const model = fixture();
  const planar = createNeuronPositions(model.nodes, model.neuron);
  const positions = createSpatialNeuronPositions(model.nodes, model.neuron);
  assert.equal(positions.length, model.nodes.length * 3);
  assert.ok([...positions].every(Number.isFinite));
  assert.deepEqual(positions, createSpatialNeuronPositions(model.nodes, model.neuron));
  assert.deepEqual(planar, createNeuronPositions(model.nodes, model.neuron));
  for (const members of model.neuron.members) {
    for (let axis = 0; axis < 3; axis += 1) {
      const values = members.map((index) => positions[index * 3 + axis]);
      assert.ok(Math.max(...values) - Math.min(...values) > 65, `cluster spans axis ${axis}`);
    }
  }
  const expanded = createSpatialNeuronPositions(model.nodes, model.neuron, { depth: 2 });
  const spread = createSpatialNeuronPositions(model.nodes, model.neuron, { branchSpread: 0.9 });
  assert.notDeepEqual(spread, positions);
  assert.ok([...spread].every(Number.isFinite));
  for (let i = 0; i < positions.length; i += 1) {
    assert.ok(Math.abs(expanded[i] - positions[i] * (i % 3 === 2 ? 2 : 1)) < 0.0001);
  }
});

test("spatial curves preserve both source endpoints including Z and bend outside the XY plane", () => {
  const model = fixture();
  const positions = createSpatialNeuronPositions(model.nodes, model.neuron);
  const buffer = new Float32Array(24 * 6);
  for (const edge of createSpatialNeuronEdgeView(model, 1000)) {
    writeSpatialNeuronCurve(buffer, 0, positions, edge, model.neuron);
    assert.deepEqual([...buffer.slice(0, 3)], [...positions.slice(edge.sourceIndex * 3, edge.sourceIndex * 3 + 3)]);
    assert.deepEqual([...buffer.slice(-3)], [...positions.slice(edge.targetIndex * 3, edge.targetIndex * 3 + 3)]);
    assert.ok([...buffer].every(Number.isFinite));
    for (let i = 6; i < buffer.length; i += 6) assert.deepEqual([...buffer.slice(i, i + 3)], [...buffer.slice(i - 3, i)]);
  }
  const edge = model.layoutEdges.find((item) => model.neuron.cluster[item.sourceIndex] !== model.neuron.cluster[item.targetIndex]);
  const flat = new Float32Array(positions.length);
  flat.set([0, 0, 10], edge.sourceIndex * 3);
  flat.set([100, 0, 10], edge.targetIndex * 3);
  writeSpatialNeuronCurve(buffer, 0, flat, edge, model.neuron, 24, 1);
  assert.ok([...buffer].filter((_, i) => i % 3 === 2).some((z) => Math.abs(z - 10) > 1));
  writeSpatialNeuronCurve(buffer, 0, flat, edge, model.neuron, 24, 0);
  assert.ok([...buffer].filter((_, i) => i % 3 === 2).every((z) => z === 10));
});

test("additional loops are bounded source relations and never remove the spanning skeleton or incident query", () => {
  const model = fixture();
  const skeleton = createSpatialNeuronEdgeView(model, 2000, 0);
  const woven = createSpatialNeuronEdgeView(model, 2000, 1);
  assert.deepEqual(skeleton, model.neuron.forestEdges);
  assert.deepEqual(woven.slice(0, skeleton.length), skeleton);
  assert.ok(woven.length > skeleton.length);
  assert.ok(woven.length <= skeleton.length + model.nodes.length * 0.45);
  const sourceIds = new Set(model.layoutEdges.map((edge) => edge.id));
  assert.ok(woven.every((edge) => sourceIds.has(edge.id)));
  assert.equal(new Set(woven.map((edge) => [edge.source, edge.target].sort().join(":"))).size, woven.length);
  assert.equal(createSpatialNeuronEdgeView(model, 12, 1).length, 12);
  assert.equal(createSpatialNeuronEdgeView(model, 0, 1).length, 0);
  const root = model.nodes[model.neuron.roots[0]].id;
  assert.equal(createGraphFocusedEdgeView(model, 2000, root).length, model.incidentEdgesByNodeId.get(root).length);
});

test("empty, isolated, coincident and long-chain inputs stay finite and bounded", () => {
  for (const size of [0, 1, 20, 4096]) {
    const nodes = Array.from({ length: size }, (_, i) => ({ id: String(i) }));
    const edges = size === 4096 ? nodes.slice(1).map((node, i) => ({ source: String(i), target: node.id })) : [];
    const structure = createNeuronStructure(nodes, edges);
    const positions = createSpatialNeuronPositions(nodes, structure, { depth: NaN, linkDistance: Infinity });
    assert.equal(positions.length, size * 3);
    assert.ok([...positions].every((value) => Number.isFinite(value) && Math.abs(value) < 1500));
    if (size > 1) {
      const output = new Float32Array(24 * 6);
      writeSpatialNeuronCurve(output, 0, new Float32Array(size * 3), { sourceIndex: 0, targetIndex: 1 }, structure);
      assert.ok([...output].every(Number.isFinite));
    }
  }
});

test("3D neuron settings persist independently with local emission and restrained bloom", () => {
  resetGraphVisualSettings();
  setGraphVisualSetting("view", "dimension", 2);
  setGraphVisualPreset("neuron");
  const before = getGraphVisualSettingsSnapshot();
  setGraphVisualSetting("view", "dimension", 3);
  setGraphVisualPreset("neural");
  const orb = getGraphVisualSettingsSnapshot().profiles["3d"];
  setGraphVisualPreset("neuron3d");
  const spatial = getGraphVisualSettingsSnapshot();
  assert.equal(getGraphVisualPresetId(spatial), "neuron3d");
  assert.equal(spatial.layout.mode, "neuron");
  assert.deepEqual(spatial.dimensions["2d"], before.dimensions["2d"]);
  assert.deepEqual(spatial.profiles["2d"], before.profiles["2d"]);
  assert.equal(spatial.profiles["3d"].postFx.radiance.temperature, 1);
  assert.ok(spatial.profiles["3d"].postFx.bloom.threshold > orb.postFx.bloom.threshold);
  assert.ok(spatial.profiles["3d"].postFx.bloom.intensity < orb.postFx.bloom.intensity);
  assert.equal(spatial.layout.depthContrast, 0);
  assert.equal(spatial.profiles["3d"].orb.network.depthContrast, 0);
  assert.deepEqual(spatial.profiles["3d"].orb.sparks, orb.orb.sparks);
  assert.ok(spatial.profiles["3d"].edge.core.widthScale < orb.edge.core.widthScale);
  setGraphVisualSetting("layout", "depth", 1.6);
  setGraphVisualSetting("layout", "weave", 1.1);
  const stored = normalizeGraphVisualSettings(JSON.parse(JSON.stringify(getGraphVisualSettingsSnapshot())));
  assert.equal(stored.layout.depth, 1.6);
  assert.equal(stored.layout.weave, 1.1);
  setGraphVisualSetting("view", "dimension", 2);
  assert.equal(getGraphVisualPresetId(getGraphVisualSettingsSnapshot()), "neuron");
  setGraphVisualSetting("view", "dimension", 3);
  assert.equal(getGraphVisualSettingsSnapshot().layout.depth, 1.6);
  setGraphVisualPreset("neural");
  assert.equal(getGraphVisualSettingsSnapshot().layout.mode, "force");
  resetGraphVisualSettings();
});
