export function getTaskbarCooldownRemaining(retryAfterUtc, now = Date.now()) {
  const retryAfterTimestamp = retryAfterUtc
    ? Date.parse(retryAfterUtc)
    : Number.NaN;
  return Number.isFinite(retryAfterTimestamp)
    ? Math.max(0, Math.ceil((retryAfterTimestamp - now) / 1000))
    : 0;
}

export function canRetryTaskbarMode(state, busy, now = Date.now()) {
  if (busy ||
      state.safeMode ||
      state.requestedMode === state.effectiveMode) {
    return false;
  }

  return state.retryAllowed ||
    (state.transitionStatus === "cooldown" &&
      getTaskbarCooldownRemaining(state.retryAfterUtc, now) === 0);
}

export function getTaskbarTransitionToast(previous, current) {
  if (previous.status !== "applying" ||
      previous.generation !== current.transitionGeneration ||
      current.transitionStatus === "applying") {
    return null;
  }

  if (current.transitionStatus === "settled") {
    return {
      source: "taskbar",
      severity: "ok",
      kind: current.simulation ? "preview-saved" : "switched",
      mode: (current.simulation ? current.requestedMode : current.effectiveMode).toUpperCase(),
    };
  }

  if (current.transitionStatus === "cooldown") {
    return {
      source: "taskbar",
      severity: "warning",
      kind: "cooldown",
    };
  }

  return {
    source: "taskbar",
    severity: "warning",
    kind: "fallback",
    mode: current.effectiveMode.toUpperCase(),
  };
}
