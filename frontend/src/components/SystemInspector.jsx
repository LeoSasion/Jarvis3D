import {
  ArrowClockwiseRegular,
  DesktopRegular,
  DismissRegular,
  HardDriveRegular,
  PulseRegular,
  SearchRegular,
  WindowAppsRegular,
} from "@fluentui/react-icons";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useSystemSnapshot } from "../hooks/usePlatformData.js";
import { useLanguage } from "../i18n/language-system.js";
import { formatDateTime, formatTime } from "../i18n/locale-format.js";
import { platform } from "../platform/index.js";
import { SparklineCanvas } from "./SparklineCanvas.jsx";

let sharedDetailsRequest = null;

function requestSystemDetails() {
  if (!sharedDetailsRequest) {
    sharedDetailsRequest = platform.system.getDetails().finally(() => {
      sharedDetailsRequest = null;
    });
  }
  return sharedDetailsRequest;
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes >= 1_000_000_000_000) return `${(bytes / 1_000_000_000_000).toFixed(2)} TB`;
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  return `${Math.round(bytes / 1000)} KB`;
}

function formatStartedAt(value, language, t) {
  if (!value) return t("systemInspector.process.protected");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("systemInspector.state.unknown");
  return formatDateTime(date, language).toLocaleUpperCase(language);
}

function OverviewView({ system, details, t }) {
  const uptimeHours = Math.floor(system.status.uptimeSeconds / 3600);
  return (
    <div className="inspector-overview">
      <div className="inspector-resource-grid">
        {system.resources.map((resource) => (
          <article key={resource.id}>
            <header><span>{resource.label}</span><strong>{resource.value}</strong></header>
            <div><SparklineCanvas points={resource.points ?? Array.from({ length: 17 }, () => resource.segments ?? 0)} /></div>
            <small>{resource.meta}{resource.secondary ? ` · ${resource.secondary}` : ""}</small>
          </article>
        ))}
      </div>

      <section className="inspector-summary-card">
        <header><DesktopRegular /><span><small>{t("systemInspector.overview.activeHost")}</small><strong>{details?.computer?.machineName ?? system.status.machineName}</strong></span></header>
        <dl>
          <div><dt>{t("systemInspector.field.operatingSystem")}</dt><dd>{details?.computer?.operatingSystem ?? system.status.osDescription}</dd></div>
          <div><dt>{t("systemInspector.field.processor")}</dt><dd>{details?.computer?.processorName ?? t("systemInspector.overview.readingHardware")}</dd></div>
          <div><dt>{t("systemInspector.field.logicalProcessors")}</dt><dd>{details?.computer?.logicalProcessors ?? "—"}</dd></div>
          <div><dt>{t("systemInspector.field.sessionUptime")}</dt><dd>{t(uptimeHours === 1
            ? "systemInspector.uptime.hours.one"
            : "systemInspector.uptime.hours.other", { count: uptimeHours })}</dd></div>
        </dl>
      </section>

      <section className={`inspector-sensor-state${details?.sensors?.available ? " is-ready" : ""}`}>
        <PulseRegular />
        <span><strong>{t("systemInspector.sensor.title")}</strong><small>{details?.sensors?.detail ?? t("systemInspector.sensor.waiting")}</small></span>
        <code>{details?.sensors?.available ? t("systemInspector.state.ready") : t("systemInspector.state.isolated")}</code>
      </section>
    </div>
  );
}

function ProcessesView({ details, language, system, t, target }) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const liveByPid = useMemo(() => new Map(system.processes.map((process) => [process.pid, process])), [system.processes]);
  const processes = useMemo(() => (details?.processes ?? []).filter((process) => (
    !deferredQuery || process.name.toLocaleLowerCase().includes(deferredQuery) || String(process.pid).includes(deferredQuery)
  )), [deferredQuery, details?.processes]);

  return (
    <div className="inspector-processes">
      <label className="inspector-process-search">
        <SearchRegular />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("systemInspector.process.filterPlaceholder")}
          aria-label={t("systemInspector.process.filterAria")}
        />
        <span>{processes.length} / {details?.processes?.length ?? 0}</span>
      </label>
      <div className="inspector-process-grid inspector-process-head" aria-hidden="true">
        <span>{t("systemInspector.process.column.process")}</span><span>PID</span><span>CPU</span><span>{t("systemInspector.process.column.workingSet")}</span><span>{t("systemInspector.process.column.private")}</span><span>{t("systemInspector.process.column.threads")}</span><span>{t("systemInspector.process.column.state")}</span><span>{t("systemInspector.process.column.started")}</span>
      </div>
      <div className="inspector-process-list">
        {processes.map((process) => {
          const live = liveByPid.get(process.pid);
          const selected = process.name.toLocaleLowerCase() === String(target ?? "").toLocaleLowerCase();
          return (
            <div key={process.pid} className={`inspector-process-grid${selected ? " is-selected" : ""}`}>
              <span><i />{process.name}</span>
              <code>{process.pid}</code>
              <strong>{live?.cpu ?? "—"}</strong>
              <span>{formatBytes(process.workingSetBytes)}</span>
              <span>{formatBytes(process.privateMemoryBytes)}</span>
              <span>{process.threadCount}</span>
              <span>{process.responding == null
                ? t("systemInspector.process.service")
                : process.responding
                  ? t("systemInspector.state.ready")
                  : t("systemInspector.process.hung")}</span>
              <time>{formatStartedAt(process.startedAt, language, t)}</time>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HardwareView({ details, t }) {
  const computer = details?.computer;
  return (
    <div className="inspector-hardware">
      <section className="hardware-identity-card">
        <header><DesktopRegular /><span><small>{t("systemInspector.hardware.platformIdentity")}</small><strong>{computer?.manufacturer ?? "—"} · {computer?.model ?? "—"}</strong></span></header>
        <dl>
          <div><dt>CPU</dt><dd>{computer?.processorName ?? "—"}</dd></div>
          <div><dt>BIOS</dt><dd>{computer?.biosVendor ?? "—"} · {computer?.biosVersion ?? "—"}</dd></div>
          <div><dt>OS BUILD</dt><dd>{computer?.operatingSystemVersion ?? "—"}</dd></div>
        </dl>
      </section>

      <section className="hardware-section">
        <header><WindowAppsRegular /><span>{t("systemInspector.hardware.displayAdapters")}</span><small>{details?.graphicsAdapters?.length ?? 0}</small></header>
        <div className="hardware-adapter-list">
          {(details?.graphicsAdapters ?? []).map((adapter) => (
            <div key={`${adapter.name}:${adapter.driverVersion}`}><i /><span><strong>{adapter.name}</strong><small>DRIVER {adapter.driverVersion ?? t("systemInspector.state.unknown")}</small></span></div>
          ))}
          {details?.graphicsAdapters?.length ? null : <p>{t("systemInspector.hardware.noDisplayAdapter")}</p>}
        </div>
      </section>

      <section className="hardware-section">
        <header><HardDriveRegular /><span>{t("systemInspector.hardware.storageChannels")}</span><small>{details?.drives?.length ?? 0}</small></header>
        <div className="hardware-drive-list">
          {(details?.drives ?? []).map((drive) => {
            const total = Number(drive.totalBytes) || 0;
            const free = Number(drive.freeBytes) || 0;
            const usedPercent = total > 0 ? Math.round(((total - free) / total) * 100) : 0;
            return (
              <article key={drive.name}>
                <header><strong>{drive.label}</strong><code>{drive.name}</code></header>
                <div><i style={{ width: `${usedPercent}%` }} /></div>
                <small>{t("systemInspector.hardware.storageUsage", {
                  used: formatBytes(total - free),
                  free: formatBytes(free),
                  fileSystem: drive.fileSystem,
                })}</small>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export function SystemInspector({
  open,
  active,
  target,
  maximized,
  onClose,
  onMinimize,
  onToggleMaximize,
  onToast,
}) {
  const { language, t } = useLanguage();
  const system = useSystemSnapshot();
  const [view, setView] = useState("overview");
  const [details, setDetails] = useState(null);
  const [status, setStatus] = useState("loading");

  const refresh = useCallback(() => {
    setStatus("loading");
    requestSystemDetails()
      .then((result) => {
        setDetails(result);
        setStatus("ready");
        if ((result.processes ?? []).some((process) => process.name.toLocaleLowerCase() === String(target ?? "").toLocaleLowerCase())) {
          setView("processes");
        }
      })
      .catch((error) => {
        setStatus("error");
        onToast(t("systemInspector.error.detailsUnavailable", { message: error.message }));
      });
  }, [onToast, t, target]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open || !active) return undefined;
    const handleEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [active, onClose, open]);

  if (!open) return null;

  return (
    <div className="system-inspector-layer">
      <section className="system-inspector" role="dialog" aria-modal="false" aria-label={t("systemInspector.accessibility.window")}>
        <header
          className="system-inspector-titlebar"
          data-window-drag-handle
          aria-keyshortcuts="Alt+F4 Alt+F9 Alt+F10"
        >
          <span><PulseRegular /></span>
          <span><small>{t("systemInspector.header.eyebrow")}</small><strong>{t("systemInspector.header.title")}</strong></span>
          <code>{status === "loading"
            ? t("systemInspector.status.scanning")
            : status === "error"
              ? t("systemInspector.status.degraded")
              : t("systemInspector.status.ready")}</code>
          <button type="button" data-no-window-drag onClick={refresh} disabled={status === "loading"} aria-label={t("systemInspector.action.refresh")}><ArrowClockwiseRegular /></button>
          <button type="button" data-no-window-drag onClick={onMinimize} aria-label={t("systemInspector.action.minimize")}>—</button>
          <button
            type="button"
            data-no-window-drag
            onClick={onToggleMaximize}
            aria-label={t(maximized
              ? "systemInspector.action.restore"
              : "systemInspector.action.maximize")}
          >
            {maximized ? "❐" : "□"}
          </button>
          <button type="button" data-no-window-drag onClick={onClose} aria-label={t("systemInspector.action.close")}><DismissRegular /></button>
        </header>

        <nav className="system-inspector-tabs" aria-label={t("systemInspector.tabs.aria")}>
          {[
            ["overview", "systemInspector.tabs.overview"],
            ["processes", "systemInspector.tabs.processes"],
            ["hardware", "systemInspector.tabs.hardware"],
          ].map(([id, labelKey]) => (
            <button key={id} type="button" className={view === id ? "is-active" : ""} onClick={() => setView(id)}>{t(labelKey)}</button>
          ))}
          <span>{details?.capturedAt ? formatTime(details.capturedAt, language) : "—"}</span>
        </nav>

        <div className={`system-inspector-content is-${view}`} aria-busy={status === "loading"}>
          {view === "overview" ? <OverviewView system={system} details={details} t={t} /> : null}
          {view === "processes" ? <ProcessesView details={details} language={language} system={system} t={t} target={target} /> : null}
          {view === "hardware" ? <HardwareView details={details} t={t} /> : null}
          {status === "loading" && !details ? <div className="system-inspector-loading"><i /><span>{t("systemInspector.loading")}</span></div> : null}
        </div>
      </section>
    </div>
  );
}
