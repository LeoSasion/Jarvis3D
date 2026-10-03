import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer } from "react";
import {
  WORKSPACE_LAYOUT_STORAGE_KEY,
  createWorkspaceWindowState,
  getWorkspaceTaskbarWindows,
  serializeWorkspaceLayout,
  workspaceWindowReducer,
} from "../workspace-window-state.js";
import { publishWorkspaceRuntime } from "../workspace-runtime-channel.js";

function readPersistedLayout() {
  try {
    return JSON.parse(window.localStorage.getItem(WORKSPACE_LAYOUT_STORAGE_KEY) ?? "null");
  } catch {
    return null;
  }
}

function readRootPixelToken(name, fallback) {
  const value = Number.parseFloat(
    window.getComputedStyle(document.documentElement).getPropertyValue(name),
  );
  return Number.isFinite(value) ? value : fallback;
}

function getViewport() {
  return {
    width: document.documentElement.clientWidth || window.innerWidth,
    height: document.documentElement.clientHeight || window.innerHeight,
    top: readRootPixelToken("--top-height", 48),
    right: 0,
    bottom: readRootPixelToken("--taskbar-height", 56),
    left: 0,
  };
}

function measureKnowledgeHandoff() {
  const workspace = document.querySelector(".desktop-workspace");
  const source = workspace?.querySelector(".knowledge-browser");
  if (!source || source.getClientRects().length === 0) return null;

  const sourceRight = source.getBoundingClientRect().right;
  const rightPanels = [
    workspace.querySelector(".desktop-tool-rail"),
    workspace.querySelector(".telemetry-rail:not([hidden])"),
    workspace.querySelector(".graph-visual-settings.is-overlay"),
  ];
  const rightBoundary = rightPanels.reduce((left, panel) => {
    if (!panel || panel.getClientRects().length === 0) return left;
    return Math.min(left, panel.getBoundingClientRect().left);
  }, document.documentElement.clientWidth || window.innerWidth);

  return { sourceRight, rightBoundary };
}

export function useWorkspaceManager() {
  const [state, dispatch] = useReducer(
    workspaceWindowReducer,
    null,
    () => createWorkspaceWindowState(getViewport(), readPersistedLayout()),
  );

  const serializedLayout = useMemo(
    () => JSON.stringify(serializeWorkspaceLayout(state)),
    [state],
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(
        WORKSPACE_LAYOUT_STORAGE_KEY,
        serializedLayout,
      );
    } catch {
      // Private browsing or a full storage quota must not disable window management.
    }
  }, [serializedLayout]);

  useEffect(() => {
    let frame = 0;
    const reflow = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        dispatch({ type: "REFLOW", viewport: getViewport(), knowledgeHandoff: measureKnowledgeHandoff() });
      });
    };
    reflow();
    window.addEventListener("resize", reflow);
    const workspace = document.querySelector(".desktop-workspace");
    const panelObserver = workspace ? new MutationObserver(reflow) : null;
    panelObserver?.observe(workspace, { attributes: true, attributeFilter: ["data-side-panel"] });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", reflow);
      panelObserver?.disconnect();
    };
  }, []);

  // Opening Agent changes the desktop layout itself; measure the source and
  // right rail again after that layout has been committed.
  useLayoutEffect(() => {
    if (!state.windows.agent.open || !state.windows.agent.knowledgePlaced) return;
    dispatch({ type: "REFLOW", viewport: getViewport(), knowledgeHandoff: measureKnowledgeHandoff() });
  }, [state.windows.agent.open, state.windows.agent.knowledgePlaced]);

  const open = useCallback((id) => dispatch({ type: "OPEN", id }), []);
  const openFromKnowledge = useCallback(() => dispatch({
    type: "OPEN_FROM_KNOWLEDGE",
    knowledgeHandoff: measureKnowledgeHandoff(),
  }), []);
  const arrangeWithKnowledge = useCallback(() => dispatch({
    type: "ARRANGE_WITH_KNOWLEDGE",
    knowledgeHandoff: measureKnowledgeHandoff(),
  }), []);
  const close = useCallback((id) => dispatch({ type: "CLOSE", id }), []);
  const activate = useCallback((id) => dispatch({ type: "ACTIVATE", id }), []);
  const minimize = useCallback((id) => dispatch({ type: "MINIMIZE", id }), []);
  const restore = useCallback((id) => dispatch({ type: "RESTORE", id }), []);
  const toggleMaximize = useCallback((id) => dispatch({ type: "TOGGLE_MAXIMIZE", id }), []);
  const toggleFromTaskbar = useCallback((id) => dispatch({ type: "TASKBAR_TOGGLE", id }), []);
  const commitBounds = useCallback((id, bounds) => {
    dispatch({ type: "COMMIT_BOUNDS", id, bounds });
  }, []);
  const resetLayout = useCallback(() => dispatch({ type: "RESET_LAYOUT" }), []);
  const cycle = useCallback((direction) => {
    dispatch({ type: "CYCLE", direction });
  }, []);
  const taskbarWindows = useMemo(() => getWorkspaceTaskbarWindows(state), [state]);

  useEffect(() => {
    publishWorkspaceRuntime(taskbarWindows);
  }, [taskbarWindows]);

  return {
    state,
    taskbarWindows,
    open,
    openFromKnowledge,
    arrangeWithKnowledge,
    close,
    activate,
    minimize,
    restore,
    toggleMaximize,
    toggleFromTaskbar,
    commitBounds,
    resetLayout,
    cycle,
  };
}
