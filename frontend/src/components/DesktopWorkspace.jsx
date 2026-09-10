import { ChevronRightRegular } from "@fluentui/react-icons";
import { useCallback, useMemo, useRef, useState } from "react";
import { DesktopToolsContext } from "../desktop-tools-context.js";
import { useLanguage } from "../i18n/language-system.js";

export function DesktopWorkspace({ children, ...props }) {
  const { t } = useLanguage();
  const [activePanel, setActivePanel] = useState("telemetry");
  const [graphToolsTarget, setGraphToolsTarget] = useState(null);
  const systemToggleRef = useRef(null);
  const togglePanel = useCallback((panel) => {
    setActivePanel((current) => current === panel ? null : panel);
  }, []);
  const value = useMemo(() => ({
    activePanel,
    setActivePanel,
    togglePanel,
    graphToolsTarget,
    systemToggleRef,
  }), [activePanel, graphToolsTarget, togglePanel]);
  const systemOpen = activePanel === "telemetry";
  const systemLabel = t(systemOpen ? "telemetry.action.hide" : "telemetry.action.show");

  return (
    <DesktopToolsContext.Provider value={value}>
      <section className="desktop-workspace" data-side-panel={activePanel ?? "closed"} {...props}>
        {children}
        <aside className="desktop-tool-rail" aria-label={t("graph.workspace.rail.aria")}>
          <button
            ref={systemToggleRef}
            type="button"
            className="desktop-tool-rail__system"
            aria-label={systemLabel}
            title={systemLabel}
            aria-expanded={systemOpen}
            aria-controls="desktop-system-panel"
            onClick={() => togglePanel("telemetry")}
          >
            <ChevronRightRegular aria-hidden="true" />
            <span>{t("telemetry.action.toolShort")}</span>
          </button>
          <div className="desktop-tool-rail__graph" ref={setGraphToolsTarget} />
        </aside>
      </section>
    </DesktopToolsContext.Provider>
  );
}
