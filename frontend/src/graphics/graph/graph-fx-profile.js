const PROFILE_IDS = Object.freeze(["2d", "3d"]);

const COMMON_BOOLEAN_PATHS = Object.freeze([
  "node.core.enabled",
  "node.halo.enabled",
  "node.pulse.enabled",
  "node.activation.enabled",
  "edge.core.enabled",
  "edge.halo.enabled",
  "edge.signal.enabled",
  "signal.enabled",
  "postFx.bloom.enabled",
]);

const THREE_D_BOOLEAN_PATHS = Object.freeze([
  "orb.signals.enabled",
  "orb.innerNetwork.enabled",
  "orb.rim.enabled",
  "orb.sparks.enabled",
]);

export const graphFxSettingRanges = Object.freeze({
  "node.master.scale": Object.freeze({ min: 0.6, max: 1.8, step: 0.01 }),
  "node.master.opacity": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "node.size.byImportance": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "node.size.variation": Object.freeze({ min: 0, max: 0.5, step: 0.01 }),
  "node.color.groupVariation": Object.freeze({ min: 0, max: 2, step: 0.05 }),
  "node.activation.strength": Object.freeze({ min: 0.2, max: 2, step: 0.05 }),
  "node.activation.restingBrightness": Object.freeze({ min: 0.15, max: 1, step: 0.05 }),
  "node.activation.chargeTime": Object.freeze({ min: 0.02, max: 0.6, step: 0.01 }),
  "node.activation.holdTime": Object.freeze({ min: 0, max: 2, step: 0.01 }),
  "node.activation.decayTime": Object.freeze({ min: 0.2, max: 6, step: 0.1 }),
  "node.core.sizeScale": Object.freeze({ min: 0.6, max: 1.8, step: 0.01 }),
  "node.core.opacity": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "node.core.emissionIntensity": Object.freeze({ min: 0, max: 3, step: 0.05 }),
  "node.halo.radiusScale": Object.freeze({ min: 0.5, max: 2.5, step: 0.01 }),
  "node.halo.opacity": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "node.halo.emissionIntensity": Object.freeze({ min: 0, max: 3, step: 0.05 }),
  "node.pulse.amount": Object.freeze({ min: 0, max: 2, step: 0.01 }),
  "node.pulse.rate": Object.freeze({ min: 0.25, max: 2.5, step: 0.05 }),
  "edge.master.opacity": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "edge.signal.speed": Object.freeze({ min: 0.1, max: 3, step: 0.05 }),
  "edge.signal.emissionIntensity": Object.freeze({ min: 0, max: 3, step: 0.05 }),
  "edge.signal.headLength": Object.freeze({ min: 0.4, max: 3, step: 0.05 }),
  "edge.signal.wakeLength": Object.freeze({ min: 0, max: 3, step: 0.05 }),
  "edge.signal.spacing": Object.freeze({ min: 0.5, max: 3, step: 0.05 }),
  "edge.signal.colorStart": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "edge.signal.colorEnd": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "edge.focus.boost": Object.freeze({ min: 0.05, max: 1.5, step: 0.05 }),
  "edge.focus.amplitude": Object.freeze({ min: 0, max: 1.5, step: 0.05 }),
  "edge.focus.period": Object.freeze({ min: 0.5, max: 8, step: 0.1 }),
  "edge.filament.taper": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "edge.filament.rootWidth": Object.freeze({ min: 1, max: 6, step: 0.05 }),
  "edge.filament.roundness": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "edge.filament.translucency": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "edge.core.widthScale": Object.freeze({ min: 0.5, max: 2, step: 0.01 }),
  "edge.core.opacity": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "edge.core.emissionIntensity": Object.freeze({ min: 0, max: 3, step: 0.05 }),
  "edge.core.widthByStrength": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "edge.core.emissionByStrength": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "edge.halo.radiusScale": Object.freeze({ min: 0.25, max: 2.5, step: 0.01 }),
  "edge.halo.opacity": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "edge.halo.emissionIntensity": Object.freeze({ min: 0, max: 3, step: 0.05 }),
  "edge.halo.falloff": Object.freeze({ min: 0.5, max: 4, step: 0.05 }),
  "edge.halo.byStrength": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "signal.count": Object.freeze({ min: 0, max: 12, step: 1, integer: true }),
  "signal.speed": Object.freeze({ min: 0.1, max: 3, step: 0.05 }),
  "signal.sizeScale": Object.freeze({ min: 0.5, max: 2, step: 0.01 }),
  "signal.opacity": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "signal.emissionIntensity": Object.freeze({ min: 0, max: 3, step: 0.05 }),
  "motion.idleRotationSpeed": Object.freeze({ min: 0, max: 2.5, step: 0.05 }),
  "motion.breathingAmount": Object.freeze({ min: 0, max: 2.5, step: 0.05 }),
  "motion.breathingRate": Object.freeze({ min: 0.25, max: 2.5, step: 0.05 }),
  "orb.network.density": Object.freeze({ min: 0.75, max: 4, step: 0.05 }),
  "orb.signals.count": Object.freeze({ min: 0, max: 48, step: 1, integer: true }),
  "orb.signals.sizeVariation": Object.freeze({ min: 0, max: 0.5, step: 0.01 }),
  "orb.signals.launchSpread": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "orb.signals.batchInterval": Object.freeze({ min: 0.5, max: 12, step: 0.1 }),
  "orb.signals.hops": Object.freeze({ min: 2, max: 16, step: 1, integer: true }),
  "orb.network.shellRatio": Object.freeze({ min: 0.1, max: 1, step: 0.01 }),
  "orb.network.depthContrast": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "orb.network.sizeScale": Object.freeze({ min: 0.65, max: 1.2, step: 0.01 }),
  "orb.network.branchSpread": Object.freeze({ min: 0.5, max: 1.4, step: 0.01 }),
  "orb.network.weave": Object.freeze({ min: 0, max: 2, step: 0.01 }),
  "orb.innerNetwork.scale": Object.freeze({ min: 0.4, max: 1, step: 0.01 }),
  "orb.innerNetwork.opacity": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "orb.innerNetwork.rotationSpeed": Object.freeze({ min: -2, max: 2, step: 0.05 }),
  "orb.rim.intensity": Object.freeze({ min: 0, max: 3, step: 0.05 }),
  "orb.rim.fresnelPower": Object.freeze({ min: 1, max: 10, step: 0.1 }),
  "orb.sparks.sizeScale": Object.freeze({ min: 0.5, max: 2, step: 0.01 }),
  "orb.sparks.opacity": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "orb.sparks.emissionIntensity": Object.freeze({ min: 0, max: 3, step: 0.05 }),
  "postFx.radiance.temperature": Object.freeze({ min: 0, max: 1, step: 0.05 }),
  "postFx.radiance.focus": Object.freeze({ min: 0, max: 1, step: 0.05 }),
  "postFx.radiance.transmissionLink": Object.freeze({ min: 0, max: 1, step: 0.05 }),
  "postFx.bloom.intensity": Object.freeze({ min: 0, max: 3, step: 0.05 }),
  "postFx.bloom.threshold": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "postFx.bloom.softKnee": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "postFx.bloom.radius": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "postFx.bloom.falloff": Object.freeze({ min: 1, max: 3, step: 0.05 }),
  "postFx.bloom.colorPreservation": Object.freeze({ min: 0, max: 1, step: 0.01 }),
});

const RAW_DEFAULT_PROFILES = {
  "2d": {
    node: {
      master: { scale: 1, opacity: 1 },
      size: { byImportance: 0.82, variation: 0.25 },
      color: { groupVariation: 1 },
      activation: { enabled: true, strength: 1, restingBrightness: 0.55, chargeTime: 0.08, holdTime: 0.12, decayTime: 1.6 },
      core: { enabled: true, sizeScale: 1, opacity: 0.84, emissionIntensity: 0.84 },
      halo: { enabled: true, radiusScale: 0.82, opacity: 0.08, emissionIntensity: 0.72 },
      pulse: { enabled: true, amount: 0.45, rate: 0.8 },
    },
    edge: {
      master: { opacity: 1 },
      signal: { enabled: true, speed: 1, emissionIntensity: 1, headLength: 1, wakeLength: 1, spacing: 1, colorStart: 0, colorEnd: 1 },
      focus: { boost: 0.3, amplitude: 0.55, period: 2.8 },
      filament: { taper: 0, rootWidth: 4.2, roundness: 0, translucency: 0 },
      core: {
        enabled: true,
        widthScale: 0.86,
        opacity: 0.62,
        emissionIntensity: 0.78,
        widthByStrength: 0.72,
        emissionByStrength: 0.72,
      },
      halo: {
        enabled: false,
        radiusScale: 0.72,
        opacity: 0.18,
        emissionIntensity: 0.64,
        falloff: 2.2,
        byStrength: 0.72,
      },
    },
    signal: {
      enabled: true,
      count: 8,
      speed: 0.82,
      sizeScale: 0.8,
      opacity: 0.78,
      emissionIntensity: 0.8,
    },
    motion: { idleRotationSpeed: 0.35, breathingAmount: 0.35, breathingRate: 0.8 },
    postFx: {
      radiance: { temperature: 0, focus: 0, transmissionLink: 1 },
      bloom: { enabled: false, intensity: 1.02, threshold: 0.28, softKnee: 0.38, radius: 0.72, falloff: 2, colorPreservation: 0.8 },
    },
  },
  "3d": {
    node: {
      master: { scale: 1, opacity: 1 },
      size: { byImportance: 1, variation: 0.25 },
      color: { groupVariation: 1 },
      activation: { enabled: true, strength: 1, restingBrightness: 0.55, chargeTime: 0.08, holdTime: 0.12, decayTime: 1.6 },
      core: { enabled: true, sizeScale: 1, opacity: 0.9, emissionIntensity: 1 },
      halo: { enabled: true, radiusScale: 1, opacity: 0.14, emissionIntensity: 1 },
      pulse: { enabled: true, amount: 1, rate: 1 },
    },
    edge: {
      master: { opacity: 1 },
      signal: { enabled: true, speed: 1, emissionIntensity: 1, headLength: 1, wakeLength: 1, spacing: 1, colorStart: 0, colorEnd: 1 },
      focus: { boost: 0.3, amplitude: 0.55, period: 2.8 },
      filament: { taper: 0, rootWidth: 4.2, roundness: 0, translucency: 0 },
      core: {
        enabled: true,
        widthScale: 1,
        opacity: 0.76,
        emissionIntensity: 1,
        widthByStrength: 1,
        emissionByStrength: 1,
      },
      halo: {
        enabled: true,
        radiusScale: 1,
        opacity: 0.46,
        emissionIntensity: 1,
        falloff: 1.65,
        byStrength: 1,
      },
    },
    signal: {
      enabled: true,
      count: 12,
      speed: 1,
      sizeScale: 1,
      opacity: 0.96,
      emissionIntensity: 1,
    },
    orb: {
      signals: { enabled: true, count: 48, sizeVariation: 0.3, launchSpread: 0.5, batchInterval: 3, hops: 10 },
      network: { density: 2.4, shellRatio: 1, depthContrast: 0, sizeScale: 1, branchSpread: 1, weave: 0.8 },
      innerNetwork: { enabled: true, scale: 0.73, opacity: 0.2, rotationSpeed: 1 },
      rim: { enabled: true, intensity: 1, fresnelPower: 5.2 },
      sparks: { enabled: true, sizeScale: 1, opacity: 0.24, emissionIntensity: 1 },
    },
    motion: { idleRotationSpeed: 1, breathingAmount: 1, breathingRate: 1 },
    postFx: {
      radiance: { temperature: 0, focus: 0, transmissionLink: 1 },
      bloom: { enabled: true, intensity: 1.85, threshold: 0.18, softKnee: 0.42, radius: 0.92, falloff: 2, colorPreservation: 0.8 },
    },
  },
};

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function cloneValue(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(cloneValue);
  return Object.fromEntries(Object.entries(value).map(
    ([key, nestedValue]) => [key, cloneValue(nestedValue)],
  ));
}

function getPathValue(value, path) {
  return path.split(".").reduce((current, key) => current?.[key], value);
}

function setPathValue(value, path, nextValue) {
  const keys = path.split(".");
  let current = value;
  keys.slice(0, -1).forEach((key) => {
    current[key] ??= {};
    current = current[key];
  });
  current[keys.at(-1)] = nextValue;
}

function boundedNumber(value, fallback, range) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const bounded = Math.min(range.max, Math.max(range.min, value));
  return range.integer ? Math.round(bounded) : bounded;
}

function isThreeDimensionalPath(path) {
  return path.startsWith("orb.");
}

function getBooleanPaths(profileId) {
  return profileId === "3d"
    ? [...COMMON_BOOLEAN_PATHS, ...THREE_D_BOOLEAN_PATHS]
    : COMMON_BOOLEAN_PATHS;
}

function supportsPath(profileId, path) {
  if (!PROFILE_IDS.includes(profileId)) return false;
  if (isThreeDimensionalPath(path) && profileId !== "3d") return false;
  return Boolean(graphFxSettingRanges[path] || getBooleanPaths(profileId).includes(path));
}

export const DEFAULT_GRAPH_FX_PROFILES = deepFreeze(cloneValue(RAW_DEFAULT_PROFILES));

export function normalizeGraphFxProfile(profileId, value) {
  const defaults = DEFAULT_GRAPH_FX_PROFILES[profileId];
  if (!defaults) return DEFAULT_GRAPH_FX_PROFILES["3d"];
  const normalized = cloneValue(defaults);

  getBooleanPaths(profileId).forEach((path) => {
    const candidate = getPathValue(value, path);
    if (typeof candidate === "boolean") setPathValue(normalized, path, candidate);
  });
  Object.entries(graphFxSettingRanges).forEach(([path, range]) => {
    if (!supportsPath(profileId, path)) return;
    setPathValue(normalized, path, boundedNumber(
      getPathValue(value, path),
      getPathValue(defaults, path),
      range,
    ));
  });

  return deepFreeze(normalized);
}

export function normalizeGraphFxProfiles(value) {
  return deepFreeze(Object.fromEntries(PROFILE_IDS.map((profileId) => [
    profileId,
    normalizeGraphFxProfile(profileId, value?.[profileId]),
  ])));
}

export function getGraphFxSettingValue(profile, path) {
  return getPathValue(profile, path);
}

export function getGraphFxSettingRange(profileId, path) {
  return supportsPath(profileId, path) ? graphFxSettingRanges[path] ?? null : null;
}

export function isGraphFxBooleanSetting(profileId, path) {
  return supportsPath(profileId, path) && getBooleanPaths(profileId).includes(path);
}

export function withGraphFxProfileSetting(profiles, profileId, path, value) {
  if (!supportsPath(profileId, path)) return normalizeGraphFxProfiles(profiles);
  const nextProfiles = cloneValue(normalizeGraphFxProfiles(profiles));
  setPathValue(nextProfiles[profileId], path, value);
  return normalizeGraphFxProfiles(nextProfiles);
}

export const graphFxProfileIds = PROFILE_IDS;
