import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_GRAPH_VISUAL_SETTINGS,
  getGraphVisualPresetId,
  getGraphVisualSettingsSnapshot,
  normalizeGraphVisualSettings,
  resetActiveGraphVisualSettings,
  resetGraphVisualSettings,
  resetGraphVisualProfile,
  selectGraphDimensionSettings,
  setGraphVisualPreset,
  setGraphVisualProfileSetting,
  setGraphVisualSetting,
  setGraphSharedNeuronStyle,
  undoGraphVisualSettings,
  updateGraphVisualSettingsSection,
} from "../src/graphics/graph/graph-visual-settings.js";
import {
  normalizeGraphVisualProfileDocument,
  serializeGraphVisualProfileDocument,
} from "../src/graph/graph-visual-profile-library.js";

test("shared neuron style links visual changes from either view while preserving layout and labels", () => {
  resetGraphVisualSettings();
  setGraphSharedNeuronStyle(false);
  setGraphVisualPreset("neuron3d");
  const before = getGraphVisualSettingsSnapshot();
  setGraphSharedNeuronStyle(true);
  setGraphVisualProfileSetting("3d", "node.core.emissionIntensity", 2.6);
  setGraphVisualSetting("view", "dimension", 2);
  setGraphVisualProfileSetting("2d", "edge.halo.opacity", 0.18);
  setGraphVisualSetting("node", "scale", 1.4);
  setGraphVisualSetting("layout", "linkDistance", 0.8);
  setGraphVisualSetting("labels", "fontSize", 14);
  const linked = getGraphVisualSettingsSnapshot();
  assert.equal(linked.sharedStyle, true);
  assert.equal(linked.idleShape, "neuronSphere");
  for (const key of ["node", "edge", "signal", "motion", "postFx"]) {
    assert.deepEqual(linked.profiles["2d"][key], linked.profiles["3d"][key]);
  }
  assert.equal(linked.profiles["3d"].edge.halo.opacity, 0.18);
  assert.equal(linked.profiles["2d"].node.core.emissionIntensity, 2.6);
  assert.equal(linked.dimensions["3d"].node.scale, 1.4);
  assert.deepEqual(linked.dimensions["3d"].layout, before.dimensions["3d"].layout);
  assert.deepEqual(linked.dimensions["3d"].labels, before.dimensions["3d"].labels);
  assert.equal(linked.dimensions["2d"].labels.fontSize, 14);
  assert.deepEqual(normalizeGraphVisualSettings(JSON.parse(JSON.stringify(linked))), linked);
  assert.equal(setGraphSharedNeuronStyle(true), linked);
  setGraphSharedNeuronStyle(false);
  setGraphVisualProfileSetting("2d", "edge.halo.opacity", 0.4);
  assert.equal(getGraphVisualSettingsSnapshot().profiles["3d"].edge.halo.opacity, 0.18);
});

test("idle geometry remains private while shared FX round trip in saved profiles", () => {
  resetGraphVisualSettings();
  setGraphSharedNeuronStyle(true);
  setGraphVisualProfileSetting("3d", "orb.network.branchSpread", 1.3);
  setGraphVisualProfileSetting("3d", "orb.network.weave", 1.2);
  const original = getGraphVisualSettingsSnapshot();
  assert.equal(original.profiles["2d"].orb, undefined);
  const exported = serializeGraphVisualProfileDocument([{ id: "linked", label: "Linked", settings: original }]);
  assert.deepEqual(normalizeGraphVisualProfileDocument(JSON.parse(exported)).profiles[0].settings, original);
  setGraphVisualSetting("view", "dimension", 2);
  const idle = selectGraphDimensionSettings(getGraphVisualSettingsSnapshot(), 3);
  assert.equal(idle.profiles["3d"].orb.network.branchSpread, 1.3);
  assert.equal(idle.sharedStyle, true);
  assert.equal(getGraphVisualSettingsSnapshot().view.dimension, 2);
  resetGraphVisualSettings();
});

test("shared reset uses the same neuron FX from either view and preserves sphere geometry", () => {
  resetGraphVisualSettings();
  setGraphSharedNeuronStyle(true);
  setGraphVisualProfileSetting("3d", "orb.network.sizeScale", 0.8);
  setGraphVisualProfileSetting("3d", "node.core.emissionIntensity", 0.4);
  resetGraphVisualProfile("3d");
  const reset = getGraphVisualSettingsSnapshot();
  setGraphVisualSetting("view", "dimension", 2);
  setGraphVisualProfileSetting("2d", "node.core.emissionIntensity", 0.6);
  resetGraphVisualProfile("2d");
  assert.deepEqual(getGraphVisualSettingsSnapshot().profiles, reset.profiles);
  resetActiveGraphVisualSettings();
  assert.equal(getGraphVisualSettingsSnapshot().layout.mode, "neuron");
  assert.equal(getGraphVisualSettingsSnapshot().profiles["3d"].orb.network.sizeScale, 0.8);
  resetGraphVisualSettings();
});

test("dimension switching restores independent sizes, spacing, colors, quality and FX", () => {
  resetGraphVisualSettings();
  setGraphSharedNeuronStyle(false);
  setGraphVisualSetting("node", "scale", 2);
  setGraphVisualSetting("layout", "linkDistance", 1.7);
  setGraphVisualSetting("edge", "color", "#123456");
  setGraphVisualSetting("performance", "quality", "high");
  setGraphVisualProfileSetting("3d", "postFx.bloom.intensity", 2.4);
  const before = getGraphVisualSettingsSnapshot();
  setGraphVisualSetting("view", "dimension", 2);
  assert.deepEqual(getGraphVisualSettingsSnapshot().node, DEFAULT_GRAPH_VISUAL_SETTINGS.dimensions["2d"].node);
  setGraphVisualSetting("node", "scale", 0.9);
  setGraphVisualSetting("layout", "linkDistance", 0.7);
  setGraphVisualProfileSetting("2d", "postFx.bloom.intensity", 0.2);
  updateGraphVisualSettingsSection("view", { dimension: 3 });
  const restored = getGraphVisualSettingsSnapshot();
  for (const section of ["node", "layout", "edge", "performance"]) {
    assert.deepEqual(restored[section], before[section]);
  }
  assert.equal(restored.profiles["3d"].postFx.bloom.intensity, 2.4);
  assert.equal(restored.dimensions["2d"].node.scale, 0.9);
  assert.equal(restored.profiles["2d"].postFx.bloom.intensity, 0.2);
});

test("presets, active reset and undo cannot overwrite the other dimension", () => {
  resetGraphVisualSettings();
  setGraphSharedNeuronStyle(false);
  setGraphVisualSetting("node", "scale", 2.2);
  setGraphVisualProfileSetting("3d", "edge.halo.opacity", 0.8);
  const before = getGraphVisualSettingsSnapshot();
  setGraphVisualSetting("view", "dimension", 2);
  setGraphVisualPreset("blueprint");
  assert.equal(getGraphVisualSettingsSnapshot().view.dimension, 2);
  assert.equal(getGraphVisualPresetId(getGraphVisualSettingsSnapshot()), "blueprint");
  const customized = getGraphVisualSettingsSnapshot();
  resetActiveGraphVisualSettings();
  const reset = getGraphVisualSettingsSnapshot();
  assert.deepEqual(reset.dimensions["3d"], before.dimensions["3d"]);
  assert.deepEqual(reset.profiles["3d"], before.profiles["3d"]);
  assert.deepEqual(reset.dimensions["2d"], DEFAULT_GRAPH_VISUAL_SETTINGS.dimensions["2d"]);
  assert.deepEqual(reset.profiles["2d"], DEFAULT_GRAPH_VISUAL_SETTINGS.profiles["2d"]);
  assert.equal(undoGraphVisualSettings(), true);
  assert.deepEqual(getGraphVisualSettingsSnapshot(), customized);
});

test("v6 shared intent migrates into both dimensions without losing either FX profile", () => {
  const { dimensions: omitted, ...legacy } = DEFAULT_GRAPH_VISUAL_SETTINGS;
  assert.ok(omitted);
  const migrated = normalizeGraphVisualSettings({
    ...legacy, version: 6,
    node: { ...legacy.node, scale: 1.9 },
    layout: { ...legacy.layout, linkDistance: 1.6 },
  });
  for (const id of ["2d", "3d"]) {
    assert.equal(migrated.dimensions[id].node.scale, 1.9);
    assert.equal(migrated.dimensions[id].layout.linkDistance, 1.6);
    assert.deepEqual(migrated.profiles[id], legacy.profiles[id]);
  }
  assert.equal(migrated.version, 7);
  assert.notEqual(migrated.dimensions["2d"].node, migrated.dimensions["3d"].node);
});

test("saved JSON and named profile exports round trip both dimension settings", () => {
  resetGraphVisualSettings();
  setGraphSharedNeuronStyle(false);
  setGraphVisualSetting("node", "scale", 2);
  setGraphVisualSetting("view", "dimension", 2);
  setGraphVisualSetting("node", "scale", 0.8);
  setGraphVisualProfileSetting("2d", "edge.halo.enabled", true);
  const original = getGraphVisualSettingsSnapshot();
  assert.deepEqual(normalizeGraphVisualSettings(JSON.parse(JSON.stringify(original))), original);
  const exported = serializeGraphVisualProfileDocument([{ id: "dual", label: "Dual", settings: original }]);
  assert.deepEqual(normalizeGraphVisualProfileDocument(JSON.parse(exported)).profiles[0].settings, original);
  const three = selectGraphDimensionSettings(original, 3);
  assert.equal(three.node.scale, 2);
  assert.equal(three.view.dimension, 3);
  assert.equal(original.view.dimension, 2);
  assert.equal(original.node.scale, 0.8);
});

test("the reference orb preset is opt-in, preserves 2D and retains the note budget", () => {
  resetGraphVisualSettings();
  setGraphSharedNeuronStyle(false);
  const original = getGraphVisualSettingsSnapshot();
  setGraphVisualPreset("neural");
  const reference = getGraphVisualSettingsSnapshot();
  assert.equal(reference.node.maxCount, 4096);
  assert.equal(reference.profiles["3d"].orb.network.shellRatio, 0.28);
  assert.equal(reference.profiles["3d"].node.pulse.enabled, false);
  assert.deepEqual(reference.dimensions["2d"], original.dimensions["2d"]);
  assert.deepEqual(reference.profiles["2d"], original.profiles["2d"]);
  setGraphVisualSetting("view", "dimension", 2);
  const two = getGraphVisualSettingsSnapshot();
  setGraphVisualPreset("neural");
  assert.equal(getGraphVisualSettingsSnapshot(), two);
});
