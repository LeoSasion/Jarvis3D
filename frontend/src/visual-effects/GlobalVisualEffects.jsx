import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { useReducedMotion } from "../hooks/useReducedMotion.js";
import {
  createVisualEffectsRenderPlan,
  getVisualEffectsSnapshot,
  subscribeVisualEffects,
} from "./visual-effects-system.js";
import { publishVisualEffectsRenderPlan } from "./visual-effects-runtime-state.js";

const VisualEffectsCompositor = lazy(() => import("./VisualEffectsCompositor.jsx"));

function readEnvironment() {
  return {
    visible: typeof document === "undefined" || document.visibilityState !== "hidden",
    forcedColors: typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(forced-colors: active)").matches,
  };
}

function ActiveVisualEffects({ preferences, surface, forcedOff }) {
  const reducedMotion = useReducedMotion();
  const [environment, setEnvironment] = useState(readEnvironment);

  useEffect(() => {
    const forcedColorsMedia = typeof window.matchMedia === "function"
      ? window.matchMedia("(forced-colors: active)")
      : null;
    const refresh = () => setEnvironment(readEnvironment());

    document.addEventListener("visibilitychange", refresh);
    if (typeof forcedColorsMedia?.addEventListener === "function") {
      forcedColorsMedia.addEventListener("change", refresh);
    } else {
      forcedColorsMedia?.addListener?.(refresh);
    }
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      if (typeof forcedColorsMedia?.removeEventListener === "function") {
        forcedColorsMedia.removeEventListener("change", refresh);
      } else {
        forcedColorsMedia?.removeListener?.(refresh);
      }
    };
  }, []);

  const plan = useMemo(() => createVisualEffectsRenderPlan(preferences, {
    ...environment,
    surface,
    forcedOff,
    reducedMotion,
  }), [environment, forcedOff, preferences, reducedMotion, surface]);

  useEffect(() => {
    if (plan.backend === "none") {
      publishVisualEffectsRenderPlan(plan);
    }
  }, [plan]);

  if (plan.backend === "none") return null;
  return (
    <Suspense fallback={null}>
      <VisualEffectsCompositor plan={plan} />
    </Suspense>
  );
}

export function GlobalVisualEffects() {
  const preferences = useSyncExternalStore(
    subscribeVisualEffects,
    getVisualEffectsSnapshot,
    getVisualEffectsSnapshot,
  );
  const surface = typeof document === "undefined"
    ? "desktop"
    : document.documentElement.dataset.surface ?? "desktop";
  const forcedOff = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("fx") === "off";
  const inactivePlan = useMemo(() => createVisualEffectsRenderPlan(preferences, {
    surface,
    forcedOff,
  }), [forcedOff, preferences, surface]);

  useEffect(() => {
    if (!preferences.enabled || surface !== "desktop" || forcedOff) {
      publishVisualEffectsRenderPlan(inactivePlan);
    }
  }, [forcedOff, inactivePlan, preferences.enabled, surface]);

  if (!preferences.enabled || surface !== "desktop" || forcedOff) return null;
  return (
    <ActiveVisualEffects
      preferences={preferences}
      surface={surface}
      forcedOff={forcedOff}
    />
  );
}
