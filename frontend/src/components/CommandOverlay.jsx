import {
  ArrowRightRegular,
  DismissRegular,
  DocumentRegular,
  FolderRegular,
  SearchRegular,
  WindowAppsRegular,
} from "@fluentui/react-icons";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useApplicationCatalog,
  useDesktopEntries,
  useTaskbarSnapshot,
} from "../hooks/usePlatformData.js";
import { getDesktopShortcutLabelKey } from "../desktop-shortcut-labels.js";
import {
  createQuickSearchIndex,
  getQuickSearchScopeShortcut,
  parseQuickSearchQuery,
  quickSearchScopes,
  searchQuickIndex,
  segmentSearchMatch,
} from "../quick-search.js";
import {
  clearQuickSearchHistory,
  recordQuickSearchQuery,
} from "../quick-search-history.js";
import { useLanguage } from "../i18n/language-system.js";
import { quickLaunchItems, quickSettingItems } from "../quick-search-catalog.js";
import { useDialogFocusTrap } from "../hooks/useDialogFocusTrap.js";
import { useRecentApplicationIds } from "../hooks/useRecentApplications.js";
import { useQuickSearchHistory } from "../hooks/useQuickSearchHistory.js";

const QUICK_SETTING_LABEL_KEYS = Object.freeze({
  bluetooth: "bluetooth",
  display: "display",
  network: "network",
  privacy: "security",
  settings: "allSettings",
  sound: "sound",
});

function getLocalizedScope(scope, t) {
  return {
    label: t(scope.labelKey),
    detail: t(scope.detailKey),
  };
}

function getLocalizedResultLabel(result, t) {
  if (result.kind === "setting") {
    const key = QUICK_SETTING_LABEL_KEYS[result.id];
    if (key) return t(`quickSearch.setting.${key}`);
  }
  if (result.kind === "desktop") {
    const labelKey = getDesktopShortcutLabelKey(result.entry?.id);
    if (labelKey) return t(labelKey);
  }
  return result.label;
}

function getLocalizedResultCategory(result, t) {
  if (result.kind === "app") return t("quickSearch.category.application");
  if (result.kind === "installed-app") return t("quickSearch.category.installedApplication");
  if (result.kind === "window") return t("quickSearch.category.openWindow");
  if (result.kind === "desktop") return result.entry?.kind === "directory"
    ? t("quickSearch.category.desktopFolder")
    : t("quickSearch.category.desktopItem");
  if (result.kind === "setting") return t("quickSearch.category.windowsSetting");
  return result.category;
}

function getLocalizedResultDetail(result, t) {
  if (result.kind === "app") return result.id === "explorer"
    ? t("quickSearch.result.browseFilesAndFolders")
    : t("quickSearch.result.launchApplication", { application: result.label });
  if (result.kind === "installed-app") {
    return t("quickSearch.result.installedApplication", {
      source: result.application?.source === "packaged"
        ? t("quickSearch.source.windowsApplication")
        : "Start Menu",
      category: result.application?.category ?? "",
    });
  }
  if (result.kind === "window") {
    const state = result.window?.minimized
      ? t("quickSearch.window.minimized")
      : result.window?.active
        ? t("quickSearch.window.active")
        : t("quickSearch.window.running");
    return t("quickSearch.result.window", {
      process: result.window?.processName ?? t("taskbar.application"),
      state,
    });
  }
  if (result.kind === "desktop") {
    return result.entry?.path ?? result.entry?.target ?? t("quickSearch.result.windowsDesktop");
  }
  if (result.kind === "setting") return result.target;
  return result.detail;
}

function QuickSearchIcon({ result }) {
  if (result.iconDataUrl) {
    return <img src={result.iconDataUrl} alt="" />;
  }

  if (result.Icon) {
    const Icon = result.Icon;
    return <Icon />;
  }

  if (result.kind === "window" || result.kind === "installed-app") return <WindowAppsRegular />;
  if (result.entry?.kind === "directory") return <FolderRegular />;
  return <DocumentRegular />;
}

function QuickSearchLabel({ label, query }) {
  return segmentSearchMatch(label, query).map((segment, index) => (
    segment.match
      ? <mark key={`${segment.text}-${index}`}>{segment.text}</mark>
      : <span key={`${segment.text}-${index}`}>{segment.text}</span>
  ));
}

function getQuickSearchOptionId(resultId) {
  return `quick-search-${encodeURIComponent(resultId)}`;
}

export function CommandOverlay({
  open,
  presenceState = "open",
  onPresenceComplete,
  onClose,
  onExecute,
  busy = false,
  statusMessage = null,
  surfaceLabel = null,
}) {
  const { language, t } = useLanguage();
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const [value, setValue] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const deferredValue = useDeferredValue(value);
  const applicationCatalog = useApplicationCatalog();
  const desktop = useDesktopEntries();
  const taskbar = useTaskbarSnapshot();
  const recentApplicationIds = useRecentApplicationIds();
  const queryHistory = useQuickSearchHistory();
  const closing = presenceState === "closing";
  const interactive = open && !closing;

  useDialogFocusTrap(dialogRef, interactive, { initialFocusRef: inputRef, onEscape: onClose });

  const searchIndex = useMemo(() => createQuickSearchIndex({
    launchItems: quickLaunchItems,
    installedApplications: applicationCatalog.applications,
    recentApplicationIds,
    settingItems: quickSettingItems,
    windows: taskbar.windows,
    desktopEntries: desktop.entries,
  }), [
    applicationCatalog.applications,
    desktop.entries,
    recentApplicationIds,
    taskbar.windows,
  ]);

  const results = useMemo(
    () => searchQuickIndex(searchIndex, deferredValue, undefined, language),
    [deferredValue, language, searchIndex],
  );
  const parsedQuery = useMemo(
    () => parseQuickSearchQuery(deferredValue),
    [deferredValue],
  );
  const activeScope = quickSearchScopes.find((scope) => scope.id === parsedQuery.scope)
    ?? quickSearchScopes[0];
  const localizedActiveScope = getLocalizedScope(activeScope, t);
  const selectedIndex = results.length > 0
    ? Math.min(activeIndex, results.length - 1)
    : 0;
  const selectedResult = results[selectedIndex] ?? null;
  const selectedOptionId = selectedResult
    ? getQuickSearchOptionId(selectedResult.resultId)
    : undefined;
  const resultStatus = applicationCatalog.error
    ? t("quickSearch.status.startMenuUnavailable")
    : applicationCatalog.loading
      ? t("quickSearch.status.indexingStartMenu")
      : desktop.loading
        ? t("quickSearch.status.indexingDesktop")
        : t("quickSearch.status.results", {
          count: results.length,
          scope: localizedActiveScope.label,
        });

  useEffect(() => {
    if (!interactive || !selectedOptionId) return;
    document.getElementById(selectedOptionId)?.scrollIntoView({ block: "nearest" });
  }, [interactive, selectedOptionId]);

  if (!open) return null;

  const execute = (result) => {
    if (!result || busy) return;
    recordQuickSearchQuery(value);
    onExecute(result);
  };

  const selectScope = (scope) => {
    const nextValue = scope.id === "all"
      ? parsedQuery.query
      : `${scope.prefix}${parsedQuery.query ? ` ${parsedQuery.query}` : " "}`;
    setValue(nextValue.slice(0, 160));
    setActiveIndex(0);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const reuseQuery = (query) => {
    setValue(query);
    setActiveIndex(0);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleInputKeyDown = (event) => {
    const shortcutScope = getQuickSearchScopeShortcut(event);
    if (shortcutScope) {
      event.preventDefault();
      const scope = quickSearchScopes.find((candidate) => candidate.id === shortcutScope);
      if (scope) selectScope(scope);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => results.length > 0 ? (current + 1) % results.length : 0);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => results.length > 0
        ? (current - 1 + results.length) % results.length
        : 0);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(0, results.length - 1));
    }
  };

  return (
    <div className="overlay-layer" data-state={presenceState} role="presentation" aria-hidden={closing ? "true" : undefined} onMouseDown={(event) => {
      if (closing) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        ref={dialogRef}
        className={`command-palette hud-panel${busy ? " is-busy" : ""}`}
        data-state={presenceState}
        inert={closing ? true : undefined}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget) onPresenceComplete?.();
        }}
        role="dialog"
        aria-modal="true"
        aria-label={surfaceLabel ?? t("quickSearch.title")}
        aria-busy={busy}
      >
        <form onSubmit={(event) => { event.preventDefault(); execute(selectedResult); }}>
          <SearchRegular />
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => {
              setValue(event.target.value.slice(0, 160));
              setActiveIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder={t("quickSearch.placeholder")}
            aria-label={t("quickSearch.title")}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-haspopup="listbox"
            aria-controls="jarvis-quick-search-results"
            aria-describedby="jarvis-quick-search-status"
            aria-activedescendant={selectedOptionId}
            autoComplete="off"
            spellCheck="false"
            maxLength={160}
            disabled={busy}
          />
          <button
            type="submit"
            className="run-command"
            aria-label={t("quickSearch.action.openSelectedResult")}
            disabled={!selectedResult || busy}
          >
            <ArrowRightRegular />
          </button>
          <button
            type="button"
            className="command-close"
            onClick={onClose}
            aria-label={t("quickSearch.action.close")}
            disabled={busy}
          >
            <DismissRegular />
          </button>
        </form>

        <div className="command-results-surface">
          {!value.trim() && queryHistory.length > 0 ? (
            <div className="command-query-history" aria-label={t("quickSearch.history.aria")}>
              <span>{t("quickSearch.history.recent")}</span>
              {queryHistory.slice(0, 4).map((query) => (
                <button
                  key={query}
                  type="button"
                  title={t("quickSearch.history.reuse", { query })}
                  onClick={() => reuseQuery(query)}
                >
                  {query}
                </button>
              ))}
              <button
                type="button"
                className="command-history-clear"
                aria-label={t("quickSearch.history.clearAria")}
                onClick={clearQuickSearchHistory}
              >
                {t("quickSearch.history.clear")}
              </button>
            </div>
          ) : null}

          <div
            id="jarvis-quick-search-results"
            className="command-results"
            role="listbox"
            aria-label={t("quickSearch.results.aria")}
            aria-busy={applicationCatalog.loading || desktop.loading}
          >
            {results.length > 0 ? results.map((result, index) => (
              <button
                id={getQuickSearchOptionId(result.resultId)}
                key={result.resultId}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={index === selectedIndex}
                className={index === selectedIndex ? "is-active" : ""}
                disabled={busy}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => execute(result)}
              >
                <span className="command-result-icon" aria-hidden="true"><QuickSearchIcon result={result} /></span>
                <span className="command-result-copy">
                  <strong>
                    <QuickSearchLabel
                      label={getLocalizedResultLabel(result, t)}
                      query={parsedQuery.query}
                    />
                  </strong>
                  <small>{getLocalizedResultDetail(result, t)}</small>
                </span>
                <span className="command-result-category">
                  {getLocalizedResultCategory(result, t)}
                </span>
                <ArrowRightRegular className="command-result-arrow" aria-hidden="true" />
              </button>
            )) : (
              <div className="command-empty-state" role="status">
                <SearchRegular />
                <span>
                  <strong>{t("quickSearch.empty.title")}</strong>
                  <small>{t("quickSearch.empty.description")}</small>
                </span>
              </div>
            )}
          </div>
        </div>

        <footer className="command-shortcut-bar">
          <div className="command-search-tools" aria-label={t("quickSearch.scope.aria")}>
            {quickSearchScopes.map((scope, index) => (
              <button
                key={scope.id}
                type="button"
                className={scope.id === activeScope.id ? "is-active" : ""}
                aria-pressed={scope.id === activeScope.id}
                aria-keyshortcuts={`Control+${index + 1}`}
                title={t("quickSearch.scope.shortcutTitle", {
                  shortcut: `Ctrl+${index + 1}`,
                  prefix: scope.prefix || t("quickSearch.scope.noPrefix"),
                  detail: getLocalizedScope(scope, t).detail,
                })}
                onClick={() => selectScope(scope)}
              >
                <span>{getLocalizedScope(scope, t).label}</span>
                <kbd>{index + 1}</kbd>
              </button>
            ))}
          </div>
          <span className="command-shortcut-hint">{t("quickSearch.shortcutHint")}</span>
          <small id="jarvis-quick-search-status" role="status" aria-live="polite" aria-atomic="true">
            {statusMessage ?? (busy ? t("quickSearch.status.checking") : resultStatus)}
          </small>
        </footer>
      </section>
    </div>
  );
}
