import {
  AddRegular,
  ArrowRightRegular,
  BotRegular,
  DismissRegular,
  DocumentRegular,
  InfoRegular,
  LinkRegular,
  MaximizeRegular,
  PersonRegular,
  PulseRegular,
  SquareMultipleRegular,
  SubtractRegular,
} from "@fluentui/react-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { getLatestAgentRelationMessage } from "../agent-context-model.js";
import { getAgentProviderLabel } from "../agent-provider-model.js";
import {
  AGENT_CAPABILITIES,
  AGENT_HISTORY_UNAVAILABLE,
  agentSupportsCapability,
  canUseAgentChat,
  getAgentTranscriptAnnouncement,
} from "../agent-session-model.js";
import { useLanguage } from "../i18n/language-system.js";
import { formatTime } from "../i18n/locale-format.js";
import { SystemNotice } from "./SystemNotice.jsx";

const STATUS_COPY_KEYS = Object.freeze({
  unavailable: "agent.status.offline",
  starting: "agent.status.connecting",
  ready: "agent.status.ready",
  running: "agent.status.responding",
  error: "agent.status.needsAttention",
});

const ERROR_COPY_KEYS = Object.freeze({
  AUTH_REQUIRED: {
    status: "agent.error.authRequired.status",
    heading: "agent.error.authRequired.heading",
    guidance: "agent.error.authRequired.guidance",
  },
  MODEL_REQUIRED: {
    status: "agent.error.modelRequired.status",
    heading: "agent.error.modelRequired.heading",
    guidance: "agent.error.modelRequired.guidance",
  },
  NETWORK_UNAVAILABLE: {
    status: "agent.error.networkUnavailable.status",
    heading: "agent.error.networkUnavailable.heading",
    guidance: "agent.error.networkUnavailable.guidance",
  },
  RATE_LIMITED: {
    status: "agent.error.rateLimited.status",
    heading: "agent.error.rateLimited.heading",
    guidance: "agent.error.rateLimited.guidance",
  },
  QUOTA_EXCEEDED: {
    status: "agent.error.quotaExceeded.status",
    heading: "agent.error.quotaExceeded.heading",
    guidance: "agent.error.quotaExceeded.guidance",
  },
});

const LINKED_FLOW_COPY_KEYS = Object.freeze({
  staged: {
    label: "agent.context.phase.staged.label",
    detail: "agent.context.phase.staged.detail",
  },
  submitting: {
    label: "agent.context.phase.submitting.label",
    detail: "agent.context.phase.submitting.detail",
  },
  running: {
    label: "agent.context.phase.running.label",
    detail: "agent.context.phase.running.detail",
  },
  complete: {
    label: "agent.context.phase.complete.label",
    detail: "agent.context.phase.complete.detail",
  },
  error: {
    label: "agent.context.phase.error.label",
    detail: "agent.context.phase.error.detail",
  },
  aborted: {
    label: "agent.context.phase.aborted.label",
    detail: "agent.context.phase.aborted.detail",
  },
});

function errorPresentation(error, t) {
  if (!error) return null;
  const keys = ERROR_COPY_KEYS[error.code];
  if (keys) {
    return {
      status: t(keys.status),
      heading: t(keys.heading),
      guidance: t(keys.guidance),
    };
  }
  return {
    status: t("agent.status.needsAttention"),
    heading: t(error.retryable
      ? "agent.error.generic.retryable.heading"
      : "agent.error.generic.attention.heading"),
    guidance: t(error.retryable
      ? "agent.error.generic.retryable.guidance"
      : "agent.error.generic.attention.guidance"),
  };
}

function formatMessageTime(value, language, t) {
  const date = new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) return t("agent.message.time.now");
  return formatTime(date, language);
}

function messageLabel(role, providerLabel, t) {
  if (role === "user") return t("agent.message.author.you");
  if (role === "assistant") {
    return providerLabel === "NO PROVIDER"
      ? t("agent.message.author.agent")
      : t("agent.message.author.provider", { provider: providerLabel });
  }
  return t("agent.message.author.system");
}

function messageDisplayText(message) {
  const text = String(message?.text ?? "");
  if (message?.role !== "user" || !text.startsWith("[JARVIS FILE CONTEXT — METADATA ONLY]")) {
    return text;
  }
  const marker = "[USER DIRECTIVE]";
  const markerIndex = text.indexOf(marker);
  return markerIndex < 0 ? text : text.slice(markerIndex + marker.length).trim();
}

function MessageAvatar({ role }) {
  if (role === "user") {
    return <PersonRegular />;
  }
  if (role === "assistant") {
    return <BotRegular />;
  }
  return <InfoRegular />;
}

function LinkedContextEvent({
  context,
  phase,
  selectionItems,
  chatAvailable = true,
  onLinkSelection,
  onClear,
  t,
}) {
  const items = context?.items ?? [];
  if (items.length === 0) {
    if (!selectionItems?.length) return null;
    return (
      <section
        className="agent-link-cue"
        aria-label={t("agent.context.selection.availableAria")}
      >
        <span className="agent-flow-node" aria-hidden="true"><LinkRegular /></span>
        <span>
          <small>{t("agent.context.selection.label")}</small>
          <strong>
            {selectionItems.length === 1
              ? selectionItems[0].name
              : t("agent.context.selection.itemsSelected", { count: selectionItems.length })}
          </strong>
          <p>{t("agent.context.selection.metadataExplanation")}</p>
        </span>
        <button
          type="button"
          onClick={() => onLinkSelection?.(selectionItems)}
          disabled={!chatAvailable}
          title={chatAvailable
            ? undefined
            : t("agent.context.selection.chatUnsupportedTitle")}
        >
          {chatAvailable
            ? t("agent.context.selection.addToMessage")
            : t("agent.status.chatUnavailable")}
        </button>
      </section>
    );
  }

  const copyKeys = LINKED_FLOW_COPY_KEYS[phase] ?? LINKED_FLOW_COPY_KEYS.staged;
  const copy = {
    label: t(copyKeys.label),
    detail: t(copyKeys.detail),
  };
  return (
    <section
      className={`agent-linked-context is-${phase}`}
      aria-label={t("agent.context.linked.aria", { status: copy.label })}
    >
      <span className="agent-flow-node" aria-hidden="true"><DocumentRegular /></span>
      <span className="agent-linked-context__identity">
        <small>{t("agent.context.linked.metadataLabel")}</small>
        <strong>
          {items.length === 1
            ? items[0].name
            : t("agent.context.linked.items", { count: items.length })}
        </strong>
        <code>
          {items.length === 1
            ? items[0].path
            : t("agent.context.linked.snapshots", { count: items.length })}
        </code>
      </span>
      <span className="agent-linked-context__state" role="status">
        <strong>{copy.label}</strong>
        <small>{copy.detail}</small>
      </span>
      <button
        type="button"
        onClick={onClear}
        disabled={["submitting", "running"].includes(phase)}
      >
        {t("agent.context.action.clear")}
      </button>
    </section>
  );
}

export function AgentConversationWindow({
  open,
  active,
  maximized,
  canMaximize = true,
  state,
  messages,
  historyError,
  sessionTransitioning,
  draft,
  linkedContext = null,
  linkedFlowPhase = "empty",
  explorerSelection = [],
  notice = null,
  onDismissNotice,
  onDraftChange,
  onSend,
  onAbort,
  onNewSession,
  onLinkExplorerSelection,
  onClearLinkedContext,
  onReuseLinkedResult,
  onClose,
  onMinimize,
  onToggleMaximize,
}) {
  const { language, t } = useLanguage();
  const transcriptRef = useRef(null);
  const composerRef = useRef(null);
  const alertRef = useRef(null);
  const messageStatusesRef = useRef(new Map());
  const [transcriptAnnouncement, setTranscriptAnnouncement] = useState(null);
  const status = state?.status ?? "unavailable";
  const errorView = useMemo(
    () => errorPresentation(state?.error, t),
    [state?.error, t],
  );
  const historyErrorText = historyError === AGENT_HISTORY_UNAVAILABLE
    ? t("agent.history.temporarilyUnavailable")
    : historyError;
  const visualStatus = errorView ? "error" : status;
  const providerLabel = getAgentProviderLabel(state);
  const statusCopy = sessionTransitioning
    ? t("agent.status.switchingSession")
    : errorView?.status
    ?? (status === "ready" && state?.connected
      ? t("agent.status.connected")
      : t(STATUS_COPY_KEYS[status] ?? STATUS_COPY_KEYS.ready));
  const isRunning = status === "running" || status === "starting";
  const supportsChat = canUseAgentChat(state);
  const supportsAbort = agentSupportsCapability(state, AGENT_CAPABILITIES.abort);
  const supportsNewSession = agentSupportsCapability(
    state,
    AGENT_CAPABILITIES.newSession,
  );
  const channelReady = Boolean(state?.available)
    && supportsChat
    && status === "ready"
    && !sessionTransitioning;
  const canSend = channelReady
    && draft.trim().length > 0;
  const connectionCopy = useMemo(() => {
    const provider = state?.available
      ? providerLabel
      : t("agent.connection.noProvider");
    const model = state?.model || t("agent.connection.modelPending");
    const connection = !state?.available
      ? t("agent.status.offline")
      : errorView?.status
        ?? (state?.connected
          ? t("agent.status.connected")
          : t("agent.connection.connectsOnSend"));
    return `${provider} · ${model} · ${connection}`;
  }, [errorView, providerLabel, state?.available, state?.connected, state?.model, t]);

  const emptyCopy = useMemo(() => {
    if (!state?.available) {
      return {
        eyebrow: t("agent.empty.unavailable.eyebrow"),
        heading: t("agent.empty.unavailable.heading"),
        detail: state?.error?.message ?? t("agent.empty.unavailable.detail"),
      };
    }
    if (errorView) {
      return {
        eyebrow: errorView.status,
        heading: errorView.heading,
        detail: errorView.guidance,
      };
    }
    if (!supportsChat) {
      return {
        eyebrow: t("agent.status.chatUnavailable"),
        heading: t("agent.empty.statusOnly.heading"),
        detail: t("agent.empty.statusOnly.detail"),
      };
    }
    if (!state?.connected) {
      return {
        eyebrow: t("agent.empty.readyToConnect.eyebrow"),
        heading: t("agent.empty.readyToConnect.heading"),
        detail: t("agent.empty.readyToConnect.detail"),
      };
    }
    return {
      eyebrow: t("agent.status.connected"),
      heading: t("agent.empty.connected.heading"),
      detail: t("agent.empty.connected.detail"),
    };
  }, [errorView, state?.available, state?.connected, state?.error?.message, supportsChat, t]);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    transcript.scrollTop = transcript.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!state?.error && !historyErrorText) return undefined;
    const frame = window.requestAnimationFrame(() => {
      alertRef.current?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [historyErrorText, state?.error]);

  const linkedContextKey = linkedContext?.relationId
    ?? (linkedContext?.items ?? []).map((item) => item.id).join("|");
  const linkedRelationMessage = useMemo(
    () => getLatestAgentRelationMessage(messages, linkedContext),
    [linkedContext, messages],
  );
  const linkedRelationMessageId = linkedRelationMessage?.id ?? null;
  const linkedDirectiveArmed = Boolean(linkedContext?.items?.length)
    && linkedFlowPhase === "staged";
  const hasLinkedContextControl = Boolean(linkedContext?.items?.length)
    || Boolean(explorerSelection?.length);
  useEffect(() => {
    if (!linkedContextKey) return;
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }, [linkedContextKey]);

  useEffect(() => {
    const { nextStatuses, announcement } = getAgentTranscriptAnnouncement(
      messageStatusesRef.current,
      messages,
    );
    messageStatusesRef.current = nextStatuses;
    if (announcement) setTranscriptAnnouncement(announcement.id);
  }, [messages]);

  if (!open) return null;

  const submit = (event) => {
    event.preventDefault();
    if (canSend) void onSend().catch(() => {});
  };

  return (
    <div className="agent-layer">
      <section
        className="agent-workbench"
        role="dialog"
        aria-modal="false"
        aria-label={t("agent.accessibility.window")}
        aria-busy={isRunning || sessionTransitioning}
        data-window-active={active ? "true" : "false"}
      >
        <header
          className="agent-titlebar"
          data-window-drag-handle
          aria-keyshortcuts={canMaximize ? "Alt+F4 Alt+F9 Alt+F10" : "Alt+F4 Alt+F9"}
        >
          <span className={`agent-titlebar__mark is-${visualStatus}`}><PulseRegular /></span>
          <span className="agent-titlebar__identity">
            <strong>JARVIS Agent</strong>
            <small className="agent-connection-summary">{connectionCopy}</small>
          </span>
          <span className={`agent-runtime-state is-${visualStatus}`} role="status">
            <i />{statusCopy}
          </span>
          <button
            type="button"
            data-no-window-drag
            onClick={() => { void onNewSession().catch(() => {}); }}
            disabled={
              isRunning
              || sessionTransitioning
              || !state?.available
              || !supportsNewSession
            }
            aria-label={t("agent.action.newSession.aria")}
            title={supportsNewSession
              ? t("agent.action.newSession.title")
              : t("agent.action.newSession.unsupportedTitle")}
          >
            <AddRegular />
          </button>
          <button
            type="button"
            data-no-window-drag
            onClick={onMinimize}
            aria-label={t("agent.action.minimize.aria")}
          >
            <SubtractRegular />
          </button>
          <button
            type="button"
            data-no-window-drag
            onClick={onToggleMaximize}
            disabled={!canMaximize}
            aria-label={canMaximize
              ? maximized
                ? t("agent.action.restore.aria")
                : t("agent.action.maximize.aria")
              : t("agent.action.layoutControlled.aria")}
            title={canMaximize
              ? maximized
                ? t("agent.action.restore.title")
                : t("agent.action.maximize.title")
              : t("agent.action.layoutControlled.title")}
          >
            {maximized ? <SquareMultipleRegular /> : <MaximizeRegular />}
          </button>
          <button
            type="button"
            data-no-window-drag
            onClick={onClose}
            aria-label={t("agent.action.close.aria")}
          >
            <DismissRegular />
          </button>
        </header>

        <div
          ref={transcriptRef}
          className="agent-transcript"
          role="log"
          aria-live="off"
          data-linked-scroll-viewport="agent"
          aria-label={t("agent.accessibility.transcript")}
        >
          <SystemNotice notice={notice} onDismiss={onDismissNotice} placement="inline" />
          {state?.error || historyErrorText ? (
            <div ref={alertRef} className="agent-alert-region has-alert" role="alert">
              {state?.error ? (
                <>
                  <strong>{state.error.code}</strong>
                  <span>{state.error.message || t("agent.error.requestFailed")}</span>
                  <small>{errorView?.guidance}</small>
                </>
              ) : (
                <>
                  <strong>{t("agent.history.unavailable")}</strong>
                  <span>{historyErrorText}</span>
                  <small>{t("agent.history.currentChatAvailable")}</small>
                </>
              )}
            </div>
          ) : null}
          {messages.length ? messages.map((message, index) => {
            const linkedRelation = message.id === linkedRelationMessageId;
            const reusableResult = linkedRelation
              && message.role === "assistant"
              && linkedFlowPhase === "complete";
            return (
              <article
                key={message.id ?? `${message.role}-${index}`}
                className={`agent-message is-${message.role ?? "system"}${message.status === "streaming" ? " is-streaming" : ""}${linkedRelation ? " is-linked-relation" : ""}`}
              >
                {linkedRelation ? (
                  <span
                    className="agent-message-link-port"
                    data-agent-relation-target={linkedContext?.relationId}
                    aria-hidden="true"
                  />
                ) : null}
                <span className="agent-message__avatar" aria-hidden="true">
                  <MessageAvatar role={message.role} />
                </span>
                <div className="agent-message__group">
                  <div className="agent-message__bubble">
                    <p>{messageDisplayText(message)}</p>
                  </div>
                  <footer className="agent-message__meta">
                    <span>{messageLabel(message.role, providerLabel, t)}</span>
                    <time>
                      {formatMessageTime(
                        message.createdAt ?? message.timestamp,
                        language,
                        t,
                      )}
                    </time>
                    {linkedRelation ? (
                      <code>{t("agent.message.state.linkedFile")}</code>
                    ) : message.status === "streaming" ? (
                      <code>{t("agent.status.responding")}</code>
                    ) : message.status === "error" ? (
                      <code>{t("agent.message.state.error")}</code>
                    ) : null}
                    {reusableResult ? (
                      <button
                        type="button"
                        className="agent-message-reuse"
                        onClick={onReuseLinkedResult}
                      >
                        {t("agent.message.action.useInMessage")}
                      </button>
                    ) : null}
                  </footer>
                </div>
              </article>
            );
          }) : (
            <div className={`agent-empty-state${channelReady && !errorView ? " is-ready" : ""}`}>
              <span className="agent-empty-state__copy">
                <BotRegular className="agent-empty-state__icon" aria-hidden="true" />
                <strong>{channelReady && !errorView && linkedContext?.items?.length
                  ? t("agent.start.linked.heading")
                  : emptyCopy.heading}</strong>
                <p>{channelReady && !errorView && linkedContext?.items?.length
                  ? t("agent.start.linked.detail")
                  : emptyCopy.detail}</p>
              </span>
              {channelReady && !errorView ? (
                <div className="agent-starters" aria-label={t("agent.start.aria")}>
                  {["plan", "questions"].map((intent) => (
                    <button
                      key={intent}
                      type="button"
                      onClick={() => {
                        onDraftChange(t(`agent.start.${linkedContext?.items?.length ? "linked" : "general"}.${intent}.prompt`));
                        composerRef.current?.focus();
                      }}
                    >
                      <span>
                        <strong>{t(`agent.start.${intent}.label`)}</strong>
                        <small>{t(`agent.start.${intent}.detail`)}</small>
                      </span>
                      <ArrowRightRegular aria-hidden="true" />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {transcriptAnnouncement ? (
            <span key={transcriptAnnouncement}>
              {t("agent.announcement.responseComplete")}
            </span>
          ) : null}
        </div>

        <form className="agent-composer" onSubmit={submit}>
          {hasLinkedContextControl ? (
            <div className="agent-composer__attachments">
              <LinkedContextEvent
                context={linkedContext}
                phase={linkedFlowPhase}
                selectionItems={explorerSelection}
                chatAvailable={supportsChat}
                onLinkSelection={onLinkExplorerSelection}
                onClear={onClearLinkedContext}
                t={t}
              />
            </div>
          ) : null}
          <label className="sr-only" htmlFor="jarvis-agent-prompt">
            {linkedDirectiveArmed
              ? t("agent.composer.accessibility.linkedMessage")
              : t("agent.composer.accessibility.message")}
          </label>
          <div className="agent-composer__input-row">
            <textarea
              ref={composerRef}
              id="jarvis-agent-prompt"
              value={draft}
              maxLength={16000}
              rows={1}
              disabled={!channelReady}
              placeholder={isRunning
                ? t("agent.composer.placeholder.responding")
                : channelReady
                  ? errorView?.guidance ?? t("agent.composer.placeholder.ready")
                  : state?.available && !supportsChat
                    ? t("agent.composer.placeholder.chatUnsupported")
                    : state?.available
                      ? t("agent.composer.placeholder.waiting")
                      : t("agent.composer.placeholder.connectProvider")}
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                event.preventDefault();
                if (canSend) void onSend().catch(() => {});
              }}
            />
            {isRunning && supportsAbort ? (
              <button
                type="button"
                className="is-stop"
                onClick={() => { void onAbort().catch(() => {}); }}
                aria-label={t("agent.composer.action.stop.aria")}
              >
                <DismissRegular /><span>{t("agent.composer.action.stop.label")}</span>
              </button>
            ) : isRunning ? (
              <button
                type="button"
                className="is-stop"
                disabled
                aria-label={t("agent.composer.action.stopUnsupported.aria")}
                title={t("agent.composer.action.stopUnsupported.title")}
              >
                <DismissRegular />
                <span>{t("agent.composer.action.stopUnsupported.label")}</span>
              </button>
            ) : (
              <button
                type="submit"
                className="is-send"
                disabled={!canSend}
                aria-label={t("agent.composer.action.send.aria")}
              >
                <ArrowRightRegular /><span>{t("agent.composer.action.send.label")}</span>
              </button>
            )}
          </div>
          <footer className="agent-footer">
            <small title={connectionCopy}>{connectionCopy}</small>
            <span className="agent-footer__status">
              {draft.length >= 12000 ? <code>{draft.length} / 16,000</code> : null}
              <code>
                {supportsChat
                  ? t("agent.connection.chatOnly")
                  : t("agent.connection.statusOnly")}
              </code>
            </span>
          </footer>
          <div className="agent-composer__hint">{t("agent.start.keyboardHint")}</div>
        </form>
      </section>
    </div>
  );
}
