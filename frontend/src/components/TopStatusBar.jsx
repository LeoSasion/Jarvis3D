import { SearchRegular, StopRegular } from "@fluentui/react-icons";
import { useLanguage } from "../i18n/language-system.js";
import { JarvisMark } from "./VectorMarks.jsx";

function TopCluster({ className = "", children, as = "div", ...props }) {
  const Tag = as;
  return (
    <Tag className={`top-cluster ${className}`} {...props}>
      {children}
    </Tag>
  );
}

export function TopStatusBar({
  onOpenCommand,
  onAbortAgent,
  agentState,
}) {
  const { t } = useLanguage();
  const agentStatus = agentState?.status ?? "unavailable";
  const agentRunning = agentStatus === "running" || agentStatus === "starting";

  return (
    <header className="topbar hud-chassis" aria-label={t("topbar.accessibility.label")}>
      <div className="topbar__zone topbar__identity">
        <TopCluster className="brand-cluster">
          <JarvisMark className="brand-orb" />
          <span className="brand-name">JARVIS</span>
        </TopCluster>
        <TopCluster
          as="button"
          type="button"
          className="search-cluster"
          onClick={onOpenCommand}
          title={t("topbar.search.title")}
          aria-label={t("topbar.search.aria")}
          aria-keyshortcuts="Control+Space"
        >
          <SearchRegular />
          <span>{t("topbar.search.label")}</span>
          <kbd>Ctrl Space</kbd>
        </TopCluster>
      </div>

      {agentRunning ? (
        <div className="topbar__zone topbar__command-bus">
          <TopCluster
            as="button"
            type="button"
            className="stop-cluster"
            onClick={() => { void onAbortAgent().catch(() => {}); }}
            title={t("topbar.agent.stop.title")}
          >
            <span className="stop-token" aria-hidden="true"><StopRegular /></span>
            <span>{t("topbar.agent.stop.label")}</span>
          </TopCluster>
        </div>
      ) : <span className="topbar__spacer" aria-hidden="true" />}
    </header>
  );
}
