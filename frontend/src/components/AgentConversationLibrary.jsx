import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../i18n/language-system.js";
import "./agent-conversation-library.css";

export function AgentConversationLibrary({ library, busy }) {
  const { t } = useLanguage();
  const detailsRef = useRef(null);
  const [title, setTitle] = useState(library?.current.title ?? "");
  useEffect(() => {
    setTitle(library?.current.title ?? "");
    if (detailsRef.current) detailsRef.current.open = false;
  }, [library?.current.id, library?.current.title]);
  if (!library?.available) return null;
  const retry = library.error === "read"
    ? () => library.refresh()
    : library.error === "restore" && library.failedRestoreId
      ? () => library.restore(library.failedRestoreId)
      : library.error === "save"
        ? () => library.save({ force: true })
        : null;
  const errorKey = library.error === "restore" ? "agent.library.restoreError"
    : library.error === "read" ? "agent.library.readError"
      : library.error === "conflict" ? "agent.library.conflictError" : "agent.library.error";
  return <details ref={detailsRef} className="agent-conversation-library" data-no-window-drag>
    <summary>{t("agent.library.title")} · {library.entries.length}
      {library.error ? <small role="status">{t("agent.library.needsAttention")}</small>
        : library.status === "saved" || library.status === "pending"
          ? <small role="status">{t(`agent.library.${library.status}`)}</small> : null}
    </summary>
    <div className="agent-conversation-library__panel">
    {library.error ? <p role="alert">{t(errorKey)}
      {retry ? <button type="button" disabled={busy} onClick={() => void retry().catch(() => {})}>{t("knowledge.retry")}</button> : null}
      {library.messages.length && ["save", "conflict"].includes(library.error)
        ? <button type="button" disabled={busy} onClick={() => void library.saveCopy().catch(() => {})}>{t("agent.library.saveCopy")}</button> : null}</p> : null}
    {library.listStatus === "loading" ? <p role="status">{t("agent.library.loading")}</p> : null}
    <label>{t("agent.library.name")}<input value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} /></label>
    <button type="button" disabled={busy || !title.trim() || !library.messages.length}
      onClick={() => void library.rename(title).catch(() => {})}>{t("agent.library.rename")}</button>
    {library.resumeMessages.length ? <p>{t("agent.library.recovered")} {t("agent.library.resumeHint")}</p> : null}
    <ul>{library.entries.map((entry) => <li key={entry.id}>
      <span><strong>{entry.title}</strong><small>{entry.provider} · {entry.messageCount}</small></span>
      <button type="button" disabled={busy} onClick={() => void library.restore(entry.id).catch(() => {})}>{t("agent.library.restore")}</button>
      <button type="button" disabled={busy || entry.id === library.current.id} onClick={() => {
        if (window.confirm(t("agent.library.removeConfirm"))) void library.remove(entry.id).catch(() => {});
      }}>{t("agent.library.delete")}</button>
    </li>)}</ul>
    {!library.entries.length && library.listStatus === "ready" ? <p>{t("agent.library.empty")}</p> : null}
    <small>{t("agent.library.limit")}</small>
    </div>
  </details>;
}
