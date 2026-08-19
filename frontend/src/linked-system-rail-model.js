import { hasAgentProviderFault } from "./agent-provider-model.js";

const ATTENTION_SEVERITIES = new Set(["warning", "error"]);
const AGENT_ATTENTION_HEALTH_STATUSES = new Set(["degraded", "unavailable"]);

function stableText(value) {
  if (value instanceof Error) return value.message || value.name;
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function attentionKey(entry) {
  return [
    entry.source,
    entry.id,
    entry.severity,
    entry.timestamp,
    entry.title,
  ].map(stableText).join("|");
}

function normalizeFeedAttentionItem(item, index) {
  const severity = stableText(item?.severity).toLowerCase();
  if (!ATTENTION_SEVERITIES.has(severity)) return null;

  const entry = {
    source: "feed",
    id: stableText(item?.id) || `feed-${index}`,
    severity,
    title: stableText(item?.title) || "SYSTEM EVENT",
    detail: stableText(item?.detail),
    timestamp: stableText(item?.timestamp),
    item,
  };
  return { ...entry, key: attentionKey(entry) };
}

function agentAttentionDetail(agentState) {
  const error = stableText(agentState?.error?.message ?? agentState?.error);
  if (error) return error;

  const healthDetail = stableText(agentState?.health?.detail);
  if (healthDetail) return healthDetail;

  const healthStatus = stableText(agentState?.health?.status).toLowerCase();
  if (AGENT_ATTENTION_HEALTH_STATUSES.has(healthStatus)) {
    return `Agent provider health is ${healthStatus}.`;
  }
  if (agentState?.health?.healthy === false) {
    return "Agent provider health check failed.";
  }
  return "Agent provider reported an error.";
}

export function isLinkedAgentAttention(agentState = {}) {
  return hasAgentProviderFault(agentState);
}

export function getLinkedAgentStatusPresentation(agentState = {}, chatAvailable = false) {
  const hasAttention = isLinkedAgentAttention(agentState);
  const status = stableText(agentState?.status).toLowerCase();
  const agentLabel = hasAttention
    ? "ATTENTION"
    : agentState?.available === false
      ? "OFFLINE"
      : status === "running" || status === "starting"
        ? "ACTIVE"
        : agentState?.connected
          ? "CONNECTED"
          : "READY";

  return {
    hasAttention,
    agentLabel,
    commandBusLabel: hasAttention
      ? chatAvailable ? "RETRY" : "DEGRADED"
      : chatAvailable ? "READY" : "CHAT UNAVAILABLE",
    dataAccessLabel: hasAttention
      ? "DEGRADED"
      : chatAvailable ? "CHAT ONLY" : "STATUS ONLY",
  };
}

function connectionAttention(agentState) {
  if (!isLinkedAgentAttention(agentState)) return null;

  const entry = {
    source: "agent",
    id: "agent-status",
    severity: "error",
    title: "AGENT CONNECTION NEEDS ATTENTION",
    detail: agentAttentionDetail(agentState),
    timestamp: stableText(agentState?.updatedAt ?? agentState?.timestamp),
    item: null,
  };
  return { ...entry, key: attentionKey(entry) };
}

function feedConnectionAttention(feed) {
  const detail = stableText(feed?.error);
  if (!detail) return null;

  const entry = {
    source: "telemetry",
    id: "system-feed",
    severity: "error",
    title: "SYSTEM FEED UNAVAILABLE",
    detail,
    timestamp: "",
    item: null,
  };
  return { ...entry, key: attentionKey(entry) };
}

function prioritizeAttention(entries) {
  return entries.find((entry) => entry.severity === "error") ?? entries[0] ?? null;
}

export function getLinkedSystemRailPresentation({ feed = {}, agentState = {} } = {}) {
  const feedItems = Array.isArray(feed.items) ? feed.items : [];
  const attention = feedItems
    .map(normalizeFeedAttentionItem)
    .filter(Boolean);
  const feedConnection = feedConnectionAttention(feed);
  const agentConnection = connectionAttention(agentState);
  if (feedConnection) attention.push(feedConnection);
  if (agentConnection) attention.push(agentConnection);

  const priority = prioritizeAttention(attention);
  const level = attention.some((entry) => entry.severity === "error")
    ? "error"
    : attention.length > 0
      ? "warning"
      : feed.loading
        ? "syncing"
        : "nominal";

  return {
    level,
    attentionCount: attention.length,
    attentionKeys: attention.map((entry) => entry.key),
    attentionSignature: attention.map((entry) => entry.key).sort().join("\n"),
    priorityItem: priority?.item ?? null,
    priorityTitle: priority?.title ?? (feed.loading ? "STATUS SYNCHRONIZING" : "SYSTEM NOMINAL"),
    priorityDetail: priority?.detail ?? "",
  };
}

export function createLinkedSystemRailState(presentation) {
  const hasAttention = Number(presentation?.attentionCount) > 0;
  return {
    expanded: hasAttention,
    observedAttentionKeys: Array.isArray(presentation?.attentionKeys)
      ? [...presentation.attentionKeys]
      : [],
    lastChangeReason: hasAttention ? "initial-attention" : "initial-nominal",
  };
}

export function getNewLinkedSystemRailAttention(previousKeys = [], nextKeys = []) {
  const previous = new Set(Array.isArray(previousKeys) ? previousKeys : []);
  return (Array.isArray(nextKeys) ? nextKeys : []).filter((key) => !previous.has(key));
}

export function syncLinkedSystemRailState(state, presentation) {
  const nextKeys = Array.isArray(presentation?.attentionKeys)
    ? presentation.attentionKeys
    : [];
  const newAttention = getNewLinkedSystemRailAttention(
    state?.observedAttentionKeys,
    nextKeys,
  );
  return {
    ...state,
    observedAttentionKeys: [...nextKeys],
    ...(newAttention.length > 0
      ? { expanded: true, lastChangeReason: "new-attention" }
      : {}),
  };
}

export function setLinkedSystemRailExpanded(state, expanded, reason = "user") {
  return {
    ...state,
    expanded: Boolean(expanded),
    lastChangeReason: reason,
  };
}
