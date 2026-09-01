const PROFILE_IDS = Object.freeze(["2d", "3d"]);

const COMMON_BOOLEAN_PATHS = Object.freeze([
  "node.core.enabled",
  "node.halo.enabled",
  "node.pulse.enabled",
  "edge.core.enabled",
  "edge.halo.enabled",
  "signal.enabled",
  "postFx.bloom.enabled",
]);

const THREE_D_BOOLEAN_PATHS = Object.freeze([
  "orb.innerNetwork.enabled",
  "orb.rim.enabled",
  "orb.sparks.enabled",
]);

export const graphFxSettingRanges = Object.freeze({
  "node.master.scale": Object.freeze({ min: 0.6, max: 1.8, step: 0.01 }),
  "node.master.opacity": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "node.size.byImportance": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "node.core.sizeScale": Object.freeze({ min: 0.6, max: 1.8, step: 0.01 }),
  "node.core.opacity": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "node.core.emissionIntensity": Object.freeze({ min: 0, max: 3, step: 0.05 }),
  "node.halo.radiusScale": Object.freeze({ min: 0.5, max: 2.5, step: 0.01 }),
  "node.halo.opacity": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "node.halo.emissionIntensity": Object.freeze({ min: 0, max: 3, step: 0.05 }),
  "node.pulse.amount": Object.freeze({ min: 0, max: 2, step: 0.01 }),
  "node.pulse.rate": Object.freeze({ min: 0.25, max: 2.5, step: 0.05 }),
  "edge.master.opacity": Object.freeze({ min: 0, max: 1, step: 0.01 }),
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
  "orb.innerNetwork.scale": Object.freeze({ min: 0.4, max: 1, step: 0.01 }),
  "orb.innerNetwork.opacity": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "orb.innerNetwork.rotationSpeed": Object.freeze({ min: -2, max: 2, step: 0.05 }),
  "orb.rim.intensity": Object.freeze({ min: 0, max: 3, step: 0.05 }),
  "orb.rim.fresnelPower": Object.freeze({ min: 1, max: 10, step: 0.1 }),
  "orb.sparks.sizeScale": Object.freeze({ min: 0.5, max: 2, step: 0.01 }),
  "orb.sparks.opacity": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "orb.sparks.emissionIntensity": Object.freeze({ min: 0, max: 3, step: 0.05 }),
  "postFx.bloom.intensity": Object.freeze({ min: 0, max: 3, step: 0.05 }),
  "postFx.bloom.threshold": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "postFx.bloom.softKnee": Object.freeze({ min: 0, max: 1, step: 0.01 }),
  "postFx.bloom.radius": Object.freeze({ min: 0, max: 1, step: 0.01 }),
});

const RAW_DEFAULT_PROFILES = {
  "2d": {
    node: {
      master: { scale: 1, opacity: 1 },
      size: { byImportance: 0.82 },
      core: { enabled: true, sizeScale: 1, opacity: 0.84, emissionIntensity: 0.84 },
      halo: { enabled: true, radiusScale: 0.82, opacity: 0.08, emissionIntensity: 0.72 },
      pulse: { enabled: true, amount: 0.45, rate: 0.8 },
    },
    edge: {
      master: { opacity: 1 },
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
      bloom: { enabled: false, intensity: 1.02, threshold: 0.28, softKnee: 0.38, radius: 0.72 },
    },
  },
  "3d": {
    node: {
      master: { scale: 1, opacity: 1 },
      size: { byImportance: 1 },
      core: { enabled: true, sizeScale: 1, opacity: 0.9, emissionIntensity: 1 },
      halo: { enabled: true, radiusScale: 1, opacity: 0.14, emissionIntensity: 1 },
      pulse: { enabled: true, amount: 1, rate: 1 },
    },
    edge: {
      master: { opacity: 1 },
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
      innerNetwork: { enabled: true, scale: 0.73, opacity: 0.2, rotationSpeed: 1 },
      rim: { enabled: true, intensity: 1, fresnelPower: 5.2 },
      sparks: { enabled: true, sizeScale: 1, opacity: 0.24, emissionIntensity: 1 },
    },
    motion: { idleRotationSpeed: 1, breathingAmount: 1, breathingRate: 1 },
    postFx: {
      bloom: { enabled: true, intensity: 1.85, threshold: 0.18, softKnee: 0.42, radius: 0.92 },
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
