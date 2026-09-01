import { useCallback, useEffect, useRef, useState } from "react";
import { platform } from "../platform/index.js";
import { loadDefaultKnowledgeGraph } from "./default-knowledge-graph-loader.js";

const GRAPH_REFRESH_INTERVAL_MS = 5_000;
const GRAPH_EVENT_DEBOUNCE_MS = 240;
const INITIAL_STATE = Object.freeze({
  status: "loading",
  graph: null,
  error: null,
  refreshing: false,
  lastUpdatedAt: null,
});

function createRefreshOutcome({ canceled = false, error = null, graph = null, ok }) {
  return Object.freeze({ canceled, error, graph, ok });
}

export function useDefaultKnowledgeGraph() {
  const [state, setState] = useState(INITIAL_STATE);
  const mountedRef = useRef(false);
  const requestSequenceRef = useRef(0);
  const inFlightRef = useRef(null);
  const abortControllerRef = useRef(null);
  const graphRef = useRef(null);

  const refresh = useCallback((options = {}) => {
    if (inFlightRef.current && options.force !== true) return inFlightRef.current;
    if (options.force === true) abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const sequence = ++requestSequenceRef.current;
    setState((current) => ({
      ...current,
      status: current.graph ? current.status : "loading",
      refreshing: Boolean(current.graph),
      error: options.preserveError ? current.error : null,
    }));

    const request = loadDefaultKnowledgeGraph(platform, {
      previousGraph: graphRef.current,
      forceRefresh: options.rescan === true,
      signal: abortController.signal,
    })
      .then((graph) => {
        if (!mountedRef.current || sequence !== requestSequenceRef.current) {
          return createRefreshOutcome({ canceled: true, graph, ok: false });
        }
        graphRef.current = graph.available ? graph : null;
        setState(graph.available
          ? {
              status: "ready",
              graph,
              error: null,
              refreshing: false,
              lastUpdatedAt: graph.source?.updatedAtUtc ?? new Date().toISOString(),
            }
          : {
              status: "unavailable",
              graph: null,
              error: null,
              refreshing: false,
              lastUpdatedAt: graph.source?.updatedAtUtc ?? new Date().toISOString(),
            });
        return createRefreshOutcome({ graph, ok: true });
      })
      .catch((error) => {
        if (error?.name === "AbortError" || error?.code === "ABORTED") {
          return createRefreshOutcome({ canceled: true, error, ok: false });
        }
        if (!mountedRef.current || sequence !== requestSequenceRef.current) {
          return createRefreshOutcome({ canceled: true, error, ok: false });
        }
        setState((current) => ({
          ...current,
          status: current.graph ? "ready" : "error",
          error,
          refreshing: false,
        }));
        return createRefreshOutcome({ error, ok: false });
      })
      .finally(() => {
        if (inFlightRef.current === request) inFlightRef.current = null;
        if (abortControllerRef.current === abortController) abortControllerRef.current = null;
      });
    inFlightRef.current = request;
    return request;
  }, []);

  const chooseVault = useCallback(async () => {
    if (typeof platform.knowledgeGraph?.chooseVault !== "function") {
      return createRefreshOutcome({ canceled: true, ok: false });
    }
    const result = await platform.knowledgeGraph.chooseVault();
    if (result?.canceled ?? result?.Canceled ?? result?.cancelled ?? result?.Cancelled) {
      return createRefreshOutcome({ canceled: true, ok: false });
    }
    const refreshOutcome = await refresh({ force: true });
    if (!refreshOutcome.ok) return refreshOutcome;
    return Object.freeze({ ...refreshOutcome, value: result });
  }, [refresh]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh({ force: true });
    let eventTimer = 0;
    let pollTimer = 0;
    const schedulePoll = () => {
      window.clearTimeout(pollTimer);
      if (document.visibilityState === "hidden") return;
      pollTimer = window.setTimeout(async () => {
        await refresh();
        schedulePoll();
      }, GRAPH_REFRESH_INTERVAL_MS);
    };
    const handleGraphChanged = () => {
      window.clearTimeout(eventTimer);
      eventTimer = window.setTimeout(() => void refresh({ force: true }), GRAPH_EVENT_DEBOUNCE_MS);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void refresh();
        schedulePoll();
      } else {
        window.clearTimeout(pollTimer);
      }
    };
    const unsubscribe = platform.events?.subscribe?.("knowledgeGraph.changed", handleGraphChanged);
    document.addEventListener("visibilitychange", handleVisibility);
    schedulePoll();
    return () => {
      mountedRef.current = false;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      graphRef.current = null;
      requestSequenceRef.current += 1;
      window.clearTimeout(eventTimer);
      window.clearTimeout(pollTimer);
      unsubscribe?.();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refresh]);

  return {
    ...state,
    refresh,
    chooseVault,
    canChooseVault: typeof platform.knowledgeGraph?.chooseVault === "function",
  };
}

export const defaultKnowledgeGraphRefreshPolicy = Object.freeze({
  intervalMs: GRAPH_REFRESH_INTERVAL_MS,
  eventDebounceMs: GRAPH_EVENT_DEBOUNCE_MS,
});
