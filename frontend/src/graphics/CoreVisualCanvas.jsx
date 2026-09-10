import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useReducedMotion } from "../hooks/useReducedMotion.js";
import { useLanguage } from "../i18n/language-system.js";
import {
  getGraphThemePalette,
  getVisualThemeDefinition,
  getVisualThemeVersionSnapshot,
  subscribeVisualTheme,
} from "../theme-system.js";
import { GraphicsRuntime } from "./GraphicsRuntime.jsx";
import { GraphScene } from "./graph/GraphScene.jsx";
import { NeuralOrbScene } from "./orb/NeuralOrbScene.jsx";
import {
  createGraphNodeBudgetView,
  createGraphRenderPlan,
} from "./graph/graph-render-policy.js";
import {
  getGraphVisualSettingsSnapshot,
  getGraphVisualPresetId,
  initializeGraphVisualSettings,
  resolveGraphVisualColors,
  selectGraphDimensionSettings,
  subscribeGraphVisualSettings,
} from "./graph/graph-visual-settings.js";
import {
  readGraphicsEnvironment,
  selectGraphicsQualityProfile,
} from "./graphics-runtime-policy.js";
import { RenderPipeline } from "./RenderPipeline.jsx";
import { publishGraphicsDiagnostics } from "./runtime/graphics-diagnostics-store.js";
import "./graphics-runtime.css";

function selectDebouncedLayout(layout) {
  return Object.freeze({
    repulsion: layout.repulsion,
    linkDistance: layout.linkDistance,
    linkStrength: layout.linkStrength,
    collision: layout.collision,
    center: layout.center,
    nodeScale: layout.nodeScale,
    hubScale: layout.hubScale,
  });
}

function createLayoutTuningKey(layout) {
  return [
    layout.repulsion,
    layout.linkDistance,
    layout.linkStrength,
    layout.collision,
    layout.center,
    layout.nodeScale,
    layout.hubScale,
  ].map((value) => Number(value).toFixed(3)).join(":");
}

function graphBudgetViewsMatch(left, right) {
  if (!left || !right
    || left.nodes.length !== right.nodes.length
    || left.edges.length !== right.edges.length) return false;
  return left.nodes.every((node, index) => node === right.nodes[index])
    && left.edges.every((edge, index) => edge === right.edges[index]);
}

function resolveCanvasReducedMotion(motionMode, preferenceReducedMotion) {
  if (motionMode === "full") return false;
  if (motionMode === "reduced") return true;
  return preferenceReducedMotion;
}

const ORB_BLOOM_PROFILE = Object.freeze({
  intensity: 1.85,
  radius: 0.92,
  smoothing: 0.42,
  threshold: 0.18,
});

function GraphicsRecoveryStatus({ fallback }) {
  const { t } = useLanguage();

  return (
    <div className="graphics-runtime__recovery" role="status">
      {fallback}
      <span>{t("graphics.runtime.recovering")}</span>
    </div>
  );
}

function EnabledCoreVisualCanvas({
  cameraCommand = null,
  graph,
  dimension,
  hoveredNodeId = null,
  interactive = false,
  motionMode = "system",
  zoom = 1,
  selectedNodeId = null,
  onNodeHover,
  onNodeSelect,
  onCameraViewChange,
  fallback = null,
  settings,
}) {
  const preferenceReducedMotion = useReducedMotion();
  const reducedMotion = resolveCanvasReducedMotion(
    motionMode,
    preferenceReducedMotion,
  );
  const [runtimeState, setRuntimeState] = useState("initializing");
  const themeVersion = useSyncExternalStore(
    subscribeVisualTheme,
    getVisualThemeVersionSnapshot,
    getVisualThemeVersionSnapshot,
  );
  const resolvedColors = useMemo(
    () => resolveGraphVisualColors(settings, getGraphThemePalette()),
    [settings, themeVersion],
  );
  const effectiveSettings = useMemo(() => Object.freeze({
    ...settings,
    node: Object.freeze({
      ...settings.node,
      baseColor: resolvedColors.baseColor,
      hubColor: resolvedColors.hubColor,
      activeColor: resolvedColors.activeColor,
      groupColor: resolvedColors.groupColor,
    }),
    edge: Object.freeze({
      ...settings.edge,
      color: resolvedColors.edgeColor,
    }),
  }), [resolvedColors, settings]);
  const environment = useMemo(
    () => readGraphicsEnvironment(preferenceReducedMotion),
    [preferenceReducedMotion],
  );
  const quality = useMemo(
    () => selectGraphicsQualityProfile(environment, settings.performance.quality),
    [environment, settings.performance.quality],
  );
  const resolvedDimension = !interactive && settings.idleShape === "neuronSphere" ? 3 : dimension === 3 || dimension === 2
    ? dimension
    : settings.view.dimension;
  const presentation = interactive
    ? "graph"
    : resolvedDimension === 3 ? "orb" : "constellation";
  const budgetGraphRef = useRef(null);
  const budgetGraph = useMemo(
    () => {
      const next = createGraphNodeBudgetView(graph, settings.node.maxCount, {
        hoveredNodeId,
        selectedNodeId,
      });
      const cached = budgetGraphRef.current;
      if (cached?.source === graph && graphBudgetViewsMatch(cached.view, next)) {
        return cached.view;
      }
      budgetGraphRef.current = { source: graph, view: next };
      return next;
    },
    [graph, hoveredNodeId, selectedNodeId, settings.node.maxCount],
  );
  const renderPlan = useMemo(
    () => createGraphRenderPlan(effectiveSettings, quality, environment, budgetGraph),
    [budgetGraph, effectiveSettings, environment, quality],
  );
  const requestedLayoutTuning = selectDebouncedLayout(renderPlan.layout);
  const layoutTuningKey = createLayoutTuningKey(requestedLayoutTuning);
  const requestedLayoutRef = useRef(requestedLayoutTuning);
  requestedLayoutRef.current = requestedLayoutTuning;
  const [settledLayoutState, setSettledLayoutState] = useState({
    dimension: resolvedDimension, tuning: requestedLayoutTuning,
  });
  const settledLayoutTuning = settledLayoutState.dimension === resolvedDimension
    ? settledLayoutState.tuning
    : requestedLayoutTuning;
  const settledLayout = useMemo(() => Object.freeze({
    ...renderPlan.layout,
    ...settledLayoutTuning,
  }), [renderPlan.layout, settledLayoutTuning]);
  const scenePlan = useMemo(
    () => Object.freeze({ ...renderPlan, layout: settledLayout }),
    [renderPlan, settledLayout],
  );
  const activeBloom = scenePlan.profiles[`${resolvedDimension}d`].postFx.bloom;
  const handleFault = useCallback((reason, runtimeSnapshot) => {
    setRuntimeState(reason);
    publishGraphicsDiagnostics(runtimeSnapshot, reason);
  }, []);
  const handleReady = useCallback((reason, runtimeSnapshot) => {
    setRuntimeState("ready");
    publishGraphicsDiagnostics(runtimeSnapshot, reason === "ready" ? "ready" : reason);
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setSettledLayoutState((current) => (
        current.dimension === resolvedDimension && createLayoutTuningKey(current.tuning) === layoutTuningKey
          ? current
          : { dimension: resolvedDimension, tuning: requestedLayoutRef.current }
      ));
    }, 180);
    return () => clearTimeout(timeoutId);
  }, [layoutTuningKey, resolvedDimension]);

  if (runtimeState === "render-error" || environment.forcedColors) return fallback;

  return (
    <div
      className={`graphics-runtime is-${interactive ? "interactive" : "passive"} is-${presentation}-presentation`}
      data-quality={quality.id}
      data-graph-dimension={resolvedDimension}
      data-graph-presentation={presentation}
      data-graph-preset={getGraphVisualPresetId(settings)}
      data-graph-constraints={scenePlan.constraints.join("|") || undefined}
      data-motion={reducedMotion ? "reduced" : "full"}
      data-runtime-state={runtimeState}
      data-graphics-input-owner={interactive ? "graph" : undefined}
    >
      <GraphicsRuntime
        dimension={resolvedDimension}
        fallback={fallback}
        interactive={interactive}
        readableLabels={interactive}
        onFault={handleFault}
        onReady={handleReady}
        quality={quality}
        zoom={zoom}
      >
        <GraphScene
          key={resolvedDimension}
          onCameraViewChange={onCameraViewChange}
          cameraCommand={cameraCommand}
          dimension={resolvedDimension}
          graph={budgetGraph}
          hoveredNodeId={hoveredNodeId}
          interactive={interactive}
          onNodeHover={onNodeHover}
          onNodeSelect={onNodeSelect}
          presentation={presentation}
          reducedMotion={reducedMotion}
          renderPlan={scenePlan}
          selectedNodeId={selectedNodeId}
          zoom={zoom}
        />
        <RenderPipeline
          bloom={activeBloom.enabled ? "required" : false}
          bloomIntensity={activeBloom.intensity}
          bloomRadius={activeBloom.radius}
          bloomSmoothing={activeBloom.softKnee}
          bloomThreshold={activeBloom.threshold}
          hdr={resolvedDimension === 3 || settings.sharedStyle}
          labels
        />
      </GraphicsRuntime>
      {runtimeState === "context-lost" ? (
        <GraphicsRecoveryStatus fallback={fallback} />
      ) : null}
    </div>
  );
}

function NeuralOrbCoreVisualCanvas({
  fallback = null,
  motionMode = "system",
  settings,
}) {
  const systemReducedMotion = useReducedMotion();
  const reducedMotion = resolveCanvasReducedMotion(motionMode, systemReducedMotion);
  const [runtimeState, setRuntimeState] = useState("initializing");
  const themeVersion = useSyncExternalStore(
    subscribeVisualTheme,
    getVisualThemeVersionSnapshot,
    getVisualThemeVersionSnapshot,
  );
  const colors = useMemo(() => {
    const theme = getVisualThemeDefinition();
    return Object.freeze({
      accent: theme.semanticColors.action,
      accentEmphasis: theme.semanticColors.actionEmphasis,
      core: theme.semanticColors.content,
    });
  }, [themeVersion]);
  const environment = useMemo(
    () => readGraphicsEnvironment(systemReducedMotion),
    [systemReducedMotion],
  );
  const quality = useMemo(
    () => selectGraphicsQualityProfile(environment, settings.performance.quality),
    [environment, settings.performance.quality],
  );
  const bloom = settings.profiles?.["3d"]?.postFx?.bloom;
  const handleFault = useCallback((reason, runtimeSnapshot) => {
    setRuntimeState(reason);
    publishGraphicsDiagnostics(runtimeSnapshot, reason);
  }, []);
  const handleReady = useCallback((reason, runtimeSnapshot) => {
    setRuntimeState("ready");
    publishGraphicsDiagnostics(runtimeSnapshot, reason === "ready" ? "ready" : reason);
  }, []);

  if (runtimeState === "render-error" || environment.forcedColors) return fallback;

  return (
    <div
      className="graphics-runtime is-passive is-neural-orb"
      data-quality={quality.id}
      data-motion={reducedMotion ? "reduced" : "full"}
      data-runtime-state={runtimeState}
      data-visual-scene="neural-orb"
      style={{ "--core-visual-accent": colors.accent }}
    >
      <GraphicsRuntime
        dimension={3}
        fallback={fallback}
        interactive={false}
        onFault={handleFault}
        onReady={handleReady}
        quality={quality}
      >
        <NeuralOrbScene colors={colors} reducedMotion={reducedMotion} />
        <RenderPipeline
          bloom={bloom?.enabled === false ? false : "required"}
          bloomIntensity={bloom?.intensity ?? ORB_BLOOM_PROFILE.intensity}
          bloomRadius={bloom?.radius ?? ORB_BLOOM_PROFILE.radius}
          bloomSmoothing={bloom?.softKnee ?? ORB_BLOOM_PROFILE.smoothing}
          bloomThreshold={bloom?.threshold ?? ORB_BLOOM_PROFILE.threshold}
          hdr
        />
      </GraphicsRuntime>
      {runtimeState === "context-lost" ? (
        <GraphicsRecoveryStatus fallback={fallback} />
      ) : null}
    </div>
  );
}

export function CoreVisualCanvas(props) {
  const storedSettings = useSyncExternalStore(
    subscribeGraphVisualSettings,
    getGraphVisualSettingsSnapshot,
    getGraphVisualSettingsSnapshot,
  );

  useEffect(() => {
    initializeGraphVisualSettings();
  }, []);

  const settings = useMemo(
    () => selectGraphDimensionSettings(storedSettings, props.scene === "neural-orb"
      || (!props.interactive && storedSettings.idleShape === "neuronSphere") ? 3 : props.dimension),
    [storedSettings, props.dimension, props.scene, props.interactive],
  );

  if (props.scene === "neural-orb") {
    return <NeuralOrbCoreVisualCanvas {...props} settings={settings} />;
  }
  if (!settings.view.enabled) return null;
  return <EnabledCoreVisualCanvas {...props} settings={settings} />;
}
