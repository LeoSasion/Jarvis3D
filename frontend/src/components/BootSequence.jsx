import { CheckmarkRegular, DismissRegular, WarningRegular } from "@fluentui/react-icons";
import { useEffect, useMemo, useState } from "react";
import { bootCheckDefinitions as checkDefinitions, getBootChecks, getDegradedBootCheckIds } from "../boot-checks.js";
import { shouldRememberFirstRunGuide, shouldShowFirstRunGuide } from "../boot-flow-model.js";
import { useLanguage } from "../i18n/language-system.js";
import { platform } from "../platform/index.js";
import { CoreNodeGlyph, JarvisMark } from "./VectorMarks.jsx";

const minimumVisibleMs = 1150;
const guideStorageKey = "jarvis:first-run-guide-v1";

function hasSeenFirstRunGuide() {
  try {
    return window.localStorage.getItem(guideStorageKey) === "seen";
  } catch {
    return false;
  }
}

function markFirstRunGuideSeen() {
  try {
    window.localStorage.setItem(guideStorageKey, "seen");
  } catch {
    // The guide remains skippable when browser storage is unavailable.
  }
}

export function BootSequence({ onComplete, onOpenRecoverySettings, reviewOnly = false }) {
  const { t } = useLanguage();
  const [states, setStates] = useState(() => Object.fromEntries(
    checkDefinitions.map((definition) => [definition.id, "pending"]),
  ));
  const [canSkip, setCanSkip] = useState(false);
  const [guideStep, setGuideStep] = useState(null);
  const checks = useMemo(getBootChecks, []);
  const showFirstRunGuide = shouldShowFirstRunGuide({
    isNative: platform.isNative,
    reviewOnly,
    guideSeen: hasSeenFirstRunGuide(),
  });

  const finish = () => {
    if (shouldRememberFirstRunGuide(guideStep)) markFirstRunGuideSeen();
    onComplete();
  };

  useEffect(() => {
    let active = true;
    let completionTimer = null;
    const startedAt = performance.now();
    const skipTimer = window.setTimeout(() => setCanSkip(true), 420);

    checks.forEach((check) => {
      check.promise.then((result) => {
        if (!active) return;
        setStates((current) => ({
          ...current,
          [check.id]: !platform.isNative ? "preview" : check.validate(result) ? "ready" : "degraded",
        }));
      }).catch(() => {
        if (!active) return;
        setStates((current) => ({ ...current, [check.id]: platform.isNative ? "degraded" : "preview" }));
      });
    });

    Promise.allSettled(checks.map((check) => check.promise)).then((results) => {
      if (!active) return null;
      const degradedIds = getDegradedBootCheckIds(checks, results, platform.isNative);
      const remaining = Math.max(0, minimumVisibleMs - (performance.now() - startedAt));
      return new Promise((resolve) => {
        completionTimer = window.setTimeout(() => resolve(degradedIds.length), remaining);
      });
    }).then((degradedCount) => {
      if (!active || degradedCount === null || reviewOnly || degradedCount > 0) return;
      if (showFirstRunGuide) setGuideStep(0);
      else onComplete();
    });

    return () => {
      active = false;
      window.clearTimeout(skipTimer);
      if (completionTimer !== null) window.clearTimeout(completionTimer);
    };
  }, [checks, onComplete, reviewOnly, showFirstRunGuide]);

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

      {guideStep !== null ? (
        <div className="boot-guide" aria-live="polite">
          <small>{t("boot.guide.step", { step: guideStep + 1 })}</small>
          <strong>{t(`boot.guide.${guideStep}.title`)}</strong>
          <p>{t(`boot.guide.${guideStep}.detail`)}</p>
          <button type="button" onClick={() => {
            if (guideStep < 2) setGuideStep(guideStep + 1);
            else finish();
          }}>
            {t(guideStep < 2 ? "boot.guide.next" : "boot.guide.done")}
          </button>
        </div>
      ) : <div className="boot-check-list">
        {checks.map((check) => {
          const state = states[check.id];
          return (
            <div key={check.id} className={`is-${state}`}>
              <code>{check.index}</code>
              <span>
                <strong>{t(check.labelKey)}</strong>
                <small>{state === "degraded"
                  ? t(`boot.degraded.${check.id}.next`)
                  : t(check.detailKey)}</small>
              </span>
              <i aria-hidden="true" />
              <b>{state === "ready" ? <CheckmarkRegular /> : state === "degraded" ? <WarningRegular /> : null}</b>
              <em>{t(`boot.state.${state}`)}</em>
            </div>
          );
        })}
      </div>}

      <footer className={degraded > 0 ? "has-recovery-action" : ""}>
        <span>
          <i style={{ "--boot-progress": completed / checkDefinitions.length }} />
        </span>
        <strong>{guideStep !== null
          ? t("boot.guide.progress")
          : completed < checkDefinitions.length
          ? t("boot.progress.establishing")
            : !platform.isNative
              ? t("boot.progress.preview")
              : degraded
            ? t("boot.progress.degraded", { count: degraded })
            : t("boot.progress.ready")}</strong>
        {degraded > 0 ? (
          <button type="button" className="boot-recovery-action" onClick={onOpenRecoverySettings}>
            {t("boot.action.openRecoverySettings")}
          </button>
        ) : null}
        <button type="button" onClick={finish} disabled={!canSkip}>
          <DismissRegular />
          {t(guideStep !== null
            ? "boot.action.skipGuide"
            : degraded || reviewOnly
              ? "boot.action.continue"
              : "boot.action.skip")}
        </button>
      </footer>
    </section>
  );
}
