import { useMemo, useState } from "react";
import { canExportAnswer, createAnswerMarkdown, getCitationTargetLine, getUnverifiedCitations, splitAnswerCitations } from "../agent-answer-model.js";
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

export function AgentAnswer({ message, sources, t, sourcePanelId, selectedCitation, onOpenSource }) {
  const [exportStatus, setExportStatus] = useState(null);
  const parts = useMemo(() => splitAnswerCitations(message.text, sources), [message.text, sources]);
  const unverified = useMemo(() => getUnverifiedCitations(parts), [parts]);

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
      aria-controls={sourcePanelId} aria-expanded={selectedCitation?.messageId === message.id
        && selectedCitation?.offset === part.offset}
      onClick={(event) => onOpenSource({ messageId: message.id, source: part.source,
        offset: part.offset, line: getCitationTargetLine(message.text, part, part.source),
        trigger: event.currentTarget })}>
      {part.text}</button> : part.text)}</p>
    {unverified.length ? <p className="agent-answer__unverified" role="note">
      {t("agent.answer.unverified", { citations: unverified.slice(0, 8).join(", ") })}{unverified.length > 8 ? "…" : ""}
    </p> : null}
    {canExportAnswer(message) ? <div className="agent-answer__actions">
      <button type="button" onClick={exportAnswer}>{t("agent.answer.export")}</button>
      {exportStatus ? <small role={exportStatus === "error" ? "alert" : "status"}>
        {t(exportStatus === "error" ? "agent.answer.exportError" : "agent.answer.exportStarted")}
      </small> : null}
    </div> : null}
  </div>;
}
