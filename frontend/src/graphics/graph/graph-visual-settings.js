import {
  DEFAULT_GRAPH_FX_PROFILES,
  normalizeGraphFxProfiles,
  withGraphFxProfileSetting,
} from "./graph-fx-profile.js";
import { NEURON_SPATIAL_DEFAULTS } from "./graph-neuron-spatial-model.js";

const STORAGE_KEY = "jarvis.graph-visual-settings.v7";
const VERSION_6_STORAGE_KEY = "jarvis.graph-visual-settings.v6";
const PREVIOUS_STORAGE_KEY = "jarvis.graph-visual-settings.v5";
const SECOND_PREVIOUS_STORAGE_KEY = "jarvis.graph-visual-settings.v4";
const THIRD_PREVIOUS_STORAGE_KEY = "jarvis.graph-visual-settings.v3";
const FOURTH_PREVIOUS_STORAGE_KEY = "jarvis.graph-visual-settings.v2";
const LEGACY_STORAGE_KEY = "jarvis.graph-visual-settings.v1";
const SCHEMA_VERSION = 7;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const BLOOM_VALUES = new Set(["auto", "off", "on"]);
const QUALITY_VALUES = new Set(["auto", "low", "balanced", "high"]);
const DIMENSION_VALUES = new Set([2, 3]);
const MAX_HISTORY_ENTRIES = 20;
const HISTORY_COALESCE_MS = 600;
const PERSIST_DELAY_MS = 180;
const listeners = new Set();
const history = [];
let initialized = false;
let historyKey = null;
let historyTimer = null;
let persistTimer = null;
let persistenceError = null;

const sectionFields = Object.freeze({
  view: Object.freeze(["enabled", "dimension"]),
  node: Object.freeze([
    "maxCount",
    "scale",
    "opacity",
    "hubScale",
    "useThemeColors",
    "baseColor",
    "hubColor",
    "activeColor",
    "groupColor",
  ]),
  edge: Object.freeze(["opacity", "color"]),
  labels: Object.freeze(["count", "fontSize", "opacity"]),
  layout: Object.freeze([
    "mode",
    "depth",
    "branchSpread",
    "weave",
    "crossLinks",
    "depthContrast",
    "repulsion",
    "linkDistance",
    "linkStrength",
    "collision",
    "center",
  ]),
  scene: Object.freeze(["stars", "bloom", "bloomIntensity"]),
  performance: Object.freeze(["quality"]),
});

export const graphVisualSettingRanges = Object.freeze({
  node: Object.freeze({
    maxCount: Object.freeze({ min: 32, max: 4096, step: 32 }),
    scale: Object.freeze({ min: 0.75, max: 2.5, step: 0.05 }),
    opacity: Object.freeze({ min: 0.5, max: 1, step: 0.01 }),
    hubScale: Object.freeze({ min: 1, max: 2.4, step: 0.05 }),
  }),
  edge: Object.freeze({
    opacity: Object.freeze({ min: 0.05, max: 0.55, step: 0.01 }),
  }),
  labels: Object.freeze({
    count: Object.freeze({ min: 0, max: 64, step: 1 }),
    fontSize: Object.freeze({ min: 8, max: 14, step: 1 }),
    opacity: Object.freeze({ min: 0.45, max: 1, step: 0.01 }),
  }),
  layout: Object.freeze({
    depth: Object.freeze({ min: 0.2, max: 2, step: 0.05 }),
    branchSpread: Object.freeze({ min: 0.15, max: 1, step: 0.01 }),
    weave: Object.freeze({ min: 0, max: 1.5, step: 0.05 }),
    crossLinks: Object.freeze({ min: 0, max: 1, step: 0.05 }),
    depthContrast: Object.freeze({ min: 0, max: 1, step: 0.05 }),
    repulsion: Object.freeze({ min: 0.5, max: 2, step: 0.05 }),
    linkDistance: Object.freeze({ min: 0.6, max: 2, step: 0.05 }),
    linkStrength: Object.freeze({ min: 0.5, max: 1.5, step: 0.05 }),
    collision: Object.freeze({ min: 0.5, max: 1.5, step: 0.05 }),
    center: Object.freeze({ min: 0, max: 0.12, step: 0.005 }),
  }),
  scene: Object.freeze({
    stars: Object.freeze({ min: 0, max: 480, step: 20 }),
    bloomIntensity: Object.freeze({ min: 0.25, max: 0.85, step: 0.05 }),
  }),
});

const DIMENSION_SECTIONS = ["node", "edge", "labels", "layout", "scene", "performance"];

function dimensionSettings(value) {
  return Object.freeze(Object.fromEntries(DIMENSION_SECTIONS.map(
    (section) => [section, Object.freeze({ ...value[section] })],
  )));
}

function freezeSettings(value) {
  return Object.freeze({
    version: SCHEMA_VERSION,
    sharedStyle: value.sharedStyle === true,
    idleShape: value.idleShape === "neuronSphere" ? "neuronSphere" : "orb",
    ...(value.dimensions ? { dimensions: Object.freeze({
      "2d": dimensionSettings(value.dimensions["2d"]),
      "3d": dimensionSettings(value.dimensions["3d"]),
    }) } : {}),
    view: Object.freeze({ ...value.view }),
    node: Object.freeze({ ...value.node }),
    edge: Object.freeze({ ...value.edge }),
    labels: Object.freeze({ ...value.labels }),
    layout: Object.freeze({ ...NEURON_SPATIAL_DEFAULTS, ...value.layout }),
    profiles: normalizeGraphFxProfiles(value.profiles),
    scene: Object.freeze({ ...value.scene }),
    performance: Object.freeze({ ...value.performance }),
  });
}

const basePresetConfigurations = Object.freeze({
  obsidian: freezeSettings({
    view: { enabled: true, dimension: 2 },
    node: {
      maxCount: 4096,
      scale: 1.2,
      opacity: 1,
      hubScale: 1.55,
      useThemeColors: true,
      baseColor: "#D8DDE3",
      hubColor: "#D8B99D",
      activeColor: "#FF7A38",
      groupColor: "#D8B99D",
    },
    edge: { opacity: 0.16, color: "#747980" },
    labels: { count: 22, fontSize: 10, opacity: 1 },
    layout: {
      mode: "force",
      repulsion: 1.05,
      linkDistance: 1,
      linkStrength: 1,
      collision: 1,
      center: 0.04,
    },
    scene: { stars: 80, bloom: "off", bloomIntensity: 0.4 },
    performance: { quality: "auto" },
  }),
  nebula: freezeSettings({
    view: { enabled: true, dimension: 3 },
    node: {
      maxCount: 4096,
      scale: 1.25,
      opacity: 1,
      hubScale: 1.65,
      useThemeColors: true,
      baseColor: "#F5F1E9",
      hubColor: "#D8B99D",
      activeColor: "#FF6B2B",
      groupColor: "#F0C6AD",
    },
    edge: { opacity: 0.32, color: "#77736C" },
    labels: { count: 24, fontSize: 10, opacity: 1 },
    layout: {
      mode: "force",
      repulsion: 1,
      linkDistance: 1,
      linkStrength: 1,
      collision: 1,
      center: 0.04,
    },
    scene: { stars: 100, bloom: "on", bloomIntensity: 0.78 },
    performance: { quality: "auto" },
  }),
  blueprint: freezeSettings({
    view: { enabled: true, dimension: 2 },
    node: {
      maxCount: 4096,
      scale: 1.15,
      opacity: 1,
      hubScale: 1.5,
      useThemeColors: true,
      baseColor: "#F2EFE8",
      hubColor: "#C9B7A8",
      activeColor: "#FF8247",
      groupColor: "#AAA59C",
    },
    edge: { opacity: 0.24, color: "#65625C" },
    labels: { count: 30, fontSize: 10, opacity: 1 },
    layout: {
      mode: "force",
      repulsion: 1.1,
      linkDistance: 0.95,
      linkStrength: 1.1,
      collision: 1,
      center: 0.045,
    },
    scene: { stars: 160, bloom: "auto", bloomIntensity: 0.52 },
    performance: { quality: "auto" },
  }),
  minimal: freezeSettings({
    view: { enabled: true, dimension: 2 },
    node: {
      maxCount: 512,
      scale: 1,
      opacity: 1,
      hubScale: 1.3,
      useThemeColors: true,
      baseColor: "#D8D5CF",
      hubColor: "#AAA59C",
      activeColor: "#FF7433",
      groupColor: "#AAA59C",
    },
    edge: { opacity: 0.09, color: "#595751" },
    labels: { count: 12, fontSize: 9, opacity: 1 },
    layout: {
      mode: "force",
      repulsion: 0.9,
      linkDistance: 1.1,
      linkStrength: 1,
      collision: 1,
      center: 0.055,
    },
    scene: { stars: 0, bloom: "off", bloomIntensity: 0.25 },
    performance: { quality: "auto" },
  }),
  performance: freezeSettings({
    view: { enabled: true, dimension: 2 },
    node: {
      maxCount: 256,
      scale: 1,
      opacity: 1,
      hubScale: 1.25,
      useThemeColors: true,
      baseColor: "#D4D1CB",
      hubColor: "#918A80",
      activeColor: "#FF7433",
      groupColor: "#AAA59C",
    },
    edge: { opacity: 0.07, color: "#55534E" },
    labels: { count: 8, fontSize: 9, opacity: 1 },
    layout: {
      mode: "force",
      repulsion: 0.8,
      linkDistance: 1.1,
      linkStrength: 0.85,
      collision: 0.8,
      center: 0.04,
    },
    scene: { stars: 0, bloom: "off", bloomIntensity: 0.25 },
    performance: { quality: "low" },
  }),
});

// Parameters calibrated to docs/design/references/jarvis-neural-orb-reference.jpg.
// The new preset is opt-in; existing 2D/3D preferences are never migrated to it.
const calibratedPresetConfigurations = Object.freeze({
  ...basePresetConfigurations,
  neuron: freezeSettings({
    ...basePresetConfigurations.obsidian,
    node: { ...basePresetConfigurations.obsidian.node, scale: 1, hubScale: 1.8 },
    edge: { opacity: 0.55, color: basePresetConfigurations.nebula.node.activeColor },
    labels: { count: 5, fontSize: 14, opacity: 1 },
    layout: { ...basePresetConfigurations.obsidian.layout, mode: "neuron", repulsion: 1.1, linkDistance: 1.35 },
    scene: { stars: 0, bloom: "on", bloomIntensity: 0.45 },
    profiles: {
      ...DEFAULT_GRAPH_FX_PROFILES,
      "2d": {
        ...DEFAULT_GRAPH_FX_PROFILES["2d"],
        node: {
          master: { scale: 1, opacity: 1 },
          size: { byImportance: 1 },
          core: { enabled: true, sizeScale: 1, opacity: 1, emissionIntensity: 2.7 },
          halo: { enabled: true, radiusScale: 1.5, opacity: 0.22, emissionIntensity: 1.5 },
          pulse: { enabled: false, amount: 0.1, rate: 0.5 },
        },
        edge: {
          ...DEFAULT_GRAPH_FX_PROFILES["2d"].edge,
          filament: { taper: 0.85, rootWidth: 5.2, roundness: 0.8, translucency: 0.7 },
          core: { ...DEFAULT_GRAPH_FX_PROFILES["2d"].edge.core, widthScale: 0.65, opacity: 0.85, emissionIntensity: 1.6 },
        },
        signal: { ...DEFAULT_GRAPH_FX_PROFILES["2d"].signal, enabled: false, count: 4, speed: 0.3 },
        motion: { idleRotationSpeed: 0, breathingAmount: 0, breathingRate: 0.5 },
        postFx: { bloom: { enabled: true, intensity: 0.7, threshold: 0.7, softKnee: 0.15, radius: 0.25 } },
      },
    },
  }),
  neural: freezeSettings({
    ...basePresetConfigurations.nebula,
    node: {
      ...basePresetConfigurations.nebula.node,
      scale: 1, hubScale: 1.3, useThemeColors: true,
      baseColor: "#FFA43A", hubColor: "#FFF0C7", activeColor: "#FF650A", groupColor: "#D8540C",
    },
    edge: { opacity: 0.55, color: "#FF650A" },
    scene: { ...basePresetConfigurations.nebula.scene, stars: 0 },
    profiles: {
      ...DEFAULT_GRAPH_FX_PROFILES,
      "3d": {
        node: {
          master: { scale: 1.28, opacity: 1 },
          size: { byImportance: 0.45 },
          core: { enabled: true, sizeScale: 1.5, opacity: 1, emissionIntensity: 3 },
          halo: { enabled: true, radiusScale: 1.9, opacity: 0.14, emissionIntensity: 2.2 },
          pulse: { enabled: false, amount: 0.15, rate: 0.5 },
        },
        edge: {
          master: { opacity: 1 },
          core: { enabled: true, widthScale: 1.25, opacity: 1, emissionIntensity: 3, widthByStrength: 0.25, emissionByStrength: 0.35 },
          halo: { enabled: true, radiusScale: 1.3, opacity: 0.28, emissionIntensity: 2.8, falloff: 2.2, byStrength: 0.5 },
        },
        signal: { enabled: true, count: 6, speed: 0.5, sizeScale: 0.7, opacity: 0.9, emissionIntensity: 1.8 },
        orb: {
          network: { density: 2.4, shellRatio: 0.28, depthContrast: 0.78 },
          innerNetwork: { enabled: true, scale: 0.73, opacity: 0.14, rotationSpeed: 0.3 },
          rim: { enabled: false, intensity: 0.2, fresnelPower: 7 },
          sparks: { enabled: true, sizeScale: 1.8, opacity: 0.3, emissionIntensity: 2.8 },
        },
        motion: { idleRotationSpeed: 0.3, breathingAmount: 0.15, breathingRate: 0.5 },
        postFx: { bloom: { enabled: true, intensity: 1.8, threshold: 0.4, softKnee: 0.22, radius: 0.25 } },
      },
    },
  }),
});

const spatialNeuronBase = calibratedPresetConfigurations.neural;
const presetConfigurations = Object.freeze({
  ...calibratedPresetConfigurations,
  neuron3d: freezeSettings({
    ...spatialNeuronBase,
    node: { ...spatialNeuronBase.node, scale: 1, hubScale: 1.6 },
    labels: { count: 5, fontSize: 12, opacity: 1 },
    layout: {
      ...spatialNeuronBase.layout, mode: "neuron", repulsion: 1.2, linkDistance: 1.5,
      ...NEURON_SPATIAL_DEFAULTS,
    },
    profiles: {
      ...spatialNeuronBase.profiles,
      "3d": {
        ...spatialNeuronBase.profiles["3d"],
        node: {
          ...spatialNeuronBase.profiles["3d"].node,
          size: { byImportance: 1 },
        },
        edge: {
          ...spatialNeuronBase.profiles["3d"].edge,
          filament: { taper: 0.85, rootWidth: 5.2, roundness: 0.8, translucency: 0.7 },
          core: { ...spatialNeuronBase.profiles["3d"].edge.core, widthScale: 0.95, emissionIntensity: 1.8 },
          halo: { ...spatialNeuronBase.profiles["3d"].edge.halo, radiusScale: 1.15, opacity: 0.12, emissionIntensity: 2, falloff: 2.8 },
        },
      },
    },
  }),
});

export const DEFAULT_GRAPH_VISUAL_SETTINGS = freezeSettings({
  ...presetConfigurations.nebula,
  dimensions: {
    "2d": dimensionSettings(presetConfigurations.obsidian),
    "3d": dimensionSettings(presetConfigurations.nebula),
  },
});

export const graphVisualPresets = Object.freeze([
  Object.freeze({ id: "neuron3d", label: "NEURON · 3D", labelKey: "graphVisualSettings.preset.neuron3d.label", detail: "Spatial dendrites and interwoven axons", dimensions: Object.freeze([3]) }),
  Object.freeze({ id: "neuron", label: "NEURON", labelKey: "graphVisualSettings.preset.neuron.label", detail: "Dendritic clusters with luminous cores and sparse axons", dimensions: Object.freeze([2]) }),
  Object.freeze({ id: "neural", label: "NEURAL ORB", detail: "Reference orb · incandescent cores and warm diffusion", dimensions: Object.freeze([3]) }),
  Object.freeze({
    id: "obsidian",
    label: "OBSIDIAN",
    detail: "Clean neutral graph with restrained ambient effects",
  }),
  Object.freeze({
    id: "nebula",
    label: "NEBULA",
    detail: "3D neural energy field with luminous hubs and relations",
  }),
  Object.freeze({
    id: "blueprint",
    label: "BLUEPRINT",
    detail: "High-contrast technical map with denser labels",
  }),
  Object.freeze({
    id: "minimal",
    label: "MINIMAL",
    detail: "Smaller node budget, sparse labels, and no GPU flourish",
  }),
  Object.freeze({
    id: "performance",
    label: "PERFORMANCE",
    detail: "Small node budget and low-cost quality for constrained scenes",
  }),
]);

function boundedNumber(value, fallback, range, { integer = false } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const bounded = Math.min(range.max, Math.max(range.min, value));
  return integer ? Math.round(bounded) : bounded;
}

function hexColor(value, fallback) {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value)
    ? value.toUpperCase()
    : fallback;
}

function hasSupportedSchema(value) {
  return value?.version === SCHEMA_VERSION;
}

const legacyHubColors = Object.freeze({
  obsidian: "#FF7A38",
  nebula: "#FF6B2B",
  blueprint: "#FF8247",
  minimal: "#FF7433",
  performance: "#FF7433",
});
const legacyPresetOpacity = Object.freeze({
  obsidian: Object.freeze({ node: 0.94, labels: 0.88 }),
  nebula: Object.freeze({ node: 0.98, labels: 0.88 }),
  blueprint: Object.freeze({ node: 0.96, labels: 0.9 }),
  minimal: Object.freeze({ node: 0.9, labels: 0.88 }),
  performance: Object.freeze({ node: 0.85, labels: 0.88 }),
});

function findLegacyPresetId(value) {
  if (value?.version !== 1) return null;
  for (const preset of graphVisualPresets) {
    const expected = presetConfigurations[preset.id];
    const nodeFieldsMatch = ["scale", "hubScale", "baseColor", "groupColor"]
      .every((field) => value.node?.[field] === expected.node[field]);
    const labelsMatch = ["count", "fontSize"]
      .every((field) => value.labels?.[field] === expected.labels[field]);
    const otherSectionsMatch = ["edge", "layout", "scene", "performance"]
      .every((section) => Object.entries(expected[section]).every(
        ([field, expectedValue]) => field === "mode" || field in NEURON_SPATIAL_DEFAULTS || value[section]?.[field] === expectedValue,
      ));
    if (nodeFieldsMatch
      && labelsMatch
      && otherSectionsMatch
      && value.node?.opacity === legacyPresetOpacity[preset.id]?.node
      && value.labels?.opacity === legacyPresetOpacity[preset.id]?.labels
      && String(value.node?.hubColor).toUpperCase() === legacyHubColors[preset.id]) {
      return preset.id;
    }
  }
  return null;
}

function migrateLegacySettings(value) {
  if (!value || typeof value !== "object" || value.version !== 1) return null;
  const legacyPresetId = findLegacyPresetId(value);
  if (legacyPresetId) {
    const preset = presetConfigurations[legacyPresetId];
    return normalizeGraphVisualSettings({
      ...preset,
      version: SCHEMA_VERSION,
      node: {
        ...preset.node,
        opacity: value.node.opacity,
      },
      labels: {
        ...preset.labels,
        opacity: value.labels.opacity,
      },
    });
  }
  return normalizeGraphVisualSettings({
    ...value,
    version: SCHEMA_VERSION,
    view: DEFAULT_GRAPH_VISUAL_SETTINGS.view,
    node: {
      ...value.node,
      useThemeColors: false,
      activeColor: value.node?.hubColor ?? DEFAULT_GRAPH_VISUAL_SETTINGS.node.activeColor,
    },
  });
}

function migrateVersion3Settings(value) {
  if (!value || typeof value !== "object" || value.version !== 3) return null;
  return normalizeGraphVisualSettings({
    ...value,
    version: SCHEMA_VERSION,
    view: {
      ...value.view,
      enabled: typeof value.view?.enabled === "boolean" ? value.view.enabled : true,
    },
    node: {
      ...value.node,
      maxCount: value.node?.maxCount ?? DEFAULT_GRAPH_VISUAL_SETTINGS.node.maxCount,
    },
  });
}

function migrateVersion4Settings(value) {
  if (!value || typeof value !== "object" || value.version !== 4) return null;
  return normalizeGraphVisualSettings({
    ...value,
    version: SCHEMA_VERSION,
    profiles: DEFAULT_GRAPH_FX_PROFILES,
  });
}

function migrateVersion5Profiles(value) {
  let profiles = normalizeGraphFxProfiles(value?.profiles);
  const legacyOrb = value?.orb;
  if (!legacyOrb || typeof legacyOrb !== "object") return profiles;
  const mappings = [
    ["postFx.bloom.intensity", legacyOrb.bloomIntensity],
    ["postFx.bloom.threshold", legacyOrb.bloomThreshold],
    ["postFx.bloom.softKnee", legacyOrb.bloomSmoothing],
    ["postFx.bloom.radius", legacyOrb.bloomRadius],
    ["edge.core.opacity", legacyOrb.lineOpacity],
    ["edge.core.widthScale", legacyOrb.lineWidth],
    ["edge.halo.radiusScale", legacyOrb.lineHaloRadius],
    ["edge.halo.opacity", legacyOrb.lineHaloOpacity],
    ["edge.halo.falloff", legacyOrb.lineHaloFalloff],
    ["node.core.sizeScale", legacyOrb.nodeSize],
    ["node.pulse.amount", legacyOrb.nodePulse],
  ];
  mappings.forEach(([path, candidate]) => {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      profiles = withGraphFxProfileSetting(profiles, "3d", path, candidate);
    }
  });
  if (typeof legacyOrb.nodeHalo === "number" && Number.isFinite(legacyOrb.nodeHalo)) {
    profiles = withGraphFxProfileSetting(
      profiles,
      "3d",
      "node.halo.opacity",
      Math.min(1, Math.max(0, legacyOrb.nodeHalo * 0.14)),
    );
  }
  // v5 was an unreleased editor draft whose Relation Halo default was temporarily hidden.
  return withGraphFxProfileSetting(profiles, "3d", "edge.halo.enabled", true);
}

function migrateVersion5Settings(value) {
  if (!value || typeof value !== "object" || value.version !== 5) return null;
  return normalizeGraphVisualSettings({
    ...value,
    version: SCHEMA_VERSION,
    profiles: migrateVersion5Profiles(value),
  });
}

function migrateVersion2Settings(value) {
  if (!value || typeof value !== "object" || value.version !== 2) return null;
  return normalizeGraphVisualSettings({
    ...value,
    version: SCHEMA_VERSION,
    view: {
      enabled: true,
      dimension: DIMENSION_VALUES.has(value.view?.dimension)
        ? value.view.dimension
        : DEFAULT_GRAPH_VISUAL_SETTINGS.view.dimension,
    },
    node: {
      ...value.node,
      maxCount: DEFAULT_GRAPH_VISUAL_SETTINGS.node.maxCount,
    },
  });
}

export function normalizeGraphVisualSettings(value, flat = false) {
  if (value?.version === 6) return normalizeGraphVisualSettings({ ...value, version: SCHEMA_VERSION }, flat);
  if (value?.version === 5) return migrateVersion5Settings(value);
  if (value?.version === 4) return migrateVersion4Settings(value);
  if (value?.version === 3) return migrateVersion3Settings(value);
  if (value?.version === 2) return migrateVersion2Settings(value);
  if (value?.version === 1) return migrateLegacySettings(value) ?? DEFAULT_GRAPH_VISUAL_SETTINGS;
  if (!value || typeof value !== "object" || !hasSupportedSchema(value)) {
    return DEFAULT_GRAPH_VISUAL_SETTINGS;
  }

  const defaults = DEFAULT_GRAPH_VISUAL_SETTINGS;
  const normalized = freezeSettings({
    sharedStyle: value.sharedStyle,
    idleShape: value.idleShape,
    view: {
      enabled: typeof value.view?.enabled === "boolean"
        ? value.view.enabled
        : defaults.view.enabled,
      dimension: DIMENSION_VALUES.has(value.view?.dimension)
        ? value.view.dimension
        : defaults.view.dimension,
    },
    node: {
      maxCount: boundedNumber(
        value.node?.maxCount,
        defaults.node.maxCount,
        graphVisualSettingRanges.node.maxCount,
        { integer: true },
      ),
      scale: boundedNumber(
        value.node?.scale,
        defaults.node.scale,
        graphVisualSettingRanges.node.scale,
      ),
      opacity: boundedNumber(
        value.node?.opacity,
        defaults.node.opacity,
        graphVisualSettingRanges.node.opacity,
      ),
      hubScale: boundedNumber(
        value.node?.hubScale,
        defaults.node.hubScale,
        graphVisualSettingRanges.node.hubScale,
      ),
      useThemeColors: typeof value.node?.useThemeColors === "boolean"
        ? value.node.useThemeColors
        : defaults.node.useThemeColors,
      baseColor: hexColor(value.node?.baseColor, defaults.node.baseColor),
      hubColor: hexColor(value.node?.hubColor, defaults.node.hubColor),
      activeColor: hexColor(value.node?.activeColor, defaults.node.activeColor),
      groupColor: hexColor(value.node?.groupColor, defaults.node.groupColor),
    },
    edge: {
      opacity: boundedNumber(
        value.edge?.opacity,
        defaults.edge.opacity,
        graphVisualSettingRanges.edge.opacity,
      ),
      color: hexColor(value.edge?.color, defaults.edge.color),
    },
    labels: {
      count: boundedNumber(
        value.labels?.count,
        defaults.labels.count,
        graphVisualSettingRanges.labels.count,
        { integer: true },
      ),
      fontSize: boundedNumber(
        value.labels?.fontSize,
        defaults.labels.fontSize,
        graphVisualSettingRanges.labels.fontSize,
        { integer: true },
      ),
      opacity: boundedNumber(
        value.labels?.opacity,
        defaults.labels.opacity,
        graphVisualSettingRanges.labels.opacity,
      ),
    },
    layout: {
      mode: value.layout?.mode === "neuron" ? "neuron" : "force",
      ...Object.fromEntries(Object.entries(NEURON_SPATIAL_DEFAULTS).map(([key, fallback]) => [
        key, boundedNumber(value.layout?.[key], fallback, graphVisualSettingRanges.layout[key]),
      ])),
      repulsion: boundedNumber(
        value.layout?.repulsion,
        defaults.layout.repulsion,
        graphVisualSettingRanges.layout.repulsion,
      ),
      linkDistance: boundedNumber(
        value.layout?.linkDistance,
        defaults.layout.linkDistance,
        graphVisualSettingRanges.layout.linkDistance,
      ),
      linkStrength: boundedNumber(
        value.layout?.linkStrength,
        defaults.layout.linkStrength,
        graphVisualSettingRanges.layout.linkStrength,
      ),
      collision: boundedNumber(
        value.layout?.collision,
        defaults.layout.collision,
        graphVisualSettingRanges.layout.collision,
      ),
      center: boundedNumber(
        value.layout?.center,
        defaults.layout.center,
        graphVisualSettingRanges.layout.center,
      ),
    },
    profiles: normalizeGraphFxProfiles(value.profiles),
    scene: {
      stars: boundedNumber(
        value.scene?.stars,
        defaults.scene.stars,
        graphVisualSettingRanges.scene.stars,
        { integer: true },
      ),
      bloom: BLOOM_VALUES.has(value.scene?.bloom)
        ? value.scene.bloom
        : defaults.scene.bloom,
      bloomIntensity: boundedNumber(
        value.scene?.bloomIntensity,
        defaults.scene.bloomIntensity,
        graphVisualSettingRanges.scene.bloomIntensity,
      ),
    },
    performance: {
      quality: QUALITY_VALUES.has(value.performance?.quality)
        ? value.performance.quality
        : defaults.performance.quality,
    },
  });
  if (flat) return normalized;
  const active = `${normalized.view.dimension}d`;
  const dimensions = {};
  for (const id of ["2d", "3d"]) {
    const stored = value.dimensions?.[id];
    dimensions[id] = stored
      ? dimensionSettings(normalizeGraphVisualSettings({ ...normalized, ...stored, view: { ...normalized.view, dimension: id === "2d" ? 2 : 3 } }, true))
      : dimensionSettings(normalized);
  }
  // Top-level fields are a projection of the active dimension for existing consumers.
  dimensions[active] = dimensionSettings(normalized);
  const profiles = { ...normalized.profiles };
  if (normalized.sharedStyle) {
    for (const id of ["2d", "3d"]) {
      dimensions[id] = dimensionSettings({ ...dimensions[id], node: normalized.node, edge: normalized.edge });
      profiles[id] = { ...profiles[id], ...Object.fromEntries(
        ["node", "edge", "signal", "motion", "postFx"].map((key) => [key, profiles[active][key]]),
      ) };
    }
  }
  return freezeSettings({ ...normalized, dimensions, profiles });
}

function configurationsMatch(left, right) {
  return left.sharedStyle === right.sharedStyle && left.idleShape === right.idleShape
    && Object.entries(sectionFields).every(([section, fields]) => (
    fields.every((field) => left[section][field] === right[section][field])
  )) && JSON.stringify(left.profiles) === JSON.stringify(right.profiles)
    && JSON.stringify(left.dimensions) === JSON.stringify(right.dimensions);
}

export function getGraphVisualPresetId(value) {
  const settings = normalizeGraphVisualSettings(value);
  for (const preset of graphVisualPresets) {
    const presetSettings = presetConfigurations[preset.id];
    if (JSON.stringify(dimensionSettings(settings)) === JSON.stringify(dimensionSettings(presetSettings))
      && JSON.stringify(settings.profiles[`${settings.view.dimension}d`]) === JSON.stringify(presetSettings.profiles[`${settings.view.dimension}d`])) return preset.id;
  }
  return "custom";
}

export function resolveGraphVisualColors(value, themePalette) {
  const normalized = normalizeGraphVisualSettings(value);
  if (!normalized.node.useThemeColors || !themePalette) {
    return Object.freeze({
      baseColor: normalized.node.baseColor,
      hubColor: normalized.node.hubColor,
      activeColor: normalized.node.activeColor,
      groupColor: normalized.node.groupColor,
      edgeColor: normalized.edge.color,
    });
  }
  return Object.freeze({
    baseColor: hexColor(themePalette.node, normalized.node.baseColor),
    hubColor: hexColor(themePalette.hub, normalized.node.hubColor),
    activeColor: hexColor(themePalette.active, normalized.node.activeColor),
    groupColor: hexColor(themePalette.group, normalized.node.groupColor),
    edgeColor: hexColor(normalized.layout.mode === "neuron" ? themePalette.active : themePalette.edge, normalized.edge.color),
  });
}

function parseStoredValue(value) {
  try {
    return normalizeGraphVisualSettings(JSON.parse(value ?? "null"));
  } catch {
    return DEFAULT_GRAPH_VISUAL_SETTINGS;
  }
}

function readSettings() {
  if (typeof window === "undefined") return DEFAULT_GRAPH_VISUAL_SETTINGS;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return parseStoredValue(stored);
    const version6 = window.localStorage.getItem(VERSION_6_STORAGE_KEY);
    if (version6 !== null) {
      const migrated = normalizeGraphVisualSettings(JSON.parse(version6));
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
    const previousRaw = window.localStorage.getItem(PREVIOUS_STORAGE_KEY);
    if (previousRaw !== null) {
      const migrated = migrateVersion5Settings(JSON.parse(previousRaw));
      if (!migrated) return DEFAULT_GRAPH_VISUAL_SETTINGS;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
    const secondPreviousRaw = window.localStorage.getItem(SECOND_PREVIOUS_STORAGE_KEY);
    if (secondPreviousRaw !== null) {
      const migrated = migrateVersion4Settings(JSON.parse(secondPreviousRaw));
      if (!migrated) return DEFAULT_GRAPH_VISUAL_SETTINGS;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
    const thirdPreviousRaw = window.localStorage.getItem(THIRD_PREVIOUS_STORAGE_KEY);
    if (thirdPreviousRaw !== null) {
      const migrated = migrateVersion3Settings(JSON.parse(thirdPreviousRaw));
      if (!migrated) return DEFAULT_GRAPH_VISUAL_SETTINGS;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
    const fourthPreviousRaw = window.localStorage.getItem(FOURTH_PREVIOUS_STORAGE_KEY);
    if (fourthPreviousRaw !== null) {
      const migrated = migrateVersion2Settings(JSON.parse(fourthPreviousRaw));
      if (!migrated) return DEFAULT_GRAPH_VISUAL_SETTINGS;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
    const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw === null) return DEFAULT_GRAPH_VISUAL_SETTINGS;
    const migrated = migrateLegacySettings(JSON.parse(legacyRaw));
    if (!migrated) return DEFAULT_GRAPH_VISUAL_SETTINGS;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return DEFAULT_GRAPH_VISUAL_SETTINGS;
  }
}

let settings = readSettings();

function applyMetadata() {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.graphVisualPreset = getGraphVisualPresetId(settings);
  document.documentElement.dataset.graphVisualQuality = settings.performance.quality;
  document.documentElement.dataset.graphDimension = String(settings.view.dimension);
  document.documentElement.dataset.graphVisibility = settings.view.enabled ? "shown" : "hidden";
  document.documentElement.dataset.graphVisualPalette = settings.node.useThemeColors
    ? "theme"
    : "custom";
}

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function persistSettings() {
  persistTimer = null;
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }
    persistenceError = null;
  } catch (error) {
    persistenceError = String(error?.message ?? "Graph visual settings could not be saved.");
    // Keep the current renderer session usable when storage is unavailable.
  }
}

function cancelPendingPersistence() {
  if (persistTimer === null) return;
  globalThis.clearTimeout(persistTimer);
  persistTimer = null;
}

function schedulePersistSettings({ immediate = false } = {}) {
  if (typeof window === "undefined") return;
  cancelPendingPersistence();
  if (immediate) {
    persistSettings();
    return;
  }
  persistTimer = globalThis.setTimeout(persistSettings, PERSIST_DELAY_MS);
}

function closeHistoryGroup() {
  historyKey = null;
  if (historyTimer !== null) globalThis.clearTimeout(historyTimer);
  historyTimer = null;
}

function recordHistory(previousSettings, nextHistoryKey) {
  const normalizedKey = String(nextHistoryKey || "settings");
  if (historyKey !== normalizedKey) {
    history.push(previousSettings);
    if (history.length > MAX_HISTORY_ENTRIES) history.shift();
  }
  historyKey = normalizedKey;
  if (historyTimer !== null) globalThis.clearTimeout(historyTimer);
  historyTimer = globalThis.setTimeout(closeHistoryGroup, HISTORY_COALESCE_MS);
}

function commitSettings(nextValue, {
  persist = true,
  force = false,
  historyKey: nextHistoryKey = "settings",
  record = true,
  immediate = false,
} = {}) {
  if (typeof window !== "undefined") initializeGraphVisualSettings();
  const next = normalizeGraphVisualSettings(nextValue);
  const changed = !configurationsMatch(next, settings);
  if (!force && !changed) return settings;
  if (changed && record) recordHistory(settings, nextHistoryKey);
  settings = next;
  if (persist) schedulePersistSettings({ immediate });
  applyMetadata();
  notifyListeners();
  return settings;
}

function handleStorage(event) {
  if (event.key !== STORAGE_KEY) return;
  cancelPendingPersistence();
  closeHistoryGroup();
  history.length = 0;
  commitSettings(parseStoredValue(event.newValue), { persist: false, record: false });
}

export function initializeGraphVisualSettings() {
  if (initialized) {
    applyMetadata();
    return;
  }
  settings = readSettings();
  applyMetadata();
  if (typeof window === "undefined") return;
  initialized = true;
  window.addEventListener("storage", handleStorage);
  window.addEventListener("pagehide", flushGraphVisualSettingsPersistence);
}

export function getGraphVisualSettingsSnapshot() {
  return settings;
}

export function selectGraphDimensionSettings(value, dimension) {
  if (dimension !== 2 && dimension !== 3 || dimension === value.view.dimension) return value;
  return Object.freeze({
    ...value,
    ...value.dimensions[`${dimension}d`],
    view: Object.freeze({ ...value.view, dimension }),
  });
}

export function subscribeGraphVisualSettings(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setGraphSharedNeuronStyle(enabled) {
  if (enabled && settings.sharedStyle) return settings;
  if (!enabled) return commitSettings({ ...settings, sharedStyle: false }, { historyKey: "style-link", immediate: true });
  const source = settings.dimensions["3d"];
  const dimensions = { ...settings.dimensions };
  for (const id of ["2d", "3d"]) {
    dimensions[id] = { ...dimensions[id], node: source.node, edge: source.edge,
      layout: { ...dimensions[id].layout, mode: "neuron" } };
  }
  const profile = settings.profiles["3d"];
  return commitSettings({
    ...settings, sharedStyle: true, idleShape: "neuronSphere", dimensions,
    ...dimensions[`${settings.view.dimension}d`],
    profiles: { "2d": profile, "3d": { ...profile, orb: { ...profile.orb,
      network: { ...profile.orb.network, shellRatio: 0.92, density: 1.2 },
      innerNetwork: { ...profile.orb.innerNetwork, enabled: false },
      rim: { ...profile.orb.rim, enabled: false }, sparks: { ...profile.orb.sparks, enabled: false },
    } } },
  }, { historyKey: "style-link", immediate: true });
}

export function setGraphVisualPreset(presetId) {
  const preset = presetConfigurations[presetId];
  if (!preset) return settings;
  const dimensions = graphVisualPresets.find((entry) => entry.id === presetId)?.dimensions;
  if (dimensions && !dimensions.includes(settings.view.dimension)) return settings;
  const id = `${settings.view.dimension}d`;
  return commitSettings({
    ...settings,
    ...dimensionSettings(preset),
    profiles: { ...settings.profiles, [id]: preset.profiles[id] },
  }, { historyKey: `preset:${id}:${presetId}` });
}

export function updateGraphVisualSettingsSection(section, patch) {
  if (!sectionFields[section] || !patch || typeof patch !== "object") return settings;
  const dimensional = section === "view" && DIMENSION_VALUES.has(patch.dimension)
    ? settings.dimensions[`${patch.dimension}d`]
    : {};
  return commitSettings({
    ...settings,
    ...dimensional,
    [section]: {
      ...settings[section],
      ...patch,
    },
  }, { historyKey: `section:${section}` });
}

export function updateGraphVisualSettings(section, patch) {
  return updateGraphVisualSettingsSection(section, patch);
}

export function setGraphVisualSetting(section, setting, value) {
  if (!sectionFields[section]?.includes(setting)) return settings;
  if (section === "view" && setting === "dimension" && DIMENSION_VALUES.has(value)) {
    return commitSettings({
      ...settings,
      ...settings.dimensions[`${value}d`],
      view: { ...settings.view, dimension: value },
    }, { historyKey: "dimension" });
  }
  const colorSetting = (section === "node"
    && ["baseColor", "hubColor", "activeColor", "groupColor"].includes(setting))
    || (section === "edge" && setting === "color");
  if (colorSetting) {
    return commitSettings({
      ...settings,
      node: {
        ...settings.node,
        ...(section === "node" ? { [setting]: value } : {}),
        useThemeColors: false,
      },
      edge: {
        ...settings.edge,
        ...(section === "edge" ? { [setting]: value } : {}),
      },
    }, { historyKey: `${section}.${setting}` });
  }
  return commitSettings({
    ...settings,
    [section]: {
      ...settings[section],
      [setting]: value,
    },
  }, { historyKey: `${section}.${setting}` });
}

export function setGraphVisualProfileSetting(profileId, path, value) {
  let profiles = withGraphFxProfileSetting(settings.profiles, profileId, path, value);
  if (settings.sharedStyle && !path.startsWith("orb.")) {
    profiles = withGraphFxProfileSetting(profiles, profileId === "3d" ? "2d" : "3d", path, value);
  }
  return commitSettings({
    ...settings,
    profiles,
  }, { historyKey: `profiles.${profileId}.${path}` });
}

export function resetGraphVisualProfile(profileId) {
  const defaults = DEFAULT_GRAPH_FX_PROFILES[profileId];
  if (!defaults) return settings;
  if (settings.sharedStyle) {
    const common = presetConfigurations.neuron3d.profiles["3d"];
    return commitSettings({ ...settings, profiles: {
      "2d": common,
      "3d": { ...common, orb: settings.profiles["3d"].orb },
    } }, { historyKey: "profiles.shared.reset", immediate: true });
  }
  return commitSettings({
    ...settings,
    profiles: {
      ...settings.profiles,
      [profileId]: defaults,
    },
  }, {
    historyKey: `profiles.${profileId}.reset`,
    immediate: true,
  });
}

export function resetActiveGraphVisualSettings() {
  const id = `${settings.view.dimension}d`;
  if (settings.sharedStyle) {
    const preset = presetConfigurations[id === "2d" ? "neuron" : "neuron3d"];
    const common = presetConfigurations.neuron3d;
    return commitSettings({ ...settings,
      ...dimensionSettings(preset), node: common.node, edge: common.edge,
      profiles: { "2d": common.profiles["3d"], "3d": { ...common.profiles["3d"], orb: settings.profiles["3d"].orb } },
    }, { historyKey: `reset:${id}`, immediate: true });
  }
  return commitSettings({
    ...settings,
    ...DEFAULT_GRAPH_VISUAL_SETTINGS.dimensions[id],
    profiles: { ...settings.profiles, [id]: DEFAULT_GRAPH_FX_PROFILES[id] },
  }, { historyKey: `reset:${id}`, immediate: true });
}

export function resetGraphVisualSettings() {
  return commitSettings(DEFAULT_GRAPH_VISUAL_SETTINGS, {
    force: true,
    historyKey: "reset",
    immediate: true,
  });
}

export function replaceGraphVisualSettings(value, options = {}) {
  return commitSettings(value, {
    historyKey: options.historyKey ?? "replace",
    immediate: options.immediate === true,
  });
}

export function canUndoGraphVisualSettings() {
  return history.length > 0;
}

export function undoGraphVisualSettings() {
  const previous = history.pop();
  if (!previous) return false;
  closeHistoryGroup();
  commitSettings(previous, { record: false, immediate: true });
  return true;
}

export function flushGraphVisualSettingsPersistence() {
  if (persistTimer !== null) {
    cancelPendingPersistence();
    persistSettings();
  }
}

export function getGraphVisualSettingsPersistenceError() {
  return persistenceError;
}

export const GRAPH_VISUAL_SETTINGS_STORAGE_KEY = STORAGE_KEY;
export const PREVIOUS_GRAPH_VISUAL_SETTINGS_STORAGE_KEY = PREVIOUS_STORAGE_KEY;
export const SECOND_PREVIOUS_GRAPH_VISUAL_SETTINGS_STORAGE_KEY = SECOND_PREVIOUS_STORAGE_KEY;
export const THIRD_PREVIOUS_GRAPH_VISUAL_SETTINGS_STORAGE_KEY = THIRD_PREVIOUS_STORAGE_KEY;
export const FOURTH_PREVIOUS_GRAPH_VISUAL_SETTINGS_STORAGE_KEY = FOURTH_PREVIOUS_STORAGE_KEY;
export const LEGACY_GRAPH_VISUAL_SETTINGS_STORAGE_KEY = LEGACY_STORAGE_KEY;
export const graphVisualSettingsPersistencePolicy = Object.freeze({
  historyEntries: MAX_HISTORY_ENTRIES,
  historyCoalesceMs: HISTORY_COALESCE_MS,
  persistDelayMs: PERSIST_DELAY_MS,
});
