import { useEffect } from "react";
import { publishVisualEffectsRenderPlan } from "./visual-effects-runtime-state.js";
import "./visual-effects.css";

const STATIC_LAYERS = Object.freeze({
  scanlines: "repeating-linear-gradient(to bottom, transparent 0, transparent 2px, rgb(245 241 233 / 2.2%) 2.5px, transparent 3px, transparent 4px)",
  vignette: "radial-gradient(ellipse at center, transparent 58%, rgb(0 0 0 / 4%) 78%, rgb(0 0 0 / 18%) 100%)",
});

function getStaticBackground(staticEffects) {
  return staticEffects.map((id) => STATIC_LAYERS[id]).filter(Boolean).join(", ");
}

export default function VisualEffectsCompositor({ plan }) {
  const staticBackground = getStaticBackground(plan.staticEffects);
  const grainClassName = plan.grain?.animated
    ? "visual-effects__grain is-animated"
    : "visual-effects__grain is-static";

  useEffect(() => {
    publishVisualEffectsRenderPlan(plan);
  }, [plan]);

  return (
    <div
      className="visual-effects-compositor"
      data-backend={plan.backend}
      data-effects={[...plan.staticEffects, plan.grain ? "grain" : null].filter(Boolean).join(" ")}
      data-layer-count={plan.layerCount}
      aria-hidden="true"
    >
      {staticBackground ? (
        <div
          className="visual-effects__static"
          style={{ backgroundImage: staticBackground }}
        />
      ) : null}
      {plan.grain ? (
        <div
          className={grainClassName}
          style={{
            "--visual-effects-grain-cycle": plan.grain.cadence === "balanced" ? "167ms" : "333ms",
          }}
        />
      ) : null}
    </div>
  );
}
