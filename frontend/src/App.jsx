import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getLatestAgentRelationMessage } from "./agent-context-model.js";
import { canUseAgentChat } from "./agent-session-model.js";
import { CommandOverlay } from "./components/CommandOverlay.jsx";
import { CoreStage } from "./components/CoreStage.jsx";
import { DesktopShortcuts } from "./components/DesktopShortcuts.jsx";
import { ManagedWorkspaceWindow } from "./components/ManagedWorkspaceWindow.jsx";
import { LinkedSystemRail } from "./components/LinkedSystemRail.jsx";
import { LinkedWorkspaceHandle } from "./components/LinkedWorkspaceHandle.jsx";
import { LinkedWorkspaceRoutes } from "./components/LinkedWorkspaceRoutes.jsx";
import { Taskbar } from "./components/Taskbar.jsx";
import { TelemetryRail } from "./components/TelemetryRail.jsx";
import { DesktopWorkspace } from "./components/DesktopWorkspace.jsx";
import { TopStatusBar } from "./components/TopStatusBar.jsx";
import { JarvisMark } from "./components/VectorMarks.jsx";
import { SystemNotice } from "./components/SystemNotice.jsx";
import {
  appendFeedbackEvent,
  createShellFeedback,
  selectFeedbackNotice,
} from "./feedback-model.js";
import { useAgentSession } from "./hooks/useAgentSession.js";
import { useDefaultKnowledgeGraph } from "./graph/useDefaultKnowledgeGraph.js";
import { useReducedMotion } from "./hooks/useReducedMotion.js";
import { useWorkspaceManager } from "./hooks/useWorkspaceManager.js";
import { translate, useLanguage } from "./i18n/language-system.js";
import { platform } from "./platform/index.js";
import { isQuickSearchToggleShortcut } from "./quick-search.js";
import { isHelpShortcut } from "./shell-shortcuts.js";
import { recordRecentApplication } from "./recent-applications.js";
import { subscribeShellFeedback } from "./shell-feedback-channel.js";
import {
  getVisibleInternalWindowIds,
  planInternalShowDesktopToggle,
} from "./show-desktop-model.js";
import { subscribeWorkspaceCommands } from "./workspace-runtime-channel.js";
import { useTransientPresence } from "./transient-presence.js";
import {
  getLinkedWorkspaceVariant,
  getLinkedPaneToggleTarget,
  getSystemNoticePlacement,
  getWorkspaceLayoutMode,
  isDockedWindow,
  isLinkedPaneToggleShortcut,
} from "./workspace-layout-mode.js";

const FileExplorerWindow = lazy(() => import("./components/FileExplorerWindow.jsx")
  .then((module) => ({ default: module.FileExplorerWindow })));
const AgentConversationWindow = lazy(() => import("./components/AgentConversationWindow.jsx")
  .then((module) => ({ default: module.AgentConversationWindow })));
const ShellPanelLayer = lazy(() => import("./components/ShellPanels.jsx")
  .then((module) => ({ default: module.ShellPanelLayer })));
const TerminalWorkbench = lazy(() => import("./components/TerminalWorkbench.jsx")
  .then((module) => ({ default: module.TerminalWorkbench })));
const SystemInspector = lazy(() => import("./components/SystemInspector.jsx")
  .then((module) => ({ default: module.SystemInspector })));
const BootSequence = lazy(() => import("./components/BootSequence.jsx")
  .then((module) => ({ default: module.BootSequence })));

export function App() {
  const { t } = useLanguage();
  const hasExternalTaskbar = new URLSearchParams(window.location.search).get("taskbar") === "external";
  const {
    state: workspaceState,
    taskbarWindows: internalTaskbarWindows,
    open: openWorkspaceWindow,
    close: closeWorkspaceWindow,
    activate: activateWorkspaceWindow,
    minimize: minimizeWorkspaceWindow,
    restore: restoreWorkspaceWindow,
    toggleMaximize: toggleMaximizeWorkspaceWindow,
    toggleFromTaskbar: toggleWorkspaceWindowFromTaskbar,
    commitBounds: commitWorkspaceWindowBounds,
    cycle: cycleWorkspaceWindows,
  } = useWorkspaceManager();
  const agentSession = useAgentSession();
  const defaultKnowledgeGraph = useDefaultKnowledgeGraph();
  const reducedMotion = useReducedMotion();
  const agentChatAvailable = canUseAgentChat(agentSession.state);
  const [selectedShortcut, setSelectedShortcut] = useState(null);
  const [activeApp, setActiveApp] = useState("builtin:explorer");
  const [commandOpen, setCommandOpen] = useState(false);
  const [shellPanel, setShellPanel] = useState(null);
  const shellPanelPresence = useTransientPresence(shellPanel, { reducedMotion });
  const commandPresence = useTransientPresence(commandOpen ? "command" : null, { reducedMotion });
  const [explorerRequest, setExplorerRequest] = useState({ path: null, sequence: 0 });
  const [explorerSelection, setExplorerSelection] = useState([]);
  const [inspectorTarget, setInspectorTarget] = useState(null);
  const [bootActive, setBootActive] = useState(true);
  const [graphLaunchpadHidden, setGraphLaunchpadHidden] = useState(false);
  const [notice, setNotice] = useState(null);
  const [localFeedEvents, setLocalFeedEvents] = useState([]);
  const showDesktopRestoreIdsRef = useRef([]);
  const workspaceLayoutMode = getWorkspaceLayoutMode(workspaceState.windows);
  const linkedWorkspaceVariant = workspaceLayoutMode === "explorer-agent-linked"
    ? getLinkedWorkspaceVariant(workspaceState.viewport)
    : null;
  const linkedAgentMessage = useMemo(
    () => getLatestAgentRelationMessage(agentSession.messages, agentSession.context),
    [agentSession.context, agentSession.messages],
  );
  const noticePlacement = getSystemNoticePlacement({
    workspaceMode: workspaceLayoutMode,
    linkedVariant: linkedWorkspaceVariant,
    activeId: workspaceState.activeId,
    noticeSource: notice?.source,
    shellPanel,
    commandOpen,
  });
  const agentInlineNotice = notice
    && workspaceLayoutMode === "explorer-agent-linked"
    && noticePlacement === "workspace-top-end"
    && workspaceState.windows.agent.open
    && !workspaceState.windows.agent.minimized
    ? notice
    : null;
  const explorerInlineNotice = notice
    && workspaceState.windows.explorer.open
    && !workspaceState.windows.explorer.minimized
    && (
      (workspaceLayoutMode === "explorer-agent-linked" && noticePlacement === "workspace-top-start")
      || (workspaceLayoutMode === "explorer-focus" && noticePlacement === "workspace-top-end")
    )
    ? notice
    : null;
  const hasInlineNotice = Boolean(agentInlineNotice || explorerInlineNotice);
  const linkedWorkspaceAnnouncement = workspaceLayoutMode === "explorer-agent-linked"
    ? workspaceState.activeId === "agent"
      ? t("workspace.linked.agentActive")
      : t("workspace.linked.explorerActive")
    : "";
  const handleToggleWorkspaceMaximize = useCallback((id) => {
    if (isDockedWindow(id, workspaceLayoutMode)) return;
    toggleMaximizeWorkspaceWindow(id);
  }, [toggleMaximizeWorkspaceWindow, workspaceLayoutMode]);

  const showToast = useCallback((input) => {
    const feedback = createShellFeedback(input);
    setNotice((current) => selectFeedbackNotice(current, feedback));
    if (feedback.severity === "warning" || feedback.severity === "error") {
      void platform.feed.reportFault({
        source: feedback.source,
        severity: feedback.severity,
        title: feedback.title,
        detail: feedback.detail,
        actionId: null,
      }).catch(() => {
        setLocalFeedEvents((current) => appendFeedbackEvent(current, feedback));
      });
    }
    return feedback;
  }, []);

  const showDesktopFeedback = useCallback((input) => showToast(
    typeof input === "string" ? { title: input, source: "desktop" } : { ...input, source: input?.source ?? "desktop" },
  ), [showToast]);
  const showExplorerFeedback = useCallback((input) => showToast(
    typeof input === "string" ? { title: input, source: "explorer" } : { ...input, source: input?.source ?? "explorer" },
  ), [showToast]);
  const showTerminalFeedback = useCallback((input) => showToast(
    typeof input === "string" ? { title: input, source: "terminal" } : { ...input, source: input?.source ?? "terminal" },
  ), [showToast]);
  const showSystemFeedback = useCallback((input) => showToast(
    typeof input === "string" ? { title: input, source: "system" } : { ...input, source: input?.source ?? "system" },
  ), [showToast]);
  const showSettingsFeedback = useCallback((input) => showToast(
    typeof input === "string" ? { title: input, source: "settings" } : { ...input, source: input?.source ?? "settings" },
  ), [showToast]);
  const finishBoot = useCallback(() => setBootActive(false), []);

  const openExplorer = useCallback((path = null) => {
    setCommandOpen(false);
    setShellPanel(null);
    setActiveApp("builtin:explorer");
    if (path) {
      setExplorerRequest((current) => ({
        path,
        sequence: current.sequence + 1,
      }));
    }
    openWorkspaceWindow("explorer");
  }, [openWorkspaceWindow]);

  const openTerminal = useCallback(() => {
    setCommandOpen(false);
    setShellPanel(null);
    setActiveApp("builtin:terminal");
    openWorkspaceWindow("terminal");
  }, [openWorkspaceWindow]);

  const hideTaskbarFlyout = useCallback(async () => {
    try {
      await platform.taskbar.hideFlyout();
    } catch {
      // A stale flyout must not block the desktop taskbar.
    }
  }, []);

  const showTaskbarFlyout = useCallback(async (options) => {
    try {
      await platform.taskbar.showFlyout(options);
    } catch (error) {
      showToast({
        severity: "error",
        source: "taskbar",
        title: translate("feedback.taskbar.previewFailed"),
        detail: error.message,
        actions: [{ label: translate("common.action.retry"), onInvoke: () => showTaskbarFlyout(options) }],
      });
    }
  }, [showToast]);

  const closeTaskbarWindow = useCallback(async (windowId) => {
    if (windowId.startsWith("jarvis:")) {
      const internalWindowId = windowId.slice("jarvis:".length);
      if (workspaceState.windows[internalWindowId]) {
        closeWorkspaceWindow(internalWindowId);
        showToast(translate("feedback.window.closed"));
      }
      return;
    }
    try {
      await platform.taskbar.closeWindow(windowId);
      showToast(translate("feedback.window.closeRequested"));
    } catch (error) {
      showToast({
        severity: "error",
        source: "taskbar",
        title: translate("feedback.window.closeFailed"),
        detail: error.message,
        actions: [{ label: translate("common.action.retry"), onInvoke: () => closeTaskbarWindow(windowId) }],
      });
    }
  }, [closeWorkspaceWindow, showToast, workspaceState.windows]);

  const openCommand = useCallback(async () => {
    await hideTaskbarFlyout();
    setShellPanel(null);
    setCommandOpen(true);
  }, [hideTaskbarFlyout]);

  const openAgent = useCallback(async () => {
    await hideTaskbarFlyout();
    setCommandOpen(false);
    setShellPanel(null);
    setActiveApp("jarvis:launcher");
    openWorkspaceWindow("agent");
  }, [hideTaskbarFlyout, openWorkspaceWindow]);

  const toggleAgentFromTaskbar = useCallback(async () => {
    await hideTaskbarFlyout();
    setCommandOpen(false);
    setShellPanel(null);
    setActiveApp("jarvis:launcher");
    toggleWorkspaceWindowFromTaskbar("agent");
  }, [hideTaskbarFlyout, toggleWorkspaceWindowFromTaskbar]);

  const linkExplorerSelectionToAgent = useCallback(async (entries) => {
    if (!agentChatAvailable) {
      await openAgent();
      showToast({
        severity: "warning",
        source: "agent",
        title: translate("feedback.agent.chatUnavailable.title"),
        detail: translate("feedback.agent.chatUnavailable.detail"),
      });
      return;
    }
    if (["submitting", "running"].includes(agentSession.context.phase)) {
      await openAgent();
      showToast(translate("feedback.agent.contextLocked"));
      return;
    }
    const stagedItems = agentSession.addContextItems(entries);
    if (!stagedItems.length) {
      showToast(translate("feedback.agent.selectExplorerItem"));
      return;
    }
    await openAgent();
    showToast(translate(
      stagedItems.length === 1
        ? "feedback.agent.explorerReferenceLinked.one"
        : "feedback.agent.explorerReferenceLinked.other",
      { count: stagedItems.length },
    ));
  }, [
    agentChatAvailable,
    agentSession.addContextItems,
    agentSession.context.phase,
    openAgent,
    showToast,
  ]);

  const linkKnowledgeGraphNodeToAgent = useCallback(async (entry) => {
    if (!agentChatAvailable) {
      await openAgent();
      showToast({
        severity: "warning",
        source: "agent",
        title: translate("feedback.agent.chatUnavailable.title"),
        detail: translate("feedback.agent.chatUnavailable.detail"),
      });
      return;
    }
    if (["submitting", "running"].includes(agentSession.context.phase)) {
      await openAgent();
      showToast(translate("feedback.agent.contextLocked"));
      return;
    }
    const stagedItems = agentSession.addContextItems(entry ? [entry] : []);
    if (!stagedItems.length) {
      showToast(translate("feedback.agent.selectGraphNode"));
      return;
    }
    await openAgent();
    showToast(translate("feedback.agent.graphNodeLinked", { name: stagedItems[0].name }));
  }, [
    agentChatAvailable,
    agentSession.addContextItems,
    agentSession.context.phase,
    openAgent,
    showToast,
  ]);

  const clearLinkedAgentContext = useCallback(() => {
    if (agentSession.clearContext()) showToast(translate("feedback.agent.referenceUnlinked"));
  }, [agentSession.clearContext, showToast]);

  const reuseLinkedAgentResult = useCallback(() => {
    agentSession.setDraft((current) => current.trim()
      ? current
      : translate("agent.draft.refineCompletedResponse"));
  }, [agentSession.setDraft]);

  useEffect(() => {
    if (!notice || notice.persistent || !notice.timeoutMs) return undefined;
    const noticeId = notice.id;
    const timer = window.setTimeout(() => {
      setNotice((current) => current?.id === noticeId ? null : current);
    }, notice.timeoutMs);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => subscribeShellFeedback((feedback) => {
    showToast(feedback);
  }), [showToast]);

  const dismissNotice = useCallback(() => {
    const noticeId = notice?.id;
    setNotice(null);
    if (noticeId) {
      setLocalFeedEvents((current) => current.filter((event) => event.id !== `local:${noticeId}`));
    }
  }, [notice?.id]);

  const clearLocalFeed = useCallback(() => setLocalFeedEvents([]), []);
  const markLocalFeedRead = useCallback(() => {
    setLocalFeedEvents((current) => current.map((event) => ({ ...event, unread: false })));
  }, []);

  useEffect(() => {
    const handleShortcut = (event) => {
      if (isHelpShortcut(event)) {
        event.preventDefault();
        setCommandOpen(false);
        setShellPanel("help");
        return;
      }
      if (isQuickSearchToggleShortcut(event)) {
        event.preventDefault();
        setShellPanel(null);
        setCommandOpen((current) => !current);
        return;
      }
      const activeWindowId = workspaceState.activeId;
      if (event.ctrlKey && event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        cycleWorkspaceWindows(event.key === "ArrowLeft" ? -1 : 1);
        return;
      }
      if (
        workspaceLayoutMode === "explorer-agent-linked"
        && isLinkedPaneToggleShortcut(event)
      ) {
        const targetId = getLinkedPaneToggleTarget(workspaceState.activeId, linkedWorkspaceVariant);
        if (targetId) {
          event.preventDefault();
          activateWorkspaceWindow(targetId);
        }
        return;
      }
      if (!activeWindowId || !event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "F4") {
        event.preventDefault();
        closeWorkspaceWindow(activeWindowId);
      } else if (event.key === "F9") {
        event.preventDefault();
        minimizeWorkspaceWindow(activeWindowId);
      } else if (event.key === "F10") {
        event.preventDefault();
        handleToggleWorkspaceMaximize(activeWindowId);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [
    activateWorkspaceWindow,
    closeWorkspaceWindow,
    cycleWorkspaceWindows,
    minimizeWorkspaceWindow,
    handleToggleWorkspaceMaximize,
    linkedWorkspaceVariant,
    workspaceState.activeId,
    workspaceLayoutMode,
  ]);

  useEffect(() => subscribeWorkspaceCommands(({ id, action }) => {
    if (action === "close") {
      closeWorkspaceWindow(id);
      return;
    }
    if (action === "minimize") {
      minimizeWorkspaceWindow(id);
      return;
    }
    if (action === "restore") {
      restoreWorkspaceWindow(id);
      return;
    }
    toggleWorkspaceWindowFromTaskbar(id);
  }), [
    closeWorkspaceWindow,
    minimizeWorkspaceWindow,
    restoreWorkspaceWindow,
    toggleWorkspaceWindowFromTaskbar,
  ]);

  useEffect(() => {
    const handleOpenPanel = (event) => {
      const panel = event.detail;
      if (panel === "command") {
        setShellPanel(null);
        setCommandOpen(true);
        return;
      }
      if (panel === "explorer") {
        openExplorer();
        return;
      }
      if (panel === "terminal") {
        openTerminal();
        return;
      }
      if (panel === "agent") {
        void openAgent();
        return;
      }
      if (["start", "quick-settings", "date-time", "notifications", "session", "settings", "help"].includes(panel)) {
        setCommandOpen(false);
        setShellPanel(panel);
      }
    };
    const handleOpenCommand = () => handleOpenPanel({ detail: "command" });
    window.addEventListener("jarvis:open-shell-panel", handleOpenPanel);
    window.addEventListener("jarvis:open-command", handleOpenCommand);
    return () => {
      window.removeEventListener("jarvis:open-shell-panel", handleOpenPanel);
      window.removeEventListener("jarvis:open-command", handleOpenCommand);
    };
  }, [openAgent, openExplorer, openTerminal]);

  const openShortcut = useCallback(async (shortcut) => {
    const label = shortcut.label ?? shortcut.name;
    setActiveApp(label.toLowerCase().replaceAll(" ", "-"));
    if (shortcut.id === "terminal" && !shortcut.path) {
      openTerminal();
      showToast(translate("feedback.terminal.ready"));
      return;
    }
    if (shortcut.kind === "directory" && shortcut.path) {
      openExplorer(shortcut.path);
      showToast(translate("feedback.explorer.browsing", { label }));
      return;
    }
    try {
      await platform.shell.open(shortcut.target ?? shortcut.path ?? label);
      showToast(translate("feedback.shell.openingWithWindows", { label }));
    } catch (error) {
      showToast({
        severity: "error",
        source: "desktop",
        title: translate("feedback.shell.openFailed", { label }),
        detail: error.message,
        actions: [{ label: translate("common.action.retry"), onInvoke: () => openShortcut(shortcut) }],
      });
    }
  }, [openExplorer, openTerminal, showToast]);

  const openShortcutLocation = useCallback(async (shortcut) => {
    if (!shortcut.path) return;
    try {
      await platform.explorer.openInWindows(shortcut.path);
      showToast(translate("feedback.explorer.locatedInWindows", { label: shortcut.label }));
    } catch (error) {
      showToast({
        severity: "error",
        source: "desktop",
        title: translate("feedback.explorer.locateFailed", { label: shortcut.label }),
        detail: error.message,
        actions: [{ label: translate("common.action.retry"), onInvoke: () => openShortcutLocation(shortcut) }],
      });
    }
  }, [showToast]);

  const copyShortcutPath = useCallback(async (shortcut) => {
    if (!shortcut.path) return;
    try {
      await navigator.clipboard.writeText(shortcut.path);
      showToast(translate("feedback.path.copied"));
    } catch (error) {
      showToast({
        severity: "error",
        source: "desktop",
        title: translate("feedback.path.copyFailed"),
        detail: error.message,
        actions: [{ label: translate("common.action.retry"), onInvoke: () => copyShortcutPath(shortcut) }],
      });
    }
  }, [showToast]);

  const openDesktopSettings = useCallback(() => {
    setCommandOpen(false);
    setShellPanel("settings");
    showToast(translate("feedback.settings.ready"));
  }, [showToast]);

  const inspect = useCallback((label) => {
    setInspectorTarget(label);
    setActiveApp("internal:inspector");
    openWorkspaceWindow("inspector");
  }, [openWorkspaceWindow]);

  const handleNotification = useCallback((notification) => {
    if (notification?.local) {
      setNotice(createShellFeedback({
        id: String(notification.id).replace(/^local:/u, ""),
        severity: notification.severity,
        source: notification.source,
        title: notification.title,
        detail: notification.detail,
        timestamp: notification.timestamp,
        persistent: true,
      }));
      return;
    }
    setCommandOpen(false);
    setShellPanel("notifications");
  }, []);

  const launchInstalledApplication = useCallback(async (application) => {
    setShellPanel(null);
    try {
      await platform.shell.openApplication(application.applicationId);
      recordRecentApplication(application.applicationId);
      showToast(platform.isNative
        ? translate("feedback.shell.opening", { label: application.label })
        : translate("feedback.shell.launchRequested", { label: application.label }));
    } catch (error) {
      showToast({
        severity: "error",
        source: "shell",
        title: translate("feedback.shell.openFailed", { label: application.label }),
        detail: error.message,
        actions: [{ label: translate("common.action.retry"), onInvoke: () => launchInstalledApplication(application) }],
      });
    }
  }, [showToast]);

  const handleAppClick = useCallback(async (item, runningWindow = null, options = {}) => {
    const builtinId = item.pinnedApplication?.id;
    setActiveApp(item.id);
    await hideTaskbarFlyout();
    try {
      if (runningWindow?.internalWindowId) {
        toggleWorkspaceWindowFromTaskbar(runningWindow.internalWindowId);
        showToast(runningWindow.active && !runningWindow.minimized
          ? translate("feedback.window.minimizing", { label: item.label })
          : translate("feedback.window.switching", { label: item.label }));
        return;
      }
      if (builtinId === "explorer") {
        openExplorer();
        return;
      }
      if (builtinId === "jarvis-settings") {
        setCommandOpen(false);
        setShellPanel("settings");
        showToast(translate("feedback.settings.ready"));
        return;
      }
      if (builtinId === "jarvis-help") {
        setCommandOpen(false);
        setShellPanel("help");
        return;
      }
      if (builtinId === "terminal") {
        openTerminal();
        showToast(translate("feedback.terminal.ready"));
        return;
      }
      if (runningWindow && !options.forceLaunch) {
        await platform.taskbar.toggleWindow(runningWindow.windowId);
        const appLabel = item.label ?? runningWindow.processName;
        showToast(runningWindow.active && !runningWindow.minimized
          ? translate("feedback.window.minimizing", { label: appLabel })
          : translate("feedback.window.switching", { label: appLabel }));
        return;
      }
      if (item.kind === "installed" && item.application) {
        await launchInstalledApplication(item.application);
        return;
      }
      if (!item.pinnedApplication) return;
      await platform.shell.open(item.pinnedApplication.target);
      showToast(platform.isNative
        ? translate("feedback.shell.openingWithWindows", { label: item.label })
        : translate("feedback.shell.selected", { label: item.label }));
    } catch (error) {
      const appLabel = item.label ?? runningWindow?.processName ?? item.id;
      showToast({
        severity: "error",
        source: "taskbar",
        title: translate("feedback.shell.openFailed", { label: appLabel }),
        detail: error.message,
        actions: [{ label: translate("common.action.retry"), onInvoke: () => handleAppClick(item, runningWindow, options) }],
      });
    }
  }, [
    hideTaskbarFlyout,
    launchInstalledApplication,
    openExplorer,
    openTerminal,
    showToast,
    toggleWorkspaceWindowFromTaskbar,
  ]);

  const toggleShowDesktop = useCallback(async () => {
    await hideTaskbarFlyout();
    const visibleInternalWindowIds = getVisibleInternalWindowIds(internalTaskbarWindows);
    try {
      const result = await platform.taskbar.toggleDesktop({
        hasVisibleInternalWindow: visibleInternalWindowIds.length > 0,
      });
      const plan = planInternalShowDesktopToggle(
        internalTaskbarWindows,
        showDesktopRestoreIdsRef.current,
        result,
      );
      plan.commands.forEach(({ id, action }) => {
        if (action === "minimize") {
          minimizeWorkspaceWindow(id);
        } else {
          restoreWorkspaceWindow(id);
        }
      });
      showDesktopRestoreIdsRef.current = plan.nextRestoreIds;
      if (result.action === "shown") {
        setCommandOpen(false);
        setShellPanel(null);
        showToast(translate("feedback.desktop.shown"));
      } else if (result.action === "restored") {
        showToast(translate("feedback.desktop.windowsRestored"));
      } else {
        showToast({
          severity: "warning",
          source: "taskbar",
          title: translate("feedback.desktop.partialRestore.title"),
          detail: translate("feedback.desktop.partialRestore.detail"),
          actions: [{ label: translate("common.action.sessionControl"), onInvoke: () => setShellPanel("session") }],
        });
      }
    } catch (error) {
      showToast({
        severity: "error",
        source: "taskbar",
        title: translate("feedback.desktop.toggleFailed"),
        detail: error.message,
        actions: [{ label: translate("common.action.sessionControl"), onInvoke: () => setShellPanel("session") }],
      });
    }
  }, [
    hideTaskbarFlyout,
    internalTaskbarWindows,
    minimizeWorkspaceWindow,
    restoreWorkspaceWindow,
    showToast,
  ]);

  const openShellPanel = useCallback(async (panel) => {
    await hideTaskbarFlyout();
    setCommandOpen(false);
    setShellPanel((current) => current === panel ? null : panel);
  }, [hideTaskbarFlyout]);
  const openSessionPanel = useCallback(() => {
    void openShellPanel("session");
  }, [openShellPanel]);
  const navigateShellPanel = useCallback((panel) => {
    setCommandOpen(false);
    setShellPanel(panel);
  }, []);

  const launchShellApp = useCallback(async ({ label, target }) => {
    if (target.toLowerCase() === "jarvis-help:") {
      setCommandOpen(false);
      setShellPanel("help");
      return;
    }
    if (target.toLowerCase() === "jarvis-settings:") {
      setShellPanel("settings");
      showToast(translate("feedback.settings.ready"));
      return;
    }
    if (target.toLowerCase() === "jarvis-terminal:") {
      openTerminal();
      showToast(translate("feedback.terminal.ready"));
      return;
    }
    setShellPanel(null);
    if (target.toLowerCase() === "explorer.exe") {
      openExplorer();
      return;
    }
    try {
      await platform.shell.open(target);
      showToast(platform.isNative
        ? translate("feedback.shell.openingWithWindows", { label })
        : translate("feedback.shell.launchRequested", { label }));
    } catch (error) {
      showToast({
        severity: "error",
        source: "shell",
        title: translate("feedback.shell.openFailed", { label }),
        detail: error.message,
        actions: [{ label: translate("common.action.retry"), onInvoke: () => launchShellApp({ label, target }) }],
      });
    }
  }, [openExplorer, openTerminal, showToast]);

  const activateShellWindow = useCallback(async (window) => {
    setShellPanel(null);
    try {
      await platform.taskbar.toggleWindow(window.windowId);
      showToast(translate("feedback.window.switching", { label: window.title || window.processName }));
    } catch (error) {
      showToast({
        severity: "error",
        source: "taskbar",
        title: translate("feedback.window.switchFailed"),
        detail: error.message,
        actions: [{ label: translate("common.action.retry"), onInvoke: () => activateShellWindow(window) }],
      });
    }
  }, [showToast]);

  const exitToWindows = useCallback(async () => {
    if (!platform.isNative) {
      showToast(translate("feedback.session.powerProtected"));
      return;
    }
    try {
      await platform.lifecycle.exitToWindows();
    } catch (error) {
      showToast({
        severity: "error",
        source: "runtime",
        title: translate("feedback.session.exitFailed"),
        detail: error.message,
        actions: [{ label: translate("common.action.sessionControl"), onInvoke: () => setShellPanel("session") }],
      });
    }
  }, [showToast]);

  const executeQuickSearch = useCallback((result) => {
    setCommandOpen(false);
    if (result.kind === "window") {
      if (result.window.active && !result.window.minimized) {
        showToast(translate("feedback.window.alreadyActive", {
          label: result.window.title || result.window.processName,
        }));
        return;
      }
      void activateShellWindow(result.window);
      return;
    }
    if (result.kind === "desktop") {
      void openShortcut(result.entry);
      return;
    }
    if (result.kind === "installed-app") {
      void launchInstalledApplication(result.application);
      return;
    }
    if (result.kind === "app" || result.kind === "setting") {
      void launchShellApp({ label: result.label, target: result.target });
      return;
    }
    showToast(translate("feedback.search.resultUnavailable"));
  }, [
    activateShellWindow,
    launchInstalledApplication,
    launchShellApp,
    openShortcut,
    showToast,
  ]);

  const hasVisibleWorkspaceWindow = Object.values(workspaceState.windows)
    .some((windowState) => windowState.open && !windowState.minimized);
  const workspaceAvailableWidth = Math.max(
    1,
    workspaceState.viewport.width - workspaceState.viewport.left - workspaceState.viewport.right,
  );

  return (
    <main className={[
      "jarvis-shell",
      hasExternalTaskbar ? "has-external-taskbar" : "",
      hasVisibleWorkspaceWindow ? "has-open-window" : "",
      `is-layout-${workspaceLayoutMode}`,
      linkedWorkspaceVariant ? `is-linked-${linkedWorkspaceVariant}` : "",
    ].filter(Boolean).join(" ")}
    style={{
      "--workspace-top-inset": `${workspaceState.viewport.top}px`,
      "--workspace-right-inset": `${workspaceState.viewport.right}px`,
      "--workspace-bottom-inset": `${workspaceState.viewport.bottom}px`,
      "--workspace-left-inset": `${workspaceState.viewport.left}px`,
      "--workspace-available-width": `${workspaceAvailableWidth}px`,
    }}>
      <div className="ambient-field" aria-hidden="true" />
      <TopStatusBar
        onFeedback={showToast}
        onOpenCommand={openCommand}
        onAbortAgent={agentSession.abort}
        agentState={agentSession.state}
        onPower={openSessionPanel}
        onOpenDateTime={() => openShellPanel("date-time")}
      />

      <DesktopWorkspace aria-label={t("workspace.desktop.ariaLabel")}>
        <DesktopShortcuts
          selectedId={selectedShortcut}
          onSelect={setSelectedShortcut}
          onOpen={openShortcut}
          onOpenLocation={openShortcutLocation}
          onCopyPath={copyShortcutPath}
          onOpenSettings={openDesktopSettings}
          onNotify={showDesktopFeedback}
        />
        <CoreStage
          defaultGraphState={defaultKnowledgeGraph}
          graphSelection={explorerSelection}
          desktopOnly={graphLaunchpadHidden}
          onOpenSearch={openCommand}
          onOpenFiles={openExplorer}
          onOpenGraphPath={openExplorer}
          onLinkGraphNode={linkKnowledgeGraphNodeToAgent}
          onKeepDesktop={() => {
            setGraphLaunchpadHidden(true);
            showToast(translate("feedback.graph.startOptionsHidden"));
          }}
          onRestoreLaunchpad={() => setGraphLaunchpadHidden(false)}
        />
        <TelemetryRail
          compact={workspaceAvailableWidth <= 1080}
          localEvents={localFeedEvents}
          onInspect={inspect}
          onNotification={handleNotification}
        />
      </DesktopWorkspace>

      {bootActive ? (
        <Suspense fallback={null}>
          <BootSequence onComplete={finishBoot} />
        </Suspense>
      ) : null}

      <LinkedWorkspaceHandle
        activeId={workspaceState.activeId}
        variant={linkedWorkspaceVariant}
        onActivate={activateWorkspaceWindow}
      />
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {linkedWorkspaceAnnouncement}
      </div>

      {workspaceState.windows.agent.open ? (
        <ManagedWorkspaceWindow
          id="agent"
          windowState={workspaceState.windows.agent}
          viewport={workspaceState.viewport}
          active={workspaceState.activeId === "agent"}
          layoutMode={workspaceLayoutMode}
          onActivate={activateWorkspaceWindow}
          onCommitBounds={commitWorkspaceWindowBounds}
          onToggleMaximize={handleToggleWorkspaceMaximize}
        >
          <Suspense fallback={null}>
            <AgentConversationWindow
              open
              active={workspaceState.activeId === "agent" && !workspaceState.windows.agent.minimized}
              maximized={workspaceState.windows.agent.maximized && !isDockedWindow("agent", workspaceLayoutMode)}
              canMaximize={!isDockedWindow("agent", workspaceLayoutMode)}
              state={agentSession.state}
              messages={agentSession.messages}
              historyError={agentSession.historyError}
              sessionTransitioning={agentSession.sessionTransitioning}
              draft={agentSession.draft}
              linkedContext={agentSession.context}
              linkedFlowPhase={agentSession.context.phase}
              explorerSelection={explorerSelection}
              notice={agentInlineNotice}
              onDismissNotice={dismissNotice}
              onDraftChange={agentSession.setDraft}
              onSend={agentSession.send}
              onAbort={agentSession.abort}
              onNewSession={agentSession.newSession}
              onLinkExplorerSelection={linkExplorerSelectionToAgent}
              onClearLinkedContext={clearLinkedAgentContext}
              onReuseLinkedResult={reuseLinkedAgentResult}
              onMinimize={() => minimizeWorkspaceWindow("agent")}
              onToggleMaximize={() => handleToggleWorkspaceMaximize("agent")}
              onClose={() => closeWorkspaceWindow("agent")}
            />
          </Suspense>
        </ManagedWorkspaceWindow>
      ) : null}

      {workspaceState.windows.explorer.open ? (
        <ManagedWorkspaceWindow
          id="explorer"
          windowState={workspaceState.windows.explorer}
          viewport={workspaceState.viewport}
          active={workspaceState.activeId === "explorer"}
          layoutMode={workspaceLayoutMode}
          onActivate={activateWorkspaceWindow}
          onCommitBounds={commitWorkspaceWindowBounds}
          onToggleMaximize={handleToggleWorkspaceMaximize}
        >
          <Suspense fallback={null}>
            <FileExplorerWindow
              open
              active={workspaceState.activeId === "explorer" && !workspaceState.windows.explorer.minimized}
              initialPath={explorerRequest.path}
              requestSequence={explorerRequest.sequence}
              maximized={workspaceState.windows.explorer.maximized && !isDockedWindow("explorer", workspaceLayoutMode)}
              canMaximize={!isDockedWindow("explorer", workspaceLayoutMode)}
              linkedContext={agentSession.context}
              linkedFlowPhase={agentSession.context.phase}
              canUseAgentChat={agentChatAvailable}
              notice={explorerInlineNotice}
              onDismissNotice={dismissNotice}
              onSelectionChange={setExplorerSelection}
              onAddToAgentContext={linkExplorerSelectionToAgent}
              onMinimize={() => minimizeWorkspaceWindow("explorer")}
              onToggleMaximize={() => handleToggleWorkspaceMaximize("explorer")}
              onClose={() => closeWorkspaceWindow("explorer")}
              onToast={showExplorerFeedback}
            />
          </Suspense>
        </ManagedWorkspaceWindow>
      ) : null}

      {workspaceState.windows.terminal.open ? (
        <ManagedWorkspaceWindow
          id="terminal"
          windowState={workspaceState.windows.terminal}
          viewport={workspaceState.viewport}
          active={workspaceState.activeId === "terminal"}
          layoutMode={workspaceLayoutMode}
          onActivate={activateWorkspaceWindow}
          onCommitBounds={commitWorkspaceWindowBounds}
          onToggleMaximize={handleToggleWorkspaceMaximize}
        >
          <Suspense fallback={null}>
            <TerminalWorkbench
              open
              active={workspaceState.activeId === "terminal" && !workspaceState.windows.terminal.minimized}
              visible={!workspaceState.windows.terminal.minimized}
              maximized={workspaceState.windows.terminal.maximized}
              onMinimize={() => minimizeWorkspaceWindow("terminal")}
              onToggleMaximize={() => toggleMaximizeWorkspaceWindow("terminal")}
              onClose={() => closeWorkspaceWindow("terminal")}
              onToast={showTerminalFeedback}
            />
          </Suspense>
        </ManagedWorkspaceWindow>
      ) : null}

      {workspaceState.windows.inspector.open ? (
        <ManagedWorkspaceWindow
          id="inspector"
          windowState={workspaceState.windows.inspector}
          viewport={workspaceState.viewport}
          active={workspaceState.activeId === "inspector"}
          layoutMode={workspaceLayoutMode}
          onActivate={activateWorkspaceWindow}
          onCommitBounds={commitWorkspaceWindowBounds}
          onToggleMaximize={handleToggleWorkspaceMaximize}
        >
          <Suspense fallback={null}>
            <SystemInspector
              open
              active={workspaceState.activeId === "inspector" && !workspaceState.windows.inspector.minimized}
              target={inspectorTarget}
              maximized={workspaceState.windows.inspector.maximized}
              onMinimize={() => minimizeWorkspaceWindow("inspector")}
              onToggleMaximize={() => toggleMaximizeWorkspaceWindow("inspector")}
              onClose={() => closeWorkspaceWindow("inspector")}
              onToast={showSystemFeedback}
            />
          </Suspense>
        </ManagedWorkspaceWindow>
      ) : null}

      {workspaceLayoutMode === "explorer-agent-linked" ? (
        <>
          <LinkedWorkspaceRoutes
            phase={agentSession.context.phase}
            relationId={agentSession.context.relationId}
            targetKey={linkedAgentMessage?.id ?? null}
            layoutVariant={linkedWorkspaceVariant}
          />
          <LinkedSystemRail
            agentState={agentSession.state}
            onInspect={inspect}
            onNotification={handleNotification}
          />
        </>
      ) : null}

      {!hasExternalTaskbar && (
        <Taskbar
          activeApp={activeApp}
          internalWindows={internalTaskbarWindows}
          onAppClick={handleAppClick}
          onOpenCommand={openCommand}
          onToggleAgent={toggleAgentFromTaskbar}
          agentState={agentSession.state}
          onOpenStart={() => openShellPanel("start")}
          onOpenQuickSettings={() => openShellPanel("quick-settings")}
          onOpenDateTime={() => openShellPanel("date-time")}
          onOpenNotifications={() => openShellPanel("notifications")}
          onShowFlyout={showTaskbarFlyout}
          onHideFlyout={hideTaskbarFlyout}
          onCloseWindow={closeTaskbarWindow}
          onToggleShowDesktop={toggleShowDesktop}
        />
      )}

      {shellPanelPresence.renderedValue ? (
        <Suspense fallback={null}>
          <ShellPanelLayer
            panel={shellPanelPresence.renderedValue}
            presenceState={shellPanelPresence.state}
            onPresenceComplete={shellPanelPresence.complete}
            onClose={() => setShellPanel(null)}
            onOpenCommand={openCommand}
            onLaunch={launchShellApp}
            onLaunchInstalled={launchInstalledApplication}
            onActivateWindow={activateShellWindow}
            onOpenPanel={navigateShellPanel}
            onExit={exitToWindows}
            onToast={showSettingsFeedback}
            localFeedEvents={localFeedEvents}
            onClearLocalFeed={clearLocalFeed}
            onMarkLocalFeedRead={markLocalFeedRead}
            graphSourceState={defaultKnowledgeGraph}
          />
        </Suspense>
      ) : null}

      {commandPresence.renderedValue ? (
        <CommandOverlay
          open
          presenceState={commandPresence.state}
          onPresenceComplete={commandPresence.complete}
          onClose={() => setCommandOpen(false)}
          onExecute={executeQuickSearch}
        />
      ) : null}

      <SystemNotice
        notice={hasInlineNotice ? null : notice}
        onDismiss={dismissNotice}
        placement={noticePlacement}
      />

      <div className="desktop-only-notice" role="status">
        <JarvisMark />
        <strong>JARVIS DESKTOP</strong>
        <span>{t("app.desktopOnly.viewportRequired")}</span>
      </div>
    </main>
  );
}
