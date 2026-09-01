import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { AdditiveBlending, Color, FrontSide } from "three";
import { useGraphicsRuntimeContext } from "../runtime/runtime-context.js";
import {
  createNeuralOrbTopology,
  selectNeuralOrbBudget,
} from "./neural-orb-model.js";

const NODE_VERTEX_SHADER = `
  attribute float aScale;
  attribute float aPhase;
  attribute float aSignalStrength;
  attribute float aSignalTime;
  uniform float uCameraDistance;
  uniform float uPixelRatio;
  uniform float uPointSize;
  uniform float uRadius;
  uniform float uSignalCycle;
  uniform float uSignalGain;
  uniform float uTime;
  varying float vFront;
  varying float vPulse;
  varying float vSignal;

  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    float cameraDepth = max(1.0, -viewPosition.z);
    float safeRadius = max(1.0, uRadius);
    vFront = clamp(
      (uCameraDistance + safeRadius - cameraDepth) / (safeRadius * 2.0),
      0.0,
      1.0
    );
    vPulse = 0.9 + 0.1 * sin((uTime * 0.86) + aPhase);
    float signalAge = mod(uTime - aSignalTime + uSignalCycle, uSignalCycle);
    float signalAttack = smoothstep(0.0, 0.045, signalAge);
    float signalDecay = 1.0 - smoothstep(0.12, 0.58, signalAge);
    vSignal = signalAttack * signalDecay * aSignalStrength * uSignalGain;
    gl_PointSize = uPointSize * aScale * vPulse * (1.0 + vSignal * 0.46)
      * uPixelRatio * (720.0 / cameraDepth);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const NODE_FRAGMENT_SHADER = `
  uniform vec3 uAccentColor;
  uniform vec3 uCoreColor;
  uniform vec3 uSignalColor;
  uniform float uOpacity;
  varying float vFront;
  varying float vPulse;
  varying float vSignal;

  void main() {
    float distanceToCenter = length(gl_PointCoord - vec2(0.5)) * 2.0;
    float halo = 1.0 - smoothstep(0.12, 1.0, distanceToCenter);
    float core = 1.0 - smoothstep(0.0, 0.64, distanceToCenter);
    float spark = 1.0 - smoothstep(0.0, 0.14, distanceToCenter);
    float depthGain = mix(0.42, 1.0, smoothstep(0.02, 0.98, vFront));
    float alpha = (halo * 0.7 + core * 1.0 + spark * 0.5)
      * depthGain * vPulse * uOpacity;
    alpha = min(1.0, alpha * (1.0 + vSignal * 1.55));
    if (alpha < 0.008) discard;
    vec3 color = mix(uAccentColor, uCoreColor, core * 0.88 + spark * 0.12);
    color = mix(color, uSignalColor, min(1.0, vSignal * 0.92));
    gl_FragColor = vec4(color, alpha);
  }
`;

const EDGE_VERTEX_SHADER = `
  attribute float aEnergy;
  attribute float aPhase;
  attribute float aSignalStrength;
  attribute float aSignalTime;
  uniform float uCameraDistance;
  uniform float uRadius;
  uniform float uTime;
  varying float vEnergy;
  varying float vFront;
  varying float vPulse;
  varying float vSignalStrength;
  varying float vSignalTime;

  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    float cameraDepth = max(1.0, -viewPosition.z);
    float safeRadius = max(1.0, uRadius);
    vFront = clamp(
      (uCameraDistance + safeRadius - cameraDepth) / (safeRadius * 2.0),
      0.0,
      1.0
    );
    vEnergy = aEnergy;
    vPulse = 0.88 + 0.12 * sin((uTime * 0.64) + aPhase);
    vSignalStrength = aSignalStrength;
    vSignalTime = aSignalTime;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const EDGE_FRAGMENT_SHADER = `
  uniform vec3 uAccentColor;
  uniform vec3 uCoreColor;
  uniform vec3 uSignalColor;
  uniform float uOpacity;
  uniform float uSignalCycle;
  uniform float uSignalGain;
  uniform float uTime;
  varying float vEnergy;
  varying float vFront;
  varying float vPulse;
  varying float vSignalStrength;
  varying float vSignalTime;

  void main() {
    float frontGain = mix(0.18, 1.0, smoothstep(0.06, 0.94, vFront));
    float signalAge = mod(uTime - vSignalTime + uSignalCycle, uSignalCycle);
    float signalAttack = smoothstep(0.0, 0.035, signalAge);
    float signalDecay = 1.0 - smoothstep(0.09, 0.42, signalAge);
    float signal = signalAttack * signalDecay * vSignalStrength * uSignalGain;
    float alpha = (uOpacity * vEnergy * vPulse * frontGain)
      + signal * mix(0.86, 1.35, frontGain);
    if (alpha < 0.006) discard;
    vec3 color = mix(uAccentColor, uCoreColor, 0.42 + (vFront * 0.3));
    color = mix(color, uSignalColor, min(1.0, signal * 0.96));
    gl_FragColor = vec4(color, alpha);
  }
`;

const SIGNAL_VERTEX_SHADER = `
  attribute vec3 aTarget;
  attribute float aDuration;
  attribute float aSignalStrength;
  attribute float aSignalTime;
  uniform float uCameraDistance;
  uniform float uPixelRatio;
  uniform float uPointSize;
  uniform float uRadius;
  uniform float uSignalCycle;
  uniform float uTime;
  varying float vFront;
  varying float vSignal;

  void main() {
    float duration = max(0.01, aDuration);
    float signalAge = mod(uTime - aSignalTime + uSignalCycle, uSignalCycle);
    float progress = clamp(signalAge / duration, 0.0, 1.0);
    float signalAttack = smoothstep(0.0, 0.025, signalAge);
    float signalDecay = 1.0 - smoothstep(duration, duration + 0.26, signalAge);
    vSignal = signalAttack * signalDecay * aSignalStrength;

    vec3 animatedPosition = mix(position, aTarget, smoothstep(0.0, 1.0, progress));
    vec4 viewPosition = modelViewMatrix * vec4(animatedPosition, 1.0);
    float cameraDepth = max(1.0, -viewPosition.z);
    float safeRadius = max(1.0, uRadius);
    vFront = clamp(
      (uCameraDistance + safeRadius - cameraDepth) / (safeRadius * 2.0),
      0.0,
      1.0
    );
    gl_PointSize = uPointSize * (0.82 + vSignal * 0.32)
      * uPixelRatio * (720.0 / cameraDepth);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const SIGNAL_FRAGMENT_SHADER = `
  uniform vec3 uCoreColor;
  uniform vec3 uSignalColor;
  varying float vFront;
  varying float vSignal;

  void main() {
    float distanceToCenter = length(gl_PointCoord - vec2(0.5)) * 2.0;
    float halo = 1.0 - smoothstep(0.08, 1.0, distanceToCenter);
    float core = 1.0 - smoothstep(0.0, 0.32, distanceToCenter);
    float depthGain = mix(0.62, 1.0, smoothstep(0.04, 0.96, vFront));
    float alpha = (halo * 0.96 + core * 1.12) * vSignal * depthGain;
    if (alpha < 0.008) discard;
    vec3 color = mix(uSignalColor, uCoreColor, core * 0.76);
    gl_FragColor = vec4(color, min(1.0, alpha));
  }
`;

const RIM_VERTEX_SHADER = `
  varying float vFresnel;

  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vec3 viewNormal = normalize(normalMatrix * normal);
    vec3 viewDirection = normalize(-viewPosition.xyz);
    vFresnel = pow(1.0 - abs(dot(viewNormal, viewDirection)), 5.2);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const RIM_FRAGMENT_SHADER = `
  uniform vec3 uAccentColor;
  uniform float uOpacity;
  varying float vFresnel;

  void main() {
    float alpha = uOpacity * vFresnel;
    gl_FragColor = vec4(uAccentColor, alpha);
  }
`;

function createNodeUniforms(signalGain = 0) {
  return {
    uAccentColor: { value: new Color() },
    uCameraDistance: { value: 720 },
    uCoreColor: { value: new Color() },
    uOpacity: { value: 1 },
    uPixelRatio: { value: 1 },
    uPointSize: { value: 8 },
    uRadius: { value: 188 },
    uSignalColor: { value: new Color() },
    uSignalCycle: { value: 12 },
    uSignalGain: { value: signalGain },
    uTime: { value: 0 },
  };
}

function createEdgeUniforms(opacity, signalGain = 0) {
  return {
    uAccentColor: { value: new Color() },
    uCameraDistance: { value: 720 },
    uCoreColor: { value: new Color() },
    uOpacity: { value: opacity },
    uRadius: { value: 188 },
    uSignalColor: { value: new Color() },
    uSignalCycle: { value: 12 },
    uSignalGain: { value: signalGain },
    uTime: { value: 0 },
  };
}

function createSignalUniforms() {
  return {
    uCameraDistance: { value: 720 },
    uCoreColor: { value: new Color() },
    uPixelRatio: { value: 1 },
    uPointSize: { value: 42 },
    uRadius: { value: 188 },
    uSignalColor: { value: new Color() },
    uSignalCycle: { value: 12 },
    uTime: { value: 0 },
  };
}

function OrbEdges({ topology, uniforms, renderOrder }) {
  return (
    <lineSegments
      frustumCulled={false}
      raycast={() => null}
      renderOrder={renderOrder}
    >
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[topology.edgePositions, 3]}
        />
        <bufferAttribute
          attach="attributes-aPhase"
          args={[topology.edgePhases, 1]}
        />
        <bufferAttribute
          attach="attributes-aEnergy"
          args={[topology.edgeEnergy, 1]}
        />
        <bufferAttribute
          attach="attributes-aSignalStrength"
          args={[topology.edgeSignalStrengths, 1]}
        />
        <bufferAttribute
          attach="attributes-aSignalTime"
          args={[topology.edgeSignalTimes, 1]}
        />
      </bufferGeometry>
      <shaderMaterial
        blending={AdditiveBlending}
        depthTest={false}
        depthWrite={false}
        fragmentShader={EDGE_FRAGMENT_SHADER}
        toneMapped={false}
        transparent
        uniforms={uniforms}
        vertexShader={EDGE_VERTEX_SHADER}
      />
    </lineSegments>
  );
}

export function NeuralOrbScene({
  colors,
  reducedMotion = false,
}) {
  const assemblyRef = useRef(null);
  const innerRef = useRef(null);
  const ambientRef = useRef(null);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const size = useThree((state) => state.size);
  const runtime = useGraphicsRuntimeContext();
  const budget = selectNeuralOrbBudget(runtime?.qualityProfile?.id);
  const topology = useMemo(() => createNeuralOrbTopology(budget), [budget]);
  const ambientSignalDefaults = useMemo(
    () => new Float32Array(topology.ambientScales.length),
    [topology],
  );
  const nodeUniforms = useMemo(() => createNodeUniforms(1), []);
  const ambientUniforms = useMemo(() => createNodeUniforms(0), []);
  const edgeUniforms = useMemo(() => createEdgeUniforms(0.86, 1), []);
  const innerEdgeUniforms = useMemo(() => createEdgeUniforms(0.22, 0), []);
  const signalUniforms = useMemo(createSignalUniforms, []);
  const rimUniforms = useMemo(() => ({
    uAccentColor: { value: new Color() },
    uOpacity: { value: 0.045 },
  }), []);

  useLayoutEffect(() => {
    const uniformGroups = [nodeUniforms, ambientUniforms, edgeUniforms, innerEdgeUniforms];
    uniformGroups.forEach((uniforms) => {
      uniforms.uAccentColor.value.set(colors.accent);
      uniforms.uCoreColor.value.set(colors.core);
      uniforms.uSignalColor.value.set(colors.accentEmphasis);
      uniforms.uSignalCycle.value = topology.signalCycle;
    });
    nodeUniforms.uOpacity.value = 1;
    nodeUniforms.uPointSize.value = 18;
    ambientUniforms.uOpacity.value = 0.22;
    ambientUniforms.uPointSize.value = 3.2;
    signalUniforms.uCoreColor.value.set(colors.core);
    signalUniforms.uSignalColor.value.set(colors.accentEmphasis);
    signalUniforms.uSignalCycle.value = topology.signalCycle;
    rimUniforms.uAccentColor.value.set(colors.accentEmphasis);
    invalidate();
  }, [
    ambientUniforms,
    colors.accent,
    colors.accentEmphasis,
    colors.core,
    edgeUniforms,
    innerEdgeUniforms,
    invalidate,
    nodeUniforms,
    rimUniforms,
    signalUniforms,
    topology.signalCycle,
  ]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const handleVisibility = () => {
      if (document.visibilityState !== "hidden") invalidate();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [invalidate]);

  useFrame((state, delta) => {
    const assembly = assemblyRef.current;
    if (!assembly) return;
    const elapsed = state.clock.elapsedTime;
    const cameraDistance = camera.position.length();
    const cameraZoom = Math.max(0.01, Number(camera.zoom) || 1);
    const frameMinimum = Math.max(1, Math.min(size.width, size.height));
    const responsiveScale = Math.max(
      0.34,
      Math.min(1.08, (0.9 * frameMinimum) / (Math.max(1, size.height) * cameraZoom)),
    );
    const breathingScale = reducedMotion ? 1 : 1 + Math.sin(elapsed * 0.52) * 0.007;
    const effectiveScale = responsiveScale * breathingScale;
    assembly.scale.setScalar(effectiveScale);

    const radius = topology.radius * effectiveScale;
    const timeUniforms = [
      nodeUniforms,
      ambientUniforms,
      edgeUniforms,
      innerEdgeUniforms,
      signalUniforms,
    ];
    timeUniforms.forEach((uniforms) => {
      uniforms.uCameraDistance.value = cameraDistance;
      uniforms.uRadius.value = radius;
      uniforms.uTime.value = elapsed;
    });
    nodeUniforms.uPixelRatio.value = runtime?.effectiveDpr ?? 1;
    ambientUniforms.uPixelRatio.value = runtime?.effectiveDpr ?? 1;
    signalUniforms.uPixelRatio.value = runtime?.effectiveDpr ?? 1;

    if (reducedMotion || (typeof document !== "undefined" && document.visibilityState === "hidden")) {
      return;
    }
    assembly.rotation.y += delta * 0.072;
    assembly.rotation.x = 0.12 + Math.sin(elapsed * 0.19) * 0.045;
    assembly.rotation.z = Math.sin(elapsed * 0.13) * 0.018;
    if (innerRef.current) innerRef.current.rotation.y -= delta * 0.035;
    if (ambientRef.current) ambientRef.current.rotation.y += delta * 0.018;
    invalidate();
  });

  return (
    <group ref={assemblyRef} position={[0, -18, 0]} rotation={[0.12, -0.32, 0]}>
      <group ref={ambientRef}>
        <points
          frustumCulled={false}
          raycast={() => null}
          renderOrder={0}
        >
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[topology.ambientPositions, 3]}
            />
            <bufferAttribute
              attach="attributes-aScale"
              args={[topology.ambientScales, 1]}
            />
            <bufferAttribute
              attach="attributes-aPhase"
              args={[topology.ambientPhases, 1]}
            />
            <bufferAttribute
              attach="attributes-aSignalStrength"
              args={[ambientSignalDefaults, 1]}
            />
            <bufferAttribute
              attach="attributes-aSignalTime"
              args={[ambientSignalDefaults, 1]}
            />
          </bufferGeometry>
          <shaderMaterial
            blending={AdditiveBlending}
            depthTest={false}
            depthWrite={false}
            fragmentShader={NODE_FRAGMENT_SHADER}
            toneMapped={false}
            transparent
            uniforms={ambientUniforms}
            vertexShader={NODE_VERTEX_SHADER}
          />
        </points>
      </group>

      <group ref={innerRef} rotation={[-0.16, 0.44, 0.1]} scale={0.73}>
        <OrbEdges topology={topology} uniforms={innerEdgeUniforms} renderOrder={0.5} />
      </group>

      <mesh
        frustumCulled={false}
        raycast={() => null}
        renderOrder={0.8}
      >
        <sphereGeometry args={[topology.radius * 1.018, 48, 32]} />
        <shaderMaterial
          blending={AdditiveBlending}
          depthTest={false}
          depthWrite={false}
          fragmentShader={RIM_FRAGMENT_SHADER}
          side={FrontSide}
          toneMapped={false}
          transparent
          uniforms={rimUniforms}
          vertexShader={RIM_VERTEX_SHADER}
        />
      </mesh>

      <OrbEdges topology={topology} uniforms={edgeUniforms} renderOrder={1} />

      <points
        frustumCulled={false}
        raycast={() => null}
        renderOrder={1.6}
      >
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[topology.signalPointPositions, 3]}
          />
          <bufferAttribute
            attach="attributes-aTarget"
            args={[topology.signalPointTargets, 3]}
          />
          <bufferAttribute
            attach="attributes-aDuration"
            args={[topology.signalPointDurations, 1]}
          />
          <bufferAttribute
            attach="attributes-aSignalStrength"
            args={[topology.signalPointStrengths, 1]}
          />
          <bufferAttribute
            attach="attributes-aSignalTime"
            args={[topology.signalPointTimes, 1]}
          />
        </bufferGeometry>
        <shaderMaterial
          blending={AdditiveBlending}
          depthTest={false}
          depthWrite={false}
          fragmentShader={SIGNAL_FRAGMENT_SHADER}
          toneMapped={false}
          transparent
          uniforms={signalUniforms}
          vertexShader={SIGNAL_VERTEX_SHADER}
        />
      </points>

      <points
        frustumCulled={false}
        raycast={() => null}
        renderOrder={2}
      >
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[topology.positions, 3]} />
          <bufferAttribute attach="attributes-aScale" args={[topology.nodeScales, 1]} />
          <bufferAttribute attach="attributes-aPhase" args={[topology.nodePhases, 1]} />
          <bufferAttribute
            attach="attributes-aSignalStrength"
            args={[topology.nodeSignalStrengths, 1]}
          />
          <bufferAttribute
            attach="attributes-aSignalTime"
            args={[topology.nodeSignalTimes, 1]}
          />
        </bufferGeometry>
        <shaderMaterial
          blending={AdditiveBlending}
          depthTest={false}
          depthWrite={false}
          fragmentShader={NODE_FRAGMENT_SHADER}
          toneMapped={false}
          transparent
          uniforms={nodeUniforms}
          vertexShader={NODE_VERTEX_SHADER}
        />
      </points>
    </group>
  );
}
