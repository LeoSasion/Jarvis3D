import { CheckmarkRegular, DismissRegular, WarningRegular } from "@fluentui/react-icons";
import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "../i18n/language-system.js";
import { platform } from "../platform/index.js";
import { CoreNodeGlyph, JarvisMark } from "./VectorMarks.jsx";

const minimumVisibleMs = 1150;
let sharedChecks = null;

const checkDefinitions = Object.freeze([
  Object.freeze({
    id: "runtime",
    index: "01",
    labelKey: "boot.check.runtime.label",
    detailKey: "boot.check.runtime.detail",
    run: () => platform.lifecycle.getRuntimeInfo(),
    validate: (result) => Boolean(result?.recoveryReady),
  }),
  Object.freeze({
    id: "telemetry",
    index: "02",
    labelKey: "boot.check.telemetry.label",
    detailKey: "boot.check.telemetry.detail",
    run: () => platform.system.getSnapshot(),
    validate: (result) => Boolean(result?.cpu ?? result?.Cpu),
  }),
  Object.freeze({
    id: "windows",
    index: "03",
    labelKey: "boot.check.windowChannel.label",
    detailKey: "boot.check.windowChannel.detail",
    run: () => platform.taskbar.getSnapshot(),
    validate: (result) => Array.isArray(result?.windows ?? result?.Windows),
  }),
  Object.freeze({
    id: "terminal",
    index: "04",
    labelKey: "boot.check.conpty.label",
    detailKey: "boot.check.conpty.detail",
    run: () => platform.terminal.listProfiles(),
    validate: (result) => !platform.isNative || Boolean(result?.conPtyAvailable),
  }),
]);

function getSharedChecks() {
  if (!sharedChecks) {
    sharedChecks = checkDefinitions.map((definition) => ({
      ...definition,
      promise: Promise.resolve().then(definition.run),
    }));
  }
  return sharedChecks;
}

export function BootSequence({ onComplete }) {
  const { t } = useLanguage();
  const [states, setStates] = useState(() => Object.fromEntries(
    checkDefinitions.map((definition) => [definition.id, "pending"]),
  ));
  const [canSkip, setCanSkip] = useState(false);
  const checks = useMemo(getSharedChecks, []);

  useEffect(() => {
    let active = true;
    const startedAt = performance.now();
    const skipTimer = window.setTimeout(() => setCanSkip(true), 420);

    checks.forEach((check) => {
      check.promise.then((result) => {
        if (!active) return;
        setStates((current) => ({
          ...current,
          [check.id]: check.validate(result) ? "ready" : "degraded",
        }));
      }).catch(() => {
        if (!active) return;
        setStates((current) => ({ ...current, [check.id]: "degraded" }));
      });
    });

    Promise.allSettled(checks.map((check) => check.promise)).then(() => {
      const remaining = Math.max(0, minimumVisibleMs - (performance.now() - startedAt));
      return new Promise((resolve) => window.setTimeout(resolve, remaining));
    }).then(() => {
      if (active) onComplete();
    });

    return () => {
      active = false;
      window.clearTimeout(skipTimer);
    };
  }, [checks, onComplete]);

  const completed = Object.values(states).filter((state) => state !== "pending").length;
  const degraded = Object.values(states).filter((state) => state === "degraded").length;

  return (
    <section
      className="boot-sequence"
      role="status"
      aria-live="polite"
      aria-label={t("boot.aria.startupChecks")}
    >
      <div className="boot-scan-field" aria-hidden="true"><i /><i /><i /></div>
      <div className="boot-core">
        <CoreNodeGlyph active={completed < checkDefinitions.length} />
        <span className="boot-core-ring" aria-hidden="true" />
      </div>
      <header>
        <JarvisMark />
        <span><small>{t("boot.startingWorkspace")}</small><strong>JARVIS DESKTOP</strong></span>
        <code>{String(completed).padStart(2, "0")} / {String(checkDefinitions.length).padStart(2, "0")}</code>
      </header>

      <div className="boot-check-list">
        {checks.map((check) => {
          const state = states[check.id];
          return (
            <div key={check.id} className={`is-${state}`}>
              <code>{check.index}</code>
              <span>
                <strong>{t(check.labelKey)}</strong>
                <small>{t(check.detailKey)}</small>
              </span>
              <i aria-hidden="true" />
              <b>{state === "ready" ? <CheckmarkRegular /> : state === "degraded" ? <WarningRegular /> : null}</b>
              <em>{t(`boot.state.${state}`)}</em>
            </div>
          );
        })}
      </div>

      <footer>
        <span>
          <i style={{ "--boot-progress": completed / checkDefinitions.length }} />
        </span>
        <strong>{completed < checkDefinitions.length
          ? t("boot.progress.establishing")
          : degraded
            ? t("boot.progress.degraded", { count: degraded })
            : t("boot.progress.ready")}</strong>
        <button type="button" onClick={onComplete} disabled={!canSkip}>
          <DismissRegular />
          {t("boot.action.skip")}
        </button>
      </footer>
    </section>
  );
}
