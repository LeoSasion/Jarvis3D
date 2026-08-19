const listeners = new Set();

function freezeRuntimeState(value) {
  return Object.freeze({
    status: value.status,
    backend: value.backend,
    layerCount: value.layerCount,
    reason: value.reason,
  });
}

function readInitialRuntimeState() {
  if (typeof document === "undefined") {
    return freezeRuntimeState({
      status: "initializing",
      backend: "none",
      layerCount: 0,
      reason: "initializing",
    });
  }

  const documentStatus = document.documentElement.dataset.visualEffectsRuntime;
  if (documentStatus === "unavailable" || documentStatus === "faulted") {
    return freezeRuntimeState({
      status: "unavailable",
      backend: "none",
      layerCount: 0,
      reason: document.documentElement.dataset.visualEffectsRuntimeReason ?? documentStatus,
    });
  }

  return freezeRuntimeState({
    status: "initializing",
    backend: "none",
    layerCount: 0,
    reason: "initializing",
  });
}

let runtimeState = readInitialRuntimeState();

function statesMatch(left, right) {
  return left.status === right.status
    && left.backend === right.backend
    && left.layerCount === right.layerCount
    && left.reason === right.reason;
}

function applyRuntimeMetadata() {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.visualEffectsRuntime = runtimeState.status;
  document.documentElement.dataset.visualEffectsRuntimeReason = runtimeState.reason ?? "";
}

function commitRuntimeState(nextValue) {
  const next = freezeRuntimeState(nextValue);
  if (statesMatch(next, runtimeState)) return runtimeState;
  runtimeState = next;
  applyRuntimeMetadata();
  listeners.forEach((listener) => listener());
  return runtimeState;
}

export function getVisualEffectsRuntimeSnapshot() {
  return runtimeState;
}

export function subscribeVisualEffectsRuntime(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishVisualEffectsRenderPlan(plan) {
  if (plan.backend === "none") {
    return commitRuntimeState({
      status: plan.reason === "disabled" ? "off" : "bypassed",
      backend: "none",
      layerCount: 0,
      reason: plan.reason,
    });
  }

  return commitRuntimeState({
    status: "active",
    backend: plan.backend,
    layerCount: plan.layerCount,
    reason: null,
  });
}

export function markVisualEffectsRuntimeUnavailable(reason = "runtime-fault") {
  return commitRuntimeState({
    status: "unavailable",
    backend: "none",
    layerCount: 0,
    reason,
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("jarvis:visual-effects-runtime-fault", (event) => {
    markVisualEffectsRuntimeUnavailable(event.detail?.reason);
  });
}
