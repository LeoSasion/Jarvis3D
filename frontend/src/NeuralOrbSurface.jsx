import { lazy, Suspense } from "react";
import { useLanguage } from "./i18n/language-system.js";
import "./neural-orb-surface.css";

const CoreVisualCanvas = lazy(() => import("./graphics/CoreVisualCanvas.jsx")
  .then((module) => ({ default: module.CoreVisualCanvas })));

function NeuralOrbFallback() {
  return <div className="neural-orb-surface__fallback" aria-hidden="true" />;
}

function getPreviewMotionMode() {
  if (typeof window === "undefined") return "system";
  return new URLSearchParams(window.location.search).get("motion") === "full"
    ? "full"
    : "system";
}

export function NeuralOrbSurface() {
  const { t } = useLanguage();
  const motionMode = getPreviewMotionMode();
  return (
    <main className="neural-orb-surface" aria-label={t("orbPreview.accessibility.label")}>
      <h1 className="sr-only">{t("orbPreview.accessibility.label")}</h1>
      <div className="neural-orb-surface__frame" data-testid="neural-orb-frame">
        <Suspense fallback={<NeuralOrbFallback />}>
          <CoreVisualCanvas
            fallback={<NeuralOrbFallback />}
            motionMode={motionMode}
            scene="neural-orb"
          />
        </Suspense>
      </div>
    </main>
  );
}
