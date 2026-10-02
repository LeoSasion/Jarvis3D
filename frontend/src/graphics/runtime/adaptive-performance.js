const DEFAULT_ADAPTIVE_POLICY = Object.freeze({
  contextLossCooldownMs: 60_000,
  downgradeCooldownMs: 15_000,
  maxTier: 2,
  slowFrameLimit: 4,
  slowFrameMs: 28,
  recoveryCooldownMs: 30_000,
  stableDurationMs: 20_000,
  stableSampleLimit: 120,
  maxSampleGapMs: 1_000,
  recoveryFrameRatio: 0.7,
  maxRecoveryCooldownMs: 300_000,
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
    recoveryCooldownMs: Math.max(0, readFiniteNumber(policy.recoveryCooldownMs, DEFAULT_ADAPTIVE_POLICY.recoveryCooldownMs)),
    stableDurationMs: Math.max(0, readFiniteNumber(policy.stableDurationMs, DEFAULT_ADAPTIVE_POLICY.stableDurationMs)),
    stableSampleLimit: Math.max(2, Math.floor(readFiniteNumber(policy.stableSampleLimit, DEFAULT_ADAPTIVE_POLICY.stableSampleLimit))),
    maxSampleGapMs: Math.max(1, readFiniteNumber(policy.maxSampleGapMs, DEFAULT_ADAPTIVE_POLICY.maxSampleGapMs)),
    recoveryFrameRatio: Math.min(0.9, Math.max(0.1, readFiniteNumber(policy.recoveryFrameRatio, DEFAULT_ADAPTIVE_POLICY.recoveryFrameRatio))),
    maxRecoveryCooldownMs: Math.max(0, readFiniteNumber(policy.maxRecoveryCooldownMs, DEFAULT_ADAPTIVE_POLICY.maxRecoveryCooldownMs)),
    sampleInterval: Math.max(1, Math.floor(readFiniteNumber(policy.sampleInterval, 4))),
  };
}

export function createAdaptivePerformanceState(initial = {}) {
  return Object.freeze({
    adaptiveTier: Math.max(0, Math.floor(readFiniteNumber(initial.adaptiveTier, 0))),
    consecutiveSlowFrames: 0,
    contextLossCount: Math.max(0, Math.floor(readFiniteNumber(initial.contextLossCount, 0))),
    cooldownUntil: Math.max(0, readFiniteNumber(initial.cooldownUntil, 0)),
    lastContextLossAt: Math.max(0, readFiniteNumber(initial.lastContextLossAt, 0)),
    lastChangeReason: "initial",
    lastChangeAt: 0,
    lastSampleAt: null,
    stableSince: null,
    stableSamples: 0,
    recoveryDelayMs: 0,
  });
}

export function reduceAdaptivePerformanceState(state, event, policyOverrides = {}) {
  const current = state ?? createAdaptivePerformanceState();
  const policy = normalizePolicy(policyOverrides);
  const now = Math.max(0, readFiniteNumber(event?.now, 0));

  if (event?.type === "sampling-paused") {
    return Object.freeze({ ...current, lastSampleAt: null, consecutiveSlowFrames: 0,
      stableSince: null, stableSamples: 0 });
  }

  if (event?.type === "context-lost") {
    return Object.freeze({
      ...current,
      adaptiveTier: Math.min(policy.maxTier, current.adaptiveTier + 1),
      consecutiveSlowFrames: 0,
      contextLossCount: current.contextLossCount + 1,
      cooldownUntil: Math.max(current.cooldownUntil, now + policy.contextLossCooldownMs),
      lastContextLossAt: now,
      lastChangeReason: "context-lost",
      lastChangeAt: now,
      lastSampleAt: null,
      stableSince: null,
      stableSamples: 0,
    });
  }

  if (event?.type !== "frame-sample") return current;
  const durationMs = Number(event.durationMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0) return current;
  const continuous = current.lastSampleAt !== null
    && now >= current.lastSampleAt
    && now - current.lastSampleAt <= policy.maxSampleGapMs;
  const observed = { ...current, lastSampleAt: now };
  if (durationMs <= policy.slowFrameMs) {
    const canMeasureRecovery = current.adaptiveTier > 0
      && now >= current.cooldownUntil
      && now >= current.lastChangeAt + current.recoveryDelayMs
      && durationMs <= policy.slowFrameMs * policy.recoveryFrameRatio;
    const stableSince = canMeasureRecovery
      ? continuous && current.stableSince !== null ? current.stableSince : now
      : null;
    const stableSamples = canMeasureRecovery
      ? continuous ? current.stableSamples + 1 : 1
      : 0;
    const recovered = stableSince !== null
      && stableSamples >= policy.stableSampleLimit
      && now - stableSince >= policy.stableDurationMs;
    return Object.freeze({
      ...observed,
      consecutiveSlowFrames: 0,
      stableSince: recovered ? null : stableSince,
      stableSamples: recovered ? 0 : stableSamples,
      ...(recovered ? {
        adaptiveTier: current.adaptiveTier - 1,
        cooldownUntil: now + policy.recoveryCooldownMs,
        lastChangeReason: "recovered",
        lastChangeAt: now,
      } : {}),
    });
  }

  const continuousSlowSamples = continuous || (current.lastSampleAt !== null
    && now >= current.lastSampleAt
    && now - current.lastSampleAt <= durationMs * policy.sampleInterval * 1.25);
  const consecutiveSlowFrames = Math.min(policy.slowFrameLimit, (continuousSlowSamples ? current.consecutiveSlowFrames : 0) + 1);
  // Recovery is deliberately slow, but a failed recovery must be able to shed
  // load immediately instead of remaining slow throughout the upgrade cooldown.
  const failedRecovery = current.lastChangeReason === "recovered";
  const canDowngrade = consecutiveSlowFrames >= policy.slowFrameLimit
    && (now >= current.cooldownUntil || failedRecovery)
    && current.adaptiveTier < policy.maxTier;
  if (!canDowngrade) {
    return Object.freeze({ ...observed, consecutiveSlowFrames, stableSince: null, stableSamples: 0 });
  }

  const recoveryDelayMs = Math.min(policy.maxRecoveryCooldownMs, failedRecovery
    ? Math.max(policy.recoveryCooldownMs, current.recoveryDelayMs) * 2
    : Math.max(policy.recoveryCooldownMs, current.recoveryDelayMs));
  return Object.freeze({
    ...observed,
    adaptiveTier: current.adaptiveTier + 1,
    consecutiveSlowFrames: 0,
    cooldownUntil: now + policy.downgradeCooldownMs,
    stableSince: null,
    stableSamples: 0,
    recoveryDelayMs,
    lastChangeReason: "slow-frames",
    lastChangeAt: now,
  });
}

export const adaptivePerformancePolicy = DEFAULT_ADAPTIVE_POLICY;
