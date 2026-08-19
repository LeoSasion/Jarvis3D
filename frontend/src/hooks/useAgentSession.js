import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  AGENT_CAPABILITIES,
  agentSupportsCapability,
  agentSessionReducer,
  canUseAgentChat,
  createAgentCapabilityError,
  createAgentSessionModel,
  normalizeAgentState,
} from "../agent-session-model.js";
import {
  agentContextReducer,
  createAgentContextModel,
  createAgentPromptForContext,
  getSuggestedAgentDirective,
  isAgentContextArmed,
  normalizeAgentContextItems,
} from "../agent-context-model.js";
import { createAgentSessionGate } from "../agent-session-gate.js";
import { platform } from "../platform/index.js";

function createClientMessageId() {
  return globalThis.crypto?.randomUUID?.() ??
    `agent-client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createRelationId() {
  return globalThis.crypto?.randomUUID?.() ??
    `agent-relation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readResult(result, camelName, pascalName) {
  return result?.[camelName] ?? result?.[pascalName];
}

function commandResultError(result, fallback) {
  const raw = readResult(result, "error", "Error");
  const error = new Error(raw?.message ?? raw?.Message ?? fallback);
  error.code = raw?.code ?? raw?.Code ?? "AGENT_COMMAND_REJECTED";
  error.retryable = Boolean(raw?.retryable ?? raw?.Retryable);
  return error;
}

function resultState(result) {
  const nested = readResult(result, "state", "State");
  if (nested) return nested;
  return readResult(result, "status", "Status") ? result : null;
}

export async function hydrateAgentSession(agent, gate, hydration) {
  try {
    const state = await agent.getState();
    const normalizedState = normalizeAgentState(state);
    if (!agentSupportsCapability(
      normalizedState,
      AGENT_CAPABILITIES.messageHistory,
    )) {
      gate.hydrate(hydration, state, []);
      return { state: normalizedState, messagesRequested: false };
    }

    try {
      const messages = await agent.getMessages();
      gate.hydrate(hydration, state, messages);
    } catch (error) {
      gate.hydrate(hydration, state, [], error);
    }
    return { state: normalizedState, messagesRequested: true };
  } catch (error) {
    gate.failHydration(hydration, error);
    return { state: null, messagesRequested: false, error };
  }
}

export function runAgentPrompt(agent, state, message, clientMessageId) {
  if (!agentSupportsCapability(state, AGENT_CAPABILITIES.chat)) {
    throw createAgentCapabilityError(AGENT_CAPABILITIES.chat);
  }
  return agent.prompt(message, clientMessageId);
}

export function runAgentAbort(agent, state) {
  if (!agentSupportsCapability(state, AGENT_CAPABILITIES.abort)) {
    throw createAgentCapabilityError(AGENT_CAPABILITIES.abort);
  }
  return agent.abort();
}

export async function runAgentSessionTransition(agent, gate, state = null) {
  if (state && !agentSupportsCapability(state, AGENT_CAPABILITIES.newSession)) {
    throw createAgentCapabilityError(AGENT_CAPABILITIES.newSession);
  }
  const token = gate.beginSessionTransition();
  if (token === null) {
    const error = new Error("An Agent session change is already in progress.");
    error.code = "AGENT_BUSY";
    error.retryable = true;
    throw error;
  }

  try {
    const result = await agent.newSession();
    if (readResult(result, "success", "Success") === false) {
      throw commandResultError(result, "The Agent Provider could not start a new session.");
    }
    const state = resultState(result) ?? await agent.getState();
    return {
      state,
      applied: gate.completeSessionTransition(token, state),
    };
  } catch (error) {
    gate.failSessionTransition(token, error);
    throw error;
  }
}

export function useAgentSession() {
  const [model, dispatch] = useReducer(
    agentSessionReducer,
    undefined,
    () => createAgentSessionModel(),
  );
  const [context, dispatchContext] = useReducer(
    agentContextReducer,
    undefined,
    () => createAgentContextModel(),
  );
  const [draft, setDraft] = useState("");
  const gateRef = useRef(null);
  const supportsChat = canUseAgentChat(model.state);
  const supportsAbort = agentSupportsCapability(
    model.state,
    AGENT_CAPABILITIES.abort,
  );
  const supportsNewSession = agentSupportsCapability(
    model.state,
    AGENT_CAPABILITIES.newSession,
  );

  useEffect(() => {
    const gate = createAgentSessionGate(dispatch);
    gateRef.current = gate;
    const hydration = gate.captureHydration();
    const stopState = platform.events.subscribe("agent.stateChanged", (state) => {
      gate.stateChanged(state);
    });
    const stopEvents = platform.events.subscribe("agent.event", (event) => {
      gate.event(event);
      const kind = String(readResult(event, "kind", "Kind") ?? "").toLocaleLowerCase();
      if (kind === "run-start") {
        dispatchContext({
          type: "run-start",
          runId: readResult(event, "runId", "RunId"),
        });
      } else if (kind === "run-end") {
        dispatchContext({
          type: "run-end",
          runId: readResult(event, "runId", "RunId"),
          status: readResult(event, "status", "Status"),
          error: readResult(event, "error", "Error"),
        });
      }
    });

    void hydrateAgentSession(platform.agent, gate, hydration);

    return () => {
      gate.dispose();
      if (gateRef.current === gate) gateRef.current = null;
      stopState();
      stopEvents();
    };
  }, []);

  const send = useCallback(async (message = draft) => {
    const text = String(message ?? "").trim();
    if (!text) return null;
    if (gateRef.current?.isTransitioning()) {
      throw new Error("Wait for the new Agent session to be ready.");
    }
    if (!model.state.available) {
      throw new Error("Agent runtime is not available.");
    }
    if (model.state.status !== "ready") {
      throw new Error("Agent is not ready for another message.");
    }

    const clientMessageId = createClientMessageId();
    const attachContext = isAgentContextArmed(context);
    const prompt = createAgentPromptForContext(text, context);
    if (attachContext) {
      dispatchContext({ type: "submit", clientMessageId });
    }
    try {
      const result = await runAgentPrompt(
        platform.agent,
        model.state,
        prompt,
        clientMessageId,
      );
      if (readResult(result, "accepted", "Accepted") === false) {
        throw commandResultError(result, "The Agent Provider rejected the prompt.");
      }
      if (attachContext) {
        dispatchContext({
          type: "run-start",
          runId: readResult(result, "runId", "RunId"),
        });
      }
      setDraft((current) => current.trim() === text ? "" : current);
      return result;
    } catch (error) {
      if (attachContext) dispatchContext({ type: "error", error });
      dispatch({ type: "error", error });
      throw error;
    }
  }, [context.items, draft, model.state.available, model.state.status, supportsChat]);

  const addContextItems = useCallback((entries) => {
    if (["submitting", "running"].includes(context.phase)) return context.items;
    const items = normalizeAgentContextItems(entries);
    if (items.length === 0) return items;
    dispatchContext({ type: "clear" });
    dispatchContext({
      type: "stage",
      entries: items,
      relationId: createRelationId(),
    });
    setDraft((current) => current.trim() ? current : getSuggestedAgentDirective(items));
    return items;
  }, [context.items, context.phase]);

  const clearContext = useCallback(() => {
    if (["submitting", "running"].includes(context.phase)) return false;
    dispatchContext({ type: "clear" });
    return true;
  }, [context.phase]);

  const abort = useCallback(async () => {
    try {
      const result = await runAgentAbort(platform.agent, model.state);
      if (readResult(result, "success", "Success") === false) {
        throw commandResultError(result, "The Agent Provider could not stop the active response.");
      }
      dispatchContext({ type: "aborted" });
      return result;
    } catch (error) {
      dispatch({ type: "error", error });
      throw error;
    }
  }, [model.state, supportsAbort]);

  const newSession = useCallback(async () => {
    if (!supportsNewSession) {
      throw createAgentCapabilityError(AGENT_CAPABILITIES.newSession);
    }
    const gate = gateRef.current;
    if (!gate) throw new Error("Agent session is not initialized.");
    const { state, applied } = await runAgentSessionTransition(
      platform.agent,
      gate,
      model.state,
    );
    if (applied) {
      setDraft("");
      dispatchContext({ type: "session-reset" });
    }
    return state;
  }, [model.state, supportsNewSession]);

  return {
    state: model.state,
    messages: model.messages,
    historyError: model.historyError,
    sessionTransitioning: model.sessionTransitioning,
    draft,
    setDraft,
    context,
    addContextItems,
    clearContext,
    capabilities: {
      chat: supportsChat,
      abort: supportsAbort,
      newSession: supportsNewSession,
    },
    send,
    abort,
    newSession,
  };
}
