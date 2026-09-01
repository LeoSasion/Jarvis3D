import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "./i18n/language-system.js";
import { mockTaskbarSnapshot } from "./platform/mock-platform.js";
import {
  advanceWindowSwitcherState,
  getVisibleWindowSwitcherEntries,
  getWindowSwitcherSelectionScrollTop,
  getWindowInitials,
  normalizeWindowSwitcherState,
} from "./window-switcher-model.js";
import { localizeWorkspaceWindow } from "./workspace-window-labels.js";

function createPreviewState() {
  const requestedIndex = Number.parseInt(
    new URLSearchParams(window.location.search).get("selected") ?? "1",
    10,
  );
  return normalizeWindowSwitcherState({
    windows: mockTaskbarSnapshot.windows,
    selectedIndex: Number.isFinite(requestedIndex) ? requestedIndex : 1,
    reverse: false,
  });
}

function WindowIcon({ entry }) {
  if (entry.iconDataUrl) {
    return <img src={entry.iconDataUrl} alt="" />;
  }
  return <span aria-hidden="true">{getWindowInitials(entry.processName)}</span>;
}

export function WindowSwitcherSurface() {
  const { t } = useLanguage();
  const railRef = useRef(null);
  const selectedCardRef = useRef(null);
  const [state, setState] = useState(createPreviewState);
  const visibleEntries = useMemo(
    () => getVisibleWindowSwitcherEntries(state),
    [state],
  );
  const localizedVisibleEntries = useMemo(
    () => visibleEntries.map((entry) => ({
      ...entry,
      window: localizeWorkspaceWindow(entry.window, t),
    })),
    [t, visibleEntries],
  );
  useEffect(() => {
    const handleNativeState = (event) => {
      setState(normalizeWindowSwitcherState(event.detail));
    };
    window.addEventListener("jarvis:window-switcher-state", handleNativeState);
    return () => window.removeEventListener("jarvis:window-switcher-state", handleNativeState);
  }, []);

  useLayoutEffect(() => {
    const rail = railRef.current;
    const selectedCard = selectedCardRef.current;
    if (!rail || !selectedCard) return;

    const railBounds = rail.getBoundingClientRect();
    const selectedBounds = selectedCard.getBoundingClientRect();
    const selectedTop = rail.scrollTop + selectedBounds.top - railBounds.top;
    const nextScrollTop = getWindowSwitcherSelectionScrollTop({
      viewportHeight: rail.clientHeight,
      scrollHeight: rail.scrollHeight,
      scrollTop: rail.scrollTop,
      selectedTop,
      selectedHeight: selectedBounds.height,
    });
    if (nextScrollTop !== rail.scrollTop) rail.scrollTop = nextScrollTop;
  }, [visibleEntries]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== "Tab") return;
      event.preventDefault();
      setState((current) => advanceWindowSwitcherState(current, event.shiftKey));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <main className="jarvis-window-switcher" aria-label={t("windowSwitcher.accessibility.surface")}>
      <section className="window-switcher-chassis" aria-live="polite">
        <header className="window-switcher-header">
          <div className="window-switcher-brand">
            <div>
              <span>{t("windowSwitcher.title")}</span>
              <small>Alt + Tab</small>
            </div>
          </div>
          <small>{t("windowSwitcher.openCount", { count: state.windows.length })}</small>
        </header>

        <div
          ref={railRef}
          className="window-switcher-rail"
          role="listbox"
          aria-label={t("windowSwitcher.accessibility.windows")}
        >
          {localizedVisibleEntries.map(({ window: entry, index, selected }) => (
            <button
              key={entry.windowId}
              ref={selected ? selectedCardRef : undefined}
              type="button"
              className={`window-switcher-card ${selected ? "is-selected" : ""}`}
              role="option"
              aria-selected={selected}
              onClick={() => setState((current) => ({
                ...normalizeWindowSwitcherState(current),
                selectedIndex: index,
              }))}
            >
              <span className="window-switcher-icon">
                <WindowIcon entry={entry} />
              </span>
              <span className="window-switcher-copy">
                <strong>{entry.title}</strong>
                <small>
                  {entry.processName}
                  <i aria-hidden="true">·</i>
                  {entry.minimized
                    ? t("windowSwitcher.state.minimized")
                    : entry.active
                      ? t("windowSwitcher.state.active")
                      : t("windowSwitcher.state.open")}
                </small>
              </span>
            </button>
          ))}
        </div>

        <footer className="window-switcher-footer">
          <div className="window-switcher-instructions">
            <kbd>ALT</kbd>
            <span>{t("windowSwitcher.instruction.release")}</span>
            <i />
            <kbd>SHIFT + TAB</kbd>
            <span>{t("windowSwitcher.instruction.previous")}</span>
          </div>
        </footer>
      </section>
    </main>
  );
}
