import { useEffect, useState } from "react";
import { useLanguage } from "../i18n/language-system.js";
import "./agent-conversation-library.css";

export function AgentConversationLibrary({ library, busy }) {
  const { t } = useLanguage();
  const [title, setTitle] = useState(library?.current.title ?? "");
  useEffect(() => { setTitle(library?.current.title ?? ""); }, [library?.current.id, library?.current.title]);
  if (!library?.available) return null;
  return <details className="agent-conversation-library">
    <summary>{t("agent.library.title")} · {library.entries.length}
      {library.status === "saved" || library.status === "pending" ? <small role="status">{t(`agent.library.${library.status}`)}</small> : null}
    </summary>
    {library.error ? <p role="alert">{t(library.error === "restore" ? "agent.library.restoreError" : "agent.library.error")}
      <button type="button" disabled={busy} onClick={() => void library.save().catch(() => {})}>{t("knowledge.retry")}</button>
      {library.messages.length ? <button type="button" disabled={busy} onClick={() => void library.saveCopy().catch(() => {})}>{t("agent.library.saveCopy")}</button> : null}</p> : null}
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
    {!library.entries.length ? <p>{t("agent.library.empty")}</p> : null}
    <small>{t("agent.library.limit")}</small>
  </details>;
}
