const WORKSPACE_WINDOW_TITLE_KEYS = Object.freeze({
  agent: "workspaceWindow.title.agent",
  explorer: "workspaceWindow.title.explorer",
  inspector: "workspaceWindow.title.inspector",
  terminal: "workspaceWindow.title.terminal",
});

function getWorkspaceWindowId(windowLike) {
  const explicitId = windowLike?.internalWindowId;
  if (typeof explicitId === "string" && WORKSPACE_WINDOW_TITLE_KEYS[explicitId]) {
    return explicitId;
  }

  const runtimeId = typeof windowLike?.windowId === "string"
    ? windowLike.windowId
    : "";
  if (!runtimeId.startsWith("jarvis:")) return null;
  const id = runtimeId.slice("jarvis:".length);
  return WORKSPACE_WINDOW_TITLE_KEYS[id] ? id : null;
}

export function getLocalizedWorkspaceWindowTitle(id, t, fallback = "") {
  const key = WORKSPACE_WINDOW_TITLE_KEYS[id];
  if (!key || typeof t !== "function") return fallback;
  const translated = t(key);
  return translated && translated !== key ? translated : fallback;
}

export function localizeWorkspaceWindow(windowLike, t) {
  const id = getWorkspaceWindowId(windowLike);
  if (!id) return windowLike;
  const title = getLocalizedWorkspaceWindowTitle(id, t, windowLike?.title ?? "");
  return title === windowLike?.title
    ? windowLike
    : { ...windowLike, title };
}

export function localizeWorkspaceWindows(windows, t) {
  return (Array.isArray(windows) ? windows : [])
    .map((windowLike) => localizeWorkspaceWindow(windowLike, t));
}
