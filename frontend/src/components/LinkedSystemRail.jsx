import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  usePlatformClock,
  usePlatformKind,
  useSystemFeed,
  useSystemSnapshot,
} from "../hooks/usePlatformData.js";
import { getAgentProviderLabel } from "../agent-provider-model.js";
import { canUseAgentChat } from "../agent-session-model.js";
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

export function LinkedSystemRail({
  agentState,
  expanded: controlledExpanded,
  onExpandedChange,
  onInspect,
  onNotification,
}) {
  const clock = usePlatformClock();
  const platformKind = usePlatformKind();
  const { processes, resources } = useSystemSnapshot();
  const feed = useSystemFeed();
  const agentChatAvailable = canUseAgentChat(agentState);
  const agentStatus = getLinkedAgentStatusPresentation(agentState, agentChatAvailable);
  const agentLabel = agentStatus.agentLabel;
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
  const notificationTitle = presentation.attentionCount > 0
    ? presentation.priorityTitle
    : notificationItem?.title ?? "NO NEW ALERTS";

  return (
    <aside
      className={railClassName}
      aria-label="Linked workspace system status"
      data-attention-count={presentation.attentionCount}
      data-attention-level={presentation.level}
      data-rail-state={expanded ? "expanded" : "collapsed"}
    >
      <header>
        <span className="linked-system-rail-heading">
          <strong>SYSTEM</strong>
          <small aria-live="polite">
            {presentation.attentionCount
              ? `${presentation.attentionCount} ATTENTION`
              : presentation.level === "syncing" ? "SYNCING" : "NOMINAL"}
          </small>
        </span>
        <i aria-hidden="true" />
        <button
          type="button"
          className="linked-system-rail-toggle"
          aria-controls={controlledSectionIds}
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} system status rail`}
          onClick={toggleExpanded}
        >
          {expanded ? "COLLAPSE" : "EXPAND"}
        </button>
      </header>

      <section id={`${contentId}-summary`} className="linked-system-rail-summary" hidden={expanded}>
        <h2>STATUS</h2>
        <dl>
          <div><dt>HOST</dt><dd>{platformKind === "windows" ? "WINDOWS" : "PREVIEW"}</dd></div>
          <div><dt>AGENT</dt><dd className={agentLabel === "OFFLINE" ? "is-muted" : "is-signal"}>{agentLabel}</dd></div>
          <div>
            <dt>ATTENTION</dt>
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
            <span>{presentation.priorityTitle}</span>
            <small>{presentation.priorityDetail || `${presentation.attentionCount} NEED ATTENTION`}</small>
          </button>
        ) : (
          <p className="linked-system-rail-priority" role="status">
            <strong>{presentation.priorityTitle}</strong>
            {presentation.priorityDetail ? <small>{presentation.priorityDetail}</small> : null}
          </p>
        )}
      </section>

      <section id={`${contentId}-host`} hidden={!expanded}>
        <h2>HOST</h2>
        <dl>
          <div><dt>MODE</dt><dd>{platformKind === "windows" ? "WINDOWS HOST" : "LOCAL PREVIEW"}</dd></div>
          <div><dt>FRAME</dt><dd>OWN PROCESS</dd></div>
          <div><dt>TIME</dt><dd>{clock.time}</dd></div>
        </dl>
      </section>

      <section id={`${contentId}-performance`} hidden={!expanded}>
        <h2>PERFORMANCE</h2>
        <div className="linked-system-resources">
          {resources.slice(0, 5).map((resource) => (
            <button key={resource.id} type="button" onClick={() => onInspect?.(resource.label)}>
              <span>{resource.label}</span><strong>{resource.value}</strong><Meter segments={resource.segments} />
            </button>
          ))}
        </div>
      </section>

      <section id={`${contentId}-connections`} hidden={!expanded}>
        <h2>CONNECTIONS</h2>
        <dl>
          <div><dt>AGENT · {providerLabel}</dt><dd className={agentLabel === "OFFLINE" ? "is-muted" : "is-signal"}>{agentLabel}</dd></div>
          <div><dt>COMMAND BUS</dt><dd>{agentStatus.commandBusLabel}</dd></div>
          <div><dt>DATA ACCESS</dt><dd>{agentStatus.dataAccessLabel}</dd></div>
        </dl>
      </section>

      <section id={`${contentId}-notifications`} hidden={!expanded}>
        <h2>NOTIFICATIONS</h2>
        {notificationItem ? (
          <button
            type="button"
            className="linked-system-notification"
            onClick={() => onNotification?.(notificationItem)}
          >
            <span>{notificationTitle}</span>
            <small>
              {presentation.attentionCount
                ? presentation.priorityDetail || `${presentation.attentionCount} NEED ATTENTION`
                : `${feed.unreadCount} UNREAD`}
            </small>
          </button>
        ) : (
          <p className="linked-system-rail-priority" role="status">
            <strong>{notificationTitle}</strong>
            <small>{presentation.priorityDetail || `${feed.unreadCount} UNREAD`}</small>
          </p>
        )}
      </section>

      <section id={`${contentId}-tasks`} hidden={!expanded}>
        <h2>TASKS</h2>
        <dl>
          <div><dt>ACTIVE GROUPS</dt><dd>{processes.length}</dd></div>
          <div><dt>AGENT RUN</dt><dd>{agentState?.status === "running" ? "1" : "0"}</dd></div>
        </dl>
      </section>
    </aside>
  );
}
