const DEFAULT_ADAPTIVE_POLICY = Object.freeze({
  contextLossCooldownMs: 60_000,
  downgradeCooldownMs: 15_000,
  maxTier: 2,
  slowFrameLimit: 4,
  slowFrameMs: 28,
});

function readFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizePolicy(policy = {}) {
  return {
    contextLossCooldownMs: Math.max(
      0,
      readFiniteNumber(policy.contextLossCooldownMs, DEFAULT_ADAPTIVE_POLICY.contextLossCooldownMs),
    ),
    downgradeCooldownMs: Math.max(
      0,
      readFiniteNumber(policy.downgradeCooldownMs, DEFAULT_ADAPTIVE_POLICY.downgradeCooldownMs),
    ),
    maxTier: Math.max(0, Math.floor(readFiniteNumber(
      policy.maxTier,
      DEFAULT_ADAPTIVE_POLICY.maxTier,
    ))),
    slowFrameLimit: Math.max(1, Math.floor(readFiniteNumber(
      policy.slowFrameLimit,
      DEFAULT_ADAPTIVE_POLICY.slowFrameLimit,
    ))),
    slowFrameMs: Math.max(
      1,
      readFiniteNumber(policy.slowFrameMs, DEFAULT_ADAPTIVE_POLICY.slowFrameMs),
    ),
  };
}

export function createAdaptivePerformanceState(initial = {}) {
  return Object.freeze({
    adaptiveTier: Math.max(0, Math.floor(readFiniteNumber(initial.adaptiveTier, 0))),
    consecutiveSlowFrames: 0,
    contextLossCount: Math.max(0, Math.floor(readFiniteNumber(initial.contextLossCount, 0))),
    cooldownUntil: Math.max(0, readFiniteNumber(initial.cooldownUntil, 0)),
    lastContextLossAt: Math.max(0, readFiniteNumber(initial.lastContextLossAt, 0)),
  });
}

export function reduceAdaptivePerformanceState(state, event, policyOverrides = {}) {
  const current = state ?? createAdaptivePerformanceState();
  const policy = normalizePolicy(policyOverrides);
  const now = Math.max(0, readFiniteNumber(event?.now, 0));

  if (event?.type === "context-lost") {
    return Object.freeze({
      ...current,
      adaptiveTier: Math.min(policy.maxTier, current.adaptiveTier + 1),
      consecutiveSlowFrames: 0,
      contextLossCount: current.contextLossCount + 1,
      cooldownUntil: Math.max(current.cooldownUntil, now + policy.contextLossCooldownMs),
      lastContextLossAt: now,
    });
  }

  if (event?.type !== "frame-sample") return current;
  const durationMs = Math.max(0, readFiniteNumber(event.durationMs, 0));
  if (durationMs <= policy.slowFrameMs) {
    if (current.consecutiveSlowFrames === 0) return current;
    return Object.freeze({ ...current, consecutiveSlowFrames: 0 });
  }

  const consecutiveSlowFrames = current.consecutiveSlowFrames + 1;
  const canDowngrade = consecutiveSlowFrames >= policy.slowFrameLimit
    && now >= current.cooldownUntil
    && current.adaptiveTier < policy.maxTier;
  if (!canDowngrade) {
    return Object.freeze({ ...current, consecutiveSlowFrames });
  }

  return Object.freeze({
    ...current,
    adaptiveTier: current.adaptiveTier + 1,
    consecutiveSlowFrames: 0,
    cooldownUntil: now + policy.downgradeCooldownMs,
  });
}

export const adaptivePerformancePolicy = DEFAULT_ADAPTIVE_POLICY;
