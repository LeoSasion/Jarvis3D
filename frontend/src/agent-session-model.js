const AGENT_STATUSES = new Set([
  "unavailable",
  "starting",
  "ready",
  "running",
  "error",
]);

const MESSAGE_ROLES = new Set(["user", "assistant", "system", "tool"]);
const MESSAGE_STATUSES = new Set([
  "pending",
  "streaming",
  "complete",
  "completed",
  "aborted",
  "cancelled",
  "error",
  "failed",
]);
const AGENT_EVENT_KINDS = new Set([
  "message",
  "text-delta",
  "message-complete",
  "run-start",
  "run-end",
  "session-reset",
  "tool",
]);

export const AGENT_CAPABILITIES = Object.freeze({
  chat: "chat",
  streaming: "streaming",
  messageHistory: "message-history",
  abort: "abort",
  newSession: "new-session",
});

const LEGACY_AGENT_CAPABILITIES = Object.freeze(
  Object.values(AGENT_CAPABILITIES),
);
const PROVIDER_HEALTH_STATUSES = new Set([
  "unavailable",
  "degraded",
  "busy",
  "connected",
  "ready",
]);
const CAPABILITY_PATTERN = /^[a-z0-9][a-z0-9.-]{0,47}$/u;

export const DEFAULT_AGENT_STATE = Object.freeze({
  available: false,
  configured: false,
  connected: false,
  status: "unavailable",
  provider: null,
  providerId: null,
  providerLabel: null,
  capabilities: LEGACY_AGENT_CAPABILITIES,
  health: Object.freeze({
    status: "unavailable",
    healthy: false,
    detail: null,
  }),
  model: null,
  sessionId: null,
  permissionMode: "chat-only",
  error: null,
  activeRunId: null,
});

function read(raw, camelName, pascalName) {
  return raw?.[camelName] ?? raw?.[pascalName];
}

function has(raw, camelName, pascalName) {
  return Object.hasOwn(raw ?? {}, camelName) || Object.hasOwn(raw ?? {}, pascalName);
}

function nullableText(value) {
  return value === undefined || value === null || value === "" ? null : String(value);
}

function boundedText(value, maximumLength) {
  const text = nullableText(value)?.replace(/[\u0000-\u001f\u007f]+/gu, " ").trim();
  return text ? text.slice(0, maximumLength) : null;
}

function providerIdentifier(value) {
  const identifier = boundedText(value, 32)?.toLowerCase();
  return identifier && /^[a-z0-9][a-z0-9.-]{0,31}$/u.test(identifier)
    ? identifier
    : null;
}

function errorText(value) {
  if (value === undefined || value === null || value === "") return null;
  return String(value?.message ?? value?.Message ?? value);
}

function normalizeAgentError(value) {
  const message = errorText(value);
  if (!message) return null;
  const rawCode = value?.code ?? value?.Code;
  const rawRetryable = value?.retryable ?? value?.Retryable;
  return {
    code: rawCode === undefined || rawCode === null || rawCode === ""
      ? "AGENT_ERROR"
      : String(rawCode),
    message,
    retryable: Boolean(rawRetryable),
  };
}

function normalizeMessageStatus(value, fallback = "complete") {
  const status = nullableText(value)?.toLowerCase();
  return MESSAGE_STATUSES.has(status) ? status : fallback;
}

function normalizeAgentCapabilities(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const normalized = [];
  for (const capability of value) {
    const name = nullableText(capability)?.trim().toLowerCase();
    if (!name || !CAPABILITY_PATTERN.test(name) || normalized.includes(name)) continue;
    normalized.push(name);
    if (normalized.length === 32) break;
  }
  return normalized;
}

function deriveAgentHealth({ available, configured, connected, status, error }) {
  const healthStatus = !available || !configured
    ? "unavailable"
    : error
      ? "degraded"
      : status === "running" || status === "starting"
        ? "busy"
        : connected
          ? "connected"
          : "ready";
  return {
    status: healthStatus,
    healthy: Boolean(available && configured && !error),
    detail: error?.code ?? null,
  };
}

function normalizeAgentHealth(rawHealth, state, fallback) {
  if (!rawHealth || typeof rawHealth !== "object" || Array.isArray(rawHealth)) {
    return fallback ?? deriveAgentHealth(state);
  }
  const reportedStatus = nullableText(read(rawHealth, "status", "Status"))?.toLowerCase();
  return {
    status: PROVIDER_HEALTH_STATUSES.has(reportedStatus)
      ? reportedStatus
      : deriveAgentHealth(state).status,
    healthy: has(rawHealth, "healthy", "Healthy")
      ? Boolean(read(rawHealth, "healthy", "Healthy"))
      : deriveAgentHealth(state).healthy,
    detail: boundedText(read(rawHealth, "detail", "Detail"), 160),
  };
}

function withDerivedAgentHealth(state) {
  return { ...state, health: deriveAgentHealth(state) };
}

export function agentSupportsCapability(state, capability) {
  const normalized = nullableText(capability)?.trim().toLowerCase();
  return Boolean(normalized && state?.capabilities?.includes(normalized));
}

export function canUseAgentChat(state) {
  return Boolean(
    state?.available
    && state?.configured !== false
    && agentSupportsCapability(state, AGENT_CAPABILITIES.chat),
  );
}

export function createAgentCapabilityError(capability) {
  const error = new Error(`The active Agent Provider does not support ${capability}.`);
  error.code = "CAPABILITY_UNAVAILABLE";
  error.retryable = false;
  return error;
}

export function normalizeAgentState(rawState = {}, fallback = DEFAULT_AGENT_STATE) {
  const reportedStatus = nullableText(read(rawState, "status", "Status"))?.toLowerCase();
  const status = AGENT_STATUSES.has(reportedStatus) ? reportedStatus : fallback.status;
  const permissionMode = nullableText(
    read(rawState, "permissionMode", "PermissionMode"),
  );
  const available = has(rawState, "available", "Available")
      ? Boolean(read(rawState, "available", "Available"))
      : fallback.available;
  const configured = has(rawState, "configured", "Configured")
      ? Boolean(read(rawState, "configured", "Configured"))
      : has(rawState, "available", "Available")
        ? Boolean(read(rawState, "available", "Available"))
        : fallback.configured;
  const connected = has(rawState, "connected", "Connected")
      ? Boolean(read(rawState, "connected", "Connected"))
      : fallback.connected;
  const error = has(rawState, "error", "Error")
    ? normalizeAgentError(read(rawState, "error", "Error"))
    : fallback.error;
  const provider = has(rawState, "provider", "Provider")
    ? boundedText(read(rawState, "provider", "Provider"), 64)
    : fallback.provider;
  const providerId = has(rawState, "providerId", "ProviderId")
    ? providerIdentifier(read(rawState, "providerId", "ProviderId"))
    : providerIdentifier(provider) ?? fallback.providerId;
  const providerLabel = has(rawState, "providerLabel", "ProviderLabel")
    ? boundedText(read(rawState, "providerLabel", "ProviderLabel"), 64)
    : fallback.providerLabel;
  const hasModernProviderContract = has(rawState, "providerId", "ProviderId")
    || has(rawState, "providerLabel", "ProviderLabel")
    || has(rawState, "health", "Health")
    || has(rawState, "capabilities", "Capabilities");
  const capabilityFallback = fallback !== DEFAULT_AGENT_STATE
    ? fallback.capabilities
    : hasModernProviderContract
      ? []
      : LEGACY_AGENT_CAPABILITIES;
  const capabilities = has(rawState, "capabilities", "Capabilities")
    ? normalizeAgentCapabilities(
      read(rawState, "capabilities", "Capabilities"),
      [],
    )
    : capabilityFallback;
  const stateWithoutHealth = {
    available,
    configured,
    connected,
    status,
    error,
  };

  return {
    available,
    configured,
    connected,
    status,
    provider,
    providerId,
    providerLabel,
    capabilities,
    health: has(rawState, "health", "Health")
      ? normalizeAgentHealth(
        read(rawState, "health", "Health"),
        stateWithoutHealth,
        null,
      )
      : normalizeAgentHealth(
        null,
        stateWithoutHealth,
        fallback === DEFAULT_AGENT_STATE ? null : fallback.health,
      ),
    model: has(rawState, "model", "Model")
      ? nullableText(read(rawState, "model", "Model"))
      : fallback.model,
    sessionId: has(rawState, "sessionId", "SessionId")
      ? nullableText(read(rawState, "sessionId", "SessionId"))
      : fallback.sessionId,
    permissionMode: permissionMode === "chat-only" ? permissionMode : "chat-only",
    error,
    activeRunId: has(rawState, "activeRunId", "ActiveRunId")
      ? nullableText(read(rawState, "activeRunId", "ActiveRunId"))
      : fallback.activeRunId,
  };
}

export function normalizeAgentMessage(rawMessage = {}, fallbackId = null) {
  const id = nullableText(read(rawMessage, "id", "Id")) ?? fallbackId;
  if (!id) return null;

  const reportedRole = nullableText(read(rawMessage, "role", "Role"))?.toLowerCase();
  const role = MESSAGE_ROLES.has(reportedRole) ? reportedRole : "assistant";
  return {
    id,
    role,
    text: String(read(rawMessage, "text", "Text") ?? ""),
    status: normalizeMessageStatus(
      read(rawMessage, "status", "Status"),
      "complete",
    ),
    createdAt: nullableText(read(rawMessage, "createdAt", "CreatedAt")),
    clientMessageId: nullableText(
      read(rawMessage, "clientMessageId", "ClientMessageId"),
    ),
    runId: nullableText(read(rawMessage, "runId", "RunId")),
  };
}

export function normalizeAgentEvent(rawEvent = {}) {
  const kind = nullableText(read(rawEvent, "kind", "Kind"))?.toLowerCase();
  if (!AGENT_EVENT_KINDS.has(kind)) return null;

  if (kind === "message") {
    const message = normalizeAgentMessage(read(rawEvent, "message", "Message"));
    if (!message) return null;
    const runId = nullableText(read(rawEvent, "runId", "RunId"));
    return {
      kind,
      message: runId && !message.runId ? { ...message, runId } : message,
    };
  }

  if (kind === "text-delta") {
    const messageId = nullableText(read(rawEvent, "messageId", "MessageId"));
    const delta = read(rawEvent, "delta", "Delta");
    return messageId && delta !== undefined && delta !== null
      ? {
        kind,
        messageId,
        delta: String(delta),
        runId: nullableText(read(rawEvent, "runId", "RunId")),
      }
      : null;
  }

  if (kind === "message-complete") {
    const messageId = nullableText(read(rawEvent, "messageId", "MessageId"));
    return messageId
      ? {
        kind,
        messageId,
        runId: nullableText(read(rawEvent, "runId", "RunId")),
        status: normalizeMessageStatus(
          read(rawEvent, "status", "Status"),
          "complete",
        ),
      }
      : null;
  }

  if (kind === "run-start") {
    const runId = nullableText(read(rawEvent, "runId", "RunId"));
    return runId ? { kind, runId } : null;
  }

  if (kind === "run-end") {
    const runId = nullableText(read(rawEvent, "runId", "RunId"));
    const error = normalizeAgentError(read(rawEvent, "error", "Error"));
    return runId
      ? {
        kind,
        runId,
        status: normalizeMessageStatus(
          read(rawEvent, "status", "Status"),
          "complete",
        ),
        error,
      }
      : null;
  }

  if (kind === "session-reset") {
    return { kind };
  }

  const toolCallId = nullableText(read(rawEvent, "toolCallId", "ToolCallId"));
  const name = nullableText(read(rawEvent, "name", "Name"));
  const status = nullableText(read(rawEvent, "status", "Status"));
  return toolCallId && name && status
    ? {
      kind,
      toolCallId,
      name,
      status,
      detail: nullableText(read(rawEvent, "detail", "Detail")),
    }
    : null;
}

export function createAgentSessionModel(rawState = {}, rawMessages = []) {
  return {
    state: normalizeAgentState(rawState),
    messages: (Array.isArray(rawMessages) ? rawMessages : [])
      .map((message) => normalizeAgentMessage(message))
      .filter(Boolean),
    tools: [],
    historyError: null,
    sessionTransitioning: false,
  };
}

function upsertMessage(messages, message) {
  const index = messages.findIndex((candidate) => candidate.id === message.id);
  if (index < 0) return [...messages, message];
  return messages.with(index, { ...messages[index], ...message });
}

function mergeMessages(hydratedMessages, liveMessages) {
  return liveMessages.reduce(
    (messages, message) => upsertMessage(messages, message),
    hydratedMessages,
  );
}

function applyAgentEvent(model, rawEvent) {
  const event = normalizeAgentEvent(rawEvent);
  if (!event) return model;

  if (event.kind === "message") {
    return { ...model, messages: upsertMessage(model.messages, event.message) };
  }

  if (event.kind === "text-delta") {
    const existing = model.messages.find((message) => message.id === event.messageId);
    const message = existing
      ? {
        ...existing,
        text: `${existing.text}${event.delta}`,
        status: "streaming",
        runId: existing.runId ?? event.runId,
      }
      : {
        id: event.messageId,
        role: "assistant",
        text: event.delta,
        status: "streaming",
        createdAt: null,
        clientMessageId: null,
        runId: event.runId,
      };
    return { ...model, messages: upsertMessage(model.messages, message) };
  }

  if (event.kind === "message-complete") {
    const existing = model.messages.find((message) => message.id === event.messageId);
    if (!existing) return model;
    return {
      ...model,
      messages: upsertMessage(model.messages, {
        ...existing,
        status: event.status,
        runId: existing.runId ?? event.runId,
      }),
    };
  }

  if (event.kind === "run-start") {
    return {
      ...model,
      state: withDerivedAgentHealth({
        ...model.state,
        available: true,
        connected: true,
        status: "running",
        activeRunId: event.runId,
        error: null,
      }),
    };
  }

  if (event.kind === "run-end") {
    const failed = ["error", "failed"].includes(event.status) || Boolean(event.error);
    return {
      ...model,
      state: withDerivedAgentHealth({
        ...model.state,
        status: failed ? "error" : "ready",
        activeRunId: null,
        error: event.error,
      }),
    };
  }

  if (event.kind === "session-reset") {
    return {
      ...model,
      messages: [],
      tools: [],
      state: withDerivedAgentHealth({
        ...model.state,
        connected: false,
        sessionId: null,
        activeRunId: null,
      }),
    };
  }

  const index = model.tools.findIndex((tool) => tool.toolCallId === event.toolCallId);
  const tools = index < 0
    ? [...model.tools, event]
    : model.tools.with(index, { ...model.tools[index], ...event });
  return { ...model, tools };
}

function reduceAgentSessionAction(current, action) {
  switch (action?.type) {
    case "hydrate": {
      const hydrated = createAgentSessionModel(action.state, action.messages);
      const messages = action.messageMode === "preserve"
        ? current.messages
        : action.messageMode === "merge"
          ? mergeMessages(hydrated.messages, current.messages)
          : hydrated.messages;
      return {
        ...current,
        state: action.preserveState ? current.state : hydrated.state,
        messages,
        historyError: errorText(action.historyError),
      };
    }
    case "state-changed":
      return {
        ...current,
        state: normalizeAgentState(action.state, current.state),
      };
    case "event":
      return applyAgentEvent(current, action.event);
    case "reset":
      return createAgentSessionModel(action.state, []);
    case "session-transition-start":
      return { ...current, sessionTransitioning: true };
    case "session-transition-complete": {
      let next = createAgentSessionModel(action.state, []);
      for (const bufferedAction of action.actions ?? []) {
        next = reduceAgentSessionAction(next, bufferedAction);
      }
      return { ...next, sessionTransitioning: false };
    }
    case "session-transition-failed": {
      let next = { ...current, sessionTransitioning: false };
      for (const bufferedAction of action.actions ?? []) {
        next = reduceAgentSessionAction(next, bufferedAction);
      }
      return reduceAgentSessionAction(next, {
        type: "error",
        error: action.error,
      });
    }
    case "history-error":
      return {
        ...current,
        historyError: errorText(action.error) ?? "Conversation history is temporarily unavailable.",
      };
    case "error":
      return {
        ...current,
        state: withDerivedAgentHealth({
          ...current.state,
          status: "error",
          activeRunId: null,
          error: normalizeAgentError(action.error) ?? {
            code: "AGENT_ERROR",
            message: "Agent request failed.",
            retryable: false,
          },
        }),
      };
    default:
      return current;
  }
}

export function agentSessionReducer(model, action) {
  return reduceAgentSessionAction(
    model ?? createAgentSessionModel(),
    action,
  );
}

export function getAgentTranscriptAnnouncement(previousStatuses, messages) {
  const nextStatuses = new Map();
  let announcement = null;

  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message?.id) continue;
    const id = String(message.id);
    const status = normalizeMessageStatus(message.status, "complete");
    const previousStatus = previousStatuses?.get(id);
    nextStatuses.set(id, status);
    if (
      message.role === "assistant" &&
      ["complete", "completed"].includes(status) &&
      previousStatus !== undefined &&
      !["complete", "completed"].includes(previousStatus)
    ) {
      announcement = {
        id,
        text: "Agent response complete.",
      };
    }
  }

  return { nextStatuses, announcement };
}
