import {
  AlertRegular,
  Battery6Regular,
  ChevronUpRegular,
  DismissRegular,
  MoreHorizontalRegular,
  PlugConnectedRegular,
  PulseRegular,
  SearchRegular,
  Speaker2Regular,
  SpeakerOffRegular,
  Wifi4Regular,
} from "@fluentui/react-icons";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getAgentLauncherStatus, getAgentProviderLabel } from "../agent-provider-model.js";
import { useLanguage } from "../i18n/language-system.js";
import { formatClockPresentation } from "../i18n/locale-format.js";
import {
  usePlatformClock,
  usePlatformKind,
  useApplicationCatalog,
  useSystemFeed,
  useTrayStatus,
  useTaskbarSnapshot,
} from "../hooks/usePlatformData.js";
import { usePinnedApplicationRefs } from "../hooks/usePinnedApplications.js";
import {
  movePinnedApplication,
  reorderPinnedApplication,
  unpinApplication,
} from "../pinned-applications.js";
import {
  getMenuApplicationPinKey,
  resolvePinnedApplications,
} from "../pinned-application-model.js";
import { quickLaunchItems } from "../quick-search-catalog.js";
import { buildStartMenuApplications } from "../start-menu-model.js";
import { useDialogFocusTrap } from "../hooks/useDialogFocusTrap.js";
import {
  getTaskbarKeyboardTarget,
} from "../taskbar-accessibility-model.js";
import {
  filterTaskbarFlyoutEntries,
  getNativeInternalWindowItems,
  getNativeTaskbarOverflowPayload,
  getTaskbarFlyoutKeyboardTarget,
  getTaskbarOverflowSummary,
} from "../taskbar-flyout-model.js";
import {
  getRunningGroupKey,
  getTaskbarContextActionIds,
  normalizeProcessName,
  partitionWindowsByPinnedApplications,
  reconcileRunningTaskbarOrder,
} from "../taskbar-grouping.js";
import {
  acceptsTaskbarHoverPointer,
  getTaskbarHoverPreviewTarget,
  TASKBAR_HOVER_DISMISS_DELAY_MS,
  TASKBAR_HOVER_PREVIEW_DELAY_MS,
} from "../taskbar-hover-preview.js";
import { getTaskbarLayoutPlan, TASKBAR_ICON_SLOT_WIDTH } from "../taskbar-layout-model.js";
import { getTaskbarFallbackMark } from "../taskbar-icon-model.js";
import { localizeWorkspaceWindows } from "../workspace-window-labels.js";
import { AgentGlyph } from "./VectorMarks.jsx";

const processDisplayNames = {
  applicationframehost: "Windows app",
  calculatorapp: "Calculator",
  chrome: "Google Chrome",
  explorer: "File Explorer",
  firefox: "Mozilla Firefox",
  msedge: "Microsoft Edge",
  mspaint: "Paint",
  notepad: "Notepad",
  paintstudio: "Paint",
  powershell: "PowerShell",
  taskmgr: "Task Manager",
};

function createTaskbarPinnedApps(applications) {
  return applications.map((application) => {
    const Icon = application.pinnedApplication?.Icon ?? null;
    const iconDataUrl = application.iconDataUrl ?? null;
    const processes = application.pinnedApplication?.processes ?? application.processes ?? [];
    return {
      id: getMenuApplicationPinKey(application),
      label: application.label,
      Icon,
      iconDataUrl,
      fallbackMark: Icon || iconDataUrl
        ? null
        : getTaskbarFallbackMark({ processName: processes[0], label: application.label }),
      processes,
      applicationId: application.applicationId ?? null,
      kind: application.kind,
      application: application.application ?? null,
      pinnedApplication: application.pinnedApplication ?? null,
    };
  });
}

function selectAppWindow(windows) {
  return windows.find((window) => window.active)
    ?? windows.find((window) => !window.minimized)
    ?? windows[0]
    ?? null;
}

function getProcessLabel(processName, fallbackTitle) {
  const normalized = normalizeProcessName(processName);
  if (["applicationframehost", "wwahost"].includes(normalized) && fallbackTitle) {
    return fallbackTitle;
  }
  if (processDisplayNames[normalized]) return processDisplayNames[normalized];
  return normalized
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildTaskbarItems(windows, pinnedApps, runningOrder, internalWindows = []) {
  const { matchedWindowsByApplication, unmatchedWindows } =
    partitionWindowsByPinnedApplications(windows, pinnedApps);
  const consumedInternalWindowIds = new Set();
  const pinnedItems = pinnedApps.map((app, index) => {
    const internalMatches = internalWindows.filter((window) => window.taskbarItemId === app.id);
    internalMatches.forEach((window) => consumedInternalWindowIds.add(window.windowId));
    const appWindows = [...matchedWindowsByApplication[index], ...internalMatches];
    return {
      ...app,
      isPinned: true,
      windows: appWindows,
      selectedWindow: selectAppWindow(appWindows),
    };
  });

  const runningGroups = new Map();
  unmatchedWindows.forEach((window) => {
    const processName = normalizeProcessName(window.processName);
    const groupKey = getRunningGroupKey(window);
    let group = runningGroups.get(groupKey);
    if (!group) {
      group = {
        id: `running:${groupKey}`,
        label: getProcessLabel(processName, window.title),
        Icon: null,
        fallbackMark: getTaskbarFallbackMark({ processName, label: window.title }),
        isPinned: false,
        windows: [],
      };
      runningGroups.set(groupKey, group);
    }
    group.windows.push(window);
  });
  internalWindows
    .filter((window) => !consumedInternalWindowIds.has(window.windowId))
    .forEach((window) => {
      const Icon = window.internalWindowId === "inspector" ? PulseRegular : null;
      runningGroups.set(window.taskbarItemId, {
        id: window.taskbarItemId,
        label: window.title,
        Icon,
        fallbackMark: Icon
          ? null
          : getTaskbarFallbackMark({ processName: window.processName, label: window.title }),
        isPinned: false,
        windows: [window],
      });
    });

  const runningItems = Array.from(runningGroups.values(), (group) => ({
    ...group,
    selectedWindow: selectAppWindow(group.windows),
  }));
  const orderById = new Map(runningOrder.map((id, index) => [id, index]));
  runningItems.sort((left, right) => {
    const leftIsInternal = left.windows.some((window) => window.internalWindowId);
    const rightIsInternal = right.windows.some((window) => window.internalWindowId);
    if (leftIsInternal !== rightIsInternal) return leftIsInternal ? -1 : 1;
    const leftIndex = orderById.get(left.id);
    const rightIndex = orderById.get(right.id);
    if (leftIndex === undefined && rightIndex === undefined) return 0;
    if (leftIndex === undefined) return 1;
    if (rightIndex === undefined) return -1;
    return leftIndex - rightIndex;
  });

  return [...pinnedItems, ...runningItems];
}

function resolveTaskbarIconDataUrl(item) {
  return item.selectedWindow?.iconDataUrl
    ?? item.windows.find((window) => window.iconDataUrl)?.iconDataUrl
    ?? item.iconDataUrl
    ?? null;
}

function hasTaskbarIcon(item) {
  return Boolean(resolveTaskbarIconDataUrl(item) || item.fallbackMark || item.Icon);
}

function useTaskbarLayoutPlan(containerRef, measurementRefs, items) {
  const [layout, setLayout] = useState(null);
  const itemKey = items.map((item) => item.id).join("\u001f");

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    let cancelled = false;
    const update = () => {
      if (cancelled) return;
      const plan = getTaskbarLayoutPlan(items.map((item) => ({
        id: item.id,
        fullWidth: measurementRefs.current.get(item.id)?.getBoundingClientRect().width,
        canUseIconOnly: hasTaskbarIcon(item),
      })), container.clientWidth);
      const signature = JSON.stringify(plan);
      setLayout((current) => current?.itemKey === itemKey && current.signature === signature
        ? current
        : { itemKey, plan, signature });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    void document.fonts?.ready?.then(update);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [containerRef, itemKey, items, measurementRefs]);

  return layout?.itemKey === itemKey ? layout.plan : null;
}

function TaskbarAppIcon({ item }) {
  const iconDataUrl = resolveTaskbarIconDataUrl(item);
  if (iconDataUrl) {
    return <img className="taskbar-native-icon" src={iconDataUrl} alt="" />;
  }

  if (item.fallbackMark) {
    return <span className="taskbar-app-fallback-mark" aria-hidden="true">{item.fallbackMark}</span>;
  }

  const Icon = item.Icon;
  return Icon
    ? <Icon />
    : <span className="taskbar-app-fallback-mark" aria-hidden="true">{getTaskbarFallbackMark(item)}</span>;
}

function getContextActionLabel(action, item, t) {
  if (action === "launch") return item.windows.length > 0
    ? t("taskbar.action.openNewInstance")
    : t("taskbar.action.open");
  if (action === "close") return item.windows.length > 1
    ? t("taskbar.action.closeAllWindows", { count: item.windows.length })
    : t("taskbar.action.closeWindow");
  return t("taskbar.action.unpinFromJarvis");
}

function getWindowStateText(window, t) {
  if (window?.minimized) return t("taskbar.state.minimized");
  if (window?.active) return t("taskbar.state.active");
  return t("taskbar.state.ready");
}

function getLocalizedTaskbarAccessibleLabel(item, isActive, t) {
  const label = String(item?.label ?? "").trim() || t("taskbar.application");
  const windows = Array.isArray(item?.windows) ? item.windows : [];
  const selectedWindow = item?.selectedWindow ?? windows[0] ?? null;
  const states = [];
  if (isActive) states.push(t("taskbar.state.active"));
  if (selectedWindow?.minimized) states.push(t("taskbar.state.minimized"));
  if (windows.length > 0) {
    states.push(t("taskbar.item.openWindows", { count: windows.length }));
  } else if (item?.isPinned) {
    states.push(t("taskbar.state.pinned"));
  } else {
    states.push(t("taskbar.state.notRunning"));
  }
  return t("taskbar.item.accessibleLabel", {
    label,
    states: states.join(t("common.separator.list")),
  });
}

function getLocalizedAgentStatus(status, t) {
  const key = {
    ACTIVE: "active",
    ATTENTION: "attention",
    OFFLINE: "offline",
    OPEN: "open",
    PROCESSING: "processing",
    READY: "ready",
  }[status];
  return key ? t(`taskbar.agent.state.${key}`) : status;
}

function getLocalizedNativeFlyoutMeta(item, t) {
  const windows = Array.isArray(item?.windows) ? item.windows : [];
  const window = item?.selectedWindow ?? windows[0] ?? null;
  if (window?.internalWindowId) {
    return t("taskbar.flyout.internalWindowMeta", {
      state: getWindowStateText(window, t),
    });
  }
  if (window) {
    return windows.length > 1
      ? t("taskbar.flyout.windowMeta", {
        count: windows.length,
        state: getWindowStateText(window, t),
      })
      : getWindowStateText(window, t);
  }
  return item?.isPinned
    ? t("taskbar.state.pinnedApplication")
    : t("taskbar.application");
}

function TaskbarLocalFlyout({
  flyout,
  onActivate,
  onCloseWindow,
  onContextAction,
  onDismiss,
  onPointerEnter,
  onPointerLeave,
}) {
  const { t } = useLanguage();
  const flyoutRef = useRef(null);
  const entryRefs = useRef(new Map());
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  useDialogFocusTrap(flyoutRef, flyout.source !== "hover", {
    onEscape: onDismiss,
  });

  if (flyout.mode === "context") {
    return (
      <section
        ref={flyoutRef}
        className="taskbar-flyout-mock is-context"
        role="dialog"
        aria-modal="false"
        aria-label={t("taskbar.flyout.applicationCommandsFor", {
          application: flyout.item.label,
        })}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
      >
        <header>
          <span>{t("taskbar.flyout.applicationCommands")}</span>
          <small>{flyout.item.label}</small>
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t("taskbar.flyout.closeCommands")}
          >
            <DismissRegular />
          </button>
        </header>
        <div className="taskbar-context-actions">
          {flyout.actions.map((action, index) => (
            <button
              type="button"
              key={action}
              data-dialog-initial-focus={index === 0 ? "true" : undefined}
              onClick={() => onContextAction(flyout.item, action)}
            >
              {getContextActionLabel(action, flyout.item, t)}
            </button>
          ))}
        </div>
      </section>
    );
  }

  const entries = flyout.mode === "windows"
    ? flyout.item.windows.map((window) => ({
      key: window.windowId,
      label: window.title,
      meta: `${window.processName} · ${getWindowStateText(window, t)}`,
      searchText: `${window.title} ${window.processName}`,
      window,
      item: flyout.item,
    }))
    : flyout.items.map((item) => ({
      key: item.id,
      label: item.label,
      meta: item.selectedWindow?.title ?? (item.isPinned
        ? t("taskbar.state.pinnedApplication")
        : t("taskbar.state.runningApplication")),
      searchText: `${item.label} ${item.selectedWindow?.title ?? ""} ${item.windows.map((window) => `${window.title} ${window.processName}`).join(" ")}`,
      window: item.selectedWindow ?? null,
      item,
    }));
  const visibleEntries = flyout.mode === "overflow"
    ? filterTaskbarFlyoutEntries(entries, query)
    : entries;
  const selectedIndex = visibleEntries.length > 0
    ? Math.min(activeIndex, visibleEntries.length - 1)
    : 0;
  const overflowSummary = getTaskbarOverflowSummary(entries, visibleEntries);
  const focusEntryAt = (index) => {
    const entry = visibleEntries[index];
    if (!entry) return;
    setActiveIndex(index);
    window.requestAnimationFrame(() => entryRefs.current.get(entry.key)?.focus());
  };
  const handleEntryKeyDown = (event, index) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    focusEntryAt(getTaskbarFlyoutKeyboardTarget(
      visibleEntries.length,
      index,
      event.key,
    ));
  };

  return (
    <section
      ref={flyoutRef}
      className={`taskbar-flyout-mock is-${flyout.mode}`}
      role="dialog"
      aria-modal="false"
      aria-label={flyout.mode === "windows"
        ? t("taskbar.flyout.windowPreviews")
        : t("taskbar.flyout.overflow")}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <header>
        <span>{flyout.mode === "windows"
          ? t("taskbar.flyout.windowGroup")
          : t("taskbar.flyout.overflow")}</span>
        <small>{flyout.mode === "windows"
          ? t("taskbar.flyout.openWindowCount", { count: visibleEntries.length })
          : t("taskbar.flyout.visibleApplicationCount", { count: visibleEntries.length })}</small>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("taskbar.flyout.close")}
        >
          <DismissRegular />
        </button>
      </header>
      {flyout.mode === "overflow" ? (
        <div className="taskbar-overflow-tools">
          <label>
            <SearchRegular aria-hidden="true" />
            <input
              type="search"
              value={query}
              maxLength={64}
              placeholder={t("taskbar.flyout.filterPlaceholder")}
              aria-label={t("taskbar.flyout.filterAria")}
              data-dialog-initial-focus="true"
              onChange={(event) => {
                setQuery(event.target.value.slice(0, 64));
                setActiveIndex(0);
              }}
              onKeyDown={(event) => {
                if (!["ArrowDown", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                focusEntryAt(getTaskbarFlyoutKeyboardTarget(
                  visibleEntries.length,
                  selectedIndex,
                  event.key,
                ));
              }}
            />
          </label>
          <code>{t("taskbar.flyout.overflowSummary", {
            visible: overflowSummary.visible,
            total: overflowSummary.total,
            running: overflowSummary.running,
            pinned: overflowSummary.pinned,
          })}</code>
        </div>
      ) : null}
      <div className="taskbar-flyout-grid">
        {visibleEntries.map((entry, index) => (
          <article
            key={entry.key}
            className={[
              entry.window?.active ? "is-active" : "",
              index === selectedIndex ? "is-keyboard-active" : "",
            ].filter(Boolean).join(" ")}
          >
            {flyout.mode === "windows" ? (
              <div className="mock-window-thumbnail" aria-hidden="true">
                <TaskbarAppIcon item={entry.item} />
                <span><small>{t("taskbar.flyout.windowPreview")}</small><strong>{entry.label}</strong></span>
              </div>
            ) : null}
            <button
              ref={(element) => {
                if (element) entryRefs.current.set(entry.key, element);
                else entryRefs.current.delete(entry.key);
              }}
              type="button"
              className="mock-window-main"
              data-dialog-initial-focus={flyout.mode === "windows" && index === 0 ? "true" : undefined}
              tabIndex={index === selectedIndex ? 0 : -1}
              onFocus={() => setActiveIndex(index)}
              onKeyDown={(event) => handleEntryKeyDown(event, index)}
              onClick={() => onActivate(entry.item, entry.window)}
            >
              <TaskbarAppIcon item={entry.item} />
              <span><strong>{entry.label}</strong><small>{entry.meta}</small></span>
            </button>
            {entry.window ? (
              <button
                type="button"
                className="mock-window-close"
                aria-label={t("taskbar.action.closeNamedWindow", { name: entry.label })}
                title={t("taskbar.action.closeNamedWindow", { name: entry.label })}
                onClick={() => onCloseWindow(entry.window.windowId)}
              >
                <DismissRegular />
              </button>
            ) : null}
          </article>
        ))}
        {visibleEntries.length === 0 ? (
          <p className="taskbar-flyout-empty" role="status">
            <SearchRegular />
            <span>
              <strong>{t("taskbar.flyout.noOverflowMatch")}</strong>
              <small>{t("taskbar.flyout.noOverflowMatchHint")}</small>
            </span>
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function Taskbar({
  activeApp,
  internalWindows = [],
  onAppClick,
  onOpenCommand,
  onToggleAgent,
  agentState,
  onOpenStart,
  onOpenQuickSettings,
  onOpenDateTime,
  onOpenNotifications,
  onShowFlyout,
  onHideFlyout,
  onCloseWindow,
  onToggleShowDesktop,
}) {
  const { language, t } = useLanguage();
  const clock = usePlatformClock();
  const localizedClock = formatClockPresentation(clock.dateTime, language);
  const platformKind = usePlatformKind();
  const tray = useTrayStatus();
  const feed = useSystemFeed();
  const taskbar = useTaskbarSnapshot();
  const pinnedApplicationRefs = usePinnedApplicationRefs();
  const needsApplicationCatalog = pinnedApplicationRefs.some((reference) =>
    reference.kind === "installed");
  const applicationCatalog = useApplicationCatalog(needsApplicationCatalog);
  const appsRef = useRef(null);
  const taskbarMeasurementRefs = useRef(new Map());
  const taskbarItemsRef = useRef([]);
  const taskbarButtonRefs = useRef(new Map());
  const hoverPreviewTimerRef = useRef(null);
  const hoverDismissTimerRef = useRef(null);
  const mockFlyoutRef = useRef(null);
  const taskbarHadFocusRef = useRef(false);
  const [runningOrder, setRunningOrder] = useState([]);
  const [draggedPinnedId, setDraggedPinnedId] = useState(null);
  const [mockFlyout, setMockFlyout] = useState(null);
  const [focusedTaskbarItemId, setFocusedTaskbarItemId] = useState(null);
  const menuApplications = useMemo(() => buildStartMenuApplications(
    quickLaunchItems,
    applicationCatalog.applications,
    language,
  ), [applicationCatalog.applications, language]);
  const orderedPinnedApps = useMemo(() => createTaskbarPinnedApps(
    resolvePinnedApplications(pinnedApplicationRefs, menuApplications),
  ), [menuApplications, pinnedApplicationRefs]);
  const localizedInternalWindows = useMemo(
    () => localizeWorkspaceWindows(internalWindows, t),
    [internalWindows, t],
  );
  const agentWindow = localizedInternalWindows
    .find((window) => window.internalWindowId === "agent") ?? null;
  const taskbarInternalWindows = useMemo(
    () => localizedInternalWindows.filter((window) => window.internalWindowId !== "agent"),
    [localizedInternalWindows],
  );
  const taskbarItems = useMemo(
    () => buildTaskbarItems(taskbar.windows, orderedPinnedApps, runningOrder, taskbarInternalWindows),
    [orderedPinnedApps, runningOrder, taskbar.windows, taskbarInternalWindows],
  );
  const layoutPlan = useTaskbarLayoutPlan(appsRef, taskbarMeasurementRefs, taskbarItems);
  useEffect(() => {
    taskbarItemsRef.current = taskbarItems;
  }, [taskbarItems]);
  useEffect(() => {
    mockFlyoutRef.current = mockFlyout;
  }, [mockFlyout]);
  useEffect(() => {
    const currentIds = taskbarItems
      .filter((item) => !item.isPinned)
      .map((item) => item.id);
    setRunningOrder((current) => reconcileRunningTaskbarOrder(current, currentIds));
  }, [taskbarItems]);
  const taskbarItemsById = useMemo(
    () => new Map(taskbarItems.map((item) => [item.id, item])),
    [taskbarItems],
  );
  const visibleLayout = useMemo(
    () => layoutPlan?.visible
      ?? taskbarItems.map((item) => ({ id: item.id, density: "icon", width: TASKBAR_ICON_SLOT_WIDTH })),
    [layoutPlan, taskbarItems],
  );
  const visibleItems = useMemo(
    () => visibleLayout.map((entry) => taskbarItemsById.get(entry.id)).filter(Boolean),
    [taskbarItemsById, visibleLayout],
  );
  const overflowItems = useMemo(
    () => (layoutPlan?.overflowIds ?? []).map((id) => taskbarItemsById.get(id)).filter(Boolean),
    [layoutPlan?.overflowIds, taskbarItemsById],
  );
  const hasOverflow = overflowItems.length > 0;
  const layoutById = useMemo(
    () => new Map(visibleLayout.map((entry) => [entry.id, entry])),
    [visibleLayout],
  );
  const focusableTaskbarIds = useMemo(
    () => [
      ...visibleItems.map((item) => item.id),
      ...(hasOverflow ? ["taskbar:overflow"] : []),
    ],
    [hasOverflow, visibleItems],
  );
  useLayoutEffect(() => {
    setFocusedTaskbarItemId((current) => (
      focusableTaskbarIds.includes(current)
        ? current
        : (() => {
          const next = current && hasOverflow
            ? "taskbar:overflow"
            : focusableTaskbarIds[0] ?? null;
          if (taskbarHadFocusRef.current && next) {
            window.requestAnimationFrame(() => taskbarButtonRefs.current.get(next)?.focus());
          }
          return next;
        })()
    ));
  }, [focusableTaskbarIds, hasOverflow]);
  const focusTaskbarItemAt = useCallback((index) => {
    const id = focusableTaskbarIds[index];
    if (!id) return;
    setFocusedTaskbarItemId(id);
    window.requestAnimationFrame(() => taskbarButtonRefs.current.get(id)?.focus());
  }, [focusableTaskbarIds]);
  const agentRunning = Boolean(agentWindow);
  const agentActive = Boolean(agentWindow?.active && !agentWindow?.minimized);
  const hasActiveInternalWindow = agentActive
    || taskbarInternalWindows.some((window) => window.active);
  const agentWorking = ["starting", "running"].includes(agentState?.status);
  const agentDegraded = Boolean(agentState?.error);
  const agentProviderLabel = getAgentProviderLabel(agentState);
  const agentLauncherStatus = getAgentLauncherStatus(agentState, {
    open: agentRunning,
    active: agentActive,
  });
  const localizedAgentLauncherStatus = getLocalizedAgentStatus(agentLauncherStatus, t);
  const networkAvailable = tray.network.available;
  const power = tray.power;
  const alertCount = feed.unreadCount;
  const PowerIcon = power.batteryPresent ? Battery6Regular : PlugConnectedRegular;
  const AudioIcon = tray.audio.muted ? SpeakerOffRegular : Speaker2Regular;

  const getFlyoutAnchor = useCallback((element) => {
    const rect = element.getBoundingClientRect();
    return {
      anchorX: rect.left + rect.width / 2,
      viewportWidth: document.documentElement.clientWidth || window.innerWidth,
    };
  }, []);

  const cancelHoverPreview = useCallback(() => {
    if (hoverPreviewTimerRef.current === null) return;
    window.clearTimeout(hoverPreviewTimerRef.current);
    hoverPreviewTimerRef.current = null;
  }, []);

  const cancelHoverDismiss = useCallback(() => {
    if (hoverDismissTimerRef.current === null) return;
    window.clearTimeout(hoverDismissTimerRef.current);
    hoverDismissTimerRef.current = null;
  }, []);

  const scheduleHoverMockDismiss = useCallback(() => {
    cancelHoverDismiss();
    if (mockFlyoutRef.current?.source !== "hover") return;
    hoverDismissTimerRef.current = window.setTimeout(() => {
      hoverDismissTimerRef.current = null;
      if (mockFlyoutRef.current?.source !== "hover") return;
      mockFlyoutRef.current = null;
      setMockFlyout(null);
    }, TASKBAR_HOVER_DISMISS_DELAY_MS);
  }, [cancelHoverDismiss]);

  const scheduleHoverPreview = useCallback((event, item) => {
    cancelHoverPreview();
    cancelHoverDismiss();
    if (
      !acceptsTaskbarHoverPointer(event.pointerType, draggedPinnedId)
      || (mockFlyoutRef.current && mockFlyoutRef.current.source !== "hover")
      || !getTaskbarHoverPreviewTarget(item, platformKind)
    ) {
      return;
    }

    const itemId = item.id;
    const anchorElement = event.currentTarget;
    hoverPreviewTimerRef.current = window.setTimeout(() => {
      hoverPreviewTimerRef.current = null;
      if (!anchorElement.isConnected) return;
      const currentItem = taskbarItemsRef.current.find((candidate) =>
        candidate.id === itemId);
      const target = getTaskbarHoverPreviewTarget(currentItem, platformKind);
      if (!target) return;

      if (target.kind === "mock") {
        const nextFlyout = {
          mode: "windows",
          item: currentItem,
          source: "hover",
        };
        mockFlyoutRef.current = nextFlyout;
        setMockFlyout(nextFlyout);
        return;
      }

      if (mockFlyoutRef.current?.source === "hover") {
        mockFlyoutRef.current = null;
        setMockFlyout(null);
      }
      onShowFlyout({
        mode: "windows",
        windowIds: target.windowIds,
        ...getFlyoutAnchor(anchorElement),
      });
    }, TASKBAR_HOVER_PREVIEW_DELAY_MS);
  }, [
    cancelHoverDismiss,
    cancelHoverPreview,
    draggedPinnedId,
    getFlyoutAnchor,
    onShowFlyout,
    platformKind,
  ]);

  const handleHoverPreviewLeave = useCallback(() => {
    cancelHoverPreview();
    scheduleHoverMockDismiss();
  }, [cancelHoverPreview, scheduleHoverMockDismiss]);

  useEffect(() => () => {
    cancelHoverPreview();
    cancelHoverDismiss();
  }, [cancelHoverDismiss, cancelHoverPreview]);

  const showWindowGroup = useCallback((event, item) => {
    cancelHoverPreview();
    cancelHoverDismiss();
    const request = {
      mode: "windows",
      windowIds: item.windows.map((window) => window.windowId),
      ...getFlyoutAnchor(event.currentTarget),
    };
    if (platformKind === "mock") {
      setMockFlyout({ mode: "windows", item, source: "manual" });
      return;
    }
    if (item.windows.some((window) => window.internalWindowId)) {
      const items = getNativeInternalWindowItems(item).map((entry, index) => ({
        ...entry,
        meta: t("taskbar.flyout.internalWindowMeta", {
          state: getWindowStateText(item.windows[index], t),
        }),
      }));
      onShowFlyout({
        mode: "overflow",
        windowIds: [],
        items,
        ...getFlyoutAnchor(event.currentTarget),
      });
      return;
    }
    onShowFlyout(request);
  }, [
    cancelHoverDismiss,
    cancelHoverPreview,
    getFlyoutAnchor,
    onShowFlyout,
    platformKind,
    t,
  ]);

  const showOverflow = useCallback((event) => {
    event.preventDefault();
    cancelHoverPreview();
    cancelHoverDismiss();
    onHideFlyout();
    if (platformKind !== "mock") {
      const payload = getNativeTaskbarOverflowPayload(overflowItems);
      const items = payload.items.map((entry, index) => ({
        ...entry,
        meta: getLocalizedNativeFlyoutMeta(overflowItems[index], t),
      }));
      const { windowIds } = payload;
      if (windowIds.length > 0 || items.length > 0) {
        onShowFlyout({
          mode: "overflow",
          windowIds,
          items,
          ...getFlyoutAnchor(event.currentTarget),
        });
      }
      return;
    }
    setMockFlyout({ mode: "overflow", items: overflowItems });
  }, [
    cancelHoverDismiss,
    cancelHoverPreview,
    getFlyoutAnchor,
    onHideFlyout,
    onShowFlyout,
    overflowItems,
    platformKind,
    t,
  ]);

  const activateMockFlyoutWindow = useCallback((item, window) => {
    cancelHoverDismiss();
    setMockFlyout(null);
    onAppClick(item, window);
  }, [cancelHoverDismiss, onAppClick]);

  const closeMockFlyoutWindow = useCallback((windowId) => {
    cancelHoverDismiss();
    setMockFlyout(null);
    onCloseWindow(windowId);
  }, [cancelHoverDismiss, onCloseWindow]);

  const executeContextAction = useCallback(async (item, action) => {
    cancelHoverPreview();
    cancelHoverDismiss();
    setMockFlyout(null);
    onHideFlyout();
    if (action === "launch") {
      await onAppClick(item, null, { forceLaunch: true });
      return;
    }
    if (action === "close") {
      await Promise.allSettled(item.windows.map((window) => onCloseWindow(window.windowId)));
      return;
    }
    if (action === "unpin" && item.isPinned) {
      unpinApplication(item.id);
    }
  }, [
    cancelHoverDismiss,
    cancelHoverPreview,
    onAppClick,
    onCloseWindow,
    onHideFlyout,
  ]);

  useEffect(() => {
    if (platformKind === "mock") return undefined;
    const handleNativeContextAction = (event) => {
      const itemId = event.detail?.itemId;
      const action = event.detail?.action;
      if (typeof itemId !== "string" || typeof action !== "string") return;
      const item = taskbarItemsRef.current.find((candidate) => candidate.id === itemId);
      if (!item) return;
      if (action === "activate") {
        const requestedWindowId = event.detail?.windowId;
        const targetWindow = typeof requestedWindowId === "string"
          ? item.windows.find((window) => window.windowId === requestedWindowId)
          : item.selectedWindow;
        void onAppClick(item, targetWindow ?? null);
        return;
      }
      if (!getTaskbarContextActionIds(item).includes(action)) return;
      void executeContextAction(item, action);
    };
    window.addEventListener("jarvis:taskbar-action", handleNativeContextAction);
    return () => window.removeEventListener("jarvis:taskbar-action", handleNativeContextAction);
  }, [executeContextAction, onAppClick, platformKind]);

  const handleItemClick = useCallback((event, item) => {
    cancelHoverPreview();
    cancelHoverDismiss();
    if (event.shiftKey && item.isPinned) {
      setMockFlyout(null);
      onHideFlyout();
      onAppClick(item, null, { forceLaunch: true });
      return;
    }
    if (item.windows.length > 1) {
      showWindowGroup(event, item);
      return;
    }
    setMockFlyout(null);
    onHideFlyout();
    onAppClick(item, item.selectedWindow);
  }, [
    cancelHoverDismiss,
    cancelHoverPreview,
    onAppClick,
    onHideFlyout,
    showWindowGroup,
  ]);

  const handleItemAuxClick = useCallback((event, item) => {
    if (event.button !== 1 || !item.isPinned) return;
    event.preventDefault();
    cancelHoverPreview();
    cancelHoverDismiss();
    setMockFlyout(null);
    onHideFlyout();
    onAppClick(item, null, { forceLaunch: true });
  }, [cancelHoverDismiss, cancelHoverPreview, onAppClick, onHideFlyout]);

  const showTaskbarContext = useCallback((event, item) => {
    event.preventDefault();
    cancelHoverPreview();
    cancelHoverDismiss();
    const actions = getTaskbarContextActionIds(item);
    if (actions.length === 0) return;
    const request = {
      mode: "context",
      windowIds: item.windows.map((window) => window.windowId),
      itemId: item.id,
      label: String(item.label).replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, 128) ||
        t("taskbar.application"),
      actions,
      ...getFlyoutAnchor(event.currentTarget),
    };
    if (platformKind === "mock") {
      setMockFlyout({ mode: "context", item, actions, source: "manual" });
      return;
    }
    setMockFlyout(null);
    onShowFlyout(request);
  }, [
    cancelHoverDismiss,
    cancelHoverPreview,
    getFlyoutAnchor,
    onShowFlyout,
    platformKind,
    t,
  ]);

  const reorderPinnedApps = useCallback((targetId) => {
    if (!draggedPinnedId || draggedPinnedId === targetId) return;
    reorderPinnedApplication(draggedPinnedId, targetId);
  }, [draggedPinnedId]);

  const movePinnedApp = useCallback((id, direction) => {
    movePinnedApplication(id, direction);
  }, []);

  return (
    <footer className="taskbar hud-chassis" aria-label={t("taskbar.aria.windowsTaskbar")}>
      <div className="taskbar-start">
        <button
          type="button"
          aria-label={t("taskbar.start")}
          title={t("taskbar.start")}
          onClick={onOpenStart}
        >
          <span className="taskbar-start-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
        </button>
      </div>
      <button
        type="button"
        className={[
          "jarvis-agent-launcher",
          agentRunning ? "is-running" : "",
          agentActive ? "is-active" : "",
          agentWorking ? "is-working" : "",
          agentState?.available === false ? "is-offline" : "",
          agentDegraded ? "is-degraded" : "",
        ].filter(Boolean).join(" ")}
        onClick={onToggleAgent ?? onOpenCommand}
        aria-label={agentActive
          ? t("taskbar.agent.minimize")
          : t("taskbar.agent.open")}
        title={agentState?.error?.message
          ?? (agentState?.available === false
            ? t("taskbar.agent.providerConfigurationRequired")
            : t("taskbar.agent.openWithProvider", { provider: agentProviderLabel }))}
      >
        <AgentGlyph
          state={agentWorking
            ? "working"
            : agentDegraded
              ? "attention"
              : agentState?.available === false ? "offline" : "ready"}
        />
        <span className="jarvis-agent-launcher__copy">
          <strong>Agent</strong>
          <small><span>{agentProviderLabel}</span> · {localizedAgentLauncherStatus}</small>
        </span>
        <i aria-hidden="true" />
      </button>
      <nav
        ref={appsRef}
        className={`taskbar-apps is-density-${layoutPlan?.mode ?? "measuring"}`}
        aria-label={t("taskbar.aria.applications")}
        aria-busy={!layoutPlan}
        onFocusCapture={() => { taskbarHadFocusRef.current = true; }}
        onBlurCapture={() => {
          window.requestAnimationFrame(() => {
            taskbarHadFocusRef.current = Boolean(appsRef.current?.contains(document.activeElement));
          });
        }}
      >
        <span className="taskbar-measure-layer" aria-hidden="true">
          {taskbarItems.map((item) => (
            <span
              key={item.id}
              ref={(element) => {
                if (element) taskbarMeasurementRefs.current.set(item.id, element);
                else taskbarMeasurementRefs.current.delete(item.id);
              }}
              className="taskbar-app-measure"
            >
              <span className="taskbar-app-measure__icon"><TaskbarAppIcon item={item} /></span>
              <span>{item.label}</span>
              {item.windows.length > 1 ? <small>{item.windows.length}</small> : null}
            </span>
          ))}
        </span>
        {visibleItems.map((item) => {
          const { id, label, windows, selectedWindow: runningWindow } = item;
          const isInternalItem = windows.some((window) => window.internalWindowId);
          const isInternalBuiltin = item.pinnedApplication?.id === "explorer"
            || item.pinnedApplication?.id === "terminal";
          const isActive = isInternalItem
            ? Boolean(runningWindow?.active)
            : hasActiveInternalWindow
              ? false
              : runningWindow?.active
                ?? (
                  platformKind === "mock" &&
                  taskbar.windows.length === 0 &&
                  !isInternalBuiltin &&
                  activeApp === id
                );
          const className = [
            isActive ? "is-active" : "",
            runningWindow ? "is-running" : "",
            item.isPinned ? "is-pinned" : "is-dynamic",
            draggedPinnedId === id ? "is-dragging" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const windowTitle = runningWindow?.title?.trim();
          const itemLayout = layoutById.get(id);
          const baseTitle = runningWindow
            ? `${label}${windowTitle ? ` — ${windowTitle}` : ""}${windows.length > 1
              ? t("taskbar.item.windowCountSuffix", { count: windows.length })
              : ""}${runningWindow.minimized ? t("taskbar.item.minimizedSuffix") : ""}`
            : label;
          const title = item.isPinned
            ? t("taskbar.item.dragToReorder", { title: baseTitle })
            : baseTitle;

          return (
            <button
              key={id}
              ref={(element) => {
                if (element) taskbarButtonRefs.current.set(id, element);
                else taskbarButtonRefs.current.delete(id);
              }}
              type="button"
              className={className}
              data-density={itemLayout?.density ?? "icon"}
              data-label-mode={itemLayout?.density === "full" ? "persistent" : "contextual"}
              style={{ "--taskbar-item-width": `${itemLayout?.width ?? TASKBAR_ICON_SLOT_WIDTH}px` }}
              aria-label={getLocalizedTaskbarAccessibleLabel(item, isActive, t)}
              aria-current={isActive ? "true" : undefined}
              title={title}
              tabIndex={
                focusedTaskbarItemId
                  ? focusedTaskbarItemId === id ? 0 : -1
                  : visibleItems[0]?.id === id ? 0 : -1
              }
              draggable={item.isPinned}
              aria-keyshortcuts={item.isPinned ? "Alt+ArrowLeft Alt+ArrowRight" : undefined}
              onFocus={() => setFocusedTaskbarItemId(id)}
              onPointerEnter={(event) => scheduleHoverPreview(event, item)}
              onPointerLeave={handleHoverPreviewLeave}
              onDragStart={(event) => {
                cancelHoverPreview();
                cancelHoverDismiss();
                setDraggedPinnedId(id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", id);
              }}
              onDragOver={(event) => {
                if (!item.isPinned) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => {
                event.preventDefault();
                reorderPinnedApps(id);
              }}
              onDragEnd={() => setDraggedPinnedId(null)}
              onKeyDown={(event) => {
                if (!event.altKey &&
                    ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                  event.preventDefault();
                  focusTaskbarItemAt(getTaskbarKeyboardTarget(
                    focusableTaskbarIds.length,
                    focusableTaskbarIds.indexOf(id),
                    event.key,
                  ));
                  return;
                }
                if (!item.isPinned || !event.altKey) return;
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  movePinnedApp(id, -1);
                } else if (event.key === "ArrowRight") {
                  event.preventDefault();
                  movePinnedApp(id, 1);
                }
              }}
              onClick={(event) => handleItemClick(event, item)}
              onAuxClick={(event) => handleItemAuxClick(event, item)}
              onContextMenu={(event) => showTaskbarContext(event, item)}
            >
              <TaskbarAppIcon item={item} />
              <span className="taskbar-app-label" aria-hidden="true">{label}</span>
              {windows.length > 1 ? <small className="taskbar-window-count">{windows.length}</small> : null}
            </button>
          );
        })}
        {hasOverflow ? (
          <button
            ref={(element) => {
              if (element) taskbarButtonRefs.current.set("taskbar:overflow", element);
              else taskbarButtonRefs.current.delete("taskbar:overflow");
            }}
            type="button"
            className="taskbar-overflow-button is-running"
            aria-label={t("taskbar.overflow.moreApplications", { count: overflowItems.length })}
            title={t("taskbar.overflow.moreApplications", { count: overflowItems.length })}
            tabIndex={focusedTaskbarItemId === "taskbar:overflow" ? 0 : -1}
            onFocus={() => setFocusedTaskbarItemId("taskbar:overflow")}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              focusTaskbarItemAt(getTaskbarKeyboardTarget(
                focusableTaskbarIds.length,
                focusableTaskbarIds.indexOf("taskbar:overflow"),
                event.key,
              ));
            }}
            onClick={showOverflow}
          >
            <MoreHorizontalRegular />
            <small>{overflowItems.length}</small>
          </button>
        ) : null}
      </nav>
      <div className="system-tray">
        <button
          type="button"
          className="tray-status-button"
          aria-label={t("taskbar.tray.openQuickSettings")}
          title={t("taskbar.tray.status", {
            network: networkAvailable
              ? t("taskbar.tray.connected")
              : t("taskbar.tray.offline"),
            power: power.batteryPresent
              ? t("taskbar.tray.battery", { percentage: Math.round(power.percentage ?? 0) })
              : t("taskbar.tray.acPower"),
          })}
          onClick={onOpenQuickSettings}
        >
          <ChevronUpRegular />
          <Wifi4Regular className={networkAvailable ? "" : "is-offline"} />
          <AudioIcon />
          <PowerIcon />
        </button>
        <button
          type="button"
          className="tray-clock"
          aria-label={t("taskbar.clock.open", {
            date: localizedClock.longDate,
            time: localizedClock.time,
          })}
          title={t("taskbar.clock.title")}
          onClick={onOpenDateTime}
        >
          <strong>{localizedClock.time}</strong>
          <small>{localizedClock.shortDate}</small>
        </button>
        <button
          className="tray-notifications"
          type="button"
          aria-label={alertCount
            ? t("taskbar.feed.ariaWithUnread", { count: alertCount })
            : t("taskbar.feed.aria")}
          title={t("taskbar.feed.title")}
          onClick={onOpenNotifications}
        >
          <AlertRegular />
          {alertCount ? <small>{alertCount}</small> : null}
        </button>
      </div>
      <button
        type="button"
        className="taskbar-show-desktop"
        aria-label={t("taskbar.showDesktop")}
        title={t("taskbar.showDesktop")}
        onClick={onToggleShowDesktop}
      />
      <span className="taskbar-edge-track" aria-hidden="true" />
      {mockFlyout ? (
        <TaskbarLocalFlyout
          key={`${mockFlyout.mode}:${mockFlyout.item?.id ?? "overflow"}`}
          flyout={mockFlyout}
          onActivate={activateMockFlyoutWindow}
          onCloseWindow={closeMockFlyoutWindow}
          onContextAction={executeContextAction}
          onDismiss={() => {
            cancelHoverDismiss();
            setMockFlyout(null);
          }}
          onPointerEnter={cancelHoverDismiss}
          onPointerLeave={scheduleHoverMockDismiss}
        />
      ) : null}
    </footer>
  );
}
