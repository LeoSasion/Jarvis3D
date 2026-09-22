import { PowerRegular, SearchRegular, StopRegular } from "@fluentui/react-icons";
import { getAgentProviderLabel, hasAgentProviderFault } from "../agent-provider-model.js";
import { usePlatformClock } from "../hooks/usePlatformData.js";
import { useLanguage } from "../i18n/language-system.js";
import { formatClockPresentation } from "../i18n/locale-format.js";
import { JarvisMark } from "./VectorMarks.jsx";
import { ScreenRecordingButton } from "./ScreenRecordingButton.jsx";

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
  onOpenDateTime,
  onPower,
  onFeedback,
}) {
  const { language, t } = useLanguage();
  const clock = usePlatformClock();
  const localizedClock = formatClockPresentation(clock.dateTime, language);
  const agentStatus = agentState?.status ?? "unavailable";
  const agentRunning = agentStatus === "running" || agentStatus === "starting";
  const agentFaulted = hasAgentProviderFault(agentState ?? {});
  const statusLabel = t(agentFaulted ? "agent.status.needsAttention"
    : agentRunning ? "agent.status.responding"
      : !agentState?.available ? "agent.status.offline"
        : agentState.connected ? "agent.status.connected" : "agent.status.ready");

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

      <div className="topbar__zone topbar__command-bus">
        <span className="topbar__bus-label">{t("topbar.commandBus")}</span>
        <div className={`topbar__agent-status${agentRunning ? " is-working" : ""}${agentFaulted ? " is-error" : ""}`}>
          <i aria-hidden="true" />
          <span>
            <strong>{getAgentProviderLabel(agentState ?? {})}</strong>
            <small>{statusLabel}</small>
          </span>
        </div>
        {agentRunning ? (
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
        ) : null}
      </div>
      <div className="topbar__zone topbar__system">
        <ScreenRecordingButton onFeedback={onFeedback} />
        <button type="button" className="topbar__clock" onClick={onOpenDateTime}
          aria-label={t("taskbar.clock.open", { date: localizedClock.longDate, time: localizedClock.time })}>
          <span>{localizedClock.longDate}</span>
          <time>{localizedClock.time}</time>
        </button>
        <button type="button" className="topbar__power" onClick={onPower}
          aria-label={t("topbar.power")} title={t("topbar.power")}>
          <PowerRegular />
        </button>
      </div>
    </header>
  );
}
