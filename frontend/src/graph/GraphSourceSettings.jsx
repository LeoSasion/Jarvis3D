import {
  ArrowSyncRegular,
  FolderOpenRegular,
  WarningRegular,
} from "@fluentui/react-icons";
import { useMemo, useState } from "react";
import { useLanguage } from "../i18n/language-system.js";
import { formatTime } from "../i18n/locale-format.js";
import { getGraphSourceDiagnostics } from "./graph-source-diagnostics.js";
import "./graph-source-settings.css";

const DIAGNOSTIC_TITLE_KEYS = Object.freeze({
  attention: "graph.source.diagnostic.attention.title",
  error: "graph.source.diagnostic.error.title",
  loading: "graph.source.diagnostic.loading.title",
  ready: "graph.source.diagnostic.ready.title",
  stale: "graph.source.diagnostic.stale.title",
  syncing: "graph.source.diagnostic.syncing.title",
  truncated: "graph.source.diagnostic.truncated.title",
  unavailable: "graph.source.diagnostic.unavailable.title",
});

const DIAGNOSTIC_DETAIL_KEYS = Object.freeze({
  error: "graph.source.diagnostic.error.detail",
  loading: "graph.source.diagnostic.loading.detail",
  stale: "graph.source.diagnostic.stale.detail",
  syncing: "graph.source.diagnostic.syncing.detail",
  truncated: "graph.source.diagnostic.truncated.detail",
  unavailable: "graph.source.diagnostic.unavailable.detail",
});

function formatUpdatedAt(value, language, t) {
  if (!value) return t("graph.source.lastSync.never");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("graph.source.lastSync.unavailable");
  return formatTime(date, language, { second: "2-digit" });
}

function getDiagnosticDetail(diagnostics, state, t) {
  if (diagnostics.id === "error" && state?.error?.message) {
    return diagnostics.detail;
  }
  if (diagnostics.id === "attention") {
    return t("graph.source.diagnostic.attention.detail", {
      skippedFiles: diagnostics.counts.skippedFiles,
      skippedLinks: diagnostics.counts.skippedLinks,
      unresolved: diagnostics.counts.unresolved,
    });
  }
  if (diagnostics.id === "ready") {
    return t("graph.source.diagnostic.ready.detail", {
      nodes: diagnostics.counts.nodes,
      relations: diagnostics.counts.edges,
    });
  }
  const detailKey = DIAGNOSTIC_DETAIL_KEYS[diagnostics.id];
  return detailKey ? t(detailKey) : diagnostics.detail;
}

export function GraphSourceSettings({ state, onToast }) {
  const { language, t } = useLanguage();
  const [busyAction, setBusyAction] = useState(null);
  const diagnostics = useMemo(() => getGraphSourceDiagnostics(state), [state]);
  const sourceName = state?.graph?.source?.name ?? "LOCAL OBSIDIAN VAULT";
  const diagnosticTitleKey = DIAGNOSTIC_TITLE_KEYS[diagnostics.id];
  const diagnosticTitle = diagnosticTitleKey
    ? t(diagnosticTitleKey)
    : diagnostics.title;
  const diagnosticDetail = getDiagnosticDetail(diagnostics, state, t);

  const runAction = async (id, action, successMessage) => {
    if (busyAction || typeof action !== "function") return;
    setBusyAction(id);
    try {
      const result = await action();
      if (result?.ok === false) {
        if (!result.canceled) {
          onToast?.(t("graph.source.toast.actionFailed", {
            message: result.error?.message ?? t("graph.source.error.unknown"),
          }));
        }
        return;
      }
      const cancelled = result?.canceled ?? result?.Canceled ?? result?.cancelled ?? result?.Cancelled;
      if (!cancelled) onToast?.(successMessage);
    } catch (error) {
      onToast?.(t("graph.source.toast.actionFailed", { message: error.message }));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <section
      className={`graph-source-settings is-${diagnostics.severity}`}
      aria-labelledby="graph-source-settings-title"
      aria-busy={Boolean(busyAction) || state?.refreshing}
    >
      <header>
        <span>
          <strong id="graph-source-settings-title">{t("graph.source.title")}</strong>
          <small>{sourceName}</small>
        </span>
        <code>{diagnosticTitle}</code>
      </header>
      <div
        className="graph-source-settings__metrics"
        aria-label={t("graph.source.summary.aria")}
      >
        <span><strong>{diagnostics.counts.nodes}</strong><small>{t("graph.source.metric.nodes")}</small></span>
        <span><strong>{diagnostics.counts.edges}</strong><small>{t("graph.source.metric.relations")}</small></span>
        <span><strong>{diagnostics.counts.unresolved}</strong><small>{t("graph.source.metric.unresolved")}</small></span>
        <span><strong>{diagnostics.counts.skippedFiles}</strong><small>{t("graph.source.metric.skippedFiles")}</small></span>
      </div>
      <p className="graph-source-settings__status" role="status" aria-live="polite">
        {diagnostics.severity === "warning" || diagnostics.severity === "error"
          ? <WarningRegular aria-hidden="true" />
          : <i aria-hidden="true" />}
        <span>
          {diagnosticDetail}
          <small>
            {t("graph.source.lastSync.label")} · {formatUpdatedAt(
              diagnostics.lastUpdatedAt,
              language,
              t,
            )}
          </small>
        </span>
      </p>
      <div className="graph-source-settings__actions">
        <button
          type="button"
          disabled={Boolean(busyAction)}
          onClick={() => runAction(
            "refresh",
            () => state?.refresh?.({ force: true, rescan: true }),
            t("graph.source.toast.rescanned"),
          )}
        >
          <ArrowSyncRegular aria-hidden="true" />
          <span>
            {busyAction === "refresh" || state?.refreshing
              ? t("graph.source.action.scanning")
              : t("graph.source.action.rescan")}
          </span>
        </button>
        <button
          type="button"
          disabled={Boolean(busyAction) || !state?.canChooseVault}
          onClick={() => runAction(
            "choose",
            state?.chooseVault,
            t("graph.source.toast.vaultChanged"),
          )}
        >
          <FolderOpenRegular aria-hidden="true" />
          <span>
            {busyAction === "choose"
              ? t("graph.source.action.choosing")
              : t("graph.source.action.chooseVault")}
          </span>
        </button>
      </div>
      <p className="graph-source-settings__privacy">
        {t("graph.source.privacy")}
      </p>
    </section>
  );
}
