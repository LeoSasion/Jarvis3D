import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_GRAPH_VISUAL_SETTINGS,
  GRAPH_VISUAL_SETTINGS_STORAGE_KEY,
  LEGACY_GRAPH_VISUAL_SETTINGS_STORAGE_KEY,
  getGraphVisualPresetId,
  getGraphVisualSettingsSnapshot,
  graphVisualPresets,
  initializeGraphVisualSettings,
  normalizeGraphVisualSettings,
  resetGraphVisualSettings,
  replaceGraphVisualSettings,
  resolveGraphVisualColors,
  setGraphVisualPreset,
  setGraphVisualProfileSetting,
  setGraphVisualSetting,
  subscribeGraphVisualSettings,
  undoGraphVisualSettings,
  updateGraphVisualSettingsSection,
} from "../src/graphics/graph/graph-visual-settings.js";

test("graph visual settings fail closed to a versioned Nebula default", () => {
  assert.equal(getGraphVisualPresetId(DEFAULT_GRAPH_VISUAL_SETTINGS), "nebula");
  assert.equal(DEFAULT_GRAPH_VISUAL_SETTINGS.version, 7);
  assert.equal(DEFAULT_GRAPH_VISUAL_SETTINGS.profiles["3d"].edge.halo.enabled, true);
  assert.equal(Object.isFrozen(DEFAULT_GRAPH_VISUAL_SETTINGS.profiles), true);
  assert.equal(Object.isFrozen(DEFAULT_GRAPH_VISUAL_SETTINGS.profiles["2d"]), true);
  assert.equal(Object.isFrozen(DEFAULT_GRAPH_VISUAL_SETTINGS.profiles["3d"].edge.halo), true);
  assert.deepEqual(normalizeGraphVisualSettings(null), DEFAULT_GRAPH_VISUAL_SETTINGS);
  assert.deepEqual(normalizeGraphVisualSettings({ node: { scale: 2 } }), DEFAULT_GRAPH_VISUAL_SETTINGS);
  assert.deepEqual(normalizeGraphVisualSettings({
    version: 9,
    node: { scale: 2 },
  }), DEFAULT_GRAPH_VISUAL_SETTINGS);

  const normalized = normalizeGraphVisualSettings({
    version: 2,
    node: {
      scale: 1.5,
      useThemeColors: false,
      baseColor: "#aabbcc",
      hubColor: "rgb(255, 0, 0)",
      activeColor: "#ff6600",
    },
  });
  assert.equal(normalized.node.scale, 1.5);
  assert.equal(normalized.node.baseColor, "#AABBCC");
  assert.equal(normalized.node.hubColor, DEFAULT_GRAPH_VISUAL_SETTINGS.node.hubColor);
  assert.equal(normalized.node.activeColor, "#FF6600");
  assert.deepEqual(normalized.view, { enabled: true, dimension: 3 });
  assert.deepEqual(normalized.edge, DEFAULT_GRAPH_VISUAL_SETTINGS.edge);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.node), true);
  assert.equal(Object.isFrozen(normalized.layout), true);
});

test("numeric visual intent is clamped to safe renderer bounds", () => {
  const normalized = normalizeGraphVisualSettings({
    version: 2,
    node: {
      scale: -10,
      opacity: 3,
      hubScale: 99,
      useThemeColors: false,
      baseColor: "#123456",
      hubColor: "#abcdef",
      activeColor: "#ff6600",
      groupColor: "#00ff11",
    },
    edge: { opacity: 0, color: "#112233" },
    labels: { count: 99, fontSize: 7, opacity: 0 },
    layout: {
      repulsion: 9,
      linkDistance: 0,
      linkStrength: 2,
      collision: -1,
      center: 1,
    },
    scene: { stars: 999, bloom: "on", bloomIntensity: 2 },
    performance: { quality: "high" },
  });

  assert.deepEqual(normalized.node, {
    maxCount: 4096,
    scale: 0.75,
    opacity: 1,
    hubScale: 2.4,
    useThemeColors: false,
    baseColor: "#123456",
    hubColor: "#ABCDEF",
    activeColor: "#FF6600",
    groupColor: "#00FF11",
  });
  assert.deepEqual(normalized.edge, { opacity: 0.05, color: "#112233" });
  assert.deepEqual(normalized.labels, { count: 64, fontSize: 8, opacity: 0.45 });
  assert.deepEqual(normalized.layout, {
    depth: 1, branchSpread: 0.48, weave: 0.8, crossLinks: 0.3, depthContrast: 0.7,
    mode: "force",
    repulsion: 2,
    linkDistance: 0.6,
    linkStrength: 1.5,
    collision: 0.5,
    center: 0.12,
  });
  assert.deepEqual(normalized.scene, {
    stars: 480,
    bloom: "on",
    bloomIntensity: 0.85,
  });
  assert.deepEqual(normalized.performance, { quality: "high" });
  assert.deepEqual(normalized.view, { enabled: true, dimension: 3 });
});

test("v3 visual intent migrates to v6 without changing user brightness", () => {
  const migrated = normalizeGraphVisualSettings({
    ...DEFAULT_GRAPH_VISUAL_SETTINGS,
    version: 3,
    view: { dimension: 3 },
    node: {
      ...DEFAULT_GRAPH_VISUAL_SETTINGS.node,
      maxCount: undefined,
      opacity: 0.63,
    },
    labels: { ...DEFAULT_GRAPH_VISUAL_SETTINGS.labels, opacity: 0.57 },
  });

  assert.equal(migrated.version, 7);
  assert.deepEqual(migrated.view, { enabled: true, dimension: 3 });
  assert.equal(migrated.node.maxCount, 4096);
  assert.equal(migrated.node.opacity, 0.63);
  assert.equal(migrated.labels.opacity, 0.57);
  assert.equal(migrated.profiles["3d"].edge.halo.enabled, true);
});

test("v5 Orb controls migrate to canonical 3D FX paths and restore Relation Halo", () => {
  const migrated = normalizeGraphVisualSettings({
    ...DEFAULT_GRAPH_VISUAL_SETTINGS,
    version: 5,
    orb: {
      bloomIntensity: 2.4,
      bloomThreshold: 0.24,
      bloomSmoothing: 0.36,
      bloomRadius: 0.84,
      lineOpacity: 0.68,
      lineWidth: 1.42,
      lineHalo: false,
      lineHaloRadius: 1.28,
      lineHaloOpacity: 0.38,
      lineHaloFalloff: 2.1,
      nodeSize: 1.22,
      nodeHalo: 0.5,
      nodePulse: 1.34,
    },
  });

  const profile = migrated.profiles["3d"];
  assert.equal(migrated.version, 7);
  assert.deepEqual(profile.postFx.bloom, {
    enabled: true,
    intensity: 2.4,
    threshold: 0.24,
    softKnee: 0.36,
    radius: 0.84,
  });
  assert.equal(profile.edge.core.opacity, 0.68);
  assert.equal(profile.edge.core.widthScale, 1.42);
  assert.deepEqual(profile.edge.halo, {
    enabled: true,
    radiusScale: 1.28,
    opacity: 0.38,
    emissionIntensity: 1,
    falloff: 2.1,
    byStrength: 1,
  });
  assert.equal(profile.node.core.sizeScale, 1.22);
  assert.equal(profile.node.halo.opacity, 0.07);
  assert.equal(profile.node.pulse.amount, 1.34);
});

test("all bounded presets round-trip and a single edit becomes Custom", () => {
  resetGraphVisualSettings();
  assert.deepEqual(
    graphVisualPresets.map(({ id, label }) => [id, label]),
    [
      ["neuron3d", "NEURON · 3D"],
      ["neuron", "NEURON"],
      ["neural", "NEURAL ORB"],
      ["obsidian", "OBSIDIAN"],
      ["nebula", "NEBULA"],
      ["blueprint", "BLUEPRINT"],
      ["minimal", "MINIMAL"],
      ["performance", "PERFORMANCE"],
    ],
  );

  for (const { id, dimensions } of graphVisualPresets) {
    if (dimensions) setGraphVisualSetting("view", "dimension", dimensions[0]);
    setGraphVisualPreset(id);
    assert.equal(getGraphVisualPresetId(getGraphVisualSettingsSnapshot()), id);
    assert.equal(getGraphVisualSettingsSnapshot().node.opacity, 1);
    assert.equal(getGraphVisualSettingsSnapshot().labels.opacity, 1);
    if (["obsidian", "nebula", "blueprint"].includes(id)) {
      assert.equal(getGraphVisualSettingsSnapshot().node.maxCount, 4096);
    }
  }

  setGraphVisualPreset("minimal");
  assert.equal(getGraphVisualSettingsSnapshot().node.maxCount, 512);
  setGraphVisualPreset("performance");
  assert.equal(getGraphVisualSettingsSnapshot().node.maxCount, 256);

  setGraphVisualPreset("nebula");
  setGraphVisualSetting("node", "scale", 1.3);
  assert.equal(getGraphVisualPresetId(getGraphVisualSettingsSnapshot()), "custom");
  const custom = getGraphVisualSettingsSnapshot();
  setGraphVisualPreset("unknown");
  assert.equal(getGraphVisualSettingsSnapshot(), custom);
  resetGraphVisualSettings();
});

test("2D and 3D view intent persists through the versioned settings store", () => {
  resetGraphVisualSettings();
  setGraphVisualSetting("view", "dimension", 2);
  assert.equal(getGraphVisualSettingsSnapshot().view.dimension, 2);
  setGraphVisualSetting("view", "dimension", 9);
  assert.equal(getGraphVisualSettingsSnapshot().view.dimension, 3);
  setGraphVisualSetting("view", "enabled", false);
  assert.equal(getGraphVisualSettingsSnapshot().view.enabled, false);
  resetGraphVisualSettings();
});

test("editing a 3D FX layer does not mutate the independent 2D profile", () => {
  resetGraphVisualSettings();
  const twoDimensionalBefore = structuredClone(
    getGraphVisualSettingsSnapshot().profiles["2d"],
  );

  setGraphVisualProfileSetting("3d", "edge.halo.opacity", 0.31);
  setGraphVisualProfileSetting("3d", "edge.halo.enabled", false);

  const updated = getGraphVisualSettingsSnapshot();
  assert.deepEqual(updated.profiles["2d"], twoDimensionalBefore);
  assert.equal(updated.profiles["3d"].edge.halo.opacity, 0.31);
  assert.equal(updated.profiles["3d"].edge.halo.enabled, false);
  assert.equal(getGraphVisualPresetId(updated), "custom");
  resetGraphVisualSettings();
});

test("node budgets are clamped to a safe renderer range", () => {
  const low = normalizeGraphVisualSettings({
    ...DEFAULT_GRAPH_VISUAL_SETTINGS,
    node: { ...DEFAULT_GRAPH_VISUAL_SETTINGS.node, maxCount: 1 },
  });
  const high = normalizeGraphVisualSettings({
    ...DEFAULT_GRAPH_VISUAL_SETTINGS,
    node: { ...DEFAULT_GRAPH_VISUAL_SETTINGS.node, maxCount: 50_000 },
  });
  assert.equal(low.node.maxCount, 32);
  assert.equal(high.node.maxCount, 4096);
});

test("theme palettes stay semantic until a user edits a color", () => {
  resetGraphVisualSettings();
  const themed = resolveGraphVisualColors(getGraphVisualSettingsSnapshot(), {
    node: "#FFFFFF",
    hub: "#C8B9AA",
    active: "#FF5500",
    group: "#999999",
    edge: "#666666",
  });
  assert.deepEqual(themed, {
    baseColor: "#FFFFFF",
    hubColor: "#C8B9AA",
    activeColor: "#FF5500",
    groupColor: "#999999",
    edgeColor: "#666666",
  });

  setGraphVisualSetting("node", "hubColor", "#123456");
  assert.equal(getGraphVisualSettingsSnapshot().node.useThemeColors, false);
  const custom = resolveGraphVisualColors(getGraphVisualSettingsSnapshot(), {
    node: "#FFFFFF",
    hub: "#C8B9AA",
    active: "#FF5500",
    group: "#999999",
    edge: "#666666",
  });
  assert.equal(custom.hubColor, "#123456");
  resetGraphVisualSettings();
});

test("section and setting updates notify only for effective changes", () => {
  resetGraphVisualSettings();
  let notifications = 0;
  const unsubscribe = subscribeGraphVisualSettings(() => {
    notifications += 1;
  });

  updateGraphVisualSettingsSection("labels", { count: 36, opacity: 0.95 });
  assert.equal(getGraphVisualSettingsSnapshot().labels.count, 36);
  assert.equal(getGraphVisualSettingsSnapshot().labels.opacity, 0.95);
  assert.equal(notifications, 1);

  updateGraphVisualSettingsSection("labels", { count: 36, opacity: 0.95 });
  setGraphVisualSetting("unknown", "value", 1);
  setGraphVisualSetting("labels", "unknown", 1);
  assert.equal(notifications, 1);

  unsubscribe();
  resetGraphVisualSettings();
});

test("named profile replacement can be undone as one visual change", () => {
  const baseline = normalizeGraphVisualSettings({
    ...DEFAULT_GRAPH_VISUAL_SETTINGS,
    node: { ...DEFAULT_GRAPH_VISUAL_SETTINGS.node, scale: 1.1 },
  });
  const profile = normalizeGraphVisualSettings({
    ...DEFAULT_GRAPH_VISUAL_SETTINGS,
    view: { dimension: 3 },
    node: { ...DEFAULT_GRAPH_VISUAL_SETTINGS.node, scale: 1.8 },
  });
  replaceGraphVisualSettings(baseline, { historyKey: "test:baseline" });
  replaceGraphVisualSettings(profile, { historyKey: "test:profile" });

  assert.equal(getGraphVisualSettingsSnapshot().view.dimension, 3);
  assert.equal(undoGraphVisualSettings(), true);
  assert.deepEqual(getGraphVisualSettingsSnapshot(), baseline);
  resetGraphVisualSettings();
});

test("storage updates synchronize without write-back and refresh document metadata", () => {
  setGraphVisualPreset("blueprint");
  const storedBlueprint = JSON.stringify(getGraphVisualSettingsSnapshot());
  resetGraphVisualSettings();

  const writes = [];
  let storageListener = null;
  const legacyNebula = JSON.stringify({
    ...DEFAULT_GRAPH_VISUAL_SETTINGS,
    version: 1,
    view: undefined,
    node: {
      ...DEFAULT_GRAPH_VISUAL_SETTINGS.node,
      maxCount: undefined,
      opacity: 0.98,
      hubColor: "#FF6B2B",
    },
    labels: { ...DEFAULT_GRAPH_VISUAL_SETTINGS.labels, opacity: 0.88 },
  }, (key, value) => (["useThemeColors", "activeColor", "enabled"].includes(key) ? undefined : value));
  global.window = {
    localStorage: {
      getItem: (key) => (key === LEGACY_GRAPH_VISUAL_SETTINGS_STORAGE_KEY ? legacyNebula : null),
      setItem: (key, value) => writes.push([key, value]),
    },
    addEventListener: (type, listener) => {
      if (type === "storage") storageListener = listener;
    },
  };
  global.document = {
    documentElement: { dataset: {} },
  };

  initializeGraphVisualSettings();
  assert.equal(typeof storageListener, "function");
  assert.equal(writes[0][0], GRAPH_VISUAL_SETTINGS_STORAGE_KEY);
  assert.equal(getGraphVisualPresetId(getGraphVisualSettingsSnapshot()), "custom");
  assert.equal(getGraphVisualSettingsSnapshot().node.opacity, 0.98);
  assert.equal(getGraphVisualSettingsSnapshot().labels.opacity, 0.88);
  storageListener({
    key: GRAPH_VISUAL_SETTINGS_STORAGE_KEY,
    newValue: storedBlueprint,
  });

  assert.equal(getGraphVisualPresetId(getGraphVisualSettingsSnapshot()), "blueprint");
  assert.equal(global.document.documentElement.dataset.graphVisualPreset, "blueprint");
  assert.equal(global.document.documentElement.dataset.graphVisualQuality, "auto");
  assert.equal(writes.length, 1);

  setGraphVisualSetting("node", "scale", 1.9);
  initializeGraphVisualSettings();
  assert.equal(getGraphVisualSettingsSnapshot().node.scale, 1.9);

  resetGraphVisualSettings();
  assert.equal(writes.at(-1)[0], GRAPH_VISUAL_SETTINGS_STORAGE_KEY);
  delete global.window;
  delete global.document;
});

test("the first in-memory edit initializes storage before it mutates settings", async () => {
  const stored = JSON.stringify({
    ...DEFAULT_GRAPH_VISUAL_SETTINGS,
    view: { enabled: true, dimension: 2 },
  });
  const writes = [];
  global.window = {
    localStorage: {
      getItem: (key) => (key === GRAPH_VISUAL_SETTINGS_STORAGE_KEY ? stored : null),
      setItem: (key, value) => writes.push([key, value]),
    },
    addEventListener: () => {},
  };
  global.document = { documentElement: { dataset: {} } };

  const settingsModule = await import(
    `../src/graphics/graph/graph-visual-settings.js?first-edit=${Date.now()}`
  );
  settingsModule.setGraphVisualSetting("view", "dimension", 3);
  settingsModule.initializeGraphVisualSettings();

  assert.equal(settingsModule.getGraphVisualSettingsSnapshot().view.dimension, 3);
  settingsModule.flushGraphVisualSettingsPersistence();
  assert.equal(JSON.parse(writes.at(-1)[1]).view.dimension, 3);

  delete global.window;
  delete global.document;
});
