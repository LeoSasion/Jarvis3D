import {
  Canvas,
  events as createPointerEvents,
  useFrame,
  useThree,
} from "@react-three/fiber";
import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  NoToneMapping,
  OrthographicCamera,
  PerspectiveCamera,
  SRGBColorSpace,
} from "three";
import {
  calculateEffectiveGraphicsDpr,
  getDowngradedGraphicsQualityProfile,
  getGraphCameraZoom,
  graphicsQualityProfiles,
} from "./graphics-runtime-policy.js";
import {
  createAdaptivePerformanceState,
  reduceAdaptivePerformanceState,
} from "./runtime/adaptive-performance.js";
import {
  readGraphicsDisplayEnvironment,
  subscribeGraphicsDisplayEnvironment,
} from "./runtime/display-environment.js";
import {
  createFrameIntervalSamplerState,
  readFrameIntervalSample,
  resetFrameIntervalSampler,
} from "./runtime/frame-interval-sampler.js";
import { GraphicsRuntimeContext } from "./runtime/runtime-context.js";

const WEBGL_OPTIONS = Object.freeze({
  alpha: true,
  antialias: false,
  depth: true,
  powerPreference: "high-performance",
  preserveDrawingBuffer: false,
  stencil: false,
});

function createSafePointerEvents(store) {
  const manager = createPointerEvents(store);
  const connect = manager.connect;
  manager.connect = (target) => {
    // R3F may finish an async StrictMode mount after a rapidly replaced graph
    // surface has already detached. A null event target must be a no-op.
    if (target) connect(target);
  };
  return manager;
}

class GraphicsErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    this.props.onFault?.("render-error", error);
  }

  render() {
    return this.state.error ? this.props.fallback : this.props.children;
  }
}

function RuntimeFrameSampler({
  onFrameComplete,
  onFrameSample,
  sampleInterval,
  slowFrameMs,
}) {
  const samplerStateRef = useRef(createFrameIntervalSamplerState());
  const callbacksRef = useRef({ onFrameComplete, onFrameSample });
  callbacksRef.current = { onFrameComplete, onFrameSample };

  useEffect(() => {
    resetFrameIntervalSampler(samplerStateRef.current);
  }, [sampleInterval, slowFrameMs]);

  useFrame((_, delta) => {
    const durationMs = readFrameIntervalSample(samplerStateRef.current, {
      deltaMs: delta * 1_000,
      sampleInterval,
      slowFrameMs,
    });
    queueMicrotask(() => {
      callbacksRef.current.onFrameComplete();
      if (durationMs !== null) {
        callbacksRef.current.onFrameSample(durationMs, performance.now());
      }
    });
  }, -1_000);

  return null;
}

function RuntimeController({
  children,
  readableLabels,
  onDprChange,
  onFault,
  onReady,
  quality,
  surfaceRef,
}) {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const setDpr = useThree((state) => state.setDpr);
  const size = useThree((state) => state.size);
  const [adaptiveTier, setAdaptiveTier] = useState(0);
  const [displayEnvironment, setDisplayEnvironment] = useState(
    readGraphicsDisplayEnvironment,
  );
  const [rendererStatus, setRendererStatus] = useState("initializing");
  const adaptiveStateRef = useRef(createAdaptivePerformanceState());
  const callbackRefs = useRef({ onFault, onReady });
  const rendererStatusRef = useRef(rendererStatus);
  const runtimeValueRef = useRef(null);
  const samplingPolicyRef = useRef(null);
  callbackRefs.current = { onFault, onReady };
  rendererStatusRef.current = rendererStatus;

  const requestedQuality = quality ?? graphicsQualityProfiles.balanced;
  const effectiveQuality = getDowngradedGraphicsQualityProfile(
    requestedQuality,
    adaptiveTier,
    displayEnvironment.forcedColors,
  );
  const maxTextureSize = Number(gl.capabilities.maxTextureSize) || 4_096;
  const effectiveDpr = calculateEffectiveGraphicsDpr({
    minimumDpr: readableLabels ? 1 : 0,
    adaptiveTier,
    devicePixelRatio: displayEnvironment.devicePixelRatio,
    height: size.height,
    maxTextureSize,
    qualityProfile: effectiveQuality,
    width: size.width,
  });
  const runtimeValue = useMemo(() => Object.freeze({
    adaptiveTier,
    devicePixelRatio: displayEnvironment.devicePixelRatio,
    effectiveDpr,
    forcedColors: displayEnvironment.forcedColors,
    maxTextureSize,
    qualityProfile: effectiveQuality,
    rendererStatus,
    requestedQualityProfile: requestedQuality,
  }), [
    adaptiveTier,
    displayEnvironment.devicePixelRatio,
    displayEnvironment.forcedColors,
    effectiveDpr,
    effectiveQuality,
    maxTextureSize,
    rendererStatus,
    requestedQuality,
  ]);
  runtimeValueRef.current = runtimeValue;
  samplingPolicyRef.current = { slowFrameMs: effectiveQuality.slowFrameMs };

  const commitRendererStatus = useCallback((nextStatus) => {
    rendererStatusRef.current = nextStatus;
    setRendererStatus(nextStatus);
  }, []);

  const commitAdaptiveState = useCallback((nextState) => {
    adaptiveStateRef.current = nextState;
    setAdaptiveTier((current) => (
      current === nextState.adaptiveTier ? current : nextState.adaptiveTier
    ));
  }, []);

  const handleFrameSample = useCallback((durationMs, now) => {
    const nextState = reduceAdaptivePerformanceState(
      adaptiveStateRef.current,
      { durationMs, now, type: "frame-sample" },
      samplingPolicyRef.current,
    );
    commitAdaptiveState(nextState);
  }, [commitAdaptiveState]);

  const handleFrameComplete = useCallback(() => {
    if (rendererStatusRef.current !== "restoring") return;
    commitRendererStatus("ready");
    callbackRefs.current.onReady?.("context-restored", runtimeValueRef.current);
  }, [commitRendererStatus]);

  useLayoutEffect(() => {
    if (rendererStatus === "context-lost") return;
    setDpr(effectiveDpr);
    onDprChange(effectiveDpr);
    invalidate();
  }, [effectiveDpr, invalidate, onDprChange, rendererStatus, setDpr]);

  useEffect(() => subscribeGraphicsDisplayEnvironment(() => {
    setDisplayEnvironment(readGraphicsDisplayEnvironment());
  }), []);

  useEffect(() => {
    const canvas = gl.domElement;
    const handleContextLost = (event) => {
      event.preventDefault();
      const nextState = reduceAdaptivePerformanceState(
        adaptiveStateRef.current,
        { now: performance.now(), type: "context-lost" },
        samplingPolicyRef.current,
      );
      commitAdaptiveState(nextState);
      commitRendererStatus("context-lost");
      callbackRefs.current.onFault?.("context-lost", runtimeValueRef.current);
    };
    const handleContextRestored = () => {
      commitRendererStatus("restoring");
      gl.resetState();
      invalidate();
    };
    canvas.addEventListener("webglcontextlost", handleContextLost, false);
    canvas.addEventListener("webglcontextrestored", handleContextRestored, false);
    commitRendererStatus("ready");
    callbackRefs.current.onReady?.("ready", runtimeValueRef.current);
    return () => {
      canvas.removeEventListener("webglcontextlost", handleContextLost, false);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored, false);
    };
  }, [commitAdaptiveState, commitRendererStatus, gl, invalidate]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    surface.dataset.adaptiveTier = String(adaptiveTier);
    surface.dataset.effectiveDpr = effectiveDpr.toFixed(3);
    surface.dataset.effectiveQuality = effectiveQuality.id;
    surface.dataset.rendererState = rendererStatus;
  }, [adaptiveTier, effectiveDpr, effectiveQuality.id, rendererStatus, surfaceRef]);

  return (
    <GraphicsRuntimeContext.Provider value={runtimeValue}>
      <RuntimeFrameSampler
        onFrameComplete={handleFrameComplete}
        onFrameSample={handleFrameSample}
        sampleInterval={effectiveQuality.frameSampleInterval}
        slowFrameMs={effectiveQuality.slowFrameMs}
      />
      {children}
    </GraphicsRuntimeContext.Provider>
  );
}

function createGraphCamera(camera, depth) {
  camera.position.set(0, 0, depth);
  camera.lookAt(0, 0, 0);
  return camera;
}

function CameraController({ dimension, zoom }) {
  const invalidate = useThree((state) => state.invalidate);
  const set = useThree((state) => state.set);
  const size = useThree((state) => state.size);
  const cameras = useMemo(() => ({
    orthographic: createGraphCamera(new OrthographicCamera(), 700),
    perspective: createGraphCamera(new PerspectiveCamera(), 720),
  }), []);

  useLayoutEffect(() => {
    const width = Math.max(1, size.width);
    const height = Math.max(1, size.height);
    const cameraZoom = getGraphCameraZoom(zoom, width, height);
    const camera = dimension === 3 ? cameras.perspective : cameras.orthographic;
    if (camera.isOrthographicCamera) {
      camera.left = -width / 2;
      camera.right = width / 2;
      camera.top = height / 2;
      camera.bottom = -height / 2;
      camera.zoom = cameraZoom;
    } else {
      camera.aspect = width / height;
      camera.fov = 48;
      camera.zoom = 1;
    }
    camera.near = 0.1;
    camera.far = 4_000;
    camera.updateProjectionMatrix();
    set({ camera });
    invalidate();
  }, [cameras, dimension, invalidate, set, size.height, size.width, zoom]);

  return null;
}

export function GraphicsRuntime({
  children,
  dimension = 2,
  quality,
  zoom = 1,
  fallback = null,
  interactive = false,
  readableLabels = false,
  onFault,
  onReady,
}) {
  const eventSourceRef = useRef(null);
  const [canvasDpr, setCanvasDpr] = useState(1);
  const handleDprChange = useCallback((nextDpr) => {
    setCanvasDpr((currentDpr) => (
      Math.abs(currentDpr - nextDpr) < 0.001 ? currentDpr : nextDpr
    ));
  }, []);
  return (
    <GraphicsErrorBoundary fallback={fallback} onFault={onFault}>
      <div ref={eventSourceRef} className="graphics-runtime__surface">
        <Canvas
          className="graphics-runtime__canvas"
          dpr={canvasDpr}
          eventSource={eventSourceRef}
          events={createSafePointerEvents}
          frameloop="demand"
          gl={WEBGL_OPTIONS}
          onCreated={({ gl }) => {
            gl.outputColorSpace = SRGBColorSpace;
            gl.toneMapping = NoToneMapping;
            gl.toneMappingExposure = 1;
            gl.setClearColor(0x000000, 0);
          }}
          style={{ pointerEvents: interactive ? "auto" : "none" }}
        >
          <RuntimeController
            readableLabels={readableLabels}
            onDprChange={handleDprChange}
            onFault={onFault}
            onReady={onReady}
            quality={quality}
            surfaceRef={eventSourceRef}
          >
            <CameraController dimension={dimension} zoom={zoom} />
            {children}
          </RuntimeController>
        </Canvas>
      </div>
    </GraphicsErrorBoundary>
  );
}
