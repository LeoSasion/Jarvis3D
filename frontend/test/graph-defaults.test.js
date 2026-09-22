import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_GRAPH_VISUAL_SETTINGS,
  GRAPH_VISUAL_SETTINGS_STORAGE_KEY,
  normalizeGraphVisualSettings,
} from "../src/graphics/graph/graph-visual-settings.js";

let instance = 0;
async function loadBrowserSettings(stored = new Map()) {
  const writes = [];
  global.window = {
    localStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => { stored.set(key, value); writes.push(key); },
    },
    addEventListener: () => {},
  };
  try {
    const module = await import(`../src/graphics/graph/graph-visual-settings.js?defaults=${++instance}`);
    module.initializeGraphVisualSettings();
    return { module, settings: module.getGraphVisualSettingsSnapshot(), writes };
  } finally {
    delete global.window;
  }
}

test("a browser with no stored graph settings starts with the complete approved neuron style", async () => {
  const { settings, writes } = await loadBrowserSettings();
  assert.deepEqual(settings, DEFAULT_GRAPH_VISUAL_SETTINGS);
  assert.equal(settings.view.dimension, 3);
  assert.equal(settings.sharedStyle, true);
  assert.equal(settings.idleShape, "neuronSphere");
  for (const id of ["2d", "3d"]) {
    assert.equal(settings.dimensions[id].layout.mode, "neuron");
    assert.equal(settings.profiles[id].edge.signal.enabled, true);
    for (const key of ["node", "edge", "signal", "motion", "postFx"]) {
      assert.deepEqual(settings.profiles[id][key], settings.profiles["3d"][key]);
    }
  }
  const orb = settings.profiles["3d"].orb;
  assert.equal(orb.network.density, 1.2);
  assert.equal(orb.network.shellRatio, 0.92);
  assert.equal(orb.network.depthContrast, 0);
  assert.equal(orb.signals.enabled, true);
  assert.equal(orb.signals.count, 48);
  assert.equal(orb.signals.sizeVariation, 0.3);
  assert.equal(orb.signals.batchInterval, 3);
  assert.equal(orb.signals.launchSpread, 0.5);
  for (const key of ["innerNetwork", "rim", "sparks"]) assert.equal(orb[key].enabled, false);
  assert.deepEqual(settings.profiles["3d"].postFx, {
    radiance: { temperature: 0.35, focus: 0.35, transmissionLink: 1 },
    bloom: { enabled: true, intensity: 1.95, threshold: 0.06, softKnee: 0.35, radius: 0.38, falloff: 2.45, colorPreservation: 0.93 },
  });
  assert.deepEqual(normalizeGraphVisualSettings(JSON.parse(JSON.stringify(settings))), settings);
  assert.deepEqual(writes, []);
});

test("new defaults preserve saved independent legacy and manual profiles", async () => {
  const custom = structuredClone(DEFAULT_GRAPH_VISUAL_SETTINGS);
  custom.sharedStyle = false;
  custom.idleShape = "orb";
  custom.node.scale = 1.8;
  custom.layout.mode = "force";
  custom.profiles["3d"].edge.signal.enabled = false;
  custom.profiles["3d"].orb.signals.count = 0;
  custom.profiles["2d"].node.master.scale = 0.8;
  for (const version of [6, 7]) {
    const value = { ...custom, version };
    const stored = new Map([[`jarvis.graph-visual-settings.v${version}`, JSON.stringify(value)]]);
    const { settings, writes } = await loadBrowserSettings(stored);
    assert.deepEqual(settings, normalizeGraphVisualSettings(value));
    assert.equal(settings.sharedStyle, false);
    assert.equal(settings.idleShape, "orb");
    assert.equal(settings.node.scale, 1.8);
    assert.equal(settings.profiles["3d"].edge.signal.enabled, false);
    assert.equal(settings.profiles["2d"].node.master.scale, 0.8);
    assert.equal(writes.length, version === 6 ? 1 : 0);
  }
});

test("full reset applies all current defaults and remains one undoable change", async () => {
  const custom = normalizeGraphVisualSettings({ ...DEFAULT_GRAPH_VISUAL_SETTINGS,
    sharedStyle: false, idleShape: "orb", node: { ...DEFAULT_GRAPH_VISUAL_SETTINGS.node, scale: 1.8 },
  });
  const { module } = await loadBrowserSettings(new Map([[GRAPH_VISUAL_SETTINGS_STORAGE_KEY, JSON.stringify(custom)]]));
  module.resetGraphVisualSettings();
  assert.deepEqual(module.getGraphVisualSettingsSnapshot(), DEFAULT_GRAPH_VISUAL_SETTINGS);
  assert.equal(module.undoGraphVisualSettings(), true);
  assert.deepEqual(module.getGraphVisualSettingsSnapshot(), custom);
});
