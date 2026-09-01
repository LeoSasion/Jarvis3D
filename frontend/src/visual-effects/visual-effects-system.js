const STORAGE_KEY = "jarvis.visual-effects.v1";
const SCHEMA_VERSION = 1;
const CADENCE_VALUES = new Set(["economy", "balanced"]);
const SUPPORTED_SURFACES = new Set(["desktop"]);
const listeners = new Set();
let initialized = false;

export const visualEffectDefinitions = Object.freeze([
  Object.freeze({
    id: "scanlines",
    labelKey: "visualEffects.effect.scanlines.label",
    detailKey: "visualEffects.effect.scanlines.detail",
  }),
  Object.freeze({
    id: "grain",
    labelKey: "visualEffects.effect.grain.label",
    detailKey: "visualEffects.effect.grain.detail",
  }),
  Object.freeze({
    id: "vignette",
    labelKey: "visualEffects.effect.vignette.label",
    detailKey: "visualEffects.effect.vignette.detail",
  }),
]);

const EFFECT_IDS = Object.freeze(visualEffectDefinitions.map(({ id }) => id));

function freezePreferences(value) {
  return Object.freeze({
    version: SCHEMA_VERSION,
    enabled: value.enabled,
    cadence: value.cadence,
    effects: Object.freeze({ ...value.effects }),
  });
}

export const DEFAULT_VISUAL_EFFECTS = freezePreferences({
  enabled: false,
  cadence: "economy",
  effects: {
    scanlines: true,
    grain: false,
    vignette: true,
  },
});

const presetConfigurations = Object.freeze({
  off: DEFAULT_VISUAL_EFFECTS,
  low: freezePreferences({
    enabled: true,
    cadence: "economy",
    effects: {
      scanlines: true,
      grain: false,
      vignette: true,
    },
  }),
  balanced: freezePreferences({
    enabled: true,
    cadence: "balanced",
    effects: {
      scanlines: true,
      grain: true,
      vignette: true,
    },
  }),
});

export const visualEffectsPresets = Object.freeze([
  Object.freeze({
    id: "off",
    labelKey: "visualEffects.preset.off.label",
    detailKey: "visualEffects.preset.off.detail",
  }),
  Object.freeze({
    id: "low",
    labelKey: "visualEffects.preset.low.label",
    detailKey: "visualEffects.preset.low.detail",
  }),
  Object.freeze({
    id: "balanced",
    labelKey: "visualEffects.preset.balanced.label",
    detailKey: "visualEffects.preset.balanced.detail",
  }),
]);

function hasSupportedSchema(value) {
  return value?.version === SCHEMA_VERSION;
}

export function normalizeVisualEffects(value) {
  if (!value || typeof value !== "object" || !hasSupportedSchema(value)) {
    return DEFAULT_VISUAL_EFFECTS;
  }

  const effects = {};
  for (const id of EFFECT_IDS) {
    effects[id] = typeof value.effects?.[id] === "boolean"
      ? value.effects[id]
      : DEFAULT_VISUAL_EFFECTS.effects[id];
  }

  return freezePreferences({
    enabled: value.enabled === true,
    cadence: CADENCE_VALUES.has(value.cadence)
      ? value.cadence
      : DEFAULT_VISUAL_EFFECTS.cadence,
    effects,
  });
}

function configurationsMatch(left, right) {
  return left.enabled === right.enabled
    && left.cadence === right.cadence
    && EFFECT_IDS.every((id) => left.effects[id] === right.effects[id]);
}

export function getVisualEffectsPresetId(value) {
  const preferences = normalizeVisualEffects(value);
  if (!preferences.enabled) return "off";
  if (configurationsMatch(preferences, presetConfigurations.low)) return "low";
  if (configurationsMatch(preferences, presetConfigurations.balanced)) return "balanced";
  return "custom";
}

function createEmptyPlan(surface, reason) {
  return Object.freeze({
    backend: "none",
    surface,
    reason,
    staticEffects: Object.freeze([]),
    grain: null,
    layerCount: 0,
  });
}

export function createVisualEffectsRenderPlan(value, environment = {}) {
  const preferences = normalizeVisualEffects(value);
  const surface = environment.surface ?? "desktop";

  if (!preferences.enabled) return createEmptyPlan(surface, "disabled");
  if (!SUPPORTED_SURFACES.has(surface)) return createEmptyPlan(surface, "surface-policy");
  if (environment.visible === false) return createEmptyPlan(surface, "hidden");
  if (environment.forcedColors === true) return createEmptyPlan(surface, "forced-colors");
  if (environment.forcedOff === true) return createEmptyPlan(surface, "recovery-override");

  const staticEffects = ["scanlines", "vignette"]
    .filter((id) => preferences.effects[id]);
  const grain = preferences.effects.grain
    ? Object.freeze({
        animated: environment.reducedMotion !== true,
        cadence: preferences.cadence,
      })
    : null;
  const layerCount = Number(staticEffects.length > 0) + Number(grain !== null);

  if (layerCount === 0) return createEmptyPlan(surface, "no-active-effects");

  return Object.freeze({
    backend: "css-overlay",
    surface,
    reason: null,
    staticEffects: Object.freeze(staticEffects),
    grain,
    layerCount,
  });
}

function parseStoredValue(value) {
  try {
    return normalizeVisualEffects(JSON.parse(value ?? "null"));
  } catch {
    return DEFAULT_VISUAL_EFFECTS;
  }
}

function readPreferences() {
  if (typeof window === "undefined") return DEFAULT_VISUAL_EFFECTS;
  try {
    return parseStoredValue(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_VISUAL_EFFECTS;
  }
}

let preferences = readPreferences();

function applyMetadata() {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.visualEffects = getVisualEffectsPresetId(preferences);
  document.documentElement.dataset.visualEffectsCadence = preferences.cadence;
}

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function persistPreferences() {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    }
  } catch {
    // The current renderer session keeps the selected configuration.
  }
}

function commitPreferences(nextValue, { persist = true, force = false } = {}) {
  const next = normalizeVisualEffects(nextValue);
  if (!force && configurationsMatch(next, preferences)) return preferences;
  preferences = next;
  if (persist) persistPreferences();
  applyMetadata();
  notifyListeners();
  return preferences;
}

function handleStorage(event) {
  if (event.key !== STORAGE_KEY) return;
  commitPreferences(parseStoredValue(event.newValue), { persist: false });
}

export function initializeVisualEffects() {
  preferences = readPreferences();
  applyMetadata();
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  window.addEventListener("storage", handleStorage);
}

export function getVisualEffectsSnapshot() {
  return preferences;
}

export function subscribeVisualEffects(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setVisualEffectsEnabled(enabled) {
  return commitPreferences({
    ...preferences,
    enabled: enabled === true,
  });
}

export function setVisualEffectsPreset(presetId) {
  const preset = presetConfigurations[presetId];
  return preset ? commitPreferences(preset) : preferences;
}

export function setVisualEffectEnabled(effectId, enabled) {
  if (!EFFECT_IDS.includes(effectId)) return preferences;
  return commitPreferences({
    ...preferences,
    effects: {
      ...preferences.effects,
      [effectId]: enabled === true,
    },
  });
}

export function setVisualEffectsCadence(cadence) {
  if (!CADENCE_VALUES.has(cadence)) return preferences;
  return commitPreferences({
    ...preferences,
    cadence,
  });
}

export function resetVisualEffects() {
  return commitPreferences(DEFAULT_VISUAL_EFFECTS, { force: true });
}
