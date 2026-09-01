import {
  AlertRegular,
  ArrowClockwiseRegular,
  ArrowExitRegular,
  CalendarMonthRegular,
  CheckmarkCircleRegular,
  ChevronLeftRegular,
  ChevronRightRegular,
  ClockRegular,
  DismissRegular,
  GlobeRegular,
  OpenRegular,
  PinOffRegular,
  PinRegular,
  PlugConnectedRegular,
  PowerRegular,
  PulseRegular,
  SearchRegular,
  SettingsRegular,
  ShieldRegular,
  Speaker2Regular,
  SpeakerOffRegular,
  WindowAppsRegular,
} from "@fluentui/react-icons";
import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  getUiAudioSnapshot,
  setUiAudioEnabled,
  setUiAudioVolume,
  subscribeUiAudio,
} from "../audio-system.js";
import {
  clearSystemFeed,
  markSystemFeedRead,
  refreshApplicationCatalog,
  refreshDisplayTopology,
  refreshNotificationHistory,
  removeWindowAppearanceRule,
  requestNotificationHistoryAccess,
  retryTaskbarMode,
  setTrayMuted,
  setTrayVolume,
  setTaskbarMode,
  setWindowAppearanceMode,
  setWindowAppearanceRule,
  useApplicationCatalog,
  useDisplayTopology,
  useNotificationHistory,
  usePlatformClock,
  useSystemSnapshot,
  useSystemFeed,
  useTaskbarModeState,
  useTaskbarSnapshot,
  useTrayStatus,
  useWindowAppearanceState,
} from "../hooks/usePlatformData.js";
import {
  createCalendarMonth,
  isTimestampOnLocalDate,
  moveCalendarDate,
  parseLocalDateKey,
  shiftCalendarMonth,
  toLocalDateKey,
} from "../date-time-panel-model.js";
import { mergeSystemFeedEvents } from "../feedback-model.js";
import { helpCenterSections } from "../help-center-model.js";
import { useRecentApplicationIds } from "../hooks/useRecentApplications.js";
import { clearRecentApplications } from "../recent-applications.js";
import { useDialogFocusTrap } from "../hooks/useDialogFocusTrap.js";
import { usePinnedApplicationRefs } from "../hooks/usePinnedApplications.js";
import {
  getPinnedApplicationKey,
  pinApplication,
  unpinApplication,
} from "../pinned-applications.js";
import {
  getMenuApplicationPinKey,
  getMenuApplicationPinReference,
  resolvePinnedApplications,
} from "../pinned-application-model.js";
import { platform } from "../platform/index.js";
import { GraphSourceSettings } from "../graph/GraphSourceSettings.jsx";
import { GraphProfileManager } from "../graph/GraphProfileManager.jsx";
import { CoreNodeGlyph } from "./VectorMarks.jsx";
import {
  quickLaunchItems as startApps,
  quickSettingItems as quickSettings,
} from "../quick-search-catalog.js";
import { normalizeSearchText } from "../quick-search.js";
import {
  createExitChallenge,
  EXIT_TO_WINDOWS_ACTION,
  isSessionChallengeExpired,
  normalizeSessionChallenge,
  normalizeSessionControlState,
} from "../session-control-model.js";
import {
  filterSystemFeed,
  getSystemFeedFilterShortcut,
  getSystemFeedFilterSummary,
} from "../system-feed-filter-model.js";
import { createVolumeCommitScheduler } from "../volume-commit-model.js";

const SESSION_ACTION_ICONS = Object.freeze({
  "exit-jarvis": ArrowExitRegular,
  lock: ShieldRegular,
  "sign-out": ArrowExitRegular,
  restart: ArrowClockwiseRegular,
  "shut-down": PowerRegular,
});
const SYSTEM_FEED_FILTER_IDS = Object.freeze([
  "all",
  "unread",
  "attention",
  "status",
]);
const SESSION_ACTION_TRANSLATION_IDS = Object.freeze({
  "exit-jarvis": "exitJarvis",
  lock: "lock",
  "sign-out": "signOut",
  restart: "restart",
  "shut-down": "shutDown",
});
import {
  buildStartMenuApplications,
  createStartMenuVirtualRows,
  filterStartMenuApplications,
  getStartPanelCommand,
  getStartViewNavigation,
  getStartMenuVirtualWindow,
  groupStartMenuApplications,
} from "../start-menu-model.js";
import { normalizeProcessName } from "../taskbar-grouping.js";
import {
  canRetryTaskbarMode,
  getTaskbarCooldownRemaining,
  getTaskbarTransitionToast,
} from "../taskbar-mode-model.js";
import {
  customVisualPaletteFields,
  getCustomVisualPaletteSnapshot,
  getVisualPaletteContrastReport,
  getVisualThemeDefinition,
  getVisualThemeOptions,
  getVisualThemeSnapshot,
  getVisualThemeVersionSnapshot,
  parseCustomVisualTheme,
  resetCustomVisualPalette,
  serializeCustomVisualTheme,
  setCustomVisualPalette,
  setVisualTheme,
  subscribeVisualTheme,
} from "../theme-system.js";
import {
  getInterfacePreferencesSnapshot,
  resetInterfacePreferences,
  setInterfacePreferences,
  subscribeInterfacePreferences,
} from "../interface-preferences.js";
import {
  LANGUAGE_OPTIONS,
  setLanguagePreference,
  useLanguage,
} from "../i18n/language-system.js";
import {
  formatClockPresentation,
  formatDate,
  formatTime,
  getCalendarWeekdayLabels,
} from "../i18n/locale-format.js";
import {
  getWindowCompatibilityReasonLabel,
  normalizeWindowAppearanceProcessName,
} from "../window-appearance-model.js";

const VisualEffectsSettings = lazy(() => import("../visual-effects/VisualEffectsSettings.jsx")
  .then((module) => ({ default: module.VisualEffectsSettings })));
const GraphVisualSettings = lazy(() => import("../graphics/graph/GraphVisualSettings.jsx")
  .then((module) => ({ default: module.GraphVisualSettings })));

class OptionalSettingsBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <p className="runtime-settings-error" role="status">
          {this.props.fallbackMessage ??
            "OPTIONAL SCREEN EFFECTS UNAVAILABLE · CORE SETTINGS REMAIN ACTIVE"}
        </p>
      );
    }
    return this.props.children;
  }
}

const windowAppearanceOptions = [
  {
    mode: "off",
    level: "L0",
    title: "OFF",
    labelKey: "settings.windows.appearance.option.off.label",
    tagKey: "settings.windows.appearance.option.off.tag",
    descriptionKey: "settings.windows.appearance.option.off.description",
  },
  {
    mode: "conservative",
    level: "L1",
    title: "CONSERVATIVE",
    labelKey: "settings.windows.appearance.option.conservative.label",
    tagKey: "settings.windows.appearance.option.conservative.tag",
    descriptionKey: "settings.windows.appearance.option.conservative.description",
  },
  {
    mode: "enhanced",
    level: "L2",
    title: "ENHANCED",
    labelKey: "settings.windows.appearance.option.enhanced.label",
    tagKey: "settings.windows.appearance.option.enhanced.tag",
    descriptionKey: "settings.windows.appearance.option.enhanced.description",
  },
  {
    mode: "immersive",
    level: "L3",
    title: "IMMERSIVE",
    labelKey: "settings.windows.appearance.option.immersive.label",
    tagKey: "settings.windows.appearance.option.immersive.tag",
    descriptionKey: "settings.windows.appearance.option.immersive.description",
  },
];

const windowAppearanceLabels = Object.fromEntries(
  windowAppearanceOptions.map((option) => [option.mode, option.title]),
);

const taskbarModeOptions = [
  {
    mode: "native",
    title: "NATIVE",
    labelKey: "settings.taskbar.option.native.label",
    descriptionKey: "settings.taskbar.option.native.description",
  },
  {
    mode: "hybrid",
    title: "HYBRID",
    labelKey: "settings.taskbar.option.hybrid.label",
    descriptionKey: "settings.taskbar.option.hybrid.description",
  },
  {
    mode: "full",
    title: "FULL",
    labelKey: "settings.taskbar.option.full.label",
    descriptionKey: "settings.taskbar.option.full.description",
  },
];

const windowCompatibilityReasonKeys = Object.freeze({
  automatic: "settings.windows.compatibility.reason.automatic",
  "user-allow": "settings.windows.compatibility.reason.userAllow",
  "user-deny": "settings.windows.compatibility.reason.userDeny",
  "system-protected": "settings.windows.compatibility.reason.systemProtected",
  "jarvis-host": "settings.windows.compatibility.reason.jarvisHost",
  "integrity-or-access": "settings.windows.compatibility.reason.integrityOrAccess",
  "non-application-window": "settings.windows.compatibility.reason.nonApplicationWindow",
  "no-standard-caption": "settings.windows.compatibility.reason.noStandardCaption",
  "system-window-class": "settings.windows.compatibility.reason.systemWindowClass",
  "window-cloaked": "settings.windows.compatibility.reason.windowCloaked",
  fullscreen: "settings.windows.compatibility.reason.fullscreen",
  "no-compatible-window": "settings.windows.compatibility.reason.noCompatibleWindow",
});

const interfaceMotionOptions = Object.freeze([
  Object.freeze({
    id: "system",
    labelKey: "settings.interface.motion.option.system.label",
    detailKey: "settings.interface.motion.option.system.description",
  }),
  Object.freeze({
    id: "reduced",
    labelKey: "settings.interface.motion.option.reduced.label",
    detailKey: "settings.interface.motion.option.reduced.description",
  }),
  Object.freeze({
    id: "full",
    labelKey: "settings.interface.motion.option.full.label",
    detailKey: "settings.interface.motion.option.full.description",
  }),
]);

const interfaceEmissionOptions = Object.freeze([
  Object.freeze({
    id: "standard",
    labelKey: "settings.interface.emission.option.standard.label",
    detailKey: "settings.interface.emission.option.standard.description",
  }),
  Object.freeze({
    id: "subtle",
    labelKey: "settings.interface.emission.option.subtle.label",
    detailKey: "settings.interface.emission.option.subtle.description",
  }),
  Object.freeze({
    id: "minimal",
    labelKey: "settings.interface.emission.option.minimal.label",
    detailKey: "settings.interface.emission.option.minimal.description",
  }),
]);

const interfaceThemeTranslationKeys = Object.freeze({
  nexus: Object.freeze({
    labelKey: "settings.interface.theme.option.nexus.label",
    descriptionKey: "settings.interface.theme.option.nexus.description",
  }),
  stealth: Object.freeze({
    labelKey: "settings.interface.theme.option.stealth.label",
    descriptionKey: "settings.interface.theme.option.stealth.description",
  }),
  clarity: Object.freeze({
    labelKey: "settings.interface.theme.option.clarity.label",
    descriptionKey: "settings.interface.theme.option.clarity.description",
  }),
  custom: Object.freeze({
    labelKey: "settings.interface.theme.option.custom.label",
    descriptionKey: "settings.interface.theme.option.custom.description",
  }),
});

const interfacePaletteFieldLabelKeys = Object.freeze({
  background: "settings.interface.palette.field.background",
  surface: "settings.interface.palette.field.surface",
  card: "settings.interface.palette.field.card",
  text: "settings.interface.palette.field.text",
  textStrong: "settings.interface.palette.field.textStrong",
  muted: "settings.interface.palette.field.muted",
  border: "settings.interface.palette.field.border",
  accent: "settings.interface.palette.field.accent",
});

const interfaceContrastCheckLabelKeys = Object.freeze({
  "text-background": "settings.interface.palette.contrast.textBackground",
  "text-surface": "settings.interface.palette.contrast.textSurface",
  "strong-card": "settings.interface.palette.contrast.strongCard",
  "muted-background": "settings.interface.palette.contrast.mutedBackground",
  "accent-background": "settings.interface.palette.contrast.accentBackground",
});

function getWindowsReleaseLabel(windows11, osBuild) {
  if (!windows11) return "WIN10";
  const build = Number.parseInt(String(osBuild ?? ""), 10);
  if (Number.isFinite(build) && build >= 28000) return "WIN11 26H1";
  if (Number.isFinite(build) && build >= 26200) return "WIN11 25H2";
  if (Number.isFinite(build) && build >= 26100) return "WIN11 24H2";
  return "WIN11";
}

function formatUptime(seconds) {
  const totalMinutes = Math.max(0, Math.floor(Number(seconds) / 60));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return days > 0 ? `${days}D ${hours}H` : `${hours}H ${minutes}M`;
}

function formatFeedTime(timestamp, language) {
  return formatTime(timestamp, language, { second: "2-digit" });
}

function PanelHeader({ eyebrow, title, onClose, closeLabel }) {
  return (
    <header className="shell-panel-header">
      <span><strong>{title}</strong><small>{eyebrow}</small></span>
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel ?? `Close ${title}`}
      >
        <DismissRegular />
      </button>
    </header>
  );
}

function getApplicationSourceLabel(source, t) {
  if (source === "packaged") return t("start.applicationSource.packaged");
  if (source === "user") return t("start.applicationSource.user");
  if (source === "common") return t("start.applicationSource.common");
  return t("start.applicationSource.pinned");
}

function StartMenuApplicationIcon({ application }) {
  if (application.iconDataUrl) return <img src={application.iconDataUrl} alt="" />;
  if (application.pinnedApplication?.Icon) {
    const Icon = application.pinnedApplication.Icon;
    return <Icon />;
  }
  return <WindowAppsRegular />;
}

function StartMenuApplicationRow({
  application,
  applicationIndex = null,
  isPinned,
  onNavigate = null,
  onOpen,
  onTogglePin,
  t,
}) {
  const sourceLabel = getApplicationSourceLabel(application.source, t);
  const categoryLabel = application.kind === "pinned"
    ? t("start.applicationCategory.pinned")
    : application.category;
  return (
    <div className={`start-application-row${isPinned ? " is-pinned" : ""}`}>
      <button
        type="button"
        className="start-application-main"
        data-start-application-index={applicationIndex}
        onKeyDown={onNavigate}
        onClick={() => onOpen(application)}
        title={`${application.label} · ${sourceLabel}`}
      >
        <span className="start-application-icon"><StartMenuApplicationIcon application={application} /></span>
        <span className="start-application-copy">
          <strong>{application.label}</strong>
          <small>{sourceLabel} · {categoryLabel}</small>
        </span>
      </button>
      <button
        type="button"
        className="start-application-pin"
        onClick={() => onTogglePin(application)}
        aria-label={t(isPinned
          ? "start.action.unpinApplication"
          : "start.action.pinApplication", { application: application.label })}
        title={t(isPinned
          ? "start.action.unpinFromTaskbar"
          : "start.action.pinToTaskbar")}
      >
        {isPinned ? <PinOffRegular /> : <PinRegular />}
      </button>
    </div>
  );
}

function StartApplicationGroups({
  groups,
  pinnedKeys,
  onOpen,
  onTogglePin,
  emptyLabel,
  t,
}) {
  const viewportRef = useRef(null);
  const frameRef = useRef(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 320 });
  const [pendingFocusIndex, setPendingFocusIndex] = useState(null);
  const layout = useMemo(() => createStartMenuVirtualRows(groups), [groups]);
  const visibleRows = useMemo(
    () => getStartMenuVirtualWindow(layout.rows, viewport.scrollTop, viewport.height),
    [layout.rows, viewport.height, viewport.scrollTop],
  );
  const orderedApplications = useMemo(
    () => groups.flatMap((group) => group.items),
    [groups],
  );
  const applicationIndexById = useMemo(
    () => new Map(orderedApplications.map((application, index) => [application.menuId, index])),
    [orderedApplications],
  );

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return undefined;
    const updateHeight = () => {
      setViewport((current) => ({
        scrollTop: element.scrollTop,
        height: Math.max(1, element.clientHeight),
      }));
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (pendingFocusIndex === null) return;
    const element = viewportRef.current;
    const target = element?.querySelector(
      `[data-start-application-index="${pendingFocusIndex}"]`,
    );
    if (!target) return;
    target.focus();
    setPendingFocusIndex(null);
  }, [pendingFocusIndex, visibleRows]);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  const handleScroll = useCallback((event) => {
    const element = event.currentTarget;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setViewport({
        scrollTop: element.scrollTop,
        height: Math.max(1, element.clientHeight),
      });
    });
  }, []);

  const focusApplication = useCallback((index) => {
    const targetIndex = Math.max(0, Math.min(orderedApplications.length - 1, index));
    const targetApplication = orderedApplications[targetIndex];
    const targetRow = layout.rows.find((row) => (
      row.kind === "applications" &&
      row.items.some((application) => application.menuId === targetApplication?.menuId)
    ));
    const element = viewportRef.current;
    if (!element || !targetRow) return;
    const rowBottom = targetRow.top + targetRow.height;
    if (targetRow.top < element.scrollTop) {
      element.scrollTop = targetRow.top;
    } else if (rowBottom > element.scrollTop + element.clientHeight) {
      element.scrollTop = rowBottom - element.clientHeight;
    }
    setViewport({ scrollTop: element.scrollTop, height: Math.max(1, element.clientHeight) });
    setPendingFocusIndex(targetIndex);
  }, [layout.rows, orderedApplications]);

  const handleApplicationNavigation = useCallback((event) => {
    const currentIndex = Number(event.currentTarget.dataset.startApplicationIndex);
    const currentApplication = orderedApplications[currentIndex];
    const currentRowIndex = layout.rows.findIndex((row) => (
      row.kind === "applications" &&
      row.items.some((application) => application.menuId === currentApplication?.menuId)
    ));
    const currentRow = layout.rows[currentRowIndex];
    const currentColumn = currentRow?.kind === "applications"
      ? currentRow.items.findIndex((application) => application.menuId === currentApplication?.menuId)
      : 0;
    let targetIndex = event.key === "ArrowRight"
      ? currentIndex + 1
      : event.key === "ArrowLeft"
        ? currentIndex - 1
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? orderedApplications.length - 1
            : null;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const step = event.key === "ArrowDown" ? 1 : -1;
      let rowIndex = currentRowIndex + step;
      while (rowIndex >= 0 && rowIndex < layout.rows.length) {
        const row = layout.rows[rowIndex];
        if (row.kind === "applications") {
          const targetApplication = row.items[Math.min(currentColumn, row.items.length - 1)];
          targetIndex = applicationIndexById.get(targetApplication.menuId);
          break;
        }
        rowIndex += step;
      }
    }

    if (targetIndex === null) return;
    event.preventDefault();
    focusApplication(targetIndex);
  }, [
    applicationIndexById,
    focusApplication,
    layout.rows,
    orderedApplications,
  ]);

  return (
    <div
      ref={viewportRef}
      className="start-all-apps"
      onScroll={handleScroll}
      aria-label={t("start.allApplications")}
    >
      {groups.length === 0 ? (
        <p className="shell-empty-state start-app-empty">{emptyLabel}</p>
      ) : (
        <div className="start-virtual-space" style={{ height: `${layout.totalHeight}px` }}>
          {visibleRows.map((row) => (
            row.kind === "group" ? (
              <div
                className="start-virtual-group-row"
                key={row.key}
                style={{ transform: `translateY(${row.top}px)`, height: `${row.height}px` }}
                aria-hidden="true"
              >
                <span>{row.label}</span><i />
              </div>
            ) : (
              <div
                className="start-virtual-application-row"
                key={row.key}
                style={{ transform: `translateY(${row.top}px)`, height: `${row.height}px` }}
              >
                {row.items.map((application) => (
                  <StartMenuApplicationRow
                    key={application.menuId}
                    application={application}
                    applicationIndex={applicationIndexById.get(application.menuId)}
                    isPinned={pinnedKeys.has(getMenuApplicationPinKey(application))}
                    onNavigate={handleApplicationNavigation}
                    onOpen={onOpen}
                    onTogglePin={onTogglePin}
                    t={t}
                  />
                ))}
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}

function StartPanel({
  onClose,
  onLaunch,
  onLaunchInstalled,
  onActivateWindow,
  onOpenHelp,
  onOpenSession,
}) {
  const { language, t } = useLanguage();
  const taskbar = useTaskbarSnapshot();
  const system = useSystemSnapshot();
  const applicationCatalog = useApplicationCatalog();
  const recentApplicationIds = useRecentApplicationIds();
  const pinnedApplicationRefs = usePinnedApplicationRefs();
  const searchRef = useRef(null);
  const pinnedViewRef = useRef(null);
  const allViewRef = useRef(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState("pinned");
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = normalizeSearchText(deferredQuery);
  const menuApplications = useMemo(() => buildStartMenuApplications(
    startApps,
    applicationCatalog.applications,
    language,
  ), [applicationCatalog.applications, language]);
  const filteredApplications = useMemo(
    () => filterStartMenuApplications(menuApplications, normalizedQuery, language),
    [language, menuApplications, normalizedQuery],
  );
  const applicationGroups = useMemo(
    () => groupStartMenuApplications(filteredApplications),
    [filteredApplications],
  );
  const pinnedKeys = useMemo(() => new Set(pinnedApplicationRefs
    .map(getPinnedApplicationKey)
    .filter(Boolean)), [pinnedApplicationRefs]);
  const pinnedApplications = useMemo(
    () => resolvePinnedApplications(pinnedApplicationRefs, menuApplications),
    [menuApplications, pinnedApplicationRefs],
  );
  const recentApplications = useMemo(() => {
    const applicationById = new Map(menuApplications
      .filter((application) => application.kind === "installed")
      .map((application) => [application.applicationId, application]));
    return recentApplicationIds
      .map((applicationId) => applicationById.get(applicationId))
      .filter(Boolean)
      .slice(0, 4);
  }, [menuApplications, recentApplicationIds]);
  const runningApps = useMemo(() => {
    const groups = new Map();
    taskbar.windows.forEach((window) => {
      const process = normalizeProcessName(window.processName);
      if (!groups.has(process)) groups.set(process, { process, windows: [] });
      groups.get(process).windows.push(window);
    });
    return Array.from(groups.values())
      .filter((group) => !normalizedQuery || normalizeSearchText(group.process).includes(normalizedQuery) ||
        group.windows.some((window) => normalizeSearchText(window.title).includes(normalizedQuery)))
      .slice(0, 5);
  }, [normalizedQuery, taskbar.windows]);
  const openMenuApplication = useCallback((application) => {
    if (application.kind === "installed") {
      onLaunchInstalled(application.application);
      return;
    }
    onLaunch({
      label: application.pinnedApplication.label,
      target: application.pinnedApplication.target,
    });
  }, [onLaunch, onLaunchInstalled]);
  const togglePinnedApplication = useCallback((application) => {
    const reference = getMenuApplicationPinReference(application);
    const key = getPinnedApplicationKey(reference);
    if (!reference || !key) return;
    if (pinnedKeys.has(key)) {
      unpinApplication(key);
      return;
    }
    pinApplication(reference);
  }, [pinnedKeys]);
  const contentMode = normalizedQuery ? "search" : view;
  const catalogStatus = applicationCatalog.error
    ? t("start.catalog.unavailable")
    : applicationCatalog.loading
      ? t("start.catalog.indexing")
      : applicationCatalog.truncated
        ? t("start.catalog.partial", {
          count: applicationCatalog.applications.length,
        })
        : applicationCatalog.watching
          ? t("start.catalog.live", {
            count: applicationCatalog.applications.length,
            revision: applicationCatalog.revision,
          })
          : t("start.catalog.ready", {
            count: applicationCatalog.applications.length,
          });
  const catalogStatusTitle = applicationCatalog.indexedAtUtc
    ? t("start.catalog.indexed", {
      time: formatFeedTime(applicationCatalog.indexedAtUtc, language),
      reason: applicationCatalog.refreshReason,
    })
    : t("start.catalog.pending");
  const setStartView = useCallback((nextView, focus = false) => {
    setQuery("");
    setView(nextView);
    if (focus) {
      window.requestAnimationFrame(() => {
        (nextView === "all" ? allViewRef : pinnedViewRef).current?.focus();
      });
    }
  }, []);
  const handleStartKeyboard = useCallback((event) => {
    const command = getStartPanelCommand(event);
    if (!command) return;
    event.preventDefault();
    if (command === "focus-search") {
      searchRef.current?.focus();
      searchRef.current?.select();
    } else {
      setStartView(command === "view-all" ? "all" : "pinned", true);
    }
  }, [setStartView]);
  const handleViewKeyboard = useCallback((event) => {
    const nextView = getStartViewNavigation(view, event.key);
    if (!nextView) return;
    event.preventDefault();
    setStartView(nextView, true);
  }, [setStartView, view]);

  return (
    <section
      className="shell-panel start-panel"
      role="dialog"
      aria-modal="false"
      aria-label={t("start.accessibility.dialog")}
      onKeyDownCapture={handleStartKeyboard}
    >
      <PanelHeader
        eyebrow={t("start.header.eyebrow")}
        title={t("start.header.title")}
        closeLabel={t("common.action.close")}
        onClose={onClose}
      />
      <div className="start-search">
        <SearchRegular />
        <input
          ref={searchRef}
          autoFocus
          data-dialog-initial-focus="true"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("start.search.placeholder")}
          aria-label={t("start.search.accessibility.label")}
        />
      </div>

      <div
        className="start-view-switch"
        role="tablist"
        aria-label={t("start.view.accessibility.label")}
      >
        <button
          ref={pinnedViewRef}
          type="button"
          role="tab"
          aria-selected={view === "pinned"}
          className={view === "pinned" ? "is-active" : ""}
          onClick={() => setStartView("pinned")}
          onKeyDown={handleViewKeyboard}
        >
          <span>{t("start.view.pinned")}</span><small>{pinnedApplications.length}</small>
        </button>
        <button
          ref={allViewRef}
          type="button"
          role="tab"
          aria-selected={view === "all"}
          className={view === "all" ? "is-active" : ""}
          onClick={() => setStartView("all")}
          onKeyDown={handleViewKeyboard}
        >
          <span>{t("start.view.allApps")}</span><small>{menuApplications.length}</small>
        </button>
        <span
          className={applicationCatalog.error ? "is-error" : ""}
          title={catalogStatusTitle}
        >
          {catalogStatus}
        </span>
        <button
          type="button"
          className="start-catalog-refresh"
          onClick={() => refreshApplicationCatalog(true)}
          disabled={applicationCatalog.loading}
          aria-label={t("start.action.refreshCatalog")}
          title={t("start.action.refreshWindowsCatalog")}
        >
          <ArrowClockwiseRegular />
        </button>
      </div>

      <div
        className={`start-panel-content is-${contentMode}`}
        aria-busy={applicationCatalog.loading || query !== deferredQuery}
      >
        {contentMode === "pinned" ? (
          <>
            <div className="start-section-heading">
              <span>{t("start.section.pinned")}</span>
              <small>{t("start.count.apps", { count: pinnedApplications.length })}</small>
            </div>
            <div className="start-app-grid">
              {pinnedApplications.length > 0 ? pinnedApplications.map((application) => (
                <div className="start-pinned-tile" key={application.menuId}>
                  <button
                    type="button"
                    className="start-pinned-launch"
                    onClick={() => openMenuApplication(application)}
                    title={application.label}
                  >
                    <span><StartMenuApplicationIcon application={application} /></span>
                    <strong>{application.label}</strong>
                  </button>
                  <button
                    type="button"
                    className="start-pinned-remove"
                    onClick={() => unpinApplication(getMenuApplicationPinKey(application))}
                    aria-label={t("start.action.unpinApplication", {
                      application: application.label,
                    })}
                    title={t("start.action.unpinApplication", {
                      application: application.label,
                    })}
                  >
                    <PinOffRegular />
                  </button>
                </div>
              )) : (
                <p className="shell-empty-state start-pinned-empty">
                  {t("start.empty.pinned")}
                </p>
              )}
            </div>

            {recentApplications.length > 0 ? (
              <>
                <div className="start-section-heading">
                  <span>{t("start.section.recent")}</span>
                  <span className="start-heading-actions">
                    <small>{t("start.count.local", {
                      count: recentApplications.length,
                    })}</small>
                    <button
                      type="button"
                      onClick={clearRecentApplications}
                      aria-label={t("start.action.clearRecent")}
                    >
                      {t("start.action.clear")}
                    </button>
                  </span>
                </div>
                <div className="start-recent-list">
                  {recentApplications.map((application) => (
                    <StartMenuApplicationRow
                      key={application.menuId}
                      application={application}
                      isPinned={pinnedKeys.has(getMenuApplicationPinKey(application))}
                      onOpen={openMenuApplication}
                      onTogglePin={togglePinnedApplication}
                      t={t}
                    />
                  ))}
                </div>
              </>
            ) : null}
          </>
        ) : (
          <>
            <div className="start-section-heading">
              <span>{t(contentMode === "search"
                ? "start.section.matches"
                : "start.section.allApplications")}</span>
              <small>{t("start.count.results", {
                count: filteredApplications.length,
              })}</small>
            </div>
            <StartApplicationGroups
              groups={applicationGroups}
              pinnedKeys={pinnedKeys}
              onOpen={openMenuApplication}
              onTogglePin={togglePinnedApplication}
              emptyLabel={t(applicationCatalog.loading
                ? "start.empty.indexing"
                : "start.empty.noMatches")}
              t={t}
            />
          </>
        )}

        {contentMode !== "all" ? (
          <>
            <div className="start-section-heading">
              <span>{t("start.section.running")}</span>
              <small>{t(taskbar.windows.length === 1
                ? "start.count.window.one"
                : "start.count.window.other", {
                count: taskbar.windows.length,
              })}</small>
            </div>
            <div className="start-running-list">
              {runningApps.length > 0 ? runningApps.map((group) => {
                const selected = group.windows.find((window) => window.active) ?? group.windows[0];
                return (
                  <button key={group.process} type="button" onClick={() => onActivateWindow(selected)}>
                    {selected.iconDataUrl
                      ? <img src={selected.iconDataUrl} alt="" />
                      : <WindowAppsRegular />}
                    <span>
                      <strong>{selected.title || group.process}</strong>
                      <small>{group.process} · {t(group.windows.length === 1
                        ? "start.count.window.one"
                        : "start.count.window.other", {
                        count: group.windows.length,
                      })}</small>
                    </span>
                  </button>
                );
              }) : (
                <p className="shell-empty-state">{t("start.empty.running")}</p>
              )}
            </div>
          </>
        ) : null}
      </div>

      <footer className="start-footer">
        <span><strong>{system.status.machineName}</strong><small>{system.status.osDescription}</small></span>
        <button type="button" onClick={onOpenHelp}>
          <PulseRegular /><span>{t("start.footer.help")}</span>
        </button>
        <button
          type="button"
          onClick={() => onLaunch({
            label: t("start.footer.jarvisSettings"),
            target: "jarvis-settings:",
          })}
        >
          <SettingsRegular /><span>{t("start.footer.settings")}</span>
        </button>
        <button type="button" className="is-exit" onClick={onOpenSession}>
          <PowerRegular /><span>{t("start.footer.sessionControls")}</span>
        </button>
      </footer>
    </section>
  );
}

function QuickSettingsPanel({ onClose, onLaunch }) {
  const { t } = useLanguage();
  const system = useSystemSnapshot();
  const tray = useTrayStatus();
  const volumeCommitRef = useRef(null);
  const [volume, setVolume] = useState(tray.audio.volumePercent ?? 0);
  const [audioError, setAudioError] = useState("");
  const { network, power, audio } = tray;
  const AudioIcon = audio.muted ? SpeakerOffRegular : Speaker2Regular;
  const powerLabel = power.batteryPresent
    ? power.charging
      ? t("quickSettings.power.batteryCharging", {
        percent: Math.round(power.percentage ?? 0),
      })
      : `${Math.round(power.percentage ?? 0)}%`
    : t(power.acConnected
      ? "quickSettings.power.acPower"
      : "quickSettings.power.desktopPower");

  useEffect(() => {
    if (audio.volumePercent !== null) {
      setVolume(audio.volumePercent);
    }
  }, [audio.volumePercent]);

  useEffect(() => {
    const scheduler = createVolumeCommitScheduler(async (nextVolume) => {
      setAudioError("");
      try {
        await setTrayVolume(nextVolume);
      } catch (error) {
        setAudioError(error.message);
      }
    });
    volumeCommitRef.current = scheduler;
    return () => {
      scheduler.cancel();
      volumeCommitRef.current = null;
    };
  }, []);

  const commitVolume = () => volumeCommitRef.current?.flush(volume);

  const toggleMute = async () => {
    setAudioError("");
    try {
      await setTrayMuted(!audio.muted);
    } catch (error) {
      setAudioError(error.message);
    }
  };

  return (
    <section
      className="shell-panel quick-settings-panel"
      role="dialog"
      aria-modal="false"
      aria-label={t("quickSettings.accessibility.dialog")}
    >
      <PanelHeader
        eyebrow={t("quickSettings.header.eyebrow")}
        title={t("quickSettings.header.title")}
        closeLabel={t("common.action.close")}
        onClose={onClose}
      />
      <div className="quick-status-strip">
        <span className={network.available ? "is-online" : "is-offline"}>
          <GlobeRegular />
          <strong>{t(network.available
            ? "quickSettings.network.online"
            : "quickSettings.network.offline")}</strong>
          <small>{network.interfaceName}</small>
        </span>
        <span>
          <PlugConnectedRegular />
          <strong>{powerLabel}</strong>
          <small>{t(power.batteryPresent
            ? "quickSettings.power.battery"
            : "quickSettings.power.power")}</small>
        </span>
      </div>
      <section
        className="quick-volume-card"
        aria-label={t("quickSettings.audio.outputVolume")}
      >
        <span className="runtime-setting-icon"><AudioIcon /></span>
        <span>
          <strong>{audio.available
            ? audio.muted
              ? t("quickSettings.audio.muted")
              : `${volume}%`
            : t("quickSettings.state.unavailable")}</strong>
          <small>{tray.simulation
            ? t("quickSettings.audio.simulation")
            : audio.deviceLabel ?? t("quickSettings.audio.defaultWindowsOutput")}</small>
        </span>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={volume}
          disabled={!audio.available}
          aria-label={t("quickSettings.audio.outputVolume")}
          aria-valuetext={audio.available
            ? t("quickSettings.audio.volumePercent", { volume })
            : t("quickSettings.audio.unavailable")}
          onChange={(event) => {
            const nextVolume = Number(event.target.value);
            setVolume(nextVolume);
            volumeCommitRef.current?.schedule(nextVolume);
          }}
          onPointerUp={commitVolume}
          onKeyUp={commitVolume}
        />
        <button
          type="button"
          className={`runtime-switch ${audio.muted ? "" : "is-on"}`}
          role="switch"
          aria-checked={!audio.muted}
          aria-label={t(audio.muted
            ? "quickSettings.audio.action.unmute"
            : "quickSettings.audio.action.mute")}
          disabled={!audio.available}
          onClick={toggleMute}
        >
          <span />
          <strong>{t(audio.muted
            ? "quickSettings.audio.muted"
            : "quickSettings.audio.live")}</strong>
        </button>
      </section>
      {audioError ? <p className="runtime-settings-error" role="alert"><AlertRegular />{audioError}</p> : null}
      <div className="quick-setting-grid">
        {quickSettings.map(({ id, target, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onLaunch({
              label: t(`quickSettings.control.${id}`),
              target,
            })}
          >
            <span><Icon /></span>
            <strong>{t(`quickSettings.control.${id}`)}</strong>
            <small>{id === "network"
              ? network.available
                ? network.interfaceType
                : t("quickSettings.state.unavailable")
              : t("quickSettings.action.openControl")}</small>
          </button>
        ))}
      </div>
      <footer className="quick-settings-footer">
        <span>{t("quickSettings.sessionUptime")}</span>
        <strong>{formatUptime(system.status.uptimeSeconds)}</strong>
      </footer>
    </section>
  );
}

function NotificationsPanel({
  localEvents = [],
  onClearLocalFeed,
  onClose,
  onLaunch,
  onMarkLocalFeedRead,
}) {
  const { language, t } = useLanguage();
  const feed = useSystemFeed();
  const notificationHistory = useNotificationHistory();
  const [feedFilter, setFeedFilter] = useState("all");
  const [feedQuery, setFeedQuery] = useState("");
  const deferredFeedQuery = useDeferredValue(feedQuery);
  const events = useMemo(
    () => mergeSystemFeedEvents(localEvents, feed.items, 50),
    [feed.items, localEvents],
  );
  const visibleFeedItems = useMemo(
    () => filterSystemFeed(events, {
      filter: feedFilter,
      query: deferredFeedQuery,
    }),
    [deferredFeedQuery, events, feedFilter],
  );
  const feedSummary = useMemo(
    () => getSystemFeedFilterSummary(events, visibleFeedItems),
    [events, visibleFeedItems],
  );
  const feedSummaryLabel = t(
    `${feedSummary.visible === feedSummary.total
      ? "notifications.summary.all"
      : "notifications.summary.filtered"}.${feedSummary.total === 1 ? "one" : "other"}`,
    {
      count: feedSummary.total,
      total: feedSummary.total,
      visible: feedSummary.visible,
    },
  );
  const unreadCount = events.filter((item) => item.unread).length;
  const markAllRead = async () => {
    await Promise.allSettled([markSystemFeedRead()]);
    onMarkLocalFeedRead?.();
  };
  const clearAll = async () => {
    await Promise.allSettled([clearSystemFeed()]);
    onClearLocalFeed?.();
  };
  const actionTargets = {
    "open-network-settings": {
      label: t("notifications.action.networkSettings"),
      target: "ms-settings:network-status",
    },
    "open-sound-settings": {
      label: t("notifications.action.soundSettings"),
      target: "ms-settings:sound",
    },
    "open-power-settings": {
      label: t("notifications.action.powerSettings"),
      target: "ms-settings:powersleep",
    },
    "open-runtime-settings": {
      label: t("notifications.action.jarvisSettings"),
      target: "jarvis-settings:",
    },
  };

  return (
    <section
      className="shell-panel shell-notifications-panel"
      role="dialog"
      aria-modal="false"
      aria-label={t("notifications.accessibility.dialog")}
      onKeyDown={(event) => {
        const nextFilter = getSystemFeedFilterShortcut(event);
        if (!nextFilter) return;
        event.preventDefault();
        setFeedFilter(nextFilter);
      }}
    >
      <PanelHeader
        eyebrow={t("notifications.header.eyebrow")}
        title={t("notifications.header.title")}
        closeLabel={t("common.action.close")}
        onClose={onClose}
      />
      <div className={`windows-history-status is-${notificationHistory.historyAvailable ? "ready" : "limited"}`}>
        <span><WindowAppsRegular /></span>
        <span>
          <strong>{t("notifications.history.title")}</strong>
          <small>{notificationHistory.historyAvailable
            ? t("notifications.history.available", {
              count: notificationHistory.items.length,
            })
            : notificationHistory.reason ?? t("notifications.history.checkingAccess")}</small>
        </span>
        <code>{notificationHistory.loading
          ? t("notifications.history.checking")
          : notificationHistory.accessStatus.toUpperCase()}</code>
      </div>
      <div
        className="system-feed-controls"
        role="toolbar"
        aria-label={t("notifications.filter.accessibility.label")}
      >
        {SYSTEM_FEED_FILTER_IDS.map((id, index) => (
          <button
            key={id}
            type="button"
            className={feedFilter === id ? "is-active" : ""}
            aria-pressed={feedFilter === id}
            aria-keyshortcuts={`Control+${index + 1}`}
            title={`Ctrl+${index + 1}`}
            data-dialog-initial-focus={index === 0 ? "true" : undefined}
            onClick={() => setFeedFilter(id)}
          >
            <span>{t(`notifications.filter.${id}`)}</span><kbd>{index + 1}</kbd>
          </button>
        ))}
        <label>
          <SearchRegular aria-hidden="true" />
          <input
            value={feedQuery}
            maxLength={96}
            placeholder={t("notifications.search.placeholder")}
            aria-label={t("notifications.search.accessibility.label")}
            onChange={(event) => setFeedQuery(event.target.value)}
          />
        </label>
        <code>{feedSummaryLabel}</code>
      </div>
      <div className="shell-notification-list">
        {feed.loading ? (
          <p className="system-feed-empty">{t("notifications.status.connecting")}</p>
        ) : null}
        {feed.error ? <p className="runtime-settings-error" role="alert"><AlertRegular />{feed.error}</p> : null}
        {!feed.loading && !feed.error && events.length === 0
          ? <p className="system-feed-empty">{t("notifications.empty.session")}</p>
          : null}
        {!feed.loading && !feed.error && events.length > 0 && visibleFeedItems.length === 0
          ? <p className="system-feed-empty">{t("notifications.empty.filter")}</p>
          : null}
        {visibleFeedItems.map((item) => {
          const target = actionTargets[item.actionId];
          const Item = target ? "button" : "div";
          const Icon = item.severity === "ok" ? CheckmarkCircleRegular : item.severity === "info" ? WindowAppsRegular : AlertRegular;
          return (
            <Item
              key={item.id}
              {...(target
                ? { type: "button", onClick: () => onLaunch(target) }
                : { role: "status" })}
              className={`shell-notification-item is-${item.severity} ${item.unread ? "is-unread" : ""}`}
            >
              <span><Icon /></span>
              <span><strong>{item.title}</strong><small>{item.detail}</small></span>
              <time dateTime={item.timestamp ?? undefined}>
                {formatFeedTime(item.timestamp, language)}
              </time>
            </Item>
          );
        })}
      </div>
      <footer className="notification-footer">
        <span>{t(`notifications.footer.visibleUnread.${feedSummary.visibleUnread === 1 ? "one" : "other"}`, {
          count: feedSummary.visibleUnread,
        })} · {feedSummaryLabel}</span>
        <button
          type="button"
          disabled={unreadCount === 0}
          onClick={() => void markAllRead()}
        >
          {t("notifications.action.markAllRead")}
        </button>
        <button
          type="button"
          disabled={events.length === 0}
          onClick={() => void clearAll()}
        >
          {t("notifications.action.clear")}
        </button>
      </footer>
    </section>
  );
}

function DateTimePanel({ onClose, onLaunch }) {
  const { language, t } = useLanguage();
  const clock = usePlatformClock();
  const feed = useSystemFeed();
  const localizedClock = formatClockPresentation(clock.dateTime, language);
  const todayKey = toLocalDateKey(clock.dateTime) ??
    toLocalDateKey(new Date());
  const today = parseLocalDateKey(todayKey) ?? new Date();
  const [selectedDateKey, setSelectedDateKey] = useState(todayKey);
  const [visibleMonth, setVisibleMonth] = useState(() => ({
    year: today.getFullYear(),
    month: today.getMonth(),
  }));
  const calendarRef = useRef(null);
  const pendingFocusDateRef = useRef(null);
  const eventTimestamps = useMemo(
    () => feed.items.map((item) => item.timestamp),
    [feed.items],
  );
  const calendar = useMemo(() => createCalendarMonth({
    ...visibleMonth,
    todayKey,
    eventTimestamps,
    locale: language,
  }), [
    eventTimestamps,
    language,
    todayKey,
    visibleMonth.month,
    visibleMonth.year,
  ]);
  const calendarWeekdays = useMemo(
    () => getCalendarWeekdayLabels(language),
    [language],
  );
  const selectedDate = parseLocalDateKey(selectedDateKey) ?? today;
  const selectedDateLabel = formatDate(selectedDate, language, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const calendarCellLabels = useMemo(() => new Map(
    calendar.cells.map((cell) => {
      const dateLabel = formatDate(
        parseLocalDateKey(cell.key),
        language,
        {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        },
      );
      return [
        cell.key,
        cell.eventCount > 0
          ? t(cell.eventCount === 1
            ? "dateTime.calendar.cellEvent.one"
            : "dateTime.calendar.cellEvent.other", {
            date: dateLabel,
            count: cell.eventCount,
          })
          : dateLabel,
      ];
    }),
  ), [calendar.cells, language, t]);
  const selectedEvents = useMemo(
    () => feed.items
      .filter((item) =>
        isTimestampOnLocalDate(item.timestamp, selectedDateKey))
      .slice(0, 5),
    [feed.items, selectedDateKey],
  );

  useEffect(() => {
    const dateKey = pendingFocusDateRef.current;
    if (!dateKey) return undefined;
    pendingFocusDateRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      calendarRef.current
        ?.querySelector(`[data-date-key="${dateKey}"]`)
        ?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [calendar, selectedDateKey]);

  const selectDate = (dateKey, focus = false) => {
    const date = parseLocalDateKey(dateKey);
    if (!date) return;
    if (focus) pendingFocusDateRef.current = dateKey;
    setSelectedDateKey(dateKey);
    setVisibleMonth({
      year: date.getFullYear(),
      month: date.getMonth(),
    });
  };

  const navigateMonth = (delta) => {
    const next = shiftCalendarMonth(
      visibleMonth.year,
      visibleMonth.month,
      delta,
    );
    const selectedDay = selectedDate.getDate();
    const lastDay = new Date(
      next.year,
      next.month + 1,
      0,
    ).getDate();
    const target = new Date(
      next.year,
      next.month,
      Math.min(selectedDay, lastDay),
      12,
    );
    selectDate(toLocalDateKey(target), true);
  };

  const handleCalendarKeyDown = (event, dateKey) => {
    const command = event.shiftKey
      ? {
          PageUp: "previousYear",
          PageDown: "nextYear",
        }[event.key]
      : {
          ArrowLeft: "previousDay",
          ArrowRight: "nextDay",
          ArrowUp: "previousWeek",
          ArrowDown: "nextWeek",
          Home: "weekStart",
          End: "weekEnd",
          PageUp: "previousMonth",
          PageDown: "nextMonth",
        }[event.key];
    if (!command) return;
    event.preventDefault();
    const target = moveCalendarDate(dateKey, command);
    if (target) selectDate(target, true);
  };

  const goToToday = () => selectDate(todayKey, true);

  return (
    <section
      className="shell-panel date-time-panel"
      role="dialog"
      aria-modal="false"
      aria-label={t("dateTime.accessibility.dialog")}
    >
      <PanelHeader
        eyebrow={t("dateTime.header.eyebrow")}
        title={t("dateTime.header.title")}
        closeLabel={t("common.action.close")}
        onClose={onClose}
      />

      <div className="date-time-hero">
        <span className="date-time-orbit" aria-hidden="true">
          <ClockRegular />
          <i />
        </span>
        <span>
          <strong>{localizedClock.time}</strong>
          <small>{localizedClock.longDate}</small>
        </span>
        <code>{t("dateTime.local")}</code>
      </div>

      <div className="date-time-calendar-header">
        <span>
          <small>{t("dateTime.calendar.label")}</small>
          <strong>{calendar.monthLabel}</strong>
        </span>
        <div>
          <button
            type="button"
            onClick={() => navigateMonth(-1)}
            aria-label={t("dateTime.calendar.previousMonth")}
            title={t("dateTime.calendar.previousMonthShortcut")}
          >
            <ChevronLeftRegular />
          </button>
          <button type="button" className="is-today" onClick={goToToday}>
            {t("dateTime.calendar.today")}
          </button>
          <button
            type="button"
            onClick={() => navigateMonth(1)}
            aria-label={t("dateTime.calendar.nextMonth")}
            title={t("dateTime.calendar.nextMonthShortcut")}
          >
            <ChevronRightRegular />
          </button>
        </div>
      </div>

      <div
        ref={calendarRef}
        className="date-time-calendar"
        role="grid"
        aria-label={calendar.monthLabel}
      >
        <div className="date-time-weekdays" role="row">
          {calendarWeekdays.map((weekday) => (
            <span key={weekday} role="columnheader">{weekday}</span>
          ))}
        </div>
        <div className="date-time-days">
          {calendar.cells.map((cell) => {
            const selected = cell.key === selectedDateKey;
            return (
              <button
                key={cell.key}
                type="button"
                role="gridcell"
                className={[
                  cell.inMonth ? "" : "is-adjacent",
                  cell.today ? "is-today" : "",
                  selected ? "is-selected" : "",
                  cell.eventCount > 0 ? "has-events" : "",
                ].filter(Boolean).join(" ")}
                aria-selected={selected}
                aria-label={calendarCellLabels.get(cell.key)}
                tabIndex={selected ? 0 : -1}
                data-date-key={cell.key}
                onClick={() => selectDate(cell.key)}
                onKeyDown={(event) =>
                  handleCalendarKeyDown(event, cell.key)}
              >
                <span>{cell.day}</span>
                {cell.eventCount > 0 ? (
                  <small aria-hidden="true">
                    {Math.min(cell.eventCount, 9)}
                  </small>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <section
        className="date-time-agenda"
        aria-labelledby="date-time-agenda-title"
      >
        <header>
          <span>
            <small>{t("dateTime.agenda.label")}</small>
            <strong id="date-time-agenda-title">{selectedDateLabel}</strong>
          </span>
          <code>{selectedEvents.length.toString().padStart(2, "0")}</code>
        </header>
        {selectedEvents.length > 0 ? (
          <div className="date-time-event-list">
            {selectedEvents.map((item) => (
              <article key={item.id} className={`is-${item.severity}`}>
                <i aria-hidden="true" />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.detail || t("dateTime.agenda.noAdditionalDetail")}</small>
                </span>
                <time dateTime={item.timestamp ?? undefined}>
                  {item.timestamp
                    ? formatTime(item.timestamp, language)
                    : "--:--"}
                </time>
              </article>
            ))}
          </div>
        ) : (
          <div className="date-time-empty">
            <CalendarMonthRegular />
            <span>
              <strong>{t("dateTime.agenda.empty.title")}</strong>
              <small>{t("dateTime.agenda.empty.detail")}</small>
            </span>
          </div>
        )}
      </section>

      <footer className="date-time-footer">
        <span>{t("dateTime.footer.accountsDisconnected")}</span>
        <button
          type="button"
          onClick={() => onLaunch({
            label: t("dateTime.action.openWindowsSettings"),
            target: "ms-settings:dateandtime",
          })}
        >
          <OpenRegular />
          {t("dateTime.action.openWindowsSettings")}
        </button>
      </footer>
    </section>
  );
}

function localizeSessionAction(action, t) {
  const translationId = SESSION_ACTION_TRANSLATION_IDS[action.id];
  if (!translationId) return action;
  const key = `session.action.${translationId}`;
  return {
    ...action,
    label: t(`${key}.label`),
    detail: t(`${key}.detail`),
    consequence: t(`${key}.consequence`),
  };
}

function localizeHelpSections(t) {
  return helpCenterSections.map((section) => ({
    ...section,
    label: t(`help.section.${section.id}.label`),
    title: t(`help.section.${section.id}.title`),
    summary: t(`help.section.${section.id}.summary`),
    entries: section.entries.map((entry, index) => ({
      ...entry,
      detail: t(`help.section.${section.id}.entry.${index}.detail`),
    })),
  }));
}

function filterLocalizedHelpSections(sections, query) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return sections;
  return sections
    .map((section) => {
      const sectionMatch = normalizeSearchText(
        `${section.label} ${section.title} ${section.summary}`,
      ).includes(normalizedQuery);
      const entries = sectionMatch
        ? section.entries
        : section.entries.filter((entry) => normalizeSearchText(
          `${entry.command} ${entry.detail}`,
        ).includes(normalizedQuery));
      return entries.length > 0 ? { ...section, entries } : null;
    })
    .filter(Boolean);
}

function SessionControlPanel({ onClose, onExit, onToast }) {
  const { t } = useLanguage();
  const sessionActionRefs = useRef(new Map());
  const lastSessionActionRef = useRef(null);
  const cancelConfirmationRef = useRef(null);
  const [sessionState, setSessionState] = useState(() =>
    normalizeSessionControlState(null));
  const [status, setStatus] = useState("loading");
  const [challenge, setChallenge] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    platform.session.getState()
      .then((result) => {
        if (!active) return;
        setSessionState(normalizeSessionControlState(result));
        setStatus("ready");
      })
      .catch((nextError) => {
        if (!active) return;
        setError(nextError.message);
        setStatus("error");
      });

    return () => {
      active = false;
      void platform.session.cancel().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!challenge) return undefined;
    const frame = window.requestAnimationFrame(() => {
      cancelConfirmationRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [challenge]);

  const restoreSessionActionFocus = () => {
    const actionId = lastSessionActionRef.current;
    window.requestAnimationFrame(() => {
      sessionActionRefs.current.get(actionId)?.focus();
    });
  };

  const beginAction = async (action) => {
    lastSessionActionRef.current = action.id;
    setError("");
    if (action.local) {
      setChallenge(createExitChallenge());
      return;
    }

    setBusy(true);
    try {
      const result = await platform.session.prepare(action.id);
      const normalized = normalizeSessionChallenge(result, action.id);
      if (!normalized) {
        throw new Error(t("session.error.invalidCapability"));
      }
      setChallenge(normalized);
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setBusy(false);
    }
  };

  const cancelChallenge = async () => {
    setChallenge(null);
    setError("");
    restoreSessionActionFocus();
    try {
      await platform.session.cancel();
    } catch {
      // Native challenges expire quickly; cancellation failure is non-blocking.
    }
  };

  const confirmAction = async () => {
    if (!challenge || busy) return;
    if (isSessionChallengeExpired(challenge)) {
      setChallenge(null);
      setError(t("session.error.confirmationExpired"));
      restoreSessionActionFocus();
      return;
    }
    if (challenge.local) {
      await onExit();
      return;
    }

    setBusy(true);
    setError("");
    try {
      const result = await platform.session.commit(
        challenge.actionId,
        challenge.token,
      );
      setChallenge(null);
      onToast(result.message ?? t("session.toast.accepted"));
      onClose();
    } catch (nextError) {
      setChallenge(null);
      setError(nextError.message);
      restoreSessionActionFocus();
    } finally {
      setBusy(false);
    }
  };

  const actions = [EXIT_TO_WINDOWS_ACTION, ...sessionState.actions]
    .map((action) => localizeSessionAction(action, t));
  const ChallengeIcon = challenge
    ? SESSION_ACTION_ICONS[challenge.actionId] ?? PowerRegular
    : PowerRegular;
  const localizedChallengeAction = challenge
    ? actions.find((action) => action.id === challenge.actionId)
    : null;
  const challengeTitle = localizedChallengeAction?.label ?? challenge?.title;
  const challengeDetail = localizedChallengeAction?.consequence ?? challenge?.detail;

  return (
    <section
      className="shell-panel session-control-panel"
      role="dialog"
      aria-modal="false"
      aria-label={t("session.accessibility.dialog")}
    >
      <PanelHeader
        eyebrow={t("session.header.eyebrow")}
        title={t("session.header.title")}
        closeLabel={t("common.action.close")}
        onClose={onClose}
      />

      <div className="session-control-status">
        <span className="session-control-orbit" aria-hidden="true">
          <PowerRegular />
          <i />
        </span>
        <div>
          <small>{t("session.status.controlBoundary")}</small>
          <strong>{t(sessionState.available
            ? "session.status.windowsReady"
            : "session.status.recoveryOnly")}</strong>
          <p>{t("session.status.description")}</p>
        </div>
        <code>{t(status === "loading"
          ? "session.status.checking"
          : sessionState.available
            ? "session.status.guarded"
            : "session.status.limited")}</code>
      </div>

      {!challenge ? (
        <div
          className="session-control-grid"
          role="group"
          aria-label={t("session.actions.accessibility.label")}
          aria-busy={busy || status === "loading"}
        >
          {actions.map((action) => {
            const Icon = SESSION_ACTION_ICONS[action.id] ?? PowerRegular;
            const disabled = busy ||
              (action.local ? false : status !== "ready" || !sessionState.available);
            return (
              <button
                key={action.id}
                ref={(element) => {
                  if (element) sessionActionRefs.current.set(action.id, element);
                  else sessionActionRefs.current.delete(action.id);
                }}
                type="button"
                className={[
                  action.local ? "is-primary" : "",
                  action.destructive ? "is-destructive" : "",
                ].filter(Boolean).join(" ")}
                disabled={disabled}
                onClick={() => void beginAction(action)}
              >
                <span><Icon /></span>
                <span>
                  <strong>{action.label}</strong>
                  <small>{action.detail}</small>
                </span>
                <code>{t(action.local
                  ? "session.action.badge.safeExit"
                  : action.destructive
                    ? "session.action.badge.system"
                    : "session.action.badge.session")}</code>
              </button>
            );
          })}
        </div>
      ) : (
        <section
          className={`session-confirmation ${challenge.destructive ? "is-destructive" : ""}`}
          role="alertdialog"
          aria-modal="false"
          aria-labelledby="session-confirmation-title"
          aria-describedby="session-confirmation-detail"
        >
          <span className="session-confirmation-icon" aria-hidden="true">
            <ChallengeIcon />
          </span>
          <div>
            <small>{t("session.confirmation.eyebrow")}</small>
            <strong id="session-confirmation-title">{challengeTitle}</strong>
            <p id="session-confirmation-detail">{challengeDetail}</p>
            <code>{challenge.local
              ? t("session.confirmation.localCapability")
              : t("session.confirmation.singleUseCapability", {
                seconds: sessionState.confirmationTimeoutSeconds,
              })}</code>
          </div>
          <div>
            <button
              ref={cancelConfirmationRef}
              type="button"
              data-dialog-initial-focus="true"
              disabled={busy}
              onClick={() => void cancelChallenge()}
            >
              {t("session.confirmation.cancel")}
            </button>
            <button
              type="button"
              className={challenge.destructive ? "is-destructive" : "is-confirm"}
              disabled={busy}
              onClick={() => void confirmAction()}
            >
              {busy
                ? t("session.confirmation.requesting")
                : t("session.confirmation.confirmAction", {
                  action: challengeTitle,
                })}
            </button>
          </div>
        </section>
      )}

      {error ? (
        <p className="runtime-settings-error session-control-error" role="alert">
          <AlertRegular />
          {error}
        </p>
      ) : null}

      <footer className="session-control-footer">
        <span><ShieldRegular /> {t("session.footer.restoreWindows", {
          shortcut: "CTRL+SHIFT+Q",
        })}</span>
        <small>{t("session.footer.noForceClose")}</small>
      </footer>
    </section>
  );
}

function HelpCenterPanel({ onClose, onOpenPanel }) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const localizedSections = useMemo(() => localizeHelpSections(t), [t]);
  const visibleSections = useMemo(
    () => filterLocalizedHelpSections(localizedSections, query),
    [localizedSections, query],
  );

  return (
    <section
      className="shell-panel help-center-panel"
      role="dialog"
      aria-modal="false"
      aria-label={t("help.accessibility.dialog")}
      data-smoke-id="help-center"
    >
      <PanelHeader
        eyebrow={t("help.header.eyebrow")}
        title={t("help.header.title")}
        closeLabel={t("common.action.close")}
        onClose={onClose}
      />
      <label className="help-center-search">
        <SearchRegular aria-hidden="true" />
        <input
          autoFocus
          data-dialog-initial-focus="true"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("help.search.placeholder")}
          aria-label={t("help.search.accessibility.label")}
        />
        <kbd>F1</kbd>
      </label>
      <div className="help-center-layout">
        <nav aria-label={t("help.categories.accessibility.label")}>
          {localizedSections.map((section, index) => (
            <button
              key={section.id}
              type="button"
              onClick={() => document.getElementById(`help-${section.id}`)?.scrollIntoView({ block: "start" })}
            >
              <code>{String(index + 1).padStart(2, "0")}</code><span>{section.label}</span>
            </button>
          ))}
        </nav>
        <div className="help-center-ledger" aria-live="polite">
          {visibleSections.length > 0 ? visibleSections.map((section) => (
            <section key={section.id} id={`help-${section.id}`}>
              <header><small>{section.label}</small><strong>{section.title}</strong><p>{section.summary}</p></header>
              <dl>
                {section.entries.map((entry) => (
                  <div key={`${section.id}:${entry.command}`}>
                    <dt>{entry.command}</dt><dd>{entry.detail}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )) : <p className="shell-empty-state">{t("help.empty.search")}</p>}
        </div>
      </div>
      <footer className="help-center-footer">
        <span><ShieldRegular /> {t("help.footer.recovery")}</span>
        <button type="button" onClick={() => onOpenPanel("session")}>
          {t("help.action.sessionControl")}
        </button>
        <button type="button" onClick={() => onOpenPanel("settings")}>
          {t("help.action.recoveryCheck")}
        </button>
      </footer>
    </section>
  );
}

const runtimeSettingsSections = Object.freeze([
  { id: "settings-general", labelKey: "settings.navigation.general" },
  { id: "settings-taskbar", labelKey: "settings.navigation.taskbar" },
  { id: "settings-windows", labelKey: "settings.navigation.windows" },
  { id: "settings-interface", labelKey: "settings.navigation.interface" },
  { id: "settings-graph", labelKey: "settings.navigation.graph" },
  { id: "settings-integration", labelKey: "settings.navigation.integration" },
  { id: "settings-help", labelKey: "settings.navigation.help" },
  { id: "settings-recovery", labelKey: "settings.navigation.recovery" },
]);

function RuntimeSettingsPanel({ onClose, onToast, onOpenHelp, graphSourceState }) {
  const { t } = useLanguage();
  const [runtime, setRuntime] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [diagnostics, setDiagnostics] = useState(null);
  const [diagnosticStatus, setDiagnosticStatus] = useState("idle");
  const [activeSection, setActiveSection] = useState(runtimeSettingsSections[0].id);

  useEffect(() => {
    let active = true;
    platform.lifecycle.getRuntimeInfo()
      .then((result) => {
        if (!active) return;
        setRuntime(result);
        setStatus("ready");
      })
      .catch((nextError) => {
        if (!active) return;
        setError(nextError.message);
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const updateStartup = async () => {
    if (!runtime || status === "saving") return;
    const needsRepair = runtime.startupEnabled && !runtime.startupCommandCurrent;
    const enabled = needsRepair ? true : !runtime.startupEnabled;
    setStatus("saving");
    setError("");
    try {
      const result = await platform.lifecycle.setStartupEnabled(enabled);
      setRuntime(result);
      setStatus("ready");
      onToast?.(t(enabled
        ? "settings.general.startup.enabledToast"
        : "settings.general.startup.disabledToast"));
    } catch (nextError) {
      setError(nextError.message);
      setStatus("error");
    }
  };

  const startupEnabled = Boolean(runtime?.startupEnabled && runtime?.startupCommandCurrent);
  const startupNeedsRepair = Boolean(runtime?.startupEnabled && !runtime?.startupCommandCurrent);
  const recoveryReady = Boolean(runtime?.recoveryReady);
  const handleSettingsNavigationKeyDown = (event, sectionIndex) => {
    const lastIndex = runtimeSettingsSections.length - 1;
    const nextIndex = event.key === "ArrowDown" || event.key === "ArrowRight"
      ? Math.min(lastIndex, sectionIndex + 1)
      : event.key === "ArrowUp" || event.key === "ArrowLeft"
        ? Math.max(0, sectionIndex - 1)
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? lastIndex
            : null;
    if (nextIndex === null || nextIndex === sectionIndex) return;
    event.preventDefault();
    const nextSection = runtimeSettingsSections[nextIndex];
    setActiveSection(nextSection.id);
    window.requestAnimationFrame(() => {
      document.getElementById(`settings-nav-${nextSection.id}`)?.focus();
    });
  };

  const runDiagnostics = async () => {
    if (diagnosticStatus === "running") return;
    setDiagnosticStatus("running");
    setError("");
    try {
      const result = await platform.lifecycle.runDiagnostics();
      setDiagnostics(result);
      setDiagnosticStatus("ready");
      onToast?.(result.overallStatus === "READY"
        ? t("settings.recovery.toast.passed", { count: result.verifiedFiles })
        : t("settings.recovery.toast.status", { status: result.overallStatus }));
    } catch (nextError) {
      setError(nextError.message);
      setDiagnosticStatus("error");
    }
  };

  return (
    <section
      className="shell-panel runtime-settings-panel"
      role="dialog"
      aria-modal="false"
      aria-label={t("settings.accessibility.dialog")}
    >
      <PanelHeader
        eyebrow={t("settings.header.eyebrow")}
        title={t("settings.title")}
        closeLabel={t("common.action.close")}
        onClose={onClose}
      />

      <div className="runtime-settings-workspace">
        <nav className="runtime-settings-nav" aria-label={t("settings.navigation.aria")}>
          {runtimeSettingsSections.map((section, sectionIndex) => (
          <button
            key={section.id}
            id={`settings-nav-${section.id}`}
            type="button"
            aria-controls="runtime-settings-detail"
            aria-current={activeSection === section.id ? "location" : undefined}
            onClick={() => setActiveSection(section.id)}
            onKeyDown={(event) => handleSettingsNavigationKeyDown(event, sectionIndex)}
          >
            {t(section.labelKey)}
          </button>
          ))}
        </nav>

        <div
          id="runtime-settings-detail"
          className="runtime-settings-detail"
          role="region"
          aria-labelledby={`settings-nav-${activeSection}`}
        >

          {activeSection === "settings-general" ? (
            <section
              id="settings-general"
              className="runtime-settings-section-anchor"
              aria-label={t("settings.general.accessibility.section")}
            >
        <div className="runtime-identity">
          <CoreNodeGlyph />
          <span>
            <small>{t("settings.general.runtimeChannel")}</small>
            <strong>{runtime?.productName ?? "JARVIS"}</strong>
            <code>{t("settings.general.version", {
              version: runtime?.version ?? "—",
              configuration: runtime?.buildConfiguration ?? t("settings.general.state.loading"),
            })}</code>
            <small className="runtime-environment">
              {t("settings.general.environment", {
                mode: runtime?.installationMode ?? t("settings.general.state.detecting"),
                version: runtime?.webView2Version ?? "—",
              })}
            </small>
          </span>
        </div>

        <div className="runtime-setting-list">
          <div className="runtime-setting-row">
            <span className="runtime-setting-icon"><PowerRegular /></span>
            <span className="runtime-setting-copy">
              <strong>{t("settings.general.startup.title")}</strong>
              <small>{startupNeedsRepair
                ? t("settings.general.startup.repairDescription")
                : t("settings.general.startup.description")}</small>
            </span>
            <button
              type="button"
              className={`runtime-switch ${startupEnabled ? "is-on" : ""} ${startupNeedsRepair ? "needs-repair" : ""}`}
              role="switch"
              aria-checked={startupEnabled}
              disabled={!runtime || status === "saving"}
              onClick={updateStartup}
            >
              <span />
              <strong>{status === "saving"
                ? t("settings.general.state.saving")
                : startupNeedsRepair
                  ? t("settings.general.state.repair")
                  : startupEnabled
                    ? t("common.state.on")
                    : t("common.state.off")}</strong>
            </button>
          </div>

          <div className="runtime-setting-row is-readonly">
            <span className="runtime-setting-icon"><ShieldRegular /></span>
            <span className="runtime-setting-copy">
              <strong>{t("settings.general.recovery.title")}</strong>
              <small>{t("settings.general.recovery.description")}</small>
            </span>
            <span className={recoveryReady ? "runtime-state-ok" : "runtime-state-attention"}>
              {recoveryReady ? <CheckmarkCircleRegular /> : <AlertRegular />}
              {recoveryReady
                ? t("settings.general.recovery.armed")
                : t("settings.general.recovery.check")}
            </span>
          </div>
        </div>
            </section>
          ) : null}

          {activeSection === "settings-taskbar" ? (
            <div id="settings-taskbar" className="runtime-settings-section-anchor">
              <TaskbarModeSettings onToast={onToast} />
            </div>
          ) : null}

          {activeSection === "settings-windows" ? (
            <div id="settings-windows" className="runtime-settings-section-anchor">
              <WindowAppearanceSettings onToast={onToast} />
            </div>
          ) : null}

          {activeSection === "settings-interface" ? (
            <div id="settings-interface" className="runtime-settings-section-anchor">
              <InterfacePreferences onToast={onToast} />
            </div>
          ) : null}

          {activeSection === "settings-graph" ? (
            <div id="settings-graph" className="runtime-settings-section-anchor">
              <GraphSourceSettings state={graphSourceState} onToast={onToast} />
              <OptionalSettingsBoundary fallbackMessage={t("settings.graph.visuals.unavailable")}>
                <Suspense fallback={(
                  <p className="shell-empty-state">{t("settings.graph.visuals.loading")}</p>
                )}>
                  <GraphVisualSettings embedded onToast={onToast} />
                </Suspense>
              </OptionalSettingsBoundary>
              <GraphProfileManager
                vaultName={graphSourceState?.graph?.source?.name ?? ""}
                onToast={onToast}
              />
            </div>
          ) : null}

          {activeSection === "settings-integration" ? (
            <div id="settings-integration" className="runtime-settings-section-anchor">
              <NativeIntegrationSettings onToast={onToast} />
            </div>
          ) : null}

          {activeSection === "settings-help" ? (
            <section
              id="settings-help"
              className="runtime-settings-section-anchor runtime-help-entry"
              aria-label={t("settings.helpEntry.aria")}
            >
        <span><PulseRegular /></span>
        <span>
          <small>{t("settings.helpEntry.eyebrow")}</small>
          <strong>{t("settings.helpEntry.title")}</strong>
          <p>{t("settings.helpEntry.description")}</p>
        </span>
        <button type="button" onClick={onOpenHelp}>
          {t("settings.helpEntry.open")}
        </button>
            </section>
          ) : null}

          {activeSection === "settings-recovery" ? (
            <section
              id="settings-recovery"
              className="runtime-settings-section-anchor"
              aria-label={t("settings.recovery.aria")}
            >
        <div className="runtime-path-card">
          <small>{t("settings.recovery.activeExecutable")}</small>
          <code title={runtime?.executablePath}>
            {runtime?.executablePath ?? t("settings.recovery.resolvingRuntime")}
          </code>
        </div>

        <section
          className="runtime-diagnostics"
          aria-label={t("settings.recovery.diagnosticsAria")}
        >
          <header>
            <span>
              <small>{t("settings.recovery.title")}</small>
              <strong>{diagnostics?.overallStatus ?? t("settings.recovery.notChecked")}</strong>
            </span>
            <button
              type="button"
              disabled={!runtime || diagnosticStatus === "running"}
              onClick={runDiagnostics}
            >
              {diagnosticStatus === "running"
                ? t("settings.recovery.verifying")
                : diagnostics
                  ? t("settings.recovery.runAgain")
                  : t("settings.recovery.runCheck")}
            </button>
          </header>

          {diagnostics ? (
            <div className="runtime-diagnostic-results">
              {diagnostics.checks.map((check) => (
                <div key={check.id} className={`is-${check.status.toLowerCase()}`}>
                  <span>{check.status === "READY" ? <CheckmarkCircleRegular /> : <AlertRegular />}</span>
                  <span><strong>{check.label}</strong><small>{check.detail}</small></span>
                  <code>{check.status}</code>
                </div>
              ))}
            </div>
          ) : (
            <p>{t("settings.recovery.description")}</p>
          )}
        </section>
            </section>
          ) : null}

          {error ? <p className="runtime-settings-error" role="alert"><AlertRegular />{error}</p> : null}
        </div>
      </div>

      <footer className="runtime-settings-footer">
        <span>{runtime?.safeMode
          ? t("settings.footer.safeMode")
          : platform.isNative
            ? t("settings.footer.nativeHost")
            : t("settings.footer.browserPreview")}</span>
        <strong>{startupEnabled
          ? t("settings.footer.autoStartArmed")
          : startupNeedsRepair
            ? t("settings.footer.startupRepairRequired")
            : t("settings.footer.manualStart")}</strong>
      </footer>
    </section>
  );
}

function NativeIntegrationSettings({ onToast }) {
  const { t } = useLanguage();
  const displays = useDisplayTopology();
  const notifications = useNotificationHistory();
  const [requesting, setRequesting] = useState(false);

  const requestAccess = async () => {
    if (requesting) return;
    setRequesting(true);
    try {
      const state = await requestNotificationHistoryAccess();
      onToast?.(state.historyAvailable
        ? t("settings.integration.notifications.connectedToast")
        : state.reason ?? t("settings.integration.notifications.unavailableToast"));
    } catch (nextError) {
      onToast?.(t("settings.integration.notifications.accessCheckFailed", {
        message: nextError.message,
      }));
    } finally {
      setRequesting(false);
    }
  };

  return (
    <section
      className="native-integration-settings"
      aria-label={t("settings.integration.aria")}
    >
      <header>
        <span><PlugConnectedRegular /></span>
        <span>
          <strong>{t("settings.integration.title")}</strong>
          <small>{t("settings.integration.description")}</small>
        </span>
        <button
          type="button"
          onClick={() => {
            void refreshDisplayTopology();
            void refreshNotificationHistory();
          }}
        >
          {t("settings.integration.refresh")}
        </button>
      </header>

      <div className="native-integration-grid">
        <article>
          <small>{t("settings.integration.notifications.title")}</small>
          <strong>{notifications.historyAvailable
            ? t("settings.integration.notifications.connected")
            : t("settings.integration.notifications.feasibilityGate")}</strong>
          <p>{notifications.reason ?? t("settings.integration.notifications.available")}</p>
          <dl>
            <div><dt>API</dt><dd>{notifications.apiAvailable
              ? t("settings.integration.state.available")
              : t("settings.integration.state.unavailable")}</dd></div>
            <div><dt>{t("settings.integration.field.identity")}</dt><dd>{notifications.packaged
              ? "MSIX"
              : t("settings.integration.state.unpackaged")}</dd></div>
            <div><dt>{t("settings.integration.field.access")}</dt><dd>{notifications.accessStatus}</dd></div>
          </dl>
          <button
            type="button"
            disabled={!notifications.canRequestAccess || requesting}
            onClick={requestAccess}
          >
            {requesting
              ? t("settings.integration.notifications.requesting")
              : notifications.canRequestAccess
                ? t("settings.integration.notifications.requestAccess")
                : notifications.packaged
                  ? t("settings.integration.notifications.adapterDisabled")
                  : t("settings.integration.notifications.signedMsixRequired")}
          </button>
        </article>

        <article>
          <small>{t("settings.integration.displays.title")}</small>
          <strong>{t("settings.integration.displays.count", {
            count: displays.monitors.length,
          })}</strong>
          <p>{t("settings.integration.displays.description")}</p>
          <dl>
            <div><dt>OS BUILD</dt><dd>{displays.osBuild || "—"}</dd></div>
            <div><dt>WIN10 BASELINE</dt><dd>{displays.windows10Compatible
              ? t("settings.integration.state.ready")
              : t("settings.integration.state.unsupported")}</dd></div>
            <div><dt>{t("settings.integration.field.policy")}</dt><dd>{displays.desktopSurfacePolicy}</dd></div>
          </dl>
          <div className="display-monitor-list">
            {displays.monitors.map((monitor) => (
              <span key={monitor.id} className={monitor.isPrimary ? "is-primary" : ""}>
                <b>{monitor.isPrimary
                  ? t("settings.integration.displays.primary")
                  : monitor.deviceName.replace("\\\\.\\", "")}</b>
                <small>{monitor.bounds.width}×{monitor.bounds.height} · {monitor.scalePercent}%</small>
              </span>
            ))}
          </div>
        </article>
      </div>

      {displays.error ? <p className="runtime-settings-error"><AlertRegular />{displays.error}</p> : null}
      {notifications.error ? <p className="runtime-settings-error"><AlertRegular />{notifications.error}</p> : null}
    </section>
  );
}

function TaskbarModeSettings({ onToast }) {
  const { t } = useLanguage();
  const state = useTaskbarModeState();
  const [pendingMode, setPendingMode] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const previousTransition = useRef({
    generation: state.transitionGeneration,
    status: state.transitionStatus,
  });
  const selectedMode = pendingMode ?? state.requestedMode;
  const busy = state.loading ||
    state.transitionStatus === "applying" ||
    pendingMode !== null ||
    retrying;
  const retryAfterTimestamp = state.retryAfterUtc
    ? Date.parse(state.retryAfterUtc)
    : Number.NaN;
  const cooldownRemaining = getTaskbarCooldownRemaining(
    state.retryAfterUtc,
    clock,
  );
  const simulation = state.simulation === true;
  const modeMismatch = !simulation && state.requestedMode !== state.effectiveMode;
  const canRetry = !simulation && canRetryTaskbarMode(state, busy, clock);

  useEffect(() => {
    const previous = previousTransition.current;
    const toast = getTaskbarTransitionToast(previous, state);
    if (toast) {
      const copy = toast.kind === "preview-saved"
        ? {
            title: t("settings.taskbar.toast.previewSaved", { mode: toast.mode }),
            detail: t("settings.taskbar.toast.windowsUnchanged"),
          }
        : toast.kind === "switched"
          ? {
              title: t("settings.taskbar.toast.switched", { mode: toast.mode }),
            }
          : toast.kind === "cooldown"
            ? {
                title: t("settings.taskbar.toast.restored"),
                detail: t("settings.taskbar.toast.cooldown"),
              }
            : {
                title: t("settings.taskbar.toast.fallback", { mode: toast.mode }),
              };
      onToast?.({ ...toast, ...copy });
    }
    previousTransition.current = {
      generation: state.transitionGeneration,
      status: state.transitionStatus,
    };
  }, [
    onToast,
    state.effectiveMode,
    state.requestedMode,
    state.simulation,
    state.transitionGeneration,
    state.transitionStatus,
    t,
  ]);

  useEffect(() => {
    if (!Number.isFinite(retryAfterTimestamp) ||
        retryAfterTimestamp <= Date.now()) {
      return undefined;
    }

    setClock(Date.now());
    const timer = globalThis.setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now >= retryAfterTimestamp) {
        globalThis.clearInterval(timer);
      }
    }, 1000);
    return () => globalThis.clearInterval(timer);
  }, [retryAfterTimestamp]);

  const updateMode = async (mode) => {
    if (busy || mode === state.requestedMode) return;
    setPendingMode(mode);
    try {
      await setTaskbarMode(mode);
    } catch {
      // The shared taskbar-mode store exposes bridge failures inline.
    } finally {
      setPendingMode(null);
    }
  };

  const retryMode = async () => {
    if (!canRetry) return;
    setRetrying(true);
    try {
      await retryTaskbarMode();
    } catch {
      // The shared taskbar-mode store exposes the structured rejection inline.
    } finally {
      setRetrying(false);
    }
  };

  return (
    <section className="window-appearance-settings" aria-labelledby="taskbar-mode-title" aria-busy={busy}>
      <header className="window-appearance-header">
        <span className="window-appearance-icon"><WindowAppsRegular /></span>
        <span>
          <strong id="taskbar-mode-title">{t("settings.taskbar.title")}</strong>
          <small>{simulation
            ? t("settings.taskbar.description.preview")
            : t("settings.taskbar.description.native")}</small>
        </span>
        <code className={!simulation && state.effectiveMode === state.requestedMode ? "is-compatible" : ""}>
          {simulation
            ? t("settings.taskbar.state.preview")
            : (state.effectiveMode ?? "native").toUpperCase()}
        </code>
      </header>

      <fieldset disabled={busy || state.safeMode}>
        <legend>{t("settings.taskbar.legend")}</legend>
        <div className="window-appearance-options">
          {taskbarModeOptions.map((option, index) => {
            const selected = selectedMode === option.mode;
            return (
              <label
                key={option.mode}
                className={`window-appearance-choice ${selected ? "is-selected" : ""} is-${option.mode}`}
              >
                <input
                  type="radio"
                  name="taskbar-mode"
                  value={option.mode}
                  checked={selected}
                  onChange={() => updateMode(option.mode)}
                />
                <span className="window-appearance-level" aria-hidden="true">T{index}</span>
                <span className="window-appearance-copy">
                  <strong><span>{option.title}</span><b>{t(option.labelKey)}</b></strong>
                  <small>{t(option.descriptionKey)}</small>
                </span>
                <span className="window-appearance-selector" aria-hidden="true"><i /></span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="window-appearance-telemetry is-taskbar" role="status" aria-live="polite">
        <span><small>{simulation
          ? t("settings.taskbar.telemetry.previewSelection")
          : t("settings.taskbar.telemetry.requestedMode")}</small><strong>{busy
          ? simulation
            ? t("settings.taskbar.state.saving")
            : t("settings.taskbar.state.applying")
          : state.requestedMode.toUpperCase()}</strong></span>
        <span><small>{simulation
          ? t("settings.taskbar.telemetry.windowsStatus")
          : t("settings.taskbar.telemetry.effectiveMode")}</small><strong>{simulation
          ? t("settings.taskbar.state.notInspected")
          : state.effectiveMode.toUpperCase()}</strong></span>
        <span><small>{simulation
          ? t("settings.taskbar.telemetry.simulation")
          : t("settings.taskbar.telemetry.transition")}</small><strong>{simulation
          ? t("settings.taskbar.state.localOnly")
          : state.transitionStatus.toUpperCase()}</strong></span>
        <span><small>{simulation
          ? t("settings.taskbar.telemetry.nativeChange")
          : t("settings.taskbar.telemetry.recovery")}</small><strong>{simulation
          ? t("settings.taskbar.state.none")
          : `${state.recoveryFailureCount}/3 · G${state.transitionGeneration}`}</strong></span>
      </div>

      {state.transitionReason ? (
        <p className="window-appearance-feedback" role="status">
          <PulseRegular /><span>{t(simulation
            ? "settings.taskbar.feedback.preview"
            : "settings.taskbar.feedback.transaction", {
            reason: state.transitionReason,
          })}</span>
        </p>
      ) : null}
      {state.safeMode ? (
        <p className="window-appearance-feedback is-fallback" role="status">
          <ShieldRegular /><span>{t("settings.taskbar.feedback.safeMode")}</span>
        </p>
      ) : null}
      {state.fallbackReason ? (
        <p className="window-appearance-feedback is-fallback" role="status">
          <AlertRegular /><span>{state.fallbackReason}</span>
          {modeMismatch ? (
            <button
              type="button"
              className="taskbar-mode-retry"
              disabled={!canRetry}
              onClick={retryMode}
            >
              <ArrowClockwiseRegular />
              {retrying
                ? t("settings.taskbar.retry.retrying")
                : cooldownRemaining > 0
                  ? t("settings.taskbar.retry.cooldown", { seconds: cooldownRemaining })
                  : t("settings.taskbar.retry.mode", {
                    mode: state.requestedMode.toUpperCase(),
                  })}
            </button>
          ) : null}
        </p>
      ) : null}
      {state.error ? (
        <p className="window-appearance-feedback is-error" role="alert">
          <AlertRegular /><span>{state.error.message ?? String(state.error)}</span>
        </p>
      ) : null}
    </section>
  );
}

function InterfacePreferences({ onToast }) {
  const language = useLanguage();
  const { t } = language;
  const selectedLanguageOption = LANGUAGE_OPTIONS.find(
    (option) => option.value === language.preference,
  ) ?? LANGUAGE_OPTIONS[0];
  const resolvedLanguageOption = LANGUAGE_OPTIONS.find(
    (option) => option.value === language.language,
  ) ?? LANGUAGE_OPTIONS.at(-1);
  const selectedLanguageLabel = t(selectedLanguageOption.labelKey);
  const resolvedLanguageLabel = t(resolvedLanguageOption.labelKey);
  const languageStatusLabel = language.preference === "system"
    ? `${selectedLanguageLabel} · ${resolvedLanguageLabel}`
    : resolvedLanguageLabel;
  const themeVersion = useSyncExternalStore(
    subscribeVisualTheme,
    getVisualThemeVersionSnapshot,
    getVisualThemeVersionSnapshot,
  );
  const themeId = getVisualThemeSnapshot();
  const currentTheme = getVisualThemeDefinition(themeId);
  const currentThemeTranslation = interfaceThemeTranslationKeys[currentTheme.id];
  const currentThemeLabel = currentThemeTranslation
    ? t(currentThemeTranslation.labelKey)
    : currentTheme.label;
  const themeOptions = useMemo(
    () => getVisualThemeOptions().map((theme) => getVisualThemeDefinition(theme.id)),
    [themeVersion],
  );
  const savedCustomPalette = getCustomVisualPaletteSnapshot();
  const savedPaletteSignature = customVisualPaletteFields
    .map(({ key }) => savedCustomPalette[key])
    .join("|");
  const [customPaletteDraft, setCustomPaletteDraft] = useState(() => ({ ...savedCustomPalette }));
  const previousSavedPaletteRef = useRef(savedCustomPalette);
  const customPaletteDraftSignature = customVisualPaletteFields
    .map(({ key }) => customPaletteDraft[key])
    .join("|");
  const isPaletteDirty = customVisualPaletteFields.some(({ key }) => (
    customPaletteDraft[key] !== savedCustomPalette[key]
  ));
  const paletteContrast = useMemo(
    () => getVisualPaletteContrastReport(customPaletteDraft),
    [customPaletteDraftSignature],
  );
  const failedContrastChecks = paletteContrast.checks.filter((check) => !check.passes);
  const themeImportRef = useRef(null);
  const audio = useSyncExternalStore(
    subscribeUiAudio,
    getUiAudioSnapshot,
    getUiAudioSnapshot,
  );
  const interfacePreferences = useSyncExternalStore(
    subscribeInterfacePreferences,
    getInterfacePreferencesSnapshot,
    getInterfacePreferencesSnapshot,
  );

  useEffect(() => {
    const previousSavedPalette = previousSavedPaletteRef.current;
    previousSavedPaletteRef.current = savedCustomPalette;
    setCustomPaletteDraft((current) => {
      const currentMatchedPreviousSaved = customVisualPaletteFields.every(({ key }) => (
        current[key] === previousSavedPalette[key]
      ));
      return currentMatchedPreviousSaved ? { ...savedCustomPalette } : current;
    });
  }, [savedPaletteSignature]);

  const applyCustomPalette = () => {
    if (!paletteContrast.passes) {
      onToast?.(t("settings.interface.toast.increaseContrast"));
      return;
    }
    const palette = setCustomVisualPalette(customPaletteDraft);
    setCustomPaletteDraft({ ...palette });
    onToast?.(t("settings.interface.toast.paletteApplied"));
  };

  const resetCustomPalette = () => {
    const palette = resetCustomVisualPalette();
    setCustomPaletteDraft({ ...palette });
    onToast?.(t("settings.interface.toast.paletteReset"));
  };

  const exportCustomPalette = () => {
    const blob = new Blob([serializeCustomVisualTheme(customPaletteDraft)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "jarvis-theme.json";
    link.click();
    URL.revokeObjectURL(url);
    onToast?.(t("settings.interface.toast.themeExported"));
  };

  const importCustomPalette = async (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      const palette = parseCustomVisualTheme(await file.text());
      setCustomPaletteDraft({ ...palette });
      onToast?.(t("settings.interface.toast.themeImported"));
    } catch (error) {
      onToast?.(t("settings.interface.toast.themeImportFailed", {
        message: error.message ?? t("settings.interface.error.unknown"),
      }));
    }
  };

  const resetInterface = async () => {
    setVisualTheme("nexus");
    setUiAudioEnabled(false);
    setUiAudioVolume(0.14);
    resetInterfacePreferences();
    try {
      const { resetVisualEffects } = await import("../visual-effects/visual-effects-system.js");
      resetVisualEffects();
      onToast?.(t("settings.interface.toast.resetComplete"));
    } catch {
      onToast?.(t("settings.interface.toast.resetPartial"));
    }
  };

  return (
    <section className="interface-preferences" aria-labelledby="interface-preferences-title">
      <header>
        <span>
          <strong id="interface-preferences-title">
            {t("settings.appearance.title")}
          </strong>
          <small>{t("settings.interface.description")}</small>
        </span>
        <code>{currentThemeLabel} · {isPaletteDirty
          ? t("settings.interface.state.unsaved")
          : t("settings.interface.state.noChanges")}</code>
      </header>

      <div className="interface-option-group is-language">
        <header>
          <span>
            <strong>{t("settings.language.title")}</strong>
            <small>{t(platform.isNative
              ? "settings.language.description"
              : "settings.language.description.browser")}</small>
          </span>
          <code>{t("settings.language.current", { language: languageStatusLabel })}</code>
        </header>
        <div
          className="interface-option-grid"
          role="radiogroup"
          aria-label={t("settings.language.title")}
        >
          {LANGUAGE_OPTIONS.map((option, index) => {
            const selected = option.value === language.preference;
            const detailKey = option.value === "system"
              ? platform.isNative
                ? "settings.language.option.system.windows"
                : "settings.language.option.system.browser"
              : `settings.language.option.${option.value}.description`;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                className={selected ? "is-selected" : ""}
                onClick={() => setLanguagePreference(option.value)}
                onKeyDown={(event) => {
                  const lastIndex = LANGUAGE_OPTIONS.length - 1;
                  const nextIndex = event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? lastIndex
                      : ["ArrowRight", "ArrowDown"].includes(event.key)
                        ? (index + 1) % LANGUAGE_OPTIONS.length
                        : ["ArrowLeft", "ArrowUp"].includes(event.key)
                          ? (index - 1 + LANGUAGE_OPTIONS.length) % LANGUAGE_OPTIONS.length
                          : null;
                  if (nextIndex === null) return;
                  event.preventDefault();
                  const nextButton = event.currentTarget.parentElement?.children[nextIndex];
                  nextButton?.focus();
                  setLanguagePreference(LANGUAGE_OPTIONS[nextIndex].value);
                }}
              >
                <strong>{t(option.labelKey)}</strong>
                <small>{t(detailKey)}</small>
              </button>
            );
          })}
        </div>
      </div>

      <p className={`theme-draft-status${isPaletteDirty ? " is-dirty" : ""}`} role="status">
        <span>{isPaletteDirty
          ? t("settings.interface.palette.draftPending")
          : t("settings.interface.palette.synchronized")}</span>
        <code>{paletteContrast.passes
          ? t("settings.interface.palette.contrastReady")
          : t("settings.interface.palette.contrastCheck")}</code>
      </p>

      <div
        className="theme-choice-grid"
        role="radiogroup"
        aria-label={t("settings.interface.theme.aria")}
      >
        {themeOptions.map((theme) => {
          const translation = interfaceThemeTranslationKeys[theme.id];
          const label = translation ? t(translation.labelKey) : theme.label;
          const description = translation
            ? t(translation.descriptionKey)
            : theme.description;
          return (
            <button
              key={theme.id}
              type="button"
              role="radio"
              aria-checked={theme.id === themeId}
              className={theme.id === themeId ? "is-selected" : ""}
              onClick={() => {
                setVisualTheme(theme.id);
                onToast?.(t("settings.interface.toast.themeChanged", { theme: label }));
              }}
            >
              <span
                className="theme-swatch"
                style={{
                  "--theme-swatch-bg": theme.palette.background,
                  "--theme-swatch-surface": theme.palette.surface,
                  "--theme-swatch-card": theme.palette.card,
                  "--theme-swatch-text": theme.palette.text,
                  "--theme-swatch-text-strong": theme.palette.textStrong,
                  "--theme-swatch-muted": theme.palette.muted,
                  "--theme-swatch-border": theme.palette.border,
                  "--theme-swatch-accent": theme.palette.accent,
                }}
                aria-hidden="true"
              >
                <i /><i /><i />
              </span>
              <span><strong>{label}</strong><small>{description}</small></span>
            </button>
          );
        })}
      </div>

      <fieldset className="theme-customizer" aria-describedby="custom-palette-description">
        <legend>{t("settings.interface.palette.title")}</legend>
        <p id="custom-palette-description">
          {t("settings.interface.palette.description")}
        </p>
        <div className="theme-customizer__fields">
          {customVisualPaletteFields.map((field) => {
            const labelKey = interfacePaletteFieldLabelKeys[field.key];
            return (
              <label key={field.key} htmlFor={`custom-palette-${field.key}`}>
                <span>{labelKey ? t(labelKey) : field.label}</span>
                <input
                  id={`custom-palette-${field.key}`}
                  type="color"
                  value={customPaletteDraft[field.key]}
                  onChange={(event) => {
                    const value = event.currentTarget.value.toUpperCase();
                    setCustomPaletteDraft((current) => ({
                      ...current,
                      [field.key]: value,
                    }));
                  }}
                />
              </label>
            );
          })}
        </div>
        <div className="theme-customizer__actions">
          <input
            ref={themeImportRef}
            className="sr-only"
            type="file"
            accept="application/json,.json"
            onChange={importCustomPalette}
            aria-label={t("settings.interface.palette.importAria")}
          />
          <button type="button" onClick={() => themeImportRef.current?.click()}>
            {t("settings.interface.palette.importJson")}
          </button>
          <button type="button" onClick={exportCustomPalette}>
            {t("settings.interface.palette.exportJson")}
          </button>
          <button
            type="button"
            className="is-primary"
            disabled={!isPaletteDirty || !paletteContrast.passes}
            onClick={applyCustomPalette}
          >
            {t("settings.interface.palette.apply")}
          </button>
          <button
            type="button"
            disabled={!isPaletteDirty}
            onClick={() => setCustomPaletteDraft({ ...savedCustomPalette })}
          >
            {t("settings.interface.palette.discard")}
          </button>
          <button type="button" onClick={resetCustomPalette}>
            {t("settings.interface.palette.resetToCarbon")}
          </button>
        </div>
        {!paletteContrast.passes ? (
          <p className="theme-contrast-warning" role="alert">
            <AlertRegular />
            <span>
              {t("settings.interface.palette.contrastWarning", {
                checks: failedContrastChecks
                  .map((check) => {
                    const labelKey = interfaceContrastCheckLabelKeys[check.id];
                    const label = labelKey ? t(labelKey) : check.label;
                    return `${label} ${check.ratio.toFixed(1)}:1`;
                  })
                  .join(" · "),
              })}
            </span>
          </p>
        ) : null}
      </fieldset>

      <div className="interface-option-group">
        <header>
          <span>
            <strong>{t("settings.motion.title")}</strong>
            <small>{t("settings.interface.motion.description")}</small>
          </span>
          <code>{interfacePreferences.motion}</code>
        </header>
        <div
          className="interface-option-grid"
          role="radiogroup"
          aria-label={t("settings.interface.motion.aria")}
        >
          {interfaceMotionOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={option.id === interfacePreferences.motion}
              className={option.id === interfacePreferences.motion ? "is-selected" : ""}
              onClick={() => setInterfacePreferences({ motion: option.id })}
            >
              <strong>{t(option.labelKey)}</strong>
              <small>{t(option.detailKey)}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="interface-option-group">
        <header>
          <span>
            <strong>{t("settings.emission.title")}</strong>
            <small>{t("settings.interface.emission.description")}</small>
          </span>
          <code>{interfacePreferences.emission}</code>
        </header>
        <div
          className="interface-option-grid"
          role="radiogroup"
          aria-label={t("settings.interface.emission.aria")}
        >
          {interfaceEmissionOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={option.id === interfacePreferences.emission}
              className={option.id === interfacePreferences.emission ? "is-selected" : ""}
              onClick={() => setInterfacePreferences({ emission: option.id })}
            >
              <strong>{t(option.labelKey)}</strong>
              <small>{t(option.detailKey)}</small>
            </button>
          ))}
        </div>
      </div>

      <OptionalSettingsBoundary fallbackMessage={t("settings.interface.effects.unavailable")}>
        <Suspense fallback={(
          <p className="shell-empty-state">
            {t("settings.interface.effects.loading")}
          </p>
        )}>
          <VisualEffectsSettings onToast={onToast} />
        </Suspense>
      </OptionalSettingsBoundary>

      <div className="audio-preference-row">
        <span className="runtime-setting-icon"><Speaker2Regular /></span>
        <span>
          <strong>{t("settings.interface.audio.title")}</strong>
          <small>{t("settings.interface.audio.description")}</small>
        </span>
        <input
          type="range"
          min="0.04"
          max="0.32"
          step="0.01"
          value={audio.volume}
          disabled={!audio.enabled}
          onChange={(event) => setUiAudioVolume(event.target.value)}
          aria-label={t("settings.interface.audio.volumeAria")}
        />
        <button
          type="button"
          className={`runtime-switch ${audio.enabled ? "is-on" : ""}`}
          role="switch"
          aria-checked={audio.enabled}
          onClick={() => setUiAudioEnabled(!audio.enabled)}
        >
          <span />
          <strong>{audio.enabled ? t("common.state.on") : t("common.state.off")}</strong>
        </button>
      </div>
      <button
        type="button"
        className="interface-reset-button"
        onClick={resetInterface}
      >
        <ArrowClockwiseRegular />
        <span>
          <strong>{t("settings.interface.reset.title")}</strong>
          <small>{t("settings.interface.reset.description")}</small>
        </span>
      </button>
    </section>
  );
}

function WindowAppearanceSettings({ onToast }) {
  const { t } = useLanguage();
  const appearance = useWindowAppearanceState();
  const [pendingMode, setPendingMode] = useState(null);
  const [pendingRule, setPendingRule] = useState(false);
  const [processInput, setProcessInput] = useState("");
  const [ruleAction, setRuleAction] = useState("deny");
  const [ruleInputError, setRuleInputError] = useState(null);
  const selectedMode = pendingMode ?? appearance.mode;
  const busy = appearance.loading || pendingMode !== null || pendingRule;
  const isBrowserPreview = appearance.simulation === true ||
    appearance.provenance?.kind === "browser-preview";
  const effectiveLabel = windowAppearanceLabels[appearance.effectiveMode] ?? "OFF";
  const selectedLabel = windowAppearanceLabels[selectedMode] ?? "OFF";
  const windowsReleaseLabel = getWindowsReleaseLabel(appearance.windows11, appearance.osBuild);

  const updateMode = async (mode) => {
    if (busy || mode === appearance.mode) return;
    setPendingMode(mode);
    try {
      const nextState = await setWindowAppearanceMode(mode);
      const nextLabel = windowAppearanceLabels[nextState.effectiveMode] ?? nextState.effectiveMode;
      const nextIsPreview = nextState.simulation === true ||
        nextState.provenance?.kind === "browser-preview";
      onToast?.(nextIsPreview
        ? t("settings.windows.appearance.toast.previewSet", {
          mode: windowAppearanceLabels[mode] ?? mode,
        })
        : nextState.effectiveMode === mode
          ? t("settings.windows.appearance.toast.switched", { mode: nextLabel })
          : t("settings.windows.appearance.toast.fallback", { mode: nextLabel }));
    } catch {
      // The shared appearance store exposes the bridge error inline.
    } finally {
      setPendingMode(null);
    }
  };

  const updateRule = async (processNameValue, action, clearInput = false) => {
    if (busy) return;
    const processName = normalizeWindowAppearanceProcessName(processNameValue);
    if (!processName) {
      setRuleInputError("settings.windows.rules.invalidProcess");
      return;
    }

    setRuleInputError(null);
    setPendingRule(true);
    try {
      const nextState = await setWindowAppearanceRule(processName, action);
      if (clearInput) setProcessInput("");
      const nextIsPreview = nextState.simulation === true ||
        nextState.provenance?.kind === "browser-preview";
      onToast?.(nextIsPreview
        ? t("settings.windows.rules.toast.previewSaved", { process: processName })
        : t("settings.windows.rules.toast.updated", {
          process: processName,
          action: t(action === "allow"
            ? "settings.windows.rules.action.allowed"
            : "settings.windows.rules.action.blocked"),
        }));
    } catch {
      // The shared appearance store exposes native validation errors inline.
    } finally {
      setPendingRule(false);
    }
  };

  const removeRule = async (processName) => {
    if (busy) return;
    setRuleInputError(null);
    setPendingRule(true);
    try {
      const nextState = await removeWindowAppearanceRule(processName);
      const nextIsPreview = nextState.simulation === true ||
        nextState.provenance?.kind === "browser-preview";
      onToast?.(nextIsPreview
        ? t("settings.windows.rules.toast.previewRemoved", { process: processName })
        : t("settings.windows.rules.toast.automatic", { process: processName }));
    } catch {
      // The shared appearance store exposes bridge errors inline.
    } finally {
      setPendingRule(false);
    }
  };

  const submitRule = (event) => {
    event.preventDefault();
    updateRule(processInput, ruleAction, true);
  };

  return (
    <section
      className="window-appearance-settings"
      aria-labelledby="window-appearance-title"
      aria-busy={busy}
    >
      <header className="window-appearance-header">
        <span className="window-appearance-icon"><WindowAppsRegular /></span>
        <span>
          <strong id="window-appearance-title">
            {t("settings.windows.appearance.title")}
          </strong>
          <small>{isBrowserPreview
            ? t("settings.windows.appearance.description.preview")
            : t("settings.windows.appearance.description.native")}</small>
        </span>
        <code className={!isBrowserPreview && appearance.windows11 ? "is-compatible" : ""}>
          {isBrowserPreview ? "PREVIEW" : windowsReleaseLabel}
        </code>
      </header>

      <fieldset disabled={busy}>
        <legend>{t("settings.windows.appearance.legend")}</legend>
        <div className="window-appearance-options">
          {windowAppearanceOptions.map((option) => {
            const selected = selectedMode === option.mode;
            return (
              <label
                key={option.mode}
                className={`window-appearance-choice ${selected ? "is-selected" : ""} is-${option.mode}`}
              >
                <input
                  type="radio"
                  name="window-appearance-mode"
                  value={option.mode}
                  checked={selected}
                  aria-describedby={`window-appearance-${option.mode}-description`}
                  onChange={() => updateMode(option.mode)}
                />
                <span className="window-appearance-level" aria-hidden="true">{option.level}</span>
                <span className="window-appearance-copy">
                  <strong><span>{option.title}</span><b>{t(option.labelKey)}</b></strong>
                  <small id={`window-appearance-${option.mode}-description`}>
                    {t(option.descriptionKey)}
                  </small>
                </span>
                <span className="window-appearance-tag">{t(option.tagKey)}</span>
                <span className="window-appearance-selector" aria-hidden="true"><i /></span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="window-appearance-telemetry" role="status" aria-live="polite">
        {isBrowserPreview ? (
          <>
            <span><small>{t("settings.windows.telemetry.previewSelection")}</small><strong>{busy
              ? t("settings.windows.state.saving")
              : selectedLabel}</strong></span>
            <span><small>WINDOWS</small><strong>{t("settings.windows.state.notInspected")}</strong></span>
            <span><small>{t("settings.windows.telemetry.nativeChange")}</small><strong>{t("settings.windows.state.none")}</strong></span>
          </>
        ) : (
          <>
            <span><small>{t("settings.windows.telemetry.effective")}</small><strong>{busy
              ? t("settings.windows.state.applying")
              : effectiveLabel}</strong></span>
            <span><small>{t("settings.windows.telemetry.styled")}</small><strong>{appearance.styledWindowCount}</strong></span>
            <span><small>{t("settings.windows.telemetry.osBuild")}</small><strong>{appearance.osBuild ?? "—"}</strong></span>
          </>
        )}
      </div>

      <div
        className="window-appearance-guards"
        aria-label={t("settings.windows.guards.aria")}
      >
        {isBrowserPreview ? (
          <>
            <span className="is-warning"><i />{t("settings.windows.guards.events", {
              status: t("settings.windows.state.notInspected"),
            })}</span>
            <span className="is-warning"><i />{t("settings.windows.guards.integrity", {
              status: t("settings.windows.state.notInspected"),
            })}</span>
            <span className="is-warning"><i />{t("settings.windows.guards.safeExit", {
              status: t("settings.windows.state.notInspected"),
            })}</span>
            <span className="is-warning"><i />{t("settings.windows.guards.recovery", {
              status: t("settings.windows.state.notInspected"),
            })}</span>
          </>
        ) : (
          <>
            <span className={appearance.effectiveMode === "off" || appearance.hooksReady ? "is-ready" : "is-warning"}>
              <i />{t("settings.windows.guards.events", {
                status: t(appearance.effectiveMode === "off"
                  ? "settings.windows.state.idle"
                  : appearance.hooksReady
                    ? "settings.windows.state.ready"
                    : "settings.windows.state.offline"),
              })}
            </span>
            <span className={appearance.hostIntegrityVerified ? "is-ready" : "is-warning"}>
              <i />{t("settings.windows.guards.integrity", {
                status: t(appearance.hostIntegrityVerified
                  ? "settings.windows.state.verified"
                  : "settings.windows.state.blocked"),
              })}
            </span>
            <span className={appearance.safetyHotkeyRegistered ? "is-ready" : "is-warning"}>
              <i />{t("settings.windows.guards.safeExit", {
                status: t(appearance.safetyHotkeyRegistered
                  ? "settings.windows.state.armed"
                  : "settings.windows.state.localOnly"),
              })}
            </span>
            <span className={appearance.recoveryArmed ? "is-ready" : "is-warning"}>
              <i />{t("settings.windows.guards.recovery", {
                status: t(appearance.recoveryArmed
                  ? "settings.windows.state.armed"
                  : "settings.windows.state.pending"),
              })}
            </span>
          </>
        )}
      </div>

      <section className="window-rule-editor" aria-labelledby="window-rule-title">
        <header>
          <span>
            <strong id="window-rule-title">{t("settings.windows.rules.title")}</strong>
            <small>{isBrowserPreview
              ? t("settings.windows.rules.description.preview", {
                count: appearance.rules.length,
              })
              : t("settings.windows.rules.description.native", {
                count: appearance.rules.length,
              })}</small>
          </span>
        </header>
        <form onSubmit={submitRule}>
          <label>
            <span className="sr-only">{t("settings.windows.rules.processLabel")}</span>
            <input
              type="text"
              value={processInput}
              maxLength={68}
              placeholder="notepad.exe"
              autoComplete="off"
              spellCheck="false"
              disabled={busy}
              aria-invalid={Boolean(ruleInputError)}
              aria-describedby={ruleInputError ? "window-rule-input-error" : undefined}
              onChange={(event) => {
                setProcessInput(event.target.value);
                setRuleInputError(null);
              }}
            />
          </label>
          <div
            className="window-rule-action"
            role="group"
            aria-label={t("settings.windows.rules.actionAria")}
          >
            <button
              type="button"
              className={ruleAction === "allow" ? "is-active is-allow" : ""}
              disabled={busy}
              onClick={() => setRuleAction("allow")}
            >
              {t("settings.windows.rules.action.allow")}
            </button>
            <button
              type="button"
              className={ruleAction === "deny" ? "is-active is-deny" : ""}
              disabled={busy}
              onClick={() => setRuleAction("deny")}
            >
              {t("settings.windows.rules.action.deny")}
            </button>
          </div>
          <button type="submit" className="window-rule-submit" disabled={busy || !processInput.trim()}>
            {pendingRule
              ? t("settings.windows.state.applying")
              : t("common.action.apply")}
          </button>
        </form>
        {ruleInputError ? (
          <p id="window-rule-input-error" className="window-rule-inline-error" role="alert">
            {t(ruleInputError)}
          </p>
        ) : null}
        {appearance.rules.length ? (
          <div
            className="window-rule-list"
            aria-label={t("settings.windows.rules.savedAria")}
          >
            {appearance.rules.map((rule) => (
              <div key={rule.processName}>
                <code>{rule.processName}.exe</code>
                <button
                  type="button"
                  className={`is-${rule.action}`}
                  disabled={busy}
                  onClick={() => updateRule(
                    rule.processName,
                    rule.action === "allow" ? "deny" : "allow",
                  )}
                >
                  {t(rule.action === "allow"
                    ? "settings.windows.rules.action.allow"
                    : "settings.windows.rules.action.deny")}
                </button>
                <button
                  type="button"
                  className="window-rule-remove"
                  disabled={busy}
                  aria-label={t("settings.windows.rules.removeAria", {
                    process: rule.processName,
                  })}
                  onClick={() => removeRule(rule.processName)}
                >
                  <DismissRegular />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="window-rule-empty">{t("settings.windows.rules.empty")}</p>
        )}
      </section>

      <section className="window-compatibility" aria-labelledby="window-compatibility-title">
        <header>
          <span>
            <strong id="window-compatibility-title">
              {t("settings.windows.compatibility.title")}
            </strong>
            <small>{isBrowserPreview
              ? t("settings.windows.compatibility.description.preview")
              : t("settings.windows.compatibility.description.native")}</small>
          </span>
          <b>{appearance.compatibilityMatrix.length}</b>
        </header>
        {appearance.compatibilityMatrix.length ? (
          <div className="window-compatibility-list">
            {appearance.compatibilityMatrix.map((entry) => {
              const actionable = !["protected", "limited"].includes(entry.decision);
              const nextAction = entry.decision === "denied" ? "allow" : "deny";
              return (
                <div key={entry.processName} className={`is-${entry.decision}`}>
                  <span>
                    <code>{entry.processName}.exe</code>
                    <small>{windowCompatibilityReasonKeys[entry.reasonCode]
                      ? t(windowCompatibilityReasonKeys[entry.reasonCode])
                      : getWindowCompatibilityReasonLabel(entry.reasonCode)}</small>
                  </span>
                  <span className="window-compatibility-counts">
                    <small>WIN</small><b>{entry.windowCount}</b>
                    <small>READY</small><b>{entry.eligibleWindowCount}</b>
                    <small>LIVE</small><b>{entry.styledWindowCount}</b>
                  </span>
                  <button
                    type="button"
                    disabled={busy || !actionable}
                    onClick={() => updateRule(entry.processName, nextAction)}
                  >
                    {actionable
                      ? t(nextAction === "allow"
                        ? "settings.windows.rules.action.allow"
                        : "settings.windows.rules.action.deny")
                      : entry.decision.toUpperCase()}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="window-rule-empty">
            {t("settings.windows.compatibility.empty")}
          </p>
        )}
      </section>

      <p className="window-appearance-safety-note">
        <ShieldRegular />
        <span>{isBrowserPreview
          ? t("settings.windows.safety.preview")
          : t("settings.windows.safety.native")}</span>
      </p>

      {appearance.fallbackReason ? (
        <p className="window-appearance-feedback is-fallback" role="status">
          <AlertRegular />
          <span>{isBrowserPreview
            ? t("settings.windows.feedback.previewOnly", {
              reason: appearance.fallbackReason,
            })
            : t("settings.windows.feedback.fallback", {
              mode: effectiveLabel,
              reason: appearance.fallbackReason,
            })}</span>
        </p>
      ) : null}
      {appearance.error ? (
        <p className="window-appearance-feedback is-error" role="alert">
          <AlertRegular />
          <span>{appearance.error}</span>
        </p>
      ) : null}
    </section>
  );
}

export function ShellPanelLayer({
  panel,
  presenceState = "open",
  onPresenceComplete,
  onClose,
  onOpenCommand,
  onLaunch,
  onLaunchInstalled,
  onActivateWindow,
  onOpenPanel,
  onExit,
  onToast,
  localFeedEvents,
  onClearLocalFeed,
  onMarkLocalFeedRead,
  graphSourceState,
}) {
  const panelRef = useRef(null);
  const closing = presenceState === "closing";
  const interactive = Boolean(panel) && !closing;
  useDialogFocusTrap(panelRef, interactive, { onEscape: onClose });

  useEffect(() => {
    if (!interactive) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const container = panelRef.current;
      if (!container || container.contains(document.activeElement)) return;
      const target = container.querySelector(
        "[data-dialog-initial-focus='true'], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]",
      );
      target?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [interactive, panel]);

  if (!panel) return null;

  return (
    <div
      className={`shell-panel-layer is-${panel}`}
      data-state={presenceState}
      aria-hidden={closing ? "true" : undefined}
      onMouseDown={(event) => {
        if (closing) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onClose();
      }}
    >
      <div
        ref={panelRef}
        data-state={presenceState}
        inert={closing ? true : undefined}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget) onPresenceComplete?.();
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {panel === "start" ? (
          <StartPanel
            onClose={onClose}
            onOpenCommand={onOpenCommand}
            onLaunch={onLaunch}
            onLaunchInstalled={onLaunchInstalled}
            onActivateWindow={onActivateWindow}
            onOpenHelp={() => onOpenPanel("help")}
            onOpenSession={() => onOpenPanel("session")}
          />
        ) : null}
        {panel === "quick-settings" ? <QuickSettingsPanel onClose={onClose} onLaunch={onLaunch} /> : null}
        {panel === "date-time" ? <DateTimePanel onClose={onClose} onLaunch={onLaunch} /> : null}
        {panel === "notifications" ? (
          <NotificationsPanel
            localEvents={localFeedEvents}
            onClearLocalFeed={onClearLocalFeed}
            onClose={onClose}
            onLaunch={onLaunch}
            onMarkLocalFeedRead={onMarkLocalFeedRead}
          />
        ) : null}
        {panel === "session" ? (
          <SessionControlPanel
            onClose={onClose}
            onExit={onExit}
            onToast={onToast}
          />
        ) : null}
        {panel === "settings" ? (
          <RuntimeSettingsPanel
            onClose={onClose}
            onToast={onToast}
            onOpenHelp={() => onOpenPanel("help")}
            graphSourceState={graphSourceState}
          />
        ) : null}
        {panel === "help" ? <HelpCenterPanel onClose={onClose} onOpenPanel={onOpenPanel} /> : null}
      </div>
    </div>
  );
}
