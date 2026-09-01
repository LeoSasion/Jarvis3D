const PASS_DEFINITIONS = Object.freeze({
  bloom: Object.freeze({ id: "bloom", order: 100 }),
  toneMapping: Object.freeze({ id: "tone-mapping", order: 900 }),
});

function clamp(value, minimum, maximum) {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
}

export function createGraphicsPassRegistry({
  bloom = true,
  bloomIntensity = 0.62,
  bloomRadius,
  bloomSmoothing = 0.22,
  bloomThreshold = 0.82,
  runtime = null,
} = {}) {
  const qualityProfile = runtime?.qualityProfile;
  const forcedColors = Boolean(runtime?.forcedColors);
  const bloomLevels = Math.round(clamp(qualityProfile?.bloomLevels ?? 6, 3, 8));
  const resolvedBloomRadius = clamp(
    bloomRadius ?? qualityProfile?.bloomRadius ?? 0.88,
    0,
    1,
  );
  const passes = [
    Object.freeze({
      ...PASS_DEFINITIONS.bloom,
      enabled: Boolean(
        bloom
        && (bloom === "required" || qualityProfile?.bloom !== false)
        && !forcedColors,
      ),
      intensity: clamp(bloomIntensity, 0, 3),
      luminanceSmoothing: clamp(bloomSmoothing, 0, 1),
      luminanceThreshold: clamp(bloomThreshold, 0, 1),
      levels: bloomLevels,
      radius: resolvedBloomRadius,
    }),
    Object.freeze({
      ...PASS_DEFINITIONS.toneMapping,
      enabled: true,
    }),
  ].sort((left, right) => left.order - right.order);

  return Object.freeze({
    passes: Object.freeze(passes),
  });
}

export function getGraphicsPass(registry, passId) {
  return registry.passes.find((pass) => pass.id === passId) ?? null;
}

export const graphicsPassDefinitions = PASS_DEFINITIONS;
