const QUALITY_PROFILES = Object.freeze({
  low: Object.freeze({
    id: "low",
    maxDpr: 1,
    maxRenderPixels: 2_100_000,
    bloomLevels: 5,
    bloomRadius: 0.92,
    frameSampleInterval: 6,
    slowFrameMs: 34,
    labelBudget: 12,
    edgeBudget: 4_000,
    layoutEdgeBudget: 4_500,
    layoutTickBudget: 96,
    starBudget: 180,
    bloom: false,
  }),
  balanced: Object.freeze({
    id: "balanced",
    maxDpr: 1.35,
    maxRenderPixels: 4_200_000,
    bloomLevels: 6,
    bloomRadius: 0.92,
    frameSampleInterval: 4,
    slowFrameMs: 28,
    labelBudget: 24,
    edgeBudget: 8_000,
    layoutEdgeBudget: 8_000,
    layoutTickBudget: 144,
    starBudget: 320,
    bloom: true,
  }),
  high: Object.freeze({
    id: "high",
    maxDpr: 1.6,
    maxRenderPixels: 7_500_000,
    bloomLevels: 7,
    bloomRadius: 0.92,
    frameSampleInterval: 4,
    slowFrameMs: 24,
    labelBudget: 48,
    edgeBudget: 12_000,
    layoutEdgeBudget: 12_000,
    layoutTickBudget: 180,
    starBudget: 480,
    bloom: true,
  }),
});

function readPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

const GRAPH_RELATIVE_ZOOM_MIN = 0.1;
const GRAPH_RELATIVE_ZOOM_MAX = 8;
const QUALITY_PROFILE_ORDER = Object.freeze(["low", "balanced", "high"]);
const ADAPTIVE_DPR_SCALES = Object.freeze([1, 0.9, 0.75]);

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundDown(value, decimalPlaces = 3) {
  const factor = 10 ** decimalPlaces;
  return Math.floor(value * factor) / factor;
}

export function getDowngradedGraphicsQualityProfile(
  requestedProfile,
  adaptiveTier = 0,
  forcedColors = false,
) {
  const requestedId = requestedProfile?.id in QUALITY_PROFILES
    ? requestedProfile.id
    : "balanced";
  if (forcedColors) return QUALITY_PROFILES.low;
  const requestedIndex = QUALITY_PROFILE_ORDER.indexOf(requestedId);
  const tier = clamp(Math.floor(Number(adaptiveTier) || 0), 0, QUALITY_PROFILE_ORDER.length - 1);
  return QUALITY_PROFILES[QUALITY_PROFILE_ORDER[Math.max(0, requestedIndex - tier)]];
}

export function getAdaptiveGraphicsDprScale(adaptiveTier = 0) {
  const tier = clamp(Math.floor(Number(adaptiveTier) || 0), 0, ADAPTIVE_DPR_SCALES.length - 1);
  return ADAPTIVE_DPR_SCALES[tier];
}

export function calculateEffectiveGraphicsDpr({
  width,
  height,
  devicePixelRatio,
  maxTextureSize,
  qualityProfile,
  adaptiveTier = 0,
  minimumDpr = 0,
} = {}) {
  const safeWidth = readPositiveNumber(width) ?? 1;
  const safeHeight = readPositiveNumber(height) ?? 1;
  const requestedDpr = readPositiveNumber(devicePixelRatio) ?? 1;
  const textureSize = readPositiveNumber(maxTextureSize) ?? 4_096;
  const profile = qualityProfile?.id in QUALITY_PROFILES
    ? qualityProfile
    : QUALITY_PROFILES.balanced;
  const maxDpr = readPositiveNumber(profile.maxDpr) ?? 1;
  const maxRenderPixels = readPositiveNumber(profile.maxRenderPixels)
    ?? QUALITY_PROFILES.balanced.maxRenderPixels;
  const textureBound = Math.min(textureSize / safeWidth, textureSize / safeHeight);
  const pixelBound = Math.sqrt(maxRenderPixels / (safeWidth * safeHeight));
  const adaptiveBound = maxDpr * getAdaptiveGraphicsDprScale(adaptiveTier);
  // Interactive text must not be rasterized below CSS-pixel resolution and
  // stretched back up. Device and GPU texture limits still take precedence.
  const readabilityFloor = Math.min(1, Math.max(0, Number(minimumDpr) || 0));
  return Math.max(0.01, roundDown(Math.min(
    requestedDpr,
    Math.max(readabilityFloor, adaptiveBound),
    textureBound,
    Math.max(readabilityFloor, pixelBound),
  )));
}

export function getGraphViewportScale(width, height) {
  const safeWidth = readPositiveNumber(width) ?? 960;
  const safeHeight = readPositiveNumber(height) ?? 640;
  return Math.max(1, Math.min(2, Math.min(safeWidth / 960, safeHeight / 640)));
}

export function getGraphCameraZoom(zoom, width, height) {
  const requestedZoom = readPositiveNumber(zoom) ?? 1;
  const relativeZoom = Math.max(
    GRAPH_RELATIVE_ZOOM_MIN,
    Math.min(GRAPH_RELATIVE_ZOOM_MAX, requestedZoom),
  );
  return relativeZoom * getGraphViewportScale(width, height);
}

export function selectGraphicsQualityProfile(environment = {}, requestedQuality = "auto") {
  const devicePixelRatio = readPositiveNumber(environment.devicePixelRatio) ?? 1;
  const hardwareConcurrency = readPositiveNumber(environment.hardwareConcurrency);
  const deviceMemory = readPositiveNumber(environment.deviceMemory);
  const reducedMotion = Boolean(environment.reducedMotion);
  const forcedColors = Boolean(environment.forcedColors);

  if (forcedColors || reducedMotion) {
    return QUALITY_PROFILES.low;
  }
  if (requestedQuality in QUALITY_PROFILES) {
    return QUALITY_PROFILES[requestedQuality];
  }
  if ((hardwareConcurrency !== null && hardwareConcurrency <= 4)
    || (deviceMemory !== null && deviceMemory <= 4)) {
    return QUALITY_PROFILES.low;
  }
  if ((hardwareConcurrency ?? 0) >= 12
    && (deviceMemory ?? 0) >= 8
    && devicePixelRatio <= 2) {
    return QUALITY_PROFILES.high;
  }
  return QUALITY_PROFILES.balanced;
}

export function readGraphicsEnvironment(reducedMotion = false) {
  const forcedColors = typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(forced-colors: active)").matches;
  return {
    devicePixelRatio: typeof window === "undefined" ? 1 : window.devicePixelRatio,
    hardwareConcurrency: typeof navigator === "undefined" ? undefined : navigator.hardwareConcurrency,
    deviceMemory: typeof navigator === "undefined" ? undefined : navigator.deviceMemory,
    reducedMotion,
    forcedColors,
  };
}

export const graphicsQualityProfiles = QUALITY_PROFILES;
