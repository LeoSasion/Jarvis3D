import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { useFrame, useThree } from "@react-three/fiber";
import GRAPH_LABEL_FONT from "@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff?url";
import { GraphicsRuntime } from "../GraphicsRuntime.jsx";
import { RenderPipeline } from "../RenderPipeline.jsx";
import { GraphScene } from "../graph/GraphScene.jsx";
import { graphicsQualityProfiles } from "../graphics-runtime-policy.js";
import { useGraphicsRuntimeContext } from "../runtime/runtime-context.js";
import { createGraphRenderPlan } from "../graph/graph-render-policy.js";
import { DEFAULT_GRAPH_VISUAL_SETTINGS, resolveGraphVisualColors, selectGraphDimensionSettings } from "../graph/graph-visual-settings.js";
import { ensureGraphLabelFont } from "../graph/graph-label-atlas.js";
import { captureGraphVisualReference, endGraphVisualPreview, getGraphVisualPreviewSnapshot, resolveGraphVisualPreview, selectGraphVisualPreview, setGraphVisualPreviewFrozen, subscribeGraphVisualPreview } from "../graph/graph-visual-preview.js";
import { getGraphThemePalette, getVisualThemeDefinition } from "../../theme-system.js";
import { GRAPHICS_REGRESSION_MANIFEST as manifest, createGraphicsRegressionClock, createGraphicsRegressionGraph, digestRegressionNumbers, summarizeRegressionIntervals } from "./regression-model.js";
import "../graphics-runtime.css";
import "./regression.css";

// This entry never loads the shell/platform bridge or connects persisted settings.
// Its only public API accepts the manifest's bounded cases and returns plain data.
const graph = createGraphicsRegressionGraph();
const theme = getVisualThemeDefinition(manifest.theme);
for (const [name, value] of Object.entries(theme.variables)) document.documentElement.style.setProperty(name, value);
const colors = resolveGraphVisualColors(DEFAULT_GRAPH_VISUAL_SETTINGS, getGraphThemePalette(manifest.theme));
const baseSettings = Object.freeze({
  ...DEFAULT_GRAPH_VISUAL_SETTINGS,
  node: Object.freeze({ ...DEFAULT_GRAPH_VISUAL_SETTINGS.node, ...Object.fromEntries(["baseColor", "hubColor", "activeColor", "groupColor"].map((key) => [key, colors[key]])) }),
  edge: Object.freeze({ ...DEFAULT_GRAPH_VISUAL_SETTINGS.edge, color: colors.edgeColor }),
});
const driver = {
  mount: 0, frame: 0, clock: null, layout: "initializing", renderer: "initializing",
  intervals: [], lastMeasuredAt: null, metrics: null, contexts: { lost: 0, restored: 0 },
};
let state = Object.freeze({ phase: "ready", caseId: null, result: null, error: null });
let frozenReference = null;
let configure = null;
let nextMount = 0;

function MetricsProbe({ clock, mount }) {
  const { gl, scene, camera, invalidate } = useThree();
  const runtime = useGraphicsRuntimeContext();
  driver.renderer = runtime?.rendererStatus ?? "initializing";
  useLayoutEffect(() => {
    const autoReset = gl.info.autoReset;
    gl.info.autoReset = false;
    driver.invalidate = invalidate;
    const extension = gl.getContext().getExtension("WEBGL_lose_context");
    driver.loseContext = () => {
      if (!extension) throw new Error("WEBGL_lose_context is unavailable.");
      extension.loseContext();
    };
    driver.restoreContext = () => extension?.restoreContext();
    const lost = () => { driver.contexts.lost += 1; };
    const restored = () => { driver.contexts.restored += 1; };
    gl.domElement.addEventListener("webglcontextlost", lost);
    gl.domElement.addEventListener("webglcontextrestored", restored);
    return () => {
      gl.info.autoReset = autoReset;
      gl.domElement.removeEventListener("webglcontextlost", lost);
      gl.domElement.removeEventListener("webglcontextrestored", restored);
    };
  }, [gl, invalidate]);
  useFrame(() => { gl.info.reset(); }, -2000);
  useFrame(() => {
    driver.frame += 1;
    if (clock.advanced && clock.frame > manifest.warmupFrames) {
      const now = performance.now();
      if (driver.lastMeasuredAt !== null) driver.intervals.push(now - driver.lastMeasuredAt);
      driver.lastMeasuredAt = now;
    }
    const nodes = scene.getObjectByName("graph-cell-nodes");
    const filaments = scene.getObjectByName("graph-resting-filaments");
    const signalData = filaments?.material?.uniforms.lineSignalHistory?.value?.image?.data;
    driver.metrics = {
      mount,
      simulationFrames: clock.frame,
      timeSeconds: clock.elapsed,
      shaderTime: nodes?.material?.uniforms.energyTime?.value ?? null,
      positionDigest: digestRegressionNumbers(nodes?.geometry?.attributes.position?.array),
      signalDigest: digestRegressionNumbers(signalData),
      camera: { type: camera.type, position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), zoom: camera.zoom, projection: camera.projectionMatrix.toArray() },
      render: { calls: gl.info.render.calls, triangles: gl.info.render.triangles, points: gl.info.render.points, lines: gl.info.render.lines },
      memory: { geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, programs: gl.info.programs?.length ?? 0 },
      canvas: { width: gl.domElement.width, height: gl.domElement.height, dpr: gl.getPixelRatio() },
      quality: runtime?.qualityProfile?.id,
      context: { ...driver.contexts },
    };
  }, 3);
  return null;
}

function RegressionScene({ configuration }) {
  const { mount, dimension, interactive, variant } = configuration;
  useSyncExternalStore(subscribeGraphVisualPreview, getGraphVisualPreviewSnapshot);
  const clock = useMemo(createGraphicsRegressionClock, [mount]);
  driver.clock = clock;
  const dimensionSettings = useMemo(() => selectGraphDimensionSettings(baseSettings, dimension), [dimension]);
  const current = useMemo(() => variant === "b" ? {
    ...dimensionSettings,
    profiles: { ...dimensionSettings.profiles, [`${dimension}d`]: {
      ...dimensionSettings.profiles[`${dimension}d`],
      postFx: { ...dimensionSettings.profiles[`${dimension}d`].postFx,
        bloom: { ...dimensionSettings.profiles[`${dimension}d`].postFx.bloom, intensity: 0.75 },
      },
    } },
  } : dimensionSettings, [dimension, dimensionSettings, variant]);
  driver.settings = dimensionSettings;
  const settings = resolveGraphVisualPreview(current);
  const renderPlan = useMemo(() => createGraphRenderPlan(settings, graphicsQualityProfiles.balanced, {}, graph), [settings]);
  const bloom = renderPlan.profiles[`${dimension}d`].postFx.bloom;
  return <div className={`graphics-runtime is-${interactive ? "interactive" : "passive"}`} data-scenario={configuration.scenario} data-presentation={interactive ? "graph" : "orb"}>
    <GraphicsRuntime dimension={dimension} quality={graphicsQualityProfiles.balanced} fixedQuality readableLabels
      interactive={interactive} measurementKey={`regression:${mount}`} fallback={<p>WebGL initialization failed.</p>}>
      <GraphScene animationClock={clock} dimension={dimension} graph={graph} interactive={interactive}
        presentation={interactive ? "graph" : "orb"} selectedNodeId={interactive ? graph.nodes[0].id : null}
        renderPlan={renderPlan} onLayoutState={(value) => { if (driver.mount === mount) driver.layout = value; }} />
      <RenderPipeline bloom={bloom.enabled ? "required" : false} bloomIntensity={bloom.intensity} bloomRadius={bloom.radius}
        bloomSmoothing={bloom.softKnee} bloomThreshold={bloom.threshold} bloomFalloff={bloom.falloff}
        bloomColorPreservation={bloom.colorPreservation} graphGlow hdr transmission labels />
      <MetricsProbe clock={clock} mount={mount} />
    </GraphicsRuntime>
  </div>;
}

function RegressionSurface() {
  const [configuration, setConfiguration] = useState(null);
  useEffect(() => { configure = setConfiguration; return () => { configure = null; }; }, []);
  return <main aria-label="JARVIS fixed graphics regression" data-regression-ready="true">
    <div id="graphics-regression-stage" style={{ width: manifest.width, height: manifest.height }}>
      {configuration && <RegressionScene key={configuration.mount} configuration={configuration} />}
    </div>
    <p>Isolated WebGL regression · fixed synthetic graph · no user files or settings</p>
  </main>;
}

async function waitUntil(predicate, description, timeout = 45_000) {
  const deadline = performance.now() + timeout;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(`Timed out: ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
}

async function drawFrames(count = 3) {
  for (let index = 0; index < count; index += 1) {
    const before = driver.frame;
    driver.invalidate?.();
    await waitUntil(() => driver.frame > before, "final composed frame");
  }
}

async function advance(frames) {
  driver.lastMeasuredAt = null;
  driver.clock.advance(frames);
  setGraphVisualPreviewFrozen(false);
  driver.invalidate();
  await waitUntil(() => driver.clock.remaining === 0, "fixed simulation frames");
  setGraphVisualPreviewFrozen(true);
  await drawFrames();
}

async function loadScenario(caseId) {
  endGraphVisualPreview();
  const mount = ++nextMount;
  Object.assign(driver, { mount, layout: "initializing", renderer: "initializing", intervals: [], lastMeasuredAt: null, metrics: null });
  configure({ mount, scenario: caseId, dimension: caseId === "explore-2d" ? 2 : 3, interactive: caseId !== "idle", variant: "a" });
  await waitUntil(() => driver.metrics?.mount === mount && driver.layout === "settled" && driver.renderer === "ready", "layout and renderer ready");
  if (!await ensureGraphLabelFont(GRAPH_LABEL_FONT)) throw new Error("The bundled graph font did not load.");
  await drawFrames();
  await advance(manifest.captureFrames);
}

function comparableFrame(value) {
  return JSON.stringify({ camera: value.camera, time: value.timeSeconds, shaderTime: value.shaderTime, positions: value.positionDigest, signals: value.signalDigest });
}

async function runCase(caseId) {
  if (["idle", "explore-3d", "explore-2d"].includes(caseId)) {
    await loadScenario(caseId);
  } else if (caseId === "frozen-a") {
    captureGraphVisualReference(driver.settings);
    configure((previous) => ({ ...previous, variant: "b" }));
    selectGraphVisualPreview("a");
    await drawFrames();
    frozenReference = comparableFrame(driver.metrics);
  } else if (caseId === "frozen-b" || caseId === "frozen-a-restored") {
    selectGraphVisualPreview(caseId === "frozen-b" ? "b" : "a");
    await drawFrames();
    if (comparableFrame(driver.metrics) !== frozenReference) throw new Error("Frozen A/B changed camera, positions or signal time/history.");
  } else if (caseId === "reentry") {
    selectGraphVisualPreview("b");
    configure((previous) => ({ ...previous, interactive: false, variant: "a" }));
    await waitUntil(() => document.querySelector('[data-presentation="orb"]'), "exit Explore committed");
    await drawFrames();
    await advance(60);
    configure((previous) => ({ ...previous, interactive: true }));
    await waitUntil(() => document.querySelector('[data-presentation="graph"]'), "reenter Explore committed");
    await drawFrames();
    await advance(60);
    if (driver.metrics.simulationFrames !== manifest.captureFrames + 120) throw new Error("Reentry did not retain the scene clock.");
    frozenReference = comparableFrame(driver.metrics);
  } else if (caseId === "context-restored") {
    const lost = driver.contexts.lost;
    const restored = driver.contexts.restored;
    driver.loseContext();
    await waitUntil(() => driver.contexts.lost > lost && driver.renderer === "context-lost", "WebGL context loss");
    driver.restoreContext();
    await waitUntil(() => driver.contexts.restored > restored && driver.renderer === "ready", "WebGL context recovery");
    await drawFrames(5);
    if (comparableFrame(driver.metrics) !== frozenReference) throw new Error("Context recovery changed the captured view.");
  }
  const metrics = driver.metrics;
  if (metrics.quality !== manifest.quality || metrics.canvas.dpr !== 1 || metrics.canvas.width !== manifest.width || metrics.canvas.height !== manifest.height) {
    throw new Error("The renderer did not keep the fixed quality, DPR and viewport.");
  }
  if (!metrics.render.calls || !metrics.memory.geometries || !metrics.memory.textures || metrics.shaderTime !== metrics.timeSeconds) {
    throw new Error("The composed graph did not render with its captured simulation time.");
  }
  const frameStatistics = summarizeRegressionIntervals(driver.intervals);
  if (!frameStatistics) throw new Error("No real active frame interval sample was collected.");
  return Object.freeze({ caseId, ...metrics, frameStatistics, frozen: getGraphVisualPreviewSnapshot().frozen,
    nodes: graph.nodes.length, relations: graph.edges.length, layout: driver.layout });
}

const completed = [];
Object.defineProperty(window, "jarvisGraphicsRegression", { configurable: false, value: Object.freeze({
  manifest,
  status: () => state,
  environment: () => ({ userAgent: navigator.userAgent, devicePixelRatio: devicePixelRatio,
    viewport: { width: innerWidth, height: innerHeight }, documentVisible: document.visibilityState === "visible",
    stage: document.getElementById("graphics-regression-stage").getBoundingClientRect().toJSON(),
    build: import.meta.env.JARVIS_BUILD }),
  start(caseId) {
    if (!configure || state.phase === "running" || caseId !== manifest.cases[completed.length]) return false;
    state = Object.freeze({ phase: "running", caseId, result: null, error: null });
    runCase(caseId).then((result) => {
      completed.push(caseId);
      state = Object.freeze({ phase: "complete", caseId, result, error: null });
    }).catch((error) => {
      state = Object.freeze({ phase: "failed", caseId, result: null, error: String(error.message).slice(0, 500) });
    });
    return true;
  },
}) });

createRoot(document.getElementById("root")).render(<RegressionSurface />);
