import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_GRAPH_VISUAL_SETTINGS, flushGraphVisualSettingsPersistence,
  getGraphVisualRenderSettingsSnapshot, getGraphVisualSettingsSnapshot,
  resetGraphVisualSettings, setGraphVisualProfileSetting, setGraphVisualSetting,
  subscribeGraphVisualSettings, undoGraphVisualSettings,
} from "../src/graphics/graph/graph-visual-settings.js";
import {
  captureGraphVisualReference, createGraphComparisonClock, endGraphVisualPreview,
  getGraphVisualPreviewSnapshot, selectGraphVisualPreview, setGraphVisualPreviewFrozen,
  selectGraphComparisonView,
} from "../src/graphics/graph/graph-visual-preview.js";
import {
  graphSettingChanged, graphSettingDefault, matchesGraphControlFilter,
} from "../src/graphics/graph/graph-visual-editor-model.js";

test("search combines translated labels, technical paths and changed-only without category restrictions", () => {
  const control = { path: "edge.signal.emissionIntensity", label: "电信号亮度", detail: "沿现有连线传播", value: 1.4, defaultValue: 1 };
  assert.equal(matchesGraphControlFilter({ query: "电信号", changedOnly: true }, control), true);
  assert.equal(matchesGraphControlFilter({ query: "EDGE signal", changedOnly: false }, control), true);
  assert.equal(matchesGraphControlFilter({ query: "连线 传播", changedOnly: false }, control), true);
  assert.equal(matchesGraphControlFilter({ query: "bloom", changedOnly: false }, control), false);
  assert.equal(matchesGraphControlFilter({ query: "", changedOnly: true }, { ...control, value: 1 }), false);
  assert.equal(graphSettingChanged(1 + 1e-12, 1), false);
  assert.equal(graphSettingChanged(false, true), true);
});

test("single-item resets use the approved dimension defaults, including calibrated glow", () => {
  resetGraphVisualSettings();
  try {
    setGraphVisualSetting("view", "dimension", 2);
    setGraphVisualSetting("node", "scale", 2.2);
    setGraphVisualSetting("labels", "fontSize", 13);
    const baseline = graphSettingDefault(DEFAULT_GRAPH_VISUAL_SETTINGS, 2, "node", "scale");
    setGraphVisualSetting("node", "scale", baseline);
    assert.equal(getGraphVisualSettingsSnapshot().node.scale, DEFAULT_GRAPH_VISUAL_SETTINGS.dimensions["2d"].node.scale);
    assert.equal(getGraphVisualSettingsSnapshot().labels.fontSize, 13);
    setGraphVisualProfileSetting("2d", "postFx.bloom.intensity", 3);
    setGraphVisualProfileSetting("2d", "postFx.bloom.intensity", DEFAULT_GRAPH_VISUAL_SETTINGS.profiles["2d"].postFx.bloom.intensity);
    assert.equal(getGraphVisualSettingsSnapshot().profiles["2d"].postFx.bloom.intensity, 1.95);
    assert.equal(getGraphVisualSettingsSnapshot().profiles["3d"].postFx.bloom.intensity, 1.95);
  } finally { resetGraphVisualSettings(); }
});

test("A/B only changes render snapshots; persistence and undo retain the latest B", () => {
  const writes = [];
  const previousWindow = globalThis.window;
  globalThis.window = {
    localStorage: { getItem: () => null, setItem: (key, value) => writes.push({ key, value }) },
    addEventListener() {}, removeEventListener() {},
  };
  let notifications = 0;
  const unsubscribe = subscribeGraphVisualSettings(() => { notifications += 1; });
  try {
    resetGraphVisualSettings();
    const a = getGraphVisualSettingsSnapshot();
    captureGraphVisualReference(a);
    setGraphVisualSetting("labels", "fontSize", 13);
    flushGraphVisualSettingsPersistence();
    const b = getGraphVisualSettingsSnapshot();
    const savedWrites = writes.length;
    for (let index = 0; index < 4; index += 1) {
      selectGraphVisualPreview("a");
      assert.equal(getGraphVisualRenderSettingsSnapshot(), a);
      assert.equal(getGraphVisualSettingsSnapshot(), b);
      flushGraphVisualSettingsPersistence();
      selectGraphVisualPreview("b");
      assert.equal(getGraphVisualRenderSettingsSnapshot(), b);
    }
    selectGraphVisualPreview("a");
    setGraphVisualPreviewFrozen(true);
    endGraphVisualPreview();
    assert.equal(getGraphVisualRenderSettingsSnapshot(), b);
    assert.equal(getGraphVisualPreviewSnapshot().frozen, false);
    assert.equal(writes.length, savedWrites);
    assert.equal(JSON.parse(writes.at(-1).value).labels.fontSize, 13);
    assert.equal(undoGraphVisualSettings(), true);
    assert.equal(getGraphVisualSettingsSnapshot().labels.fontSize, a.labels.fontSize);
    assert.ok(notifications >= 12);
  } finally {
    endGraphVisualPreview();
    resetGraphVisualSettings();
    unsubscribe();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("frozen comparison uses one continuous animation clock across long idle gaps and repeated render edits", () => {
  const clock = createGraphComparisonClock();
  assert.deepEqual(clock.sample(20, 0.016, false), { elapsed: 20, frameDelta: 0.016 });
  clock.sample(21, 0.016, false);
  for (const raw of [22, 30, 120, 1000]) {
    assert.deepEqual(clock.sample(raw, 0.016, true), { elapsed: 21, frameDelta: 0 });
  }
  assert.deepEqual(clock.sample(2000, 1000, false), { elapsed: 21, frameDelta: 0 });
  const resumed = clock.sample(2000.02, 0.02, false);
  assert.ok(Math.abs(resumed.elapsed - 21.02) < 1e-10);
  assert.equal(resumed.frameDelta, 0.02);
  assert.deepEqual(clock.sample(2001, 0.5, true), { elapsed: resumed.elapsed, frameDelta: 0 });
});

test("frozen comparison retains the scene, dimension, focus and source until the latest live view resumes", () => {
  const original = {
    dimension: 3, interactive: false, scene: undefined, graph: { nodes: [{ id: "one" }] },
    selectedNodeId: "one", motionMode: "full",
  };
  const before = selectGraphComparisonView(null, original, false);
  assert.equal(selectGraphComparisonView(before, { ...original }, false), before);
  const next = { ...original, dimension: 2, interactive: true, graph: { nodes: [] }, selectedNodeId: "two", motionMode: "reduced" };
  assert.equal(selectGraphComparisonView(before, next, true), before);
  assert.equal(selectGraphComparisonView(before, { ...next, dimension: 3 }, true), before);
  const resumed = selectGraphComparisonView(before, next, false);
  assert.equal(resumed.dimension, 2);
  assert.equal(resumed.interactive, true);
  assert.equal(resumed.graph, next.graph);
  assert.equal(resumed.selectedNodeId, "two");
  assert.equal(resumed.motionMode, "reduced");
});
