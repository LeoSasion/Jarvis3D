import {
  Bloom,
  EffectComposer,
  ToneMapping,
} from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useMemo } from "react";
import { UnsignedByteType } from "three";
import {
  createGraphicsPassRegistry,
} from "./runtime/pass-registry.js";
import { useGraphicsRuntimeContext } from "./runtime/runtime-context.js";

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
}) {
  const runtime = useGraphicsRuntimeContext();
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
    <EffectComposer
      enableNormalPass={false}
      frameBufferType={UnsignedByteType}
      multisampling={0}
    >
      {registry.passes.map((pass) => <RegisteredPass key={pass.id} pass={pass} />)}
    </EffectComposer>
  );
}
