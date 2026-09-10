import {
  AlertRegular,
  CheckmarkCircleRegular,
  ChevronRightRegular,
  InfoRegular,
} from "@fluentui/react-icons";
import { useMemo, useState } from "react";
import { useDesktopTools } from "../desktop-tools-context.js";
import { mergeSystemFeedEvents } from "../feedback-model.js";
import { useSystemFeed, useSystemSnapshot } from "../hooks/usePlatformData.js";
import { useLanguage } from "../i18n/language-system.js";
import { formatTime } from "../i18n/locale-format.js";
import {
  getCompactTelemetrySummary,
  getTelemetryPriorityPresentation,
  getTelemetryRailMode,
} from "../telemetry-rail-model.js";
import { HudPanel } from "./HudPanel.jsx";
import { SparklineCanvas } from "./SparklineCanvas.jsx";

function SegmentBar({ active = 10 }) {
  return (
    <span className="segment-bar" aria-hidden="true">
      {Array.from({ length: 18 }, (_, index) => (
        <i key={index} className={index < active ? "is-on" : ""} />
      ))}
    </span>
  );
}

function ResourceRow({ resource, onInspect, t }) {
  return (
    <button
      type="button"
      className="resource-row"
      onClick={() => onInspect(resource.label)}
      aria-label={t("telemetry.resource.inspect", {
        label: resource.label,
        value: resource.value,
      })}
    >
      <span className="resource-copy">
        <span className="resource-heading">
          <strong>{resource.label}</strong>
          <b>{resource.value}</b>
        </span>
        <small>{resource.meta}</small>
      </span>
      <span className="resource-visual">
        {resource.segments ? <SegmentBar active={resource.segments} /> : <SparklineCanvas points={resource.points} />}
        {resource.secondary ? <small className="resource-secondary">{resource.secondary}</small> : null}
      </span>
      <ChevronRightRegular className="telemetry-row-affordance" aria-hidden="true" />
    </button>
  );
}

function formatFeedTime(timestamp, language) {
  return formatTime(timestamp, language);
}

function getLocalizedPriorityCopy({ events, feedError, feedLoading, priorityState, t }) {
  if (feedError) {
    return {
      title: t("telemetry.priority.disconnected.title"),
      detail: t("telemetry.priority.disconnected.detail"),
      meta: priorityState.meta,
    };
  }
  if (feedLoading) {
    return {
      title: t("telemetry.priority.connecting.title"),
      detail: t("telemetry.priority.connecting.detail"),
      meta: events.length > 0
        ? t("telemetry.priority.connecting.cached", { count: events.length })
        : t("telemetry.priority.connecting.waiting"),
    };
  }
  if (priorityState.kind === "warning") {
    return {
      title: t("telemetry.priority.attention.title"),
      detail: priorityState.detail,
      meta: priorityState.meta,
    };
  }
  return {
    title: t("telemetry.priority.nominal.title"),
    detail: events[0]?.title ?? t("telemetry.priority.nominal.detail"),
    meta: events[0]?.detail || t("telemetry.priority.nominal.events", { count: events.length }),
  };
}

export function TelemetryRail({ compact = false, localEvents = [], onInspect, onNotification }) {
  const { language, t } = useLanguage();
  const { processes, resources } = useSystemSnapshot();
  const feed = useSystemFeed();
  const events = useMemo(
    () => mergeSystemFeedEvents(localEvents, feed.items),
    [feed.items, localEvents],
  );
  const [resourcesExpanded, setResourcesExpanded] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [feedOpen, setFeedOpen] = useState(false);
  const { activePanel, setActivePanel, systemToggleRef } = useDesktopTools();
  const railCollapsed = activePanel !== "telemetry";
  const visibleResources = resourcesExpanded ? resources : resources.slice(0, 2);
  const visibleEvents = events.slice(0, 5);
  const unreadCount = Math.min(99, events.filter((item) => item.unread).length);
  const priorityState = getTelemetryPriorityPresentation({
    events,
    feedError: feed.error,
    feedLoading: feed.loading,
  });
  const priorityCopy = getLocalizedPriorityCopy({
    events,
    feedError: feed.error,
    feedLoading: feed.loading,
    priorityState,
    t,
  });
  const railMode = getTelemetryRailMode({ compact, priorityKind: priorityState.kind });
  const compactSummary = getCompactTelemetrySummary(resources);
  const PriorityIcon = priorityState.kind === "warning"
    ? AlertRegular
    : priorityState.kind === "connecting"
      ? InfoRegular
      : CheckmarkCircleRegular;
  return (
    <aside
      id="desktop-system-panel"
      className={`telemetry-rail is-${railMode} ${railCollapsed ? "is-rail-collapsed" : ""}`}
      aria-label={t("telemetry.accessibility.label")}
      hidden={railCollapsed}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        setActivePanel(null);
        systemToggleRef.current?.focus();
      }}
    >
      <header className="telemetry-rail__chrome">
        <span className="telemetry-rail__chrome-label">
          <i aria-hidden="true" />
          <strong>{t("telemetry.title")}</strong>
        </span>
      </header>
      {railMode === "compact-nominal" ? (
        <button
          type="button"
          className="telemetry-compact-summary"
          onClick={() => onInspect(t("telemetry.target.systemHealth"))}
          aria-label={t("telemetry.compact.summary", {
            cpu: compactSummary.cpu,
            memory: compactSummary.memory,
          })}
        >
          <CheckmarkCircleRegular aria-hidden="true" />
          <span>
            <strong>{t("telemetry.priority.nominal.title")}</strong>
            <small>{t("telemetry.compact.metrics", {
              cpu: compactSummary.cpu,
              memory: compactSummary.memory,
            })}</small>
          </span>
          <ChevronRightRegular aria-hidden="true" />
        </button>
      ) : <>
        <HudPanel title={t("telemetry.section.priority")} className={`priority-panel ${priorityState.className}`}>
        <button type="button" className="telemetry-priority" onClick={() => onInspect(t("telemetry.target.systemHealth"))}>
          <PriorityIcon />
          <span>
            <strong>{priorityCopy.title}</strong>
            <small>{priorityCopy.detail}</small>
            <em>{priorityCopy.meta}</em>
          </span>
          <ChevronRightRegular className="telemetry-row-affordance" aria-hidden="true" />
        </button>
        </HudPanel>

        <HudPanel
        title={t("telemetry.section.resources")}
        className="resources-panel"
        action={resources.length > 2 ? (
          <button type="button" className="telemetry-inline-action" onClick={() => setResourcesExpanded((current) => !current)}>
            {resourcesExpanded
              ? t("telemetry.resources.showLess")
              : t("telemetry.resources.showMore", { count: resources.length - 2 })}
          </button>
        ) : null}
      >
        <div className="resource-list">
          {visibleResources.map((resource) => (
            <ResourceRow key={resource.id} resource={resource} onInspect={onInspect} t={t} />
          ))}
        </div>
        </HudPanel>
      </>}

      <HudPanel
        title={t("telemetry.section.activity")}
        className="activity-panel"
        collapsible
        open={activityOpen}
        onToggle={() => setActivityOpen((current) => !current)}
        action={<span className="telemetry-count">{processes.length}</span>}
      >
        <div className="process-title">{t("telemetry.activity.title")}</div>
        <div className="process-grid process-grid--header" aria-hidden="true">
          <span>{t("telemetry.activity.column.name")}</span><span>CPU</span><span>MEM</span><span>NET</span>
        </div>
        <div className="process-list">
          {processes.map((process) => (
            <button
              key={process.id}
              type="button"
              className="process-grid"
              onClick={() => onInspect(process.name)}
              aria-label={t("telemetry.process.inspect", {
                name: process.name,
                cpu: process.cpu,
                memory: process.memory,
                network: process.network,
              })}
            >
              <span className="process-name"><i aria-hidden="true" />{process.name}</span>
              <span>{process.cpu}</span><span>{process.memory}</span><span>{process.network}</span>
            </button>
          ))}
        </div>
      </HudPanel>

      <HudPanel
        title={t("telemetry.section.feed")}
        action={<span className="notification-count">{unreadCount}</span>}
        className="notifications-panel"
        collapsible
        open={feedOpen}
        onToggle={() => setFeedOpen((current) => !current)}
      >
        <div className="notification-list">
          {visibleEvents.length === 0 ? <p className="system-feed-empty">{t("telemetry.feed.empty")}</p> : null}
          {visibleEvents.map((notification) => {
            const Icon = notification.severity === "ok"
              ? CheckmarkCircleRegular
              : notification.severity === "info"
                ? InfoRegular
                : AlertRegular;
            return (
              <button key={notification.id} type="button" className="notification-row" onClick={() => onNotification(notification)}>
                <Icon />
                <span className="notification-copy">
                  <strong>{notification.title}</strong>
                  <small>{notification.detail}</small>
                </span>
                <time dateTime={notification.timestamp ?? undefined}>{formatFeedTime(notification.timestamp, language)}</time>
                <ChevronRightRegular className="telemetry-row-affordance" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </HudPanel>
      {feed.loading ? <p className="telemetry-loading" role="status">{t("telemetry.feed.connecting")}</p> : null}
    </aside>
  );
}
