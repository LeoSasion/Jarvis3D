import {
  Bloom,
  EffectComposer,
  ToneMapping,
} from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo } from "react";
import { HalfFloatType, UnsignedByteType } from "three";
import {
  createGraphicsPassRegistry,
} from "./runtime/pass-registry.js";
import { useGraphicsRuntimeContext } from "./runtime/runtime-context.js";
import { renderGraphLabels } from "./graph/graph-label-rendering.js";
import { GraphGlowEffect } from "./graph/graph-glow-effect.js";

function GraphGlowPass({ pass, transmission }) {
  const effect = useMemo(() => new GraphGlowEffect(pass.levels), [pass.levels]);
  useLayoutEffect(() => effect.configure(pass, transmission), [effect, pass, transmission]);
  useEffect(() => () => effect.dispose(), [effect]);
  return <primitive object={effect} dispose={null} />;
}

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
  bloomFalloff = 2,
  bloomColorPreservation = 0.8,
  hdr = false,
  labels = false,
  transmission = false,
  graphGlow = false,
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
    bloomFalloff,
    bloomColorPreservation,
    runtime,
  }), [bloom, bloomIntensity, bloomRadius, bloomSmoothing, bloomThreshold, bloomFalloff, bloomColorPreservation, runtime]);
  const glowPass = registry.passes.find((pass) => pass.id === "bloom");

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
        {registry.passes.map((pass) => graphGlow && pass.id === "bloom"
          ? null : <RegisteredPass key={pass.id} pass={pass} />)}
        {graphGlow ? <GraphGlowPass pass={glowPass} transmission={transmission} /> : null}
      </EffectComposer>
      {labels ? <GraphLabelPass /> : null}
    </>
  );
}
