import { useEffect, useId, useMemo, useRef, useState } from "react";
import { canExportAnswer, createAnswerMarkdown, getUnverifiedCitations, splitAnswerCitations } from "../agent-answer-model.js";
import "./agent-answer.css";

function downloadAnswer(document) {
  const url = URL.createObjectURL(new Blob([document.text], { type: "text/markdown;charset=utf-8" }));
  const anchor = globalThis.document.createElement("a");
  anchor.href = url;
  anchor.download = document.filename;
  try {
    globalThis.document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

export function AgentAnswer({ message, sources, t }) {
  const sourcePanelId = useId();
  const sourcePanelRef = useRef(null);
  const citationTriggerRef = useRef(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState(null);
  const [exportStatus, setExportStatus] = useState(null);
  const parts = useMemo(() => splitAnswerCitations(message.text, sources), [message.text, sources]);
  const unverified = useMemo(() => getUnverifiedCitations(parts), [parts]);
  const selectedSource = sources.find((source) => JSON.stringify(source) === selectedSnapshot);
  const snapshotVisible = Boolean(selectedSource);

  useEffect(() => {
    if (!snapshotVisible) return;
    sourcePanelRef.current?.focus();
    sourcePanelRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedSnapshot, snapshotVisible]);

  const exportAnswer = () => {
    try {
      downloadAnswer(createAnswerMarkdown(message, sources, {
        title: t("agent.answer.exportTitle"), sources: t("agent.answer.exportSources"),
        snapshot: t("agent.answer.snapshotNotice"), path: t("agent.answer.path"),
        lines: t("agent.answer.lines"), truncated: t("agent.answer.truncated"),
        unverified: t("agent.answer.unverifiedLabel"),
      }));
      setExportStatus("saved");
    } catch { setExportStatus("error"); }
  };

  return <div className="agent-answer">
    <p>{parts.map((part, index) => part.source ? <button key={index} type="button" className="agent-answer__citation"
      aria-label={t("agent.answer.viewSource", { citation: part.text, path: part.source.path })}
      aria-controls={sourcePanelId} aria-expanded={selectedSource?.source === part.citation}
      onClick={(event) => {
        citationTriggerRef.current = event.currentTarget;
        setSelectedSnapshot(JSON.stringify(part.source));
        if (selectedSource === part.source) sourcePanelRef.current?.focus();
      }}>{part.text}</button> : part.text)}</p>
    {unverified.length ? <p className="agent-answer__unverified" role="note">
      {t("agent.answer.unverified", { citations: unverified.slice(0, 8).join(", ") })}{unverified.length > 8 ? "…" : ""}
    </p> : null}
    {selectedSource ? <section id={sourcePanelId} ref={sourcePanelRef} tabIndex={-1} className="agent-answer__snapshot"
      aria-label={t("agent.answer.sourceSnapshot", { citation: `[${selectedSource.source}]` })}>
      <header><strong>[{selectedSource.source}] {selectedSource.title}</strong>
        <button type="button" onClick={() => {
          setSelectedSnapshot(null);
          citationTriggerRef.current?.focus();
        }}>{t("agent.answer.closeSource")}</button></header>
      <small>{selectedSource.path} · L{selectedSource.startLine}–{selectedSource.endLine}</small>
      <p>{t("agent.answer.snapshotNotice")}</p>
      {selectedSource.truncated ? <p>{t("agent.answer.truncated")}</p> : null}
      <pre>{selectedSource.text}</pre>
    </section> : null}
    {canExportAnswer(message) ? <div className="agent-answer__actions">
      <button type="button" onClick={exportAnswer}>{t("agent.answer.export")}</button>
      {exportStatus ? <small role={exportStatus === "error" ? "alert" : "status"}>
        {t(exportStatus === "error" ? "agent.answer.exportError" : "agent.answer.exportStarted")}
      </small> : null}
    </div> : null}
  </div>;
}
