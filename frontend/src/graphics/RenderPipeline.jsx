import {
  Bloom,
  EffectComposer,
  ToneMapping,
} from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { HalfFloatType, UnsignedByteType } from "three";
import {
  createGraphicsPassRegistry,
} from "./runtime/pass-registry.js";
import { useGraphicsRuntimeContext } from "./runtime/runtime-context.js";
import { renderGraphLabels } from "./graph/graph-label-rendering.js";

function GraphLabelPass() {
  // Composer runs at priority 1; draw crisp information afterward on the same canvas.
  useFrame(({ gl, scene, camera }) => renderGraphLabels(gl, scene, camera), 2);
  return null;
}

function RegisteredPass({ pass }) {
  if (!pass.enabled) return null;
  if (pass.id === "bloom") {
    return (
      <Bloom
        intensity={pass.intensity}
        levels={pass.levels}
        luminanceThreshold={pass.luminanceThreshold}
        luminanceSmoothing={pass.luminanceSmoothing}
        mipmapBlur
        radius={pass.radius}
      />
    );
  }
  if (pass.id === "tone-mapping") {
    return <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />;
  }
  return null;
}

export function RenderPipeline({
  bloom = true,
  bloomIntensity = 0.62,
  bloomRadius,
  bloomSmoothing = 0.22,
  bloomThreshold = 0.82,
  hdr = false,
  labels = false,
}) {
  const runtime = useGraphicsRuntimeContext();
  const gl = useThree((state) => state.gl);
  // Preserve radiance above 1 until Bloom and tone mapping have consumed it.
  // 2D retains its existing pipeline; unsupported GPUs keep the SDR fallback.
  const frameBufferType = hdr && gl.extensions.has("EXT_color_buffer_float")
    ? HalfFloatType
    : UnsignedByteType;
  useEffect(() => {
    gl.domElement.dataset.graphicsColorRange = frameBufferType === HalfFloatType ? "hdr" : "sdr";
    return () => { delete gl.domElement.dataset.graphicsColorRange; };
  }, [frameBufferType, gl]);
  const registry = useMemo(() => createGraphicsPassRegistry({
    bloom,
    bloomIntensity,
    bloomRadius,
    bloomSmoothing,
    bloomThreshold,
    runtime,
  }), [bloom, bloomIntensity, bloomRadius, bloomSmoothing, bloomThreshold, runtime]);

  // The WebGL context can briefly leave the ready state during StrictMode
  // setup or context restoration. Mounting EffectComposer in that interval
  // makes postprocessing read context attributes from a lost context.
  if (runtime?.rendererStatus !== "ready") return null;

  return (
    <>
      <EffectComposer
        key={frameBufferType}
        enableNormalPass={false}
        frameBufferType={frameBufferType}
        multisampling={0}
      >
        {registry.passes.map((pass) => <RegisteredPass key={pass.id} pass={pass} />)}
      </EffectComposer>
      {labels ? <GraphLabelPass /> : null}
    </>
  );
}
