import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { graphFxSettingRanges, normalizeGraphFxProfile } from "../src/graphics/graph/graph-fx-profile.js";
import { getFocusedFilamentGain } from "../src/graphics/graph/graph-focus-filament.js";
import { createGraphCellVariations } from "../src/graphics/graph/graph-cell-state.js";
import { getGraphVisualSettingsSnapshot, normalizeGraphVisualSettings, resetGraphVisualSettings, setGraphSharedNeuronStyle, setGraphVisualProfileSetting } from "../src/graphics/graph/graph-visual-settings.js";

test("every bounded graph effect parameter has a corresponding settings control", () => {
  const source = readFileSync(new URL("../src/graphics/graph/GraphVisualSettings.jsx", import.meta.url), "utf8");
  for (const path of Object.keys(graphFxSettingRanges)) {
    const mappedRadiance = path.startsWith("postFx.radiance.")
      && source.includes('path={`postFx.radiance.${control}`}')
      && source.includes(`"${path.split(".").at(-1)}"`);
    assert.ok(mappedRadiance || source.includes(`path="${path}"`), `Missing control: ${path}`);
  }
});

test("new controls migrate old profiles, clamp invalid input, and preserve per-view ownership", () => {
  const legacy = normalizeGraphFxProfile("3d", {});
  assert.deepEqual(legacy.orb.signals, { enabled: true, count: 48, sizeVariation: 0.3, launchSpread: 0.5, batchInterval: 3, hops: 10 });
  assert.deepEqual(legacy.edge.focus, { boost: 0.3, amplitude: 0.55, period: 2.8 });
  const invalid = normalizeGraphFxProfile("3d", { orb: { signals: { count: 500, hops: -5, batchInterval: Infinity } }, edge: { focus: { boost: -1, period: 0 } } });
  assert.deepEqual(invalid.orb.signals, { enabled: true, count: 48, sizeVariation: 0.3, launchSpread: 0.5, batchInterval: 3, hops: 2 });
  assert.equal(normalizeGraphFxProfile("3d", { orb: { signals: { launchSpread: 99 } } }).orb.signals.launchSpread, 1);
  assert.equal(normalizeGraphFxProfile("3d", { orb: { signals: { launchSpread: -1 } } }).orb.signals.launchSpread, 0);
  assert.equal(normalizeGraphFxProfile("3d", { orb: { signals: { batchInterval: 0 } } }).orb.signals.batchInterval, 0.5);
  assert.equal(invalid.edge.focus.boost, 0.05);
  assert.equal(invalid.edge.focus.period, 0.5);
  resetGraphVisualSettings();
  try {
    setGraphSharedNeuronStyle(true);
    setGraphVisualProfileSetting("3d", "edge.signal.headLength", 2);
    setGraphVisualProfileSetting("3d", "orb.signals.count", 3);
    setGraphVisualProfileSetting("3d", "orb.signals.sizeVariation", 0);
    setGraphVisualProfileSetting("3d", "orb.signals.launchSpread", 0.75);
    setGraphVisualProfileSetting("3d", "orb.signals.batchInterval", 2.5);
    setGraphVisualProfileSetting("2d", "node.size.variation", 0.4);
    let saved = getGraphVisualSettingsSnapshot();
    assert.equal(saved.profiles["2d"].edge.signal.headLength, 2);
    assert.equal(saved.profiles["3d"].node.size.variation, 0.4);
    assert.equal(saved.profiles["3d"].orb.signals.count, 3);
    assert.equal(saved.profiles["3d"].orb.signals.sizeVariation, 0);
    assert.equal(saved.profiles["3d"].orb.signals.launchSpread, 0.75);
    assert.equal(saved.profiles["3d"].orb.signals.batchInterval, 2.5);
    assert.equal(saved.profiles["2d"].orb, undefined);
    setGraphSharedNeuronStyle(false);
    setGraphVisualProfileSetting("2d", "edge.focus.amplitude", 0);
    saved = getGraphVisualSettingsSnapshot();
    assert.equal(saved.profiles["3d"].edge.focus.amplitude, 0.55);
    assert.equal(saved.profiles["2d"].edge.focus.amplitude, 0);
    assert.deepEqual(normalizeGraphVisualSettings(JSON.parse(JSON.stringify(saved))), saved);
  } finally { resetGraphVisualSettings(); }
});

test("focus controls keep the dimmest highlight above normal", () => {
  const focus = { boost: 0.2, amplitude: 0.4, period: 4 };
  assert.equal(getFocusedFilamentGain(0, false, focus), 1.2);
  assert.equal(getFocusedFilamentGain(2, false, focus), 1.6);
  assert.equal(getFocusedFilamentGain(2, true, focus), 1.2);
  assert.equal(getFocusedFilamentGain(2, false, { ...focus, amplitude: 0 }), 1.2);
});

test("node variation can be disabled or scaled without rerolling node identity", () => {
  const model = { nodes: Array.from({ length: 30 }, (_, i) => ({ id: `note:${i}`, group: `group:${i % 3}` })) };
  const flat = createGraphCellVariations(model, "#ff5a00", { size: 0, hue: 0 });
  for (let index = 0; index < 30; index += 1) assert.deepEqual(flat.slice(index * 4, index * 4 + 4), flat.slice(0, 4));
  assert.equal(flat[3], 1);
  const normal = createGraphCellVariations(model, "#ff5a00");
  const double = createGraphCellVariations(model, "#ff5a00", { size: 0.5, hue: 1 });
  for (let index = 0; index < 30; index += 1) {
    assert.ok(Math.abs(double[index * 4 + 3] - (1 + 2 * (normal[index * 4 + 3] - 1))) < 0.000001);
  }
});
