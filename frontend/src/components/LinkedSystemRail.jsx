import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  usePlatformClock,
  usePlatformKind,
  useSystemFeed,
  useSystemSnapshot,
} from "../hooks/usePlatformData.js";
import { getAgentProviderLabel } from "../agent-provider-model.js";
import { canUseAgentChat } from "../agent-session-model.js";
import { useLanguage } from "../i18n/language-system.js";
import { formatTime } from "../i18n/locale-format.js";
import {
  createLinkedSystemRailState,
  getLinkedAgentStatusPresentation,
  getLinkedSystemRailPresentation,
  getNewLinkedSystemRailAttention,
  setLinkedSystemRailExpanded,
  syncLinkedSystemRailState,
} from "../linked-system-rail-model.js";

function Meter({ segments = 0 }) {
  const active = Math.max(0, Math.min(12, Math.round((segments / 18) * 12)));
  return (
    <span className="linked-system-meter" aria-hidden="true">
      {Array.from({ length: 12 }, (_, index) => <i key={index} className={index < active ? "is-on" : ""} />)}
    </span>
  );
}

const STATUS_KEYS = Object.freeze({
  ACTIVE: "linkedSystem.state.active",
  ATTENTION: "linkedSystem.state.attention",
  "CHAT ONLY": "linkedSystem.state.chatOnly",
  "CHAT UNAVAILABLE": "linkedSystem.state.chatUnavailable",
  CONNECTED: "linkedSystem.state.connected",
  DEGRADED: "linkedSystem.state.degraded",
  OFFLINE: "linkedSystem.state.offline",
  READY: "linkedSystem.state.ready",
  RETRY: "linkedSystem.state.retry",
  "STATUS ONLY": "linkedSystem.state.statusOnly",
});

function localizeStatus(value, t) {
  const key = STATUS_KEYS[String(value ?? "").trim().toUpperCase()];
  return key ? t(key) : value;
}

export function LinkedSystemRail({
  agentState,
  expanded: controlledExpanded,
  onExpandedChange,
  onInspect,
  onNotification,
}) {
  const { language, t } = useLanguage();
  const clock = usePlatformClock();
  const platformKind = usePlatformKind();
  const { processes, resources } = useSystemSnapshot();
  const feed = useSystemFeed();
  const agentChatAvailable = canUseAgentChat(agentState);
  const agentStatus = getLinkedAgentStatusPresentation(agentState, agentChatAvailable);
  const agentLabel = localizeStatus(agentStatus.agentLabel, t);
  const providerLabel = getAgentProviderLabel(agentState);
  const contentId = useId();
  const presentation = useMemo(
    () => getLinkedSystemRailPresentation({ feed, agentState }),
    [agentState, feed],
  );
  const [railState, setRailState] = useState(() => createLinkedSystemRailState(presentation));
  const observedAttentionRef = useRef(railState.observedAttentionKeys);
  const expanded = typeof controlledExpanded === "boolean"
    ? controlledExpanded
    : railState.expanded;

  useEffect(() => {
    const newAttention = getNewLinkedSystemRailAttention(
      observedAttentionRef.current,
      presentation.attentionKeys,
    );
    observedAttentionRef.current = presentation.attentionKeys;
    setRailState((current) => syncLinkedSystemRailState(current, presentation));
    if (newAttention.length > 0 && !expanded) {
      onExpandedChange?.(true, {
        reason: "new-attention",
        attentionCount: presentation.attentionCount,
        attentionLevel: presentation.level,
      });
    }
  }, [
    expanded,
    onExpandedChange,
    presentation.attentionCount,
    presentation.attentionKeys,
    presentation.attentionSignature,
    presentation.level,
  ]);

  const toggleExpanded = () => {
    const nextExpanded = !expanded;
    setRailState((current) => setLinkedSystemRailExpanded(current, nextExpanded));
    onExpandedChange?.(nextExpanded, {
      reason: "user",
      attentionCount: presentation.attentionCount,
      attentionLevel: presentation.level,
    });
  };

  const railClassName = [
    "linked-system-rail",
    expanded ? "is-expanded" : "is-collapsed",
    `has-${presentation.level}-status`,
  ].join(" ");
  const controlledSectionIds = ["summary", "host", "performance", "connections", "notifications", "tasks"]
    .map((section) => `${contentId}-${section}`)
    .join(" ");
  const notificationItem = presentation.attentionCount > 0
    ? presentation.priorityItem
    : feed.items[0] ?? null;
  const localizedPriorityTitle = presentation.priorityTitle ||
    t(presentation.priorityTitleKey);
  const localizedPriorityDetail = presentation.priorityDetail ||
    (presentation.priorityDetailKey
      ? t(presentation.priorityDetailKey, presentation.priorityDetailValues)
      : "");
  const notificationTitle = presentation.attentionCount > 0
    ? localizedPriorityTitle
    : notificationItem?.title ?? t("linkedSystem.notification.none");

  return (
    <aside
      className={railClassName}
      aria-label={t("linkedSystem.accessibility.rail")}
      data-attention-count={presentation.attentionCount}
      data-attention-level={presentation.level}
      data-rail-state={expanded ? "expanded" : "collapsed"}
    >
      <header>
        <span className="linked-system-rail-heading">
          <strong>{t("linkedSystem.title")}</strong>
          <small aria-live="polite">
            {presentation.attentionCount
              ? t("linkedSystem.attention.count", { count: presentation.attentionCount })
              : presentation.level === "syncing"
                ? t("linkedSystem.state.syncing")
                : t("linkedSystem.state.nominal")}
          </small>
        </span>
        <i aria-hidden="true" />
        <button
          type="button"
          className="linked-system-rail-toggle"
          aria-controls={controlledSectionIds}
          aria-expanded={expanded}
          aria-label={t(expanded
            ? "linkedSystem.action.collapseAria"
            : "linkedSystem.action.expandAria")}
          onClick={toggleExpanded}
        >
          {expanded ? t("linkedSystem.action.collapse") : t("linkedSystem.action.expand")}
        </button>
      </header>

      <section id={`${contentId}-summary`} className="linked-system-rail-summary" hidden={expanded}>
        <h2>{t("linkedSystem.section.status")}</h2>
        <dl>
          <div><dt>{t("linkedSystem.field.host")}</dt><dd>{platformKind === "windows" ? "WINDOWS" : t("linkedSystem.state.preview")}</dd></div>
          <div><dt>AGENT</dt><dd className={agentStatus.agentLabel === "OFFLINE" ? "is-muted" : "is-signal"}>{agentLabel}</dd></div>
          <div>
            <dt>{t("linkedSystem.field.attention")}</dt>
            <dd className={presentation.attentionCount ? "is-signal" : undefined}>
              {presentation.attentionCount}
            </dd>
          </div>
        </dl>
        {presentation.priorityItem ? (
          <button
            type="button"
            className="linked-system-notification is-compact"
            onClick={() => onNotification?.(presentation.priorityItem)}
          >
            <span>{localizedPriorityTitle}</span>
            <small>{localizedPriorityDetail || t("linkedSystem.attention.needs", {
              count: presentation.attentionCount,
            })}</small>
          </button>
        ) : (
          <p className="linked-system-rail-priority" role="status">
            <strong>{localizedPriorityTitle}</strong>
            {localizedPriorityDetail ? <small>{localizedPriorityDetail}</small> : null}
          </p>
        )}
      </section>

      <section id={`${contentId}-host`} hidden={!expanded}>
        <h2>{t("linkedSystem.section.host")}</h2>
        <dl>
          <div><dt>{t("linkedSystem.field.mode")}</dt><dd>{platformKind === "windows" ? "WINDOWS HOST" : t("linkedSystem.state.localPreview")}</dd></div>
          <div><dt>{t("linkedSystem.field.frame")}</dt><dd>{t("linkedSystem.state.ownProcess")}</dd></div>
          <div><dt>{t("linkedSystem.field.time")}</dt><dd>{formatTime(clock.dateTime, language)}</dd></div>
        </dl>
      </section>

      <section id={`${contentId}-performance`} hidden={!expanded}>
        <h2>{t("linkedSystem.section.performance")}</h2>
        <div className="linked-system-resources">
          {resources.slice(0, 5).map((resource) => (
            <button key={resource.id} type="button" onClick={() => onInspect?.(resource.label)}>
              <span>{resource.label}</span><strong>{resource.value}</strong><Meter segments={resource.segments} />
            </button>
          ))}
        </div>
      </section>

      <section id={`${contentId}-connections`} hidden={!expanded}>
        <h2>{t("linkedSystem.section.connections")}</h2>
        <dl>
          <div><dt>AGENT · {providerLabel}</dt><dd className={agentStatus.agentLabel === "OFFLINE" ? "is-muted" : "is-signal"}>{agentLabel}</dd></div>
          <div><dt>CHAT</dt><dd>{localizeStatus(agentStatus.commandBusLabel, t)}</dd></div>
          <div><dt>{t("linkedSystem.field.dataAccess")}</dt><dd>{localizeStatus(agentStatus.dataAccessLabel, t)}</dd></div>
        </dl>
      </section>

      <section id={`${contentId}-notifications`} hidden={!expanded}>
        <h2>{t("linkedSystem.section.notifications")}</h2>
        {notificationItem ? (
          <button
            type="button"
            className="linked-system-notification"
            onClick={() => onNotification?.(notificationItem)}
          >
            <span>{notificationTitle}</span>
            <small>
              {presentation.attentionCount
                ? localizedPriorityDetail || t("linkedSystem.attention.needs", {
                  count: presentation.attentionCount,
                })
                : t("linkedSystem.notification.unread", { count: feed.unreadCount })}
            </small>
          </button>
        ) : (
          <p className="linked-system-rail-priority" role="status">
            <strong>{notificationTitle}</strong>
            <small>{localizedPriorityDetail || t("linkedSystem.notification.unread", {
              count: feed.unreadCount,
            })}</small>
          </p>
        )}
      </section>

      <section id={`${contentId}-tasks`} hidden={!expanded}>
        <h2>{t("linkedSystem.section.tasks")}</h2>
        <dl>
          <div><dt>{t("linkedSystem.field.activeGroups")}</dt><dd>{processes.length}</dd></div>
          <div><dt>{t("linkedSystem.field.agentRun")}</dt><dd>{agentState?.status === "running" ? "1" : "0"}</dd></div>
        </dl>
      </section>
    </aside>
  );
}
