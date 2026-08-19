const PROVIDER_ALIASES = Object.freeze({
  "browser-preview": "PREVIEW",
  pi: "PI",
});
const ATTENTION_HEALTH_STATUSES = new Set(["degraded", "unavailable"]);

export function hasAgentProviderFault(state = {}) {
  const status = String(state.status ?? "").trim().toLowerCase();
  const healthStatus = String(state.health?.status ?? "").trim().toLowerCase();
  return Boolean(
    state.error
    || status === "error"
    || ATTENTION_HEALTH_STATUSES.has(healthStatus)
    || state.health?.healthy === false
  );
}

export function getAgentProviderLabel(state = {}) {
  if (state.available === false) return "NO PROVIDER";
  const explicitLabel = String(state.providerLabel ?? "")
    .replace(/[^\p{L}\p{N} ._&+/-]+/gu, " ")
    .trim()
    .slice(0, 48);
  if (explicitLabel) return explicitLabel.toLocaleUpperCase();
  const provider = String(state.providerId ?? state.provider ?? "")
    .trim()
    .toLocaleLowerCase();
  if (!provider) return "PROVIDER PENDING";
  if (PROVIDER_ALIASES[provider]) return PROVIDER_ALIASES[provider];
  return provider
    .replace(/[^\p{L}\p{N}._-]+/gu, " ")
    .trim()
    .slice(0, 24)
    .toLocaleUpperCase() || "PROVIDER";
}

export function getAgentLauncherStatus(state = {}, windowState = {}) {
  if (hasAgentProviderFault(state)) return "ATTENTION";
  if (state.available === false) return "OFFLINE";
  if (state.status === "starting" || state.status === "running") return "PROCESSING";
  if (windowState.active) return "ACTIVE";
  if (windowState.open) return "READY";
  return "OPEN";
}

export function getCommandBusPresentation(state = {}) {
  const agentRunning = state.status === "running" || state.status === "starting";
  const agentFaulted = hasAgentProviderFault(state);
  return {
    localCommandLabel: "LOCAL COMMANDS READY",
    agentProviderStatus: agentFaulted
      ? "AGENT DEGRADED"
      : agentRunning
      ? "AGENT ACTIVE"
      : state.available
        ? "AGENT READY"
        : "AGENT OFFLINE",
  };
}
