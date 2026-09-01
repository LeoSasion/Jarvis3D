import { useFrame, useThree } from "@react-three/fiber";
import GRAPH_LABEL_FONT from "@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff?url";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  FrontSide,
  InstancedBufferAttribute,
  Matrix4,
  ShaderMaterial,
  Vector2,
  Vector3,
} from "three";
import {
  createGraphAdjacentNodeSet,
  createDeterministicStarField,
  createGraphEdgeView,
  createGraphFocusedEdgeView,
  createGraphLayoutEdgeView,
  createGraphTopologyModel,
} from "./graph-buffer-model.js";
import { GraphCameraNavigation } from "./GraphCameraNavigation.jsx";
import {
  GRAPH_LABEL_DYNAMIC_SLOTS,
  MAX_GRAPH_LABEL_ATLAS_ENTRIES,
  createGraphLabelAtlas,
  ensureGraphLabelFont,
  selectGraphLabelIndices,
} from "./graph-label-atlas.js";
import {
  createGraphPointerQueue,
  createGraphScreenIndex,
  graphScreenPickingPolicy,
  pickGraphScreenNode,
} from "./graph-picking-model.js";
import {
  createGraphOrbMorphModel,
  createGraphPlanarMorphModel,
  easeGraphOrbMorph,
} from "./graph-orb-morph-model.js";
import {
  isGraphSignalLayerActive,
  shouldContinueGraphFrame,
} from "./graph-frame-policy.js";
import { applyGraphRuntimeQuality } from "./graph-render-policy.js";
import { useGraphicsRuntimeContext } from "../runtime/runtime-context.js";

const NODE_MATRIX = new Matrix4();
const NODE_COLOR = new Color();
const EDGE_SOURCE_COLOR = new Color();
const EDGE_TARGET_COLOR = new Color();
const EDGE_ORB_SOURCE_COLOR = new Color();
const EDGE_ORB_TARGET_COLOR = new Color();
const PICK_CENTER = new Vector3();
const PICK_EDGE = new Vector3();
const PICK_RIGHT = new Vector3();
const MAX_LAYOUT_WORKER_RETRIES = 2;
const LAYOUT_WORKER_RETRY_DELAYS = Object.freeze([120, 320]);
const LAYOUT_PROGRESS_WATCHDOG_MS = 3_500;
const GRAPH_MORPH_DURATION_SECONDS = 1.28;
const DIMENSION_MORPH_DURATION_SECONDS = 0.72;
const ENERGY_LINE_QUAD_POSITIONS = new Float32Array([
  0, -1, 0,
  1, -1, 0,
  1, 1, 0,
  0, -1, 0,
  1, 1, 0,
  0, 1, 0,
]);

const ENERGY_POINT_VERTEX_SHADER = `
  attribute vec3 pointColor;
  attribute float pointHierarchy;
  attribute float pointPhase;
  attribute float pointScale;
  uniform float energyTime;
  uniform float pointSize;
  uniform float pointScaleVariation;
  uniform float pulseAmount;
  uniform float pointPulseMotion;
  uniform float pointPulseVisibility;
  uniform float pulseRate;
  varying vec3 pointEnergyColor;
  varying float pointEnergyHierarchy;
  varying float pointPulseEnvelope;
  varying float pointPulse;
  varying float pointPulseWave;

  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    float perspective = clamp(520.0 / max(1.0, -viewPosition.z), 0.68, 1.9);
    float scaleGain = mix(1.0, max(0.45, pointScale), pointScaleVariation);
    float pulseStrength = clamp(pulseAmount, 0.0, 2.0);
    float pulsePhase = energyTime * 1.18 * pulseRate + pointPhase * 0.42;
    pointEnergyColor = pointColor;
    pointEnergyHierarchy = pointHierarchy;
    pointPulseWave = pointPulseMotion > 0.5
      ? 0.5 + 0.5 * sin(pulsePhase)
      : 0.52;
    pointPulse = 1.0
      + sin(pulsePhase)
        * 0.1
        * pulseStrength
        * pointPulseMotion
        * pointPulseVisibility;
    pointPulseEnvelope = 1.0
      + pointPulseVisibility
        * pulseStrength
        * (0.34 + pointPulseWave * 0.16);
    gl_PointSize = pointSize
      * scaleGain
      * pointPulse
      * pointPulseEnvelope
      * perspective;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const ENERGY_POINT_FRAGMENT_SHADER = `
  uniform vec3 energyColor;
  uniform float orbStyle;
  uniform float pointColorVariation;
  uniform float pointCoreEmissionIntensity;
  uniform float pointCoreOpacity;
  uniform float pointCoreVisibility;
  uniform float pointHaloEmissionIntensity;
  uniform float pointHaloOpacity;
  uniform float pointHaloVisibility;
  uniform float pointOpacity;
  uniform float pointPulseVisibility;
  uniform float pulseAmount;
  uniform float whiteCore;
  varying vec3 pointEnergyColor;
  varying float pointEnergyHierarchy;
  varying float pointPulseEnvelope;
  varying float pointPulse;
  varying float pointPulseWave;

  void main() {
    float spriteRadius = length(gl_PointCoord - vec2(0.5)) * 2.0;
    if (spriteRadius > 1.0) discard;
    float radius = spriteRadius * pointPulseEnvelope;
    float originalHalo = pow(max(0.0, 1.0 - radius), 2.15);
    float originalCore = pow(max(0.0, 1.0 - radius), 8.0);
    vec3 originalColor = mix(energyColor, vec3(1.0), originalCore * whiteCore)
      * (0.9 + originalCore * 1.8);
    float originalHaloAlpha = originalHalo
      * 0.62
      * pointHaloOpacity
      * pointHaloVisibility;
    float originalCoreAlpha = originalCore
      * 0.84
      * pointCoreOpacity
      * pointCoreVisibility;
    float originalAlpha = (originalHaloAlpha + originalCoreAlpha)
      * pointOpacity
      * pointPulse;
    float originalCoreMix = originalCoreAlpha
      / max(0.0001, originalHaloAlpha + originalCoreAlpha);
    float originalEmission = mix(
      pointHaloEmissionIntensity,
      pointCoreEmissionIntensity,
      originalCoreMix
    );
    float orbHalo = 1.0 - smoothstep(0.12, 1.0, radius);
    float orbCore = 1.0 - smoothstep(0.0, 0.64, radius);
    float spark = 1.0 - smoothstep(0.0, 0.14, radius);
    float hierarchy = clamp(pointEnergyHierarchy, 0.0, 1.0);
    float hierarchyCore = smoothstep(0.62, 1.0, hierarchy);
    float orbCoreMix = (orbCore * 0.76 + spark * 0.24)
      * whiteCore * mix(0.06, 0.82, hierarchyCore)
      * pointCoreVisibility;
    vec3 orbBaseColor = mix(energyColor, pointEnergyColor, pointColorVariation);
    vec3 orbColor = mix(orbBaseColor, vec3(1.0), orbCoreMix)
      * mix(1.0, 1.26, hierarchy);
    float orbHaloAlpha = orbHalo
      * 0.7
      * pointHaloOpacity
      * pointHaloVisibility;
    float orbCoreAlpha = (orbCore + spark * 0.5)
      * pointCoreOpacity
      * pointCoreVisibility;
    float orbAlpha = (orbHaloAlpha + orbCoreAlpha)
      * pointOpacity
      * pointPulse
      * mix(0.62, 1.16, hierarchy);
    float orbCoreLayerMix = orbCoreAlpha
      / max(0.0001, orbHaloAlpha + orbCoreAlpha);
    float orbEmission = mix(
      pointHaloEmissionIntensity,
      pointCoreEmissionIntensity,
      orbCoreLayerMix
    );
    float baseAlpha = mix(originalAlpha, min(1.0, orbAlpha), orbStyle);
    vec3 baseColor = mix(
      originalColor * originalEmission,
      orbColor * orbEmission,
      orbStyle
    );
    float pulseRingRadius = mix(1.02, 1.42, pointPulseWave);
    float pulseRing = 1.0 - smoothstep(
      0.055,
      0.15,
      abs(radius - pulseRingRadius)
    );
    float pulseStrength = clamp(pulseAmount, 0.0, 2.0);
    float pulseHierarchy = mix(
      0.52,
      1.16,
      clamp(pointEnergyHierarchy, 0.0, 1.0)
    );
    float pulseAlpha = pulseRing
      * pointPulseVisibility
      * pulseStrength
      * pulseHierarchy
      * mix(0.2, 0.34, pointPulseWave);
    vec3 pulseColor = mix(energyColor, pointEnergyColor, pointColorVariation)
      * mix(1.02, 1.34, pointPulseWave)
      * mix(0.92, 1.18, clamp(pointEnergyHierarchy, 0.0, 1.0));
    float pulseMix = pulseAlpha / max(0.0001, baseAlpha + pulseAlpha);
    gl_FragColor = vec4(
      mix(baseColor, pulseColor, pulseMix),
      min(1.0, baseAlpha + pulseAlpha)
    );
  }
`;

const ENERGY_LINE_VERTEX_SHADER = `
  attribute vec3 edgeStart;
  attribute vec3 edgeEnd;
  attribute vec3 edgeColorStart;
  attribute vec3 edgeColorEnd;
  attribute float edgeWidth;
  attribute float edgeEnergy;
  uniform vec2 viewportSize;
  uniform float lineHaloRadiusScale;
  uniform float lineHaloVisibility;
  uniform float lineWidthByStrength;
  uniform float lineWidthScale;
  varying vec3 energyLineColor;
  varying float energyLineCoreBoundary;
  varying float energyLineDistance;
  varying float energyLineProgress;
  varying float energyLineStrength;

  void main() {
    vec4 startClip = projectionMatrix * modelViewMatrix * vec4(edgeStart, 1.0);
    vec4 endClip = projectionMatrix * modelViewMatrix * vec4(edgeEnd, 1.0);
    vec2 safeViewport = max(viewportSize, vec2(1.0));
    vec2 startNdc = startClip.xy / max(0.001, startClip.w);
    vec2 endNdc = endClip.xy / max(0.001, endClip.w);
    vec2 screenDirection = (endNdc - startNdc) * safeViewport;
    float screenLength = max(0.001, length(screenDirection));
    vec2 screenNormal = vec2(-screenDirection.y, screenDirection.x) / screenLength;
    float along = position.x;
    float side = position.y;
    vec4 clipPosition = mix(startClip, endClip, along);
    float strength = clamp(edgeEnergy, 0.0, 1.0);
    float hierarchyWidth = mix(
      1.0,
      max(1.0, edgeWidth / 0.48),
      lineWidthByStrength
    );
    float coreWidthPixels = 0.48 * hierarchyWidth * lineWidthScale;
    float haloStrength = pow(strength, 1.35);
    float haloPixels = (2.4 + haloStrength * 6.8)
      * lineHaloRadiusScale
      * lineHaloVisibility;
    float expandedWidthPixels = coreWidthPixels + haloPixels;
    vec2 offsetNdc = screenNormal
      * side
      * expandedWidthPixels
      * 2.0
      / safeViewport;
    clipPosition.xy += offsetNdc * clipPosition.w;
    gl_Position = clipPosition;
    energyLineColor = mix(edgeColorStart, edgeColorEnd, along);
    energyLineCoreBoundary = clamp(
      coreWidthPixels / max(0.001, expandedWidthPixels),
      0.06,
      0.82
    );
    energyLineDistance = side;
    energyLineProgress = along;
    energyLineStrength = edgeEnergy;
  }
`;

const ENERGY_LINE_FRAGMENT_SHADER = `
  uniform float lineCoreEmissionByStrength;
  uniform float lineCoreEmissionIntensity;
  uniform float lineCoreOpacity;
  uniform float lineCoreVisibility;
  uniform float lineHaloFalloff;
  uniform float lineHaloByStrength;
  uniform vec3 lineHaloColor;
  uniform float lineHaloEmissionIntensity;
  uniform float lineHaloOpacity;
  uniform float lineHaloVisibility;
  uniform float lineMasterOpacity;
  varying vec3 energyLineColor;
  varying float energyLineCoreBoundary;
  varying float energyLineDistance;
  varying float energyLineProgress;
  varying float energyLineStrength;

  void main() {
    float lineDistance = abs(energyLineDistance);
    float coreFeather = max(0.018, energyLineCoreBoundary * 0.3);
    float core = 1.0 - smoothstep(
      max(0.0, energyLineCoreBoundary - coreFeather),
      min(1.0, energyLineCoreBoundary + coreFeather),
      lineDistance
    );
    float haloDistance = clamp(
      (lineDistance - energyLineCoreBoundary)
        / max(0.001, 1.0 - energyLineCoreBoundary),
      0.0,
      1.0
    );
    float halo = pow(max(0.0, 1.0 - haloDistance), lineHaloFalloff)
      * (1.0 - core * 0.68);
    float endpointFade = min(
      smoothstep(0.0, 0.018, energyLineProgress),
      smoothstep(0.0, 0.018, 1.0 - energyLineProgress)
    );
    float strength = clamp(energyLineStrength, 0.0, 1.0);
    float coreGain = smoothstep(0.18, 1.0, strength);
    float coreStrengthAlpha = mix(
      1.0,
      mix(0.1, 1.0, pow(strength, 1.45)),
      lineCoreEmissionByStrength
    );
    float coreAlpha = core
      * coreStrengthAlpha
      * lineCoreOpacity
      * lineCoreVisibility;
    float haloStrengthAlpha = mix(
      1.0,
      mix(0.22, 1.0, pow(strength, 1.3)),
      lineHaloByStrength
    );
    float haloAlpha = halo
      * lineHaloOpacity
      * haloStrengthAlpha
      * lineHaloVisibility;
    float alpha = lineMasterOpacity
      * endpointFade
      * min(1.0, coreAlpha + haloAlpha);
    float haloColorGain = mix(0.98, 1.38, strength);
    float coreColorGain = 1.0 + coreGain * 0.3;
    float coreEmissionGain = mix(
      1.0,
      mix(0.72, 1.28, strength),
      lineCoreEmissionByStrength
    );
    vec3 haloColor = mix(
      lineHaloColor,
      energyLineColor,
      0.1 + strength * 0.12
    )
      * haloColorGain
      * lineHaloEmissionIntensity;
    vec3 coreColor = energyLineColor
      * coreColorGain
      * lineCoreEmissionIntensity
      * coreEmissionGain;
    float coreMix = coreAlpha / max(0.0001, coreAlpha + haloAlpha);
    gl_FragColor = vec4(
      mix(haloColor, coreColor, coreMix),
      alpha
    );
  }
`;

const GRAPH_ORB_RIM_VERTEX_SHADER = `
  varying float rimViewFactor;

  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vec3 viewNormal = normalize(normalMatrix * normal);
    vec3 viewDirection = normalize(-viewPosition.xyz);
    rimViewFactor = clamp(
      1.0 - abs(dot(viewNormal, viewDirection)),
      0.0,
      1.0
    );
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const GRAPH_ORB_RIM_FRAGMENT_SHADER = `
  uniform vec3 rimColor;
  uniform float rimFresnelPower;
  uniform float rimIntensity;
  varying float rimViewFactor;

  void main() {
    float tightRim = pow(rimViewFactor, rimFresnelPower);
    float broadRim = pow(
      rimViewFactor,
      max(1.0, rimFresnelPower * 0.42)
    );
    float rimAlpha = min(
      1.0,
      rimIntensity * (broadRim * 0.055 + tightRim * 0.135)
    );
    float whiteMix = tightRim * min(0.22, rimIntensity * 0.08);
    vec3 energizedRimColor = mix(rimColor, vec3(1.0), whiteMix)
      * (1.08 + tightRim * 0.42);
    gl_FragColor = vec4(energizedRimColor, rimAlpha);
  }
`;

const LABEL_VERTEX_SHADER = `
  attribute vec4 atlasRect;
  attribute vec3 labelTint;
  varying vec2 vAtlasUv;
  varying vec3 vLabelTint;

  void main() {
    vec4 center = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float width = length(instanceMatrix[0].xyz);
    float height = length(instanceMatrix[1].xyz);
    center.xy += position.xy * vec2(width, height);
    vAtlasUv = atlasRect.xy + uv * atlasRect.zw;
    vLabelTint = labelTint;
    gl_Position = projectionMatrix * center;
  }
`;

const LABEL_FRAGMENT_SHADER = `
  uniform sampler2D labelAtlas;
  uniform float labelOpacity;
  varying vec2 vAtlasUv;
  varying vec3 vLabelTint;

  void main() {
    vec4 glyph = texture2D(labelAtlas, vAtlasUv);
    float alpha = glyph.a * labelOpacity;
    if (alpha < 0.025) discard;
    gl_FragColor = vec4(vLabelTint * glyph.rgb, alpha);
  }
`;

function createNodePalette(appearance) {
  return {
    base: new Color(appearance.baseColor),
    muted: new Color("#77736c"),
    hub: new Color(appearance.hubColor),
    selected: new Color(appearance.activeColor),
    group: new Color(appearance.groupColor),
  };
}

function semanticHash(value) {
  let hash = 2_166_136_261;
  for (const character of String(value ?? "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 0xffff_ffff;
}

function isGroupNode(node) {
  return ["folder", "directory", "tag", "moc", "group"].includes(node.kind);
}

function createSolidPointColors(count, color) {
  const values = new Float32Array(Math.max(0, count) * 3);
  const resolved = new Color(color);
  for (let index = 0; index < count; index += 1) resolved.toArray(values, index * 3);
  return values;
}

function resolveMoltenOrangeColor(target, energy, warmCore, palette) {
  const brightnessLift = Math.max(0, (energy - 0.16) / 0.84);
  return target.copy(palette.selected)
    .multiplyScalar(1 + brightnessLift * 0.3)
    .lerp(palette.base, Math.min(0.72, warmCore * 0.72));
}

function createNodeEnergyStyle(model, palette) {
  const colors = new Float32Array(model.nodes.length * 3);
  const hierarchy = new Float32Array(model.nodes.length);
  const scales = new Float32Array(model.nodes.length);
  const energies = new Float32Array(model.nodes.length);
  let maximumDegree = 1;
  let minimumSize = Number.POSITIVE_INFINITY;
  let maximumSize = 0;
  for (let index = 0; index < model.nodes.length; index += 1) {
    maximumDegree = Math.max(maximumDegree, Number(model.degrees[index]) || 0);
    minimumSize = Math.min(minimumSize, Number(model.sizes[index]) || 0);
    maximumSize = Math.max(maximumSize, Number(model.sizes[index]) || 0);
  }
  const sizeRange = Math.max(0.001, maximumSize - minimumSize);
  model.nodes.forEach((node, index) => {
    const degreeScore = Math.sqrt((Number(model.degrees[index]) || 0) / maximumDegree);
    const sizeScore = ((Number(model.sizes[index]) || minimumSize) - minimumSize) / sizeRange;
    const isSource = ["home", "source"].includes(node.kind);
    const isHub = Boolean(model.hubMask[index]);
    const isGroup = isGroupNode(node);
    const semanticBoost = isSource ? 0.22 : isHub ? 0.16 : isGroup ? 0.08 : 0;
    energies[index] = Math.min(
      1,
      0.12 + degreeScore * 0.48 + sizeScore * 0.18 + semanticBoost,
    );
  });
  const resolvedEnergies = model.nodes
    .map((node, index) => (node.resolved === false ? null : energies[index]))
    .filter((value) => value !== null)
    .sort((left, right) => left - right);
  const warmCoreThreshold = resolvedEnergies[
    Math.floor(Math.max(0, resolvedEnergies.length - 1) * 0.88)
  ] ?? 1;
  const maximumEnergy = resolvedEnergies.at(-1) ?? 1;
  const warmCoreRange = Math.max(0.001, maximumEnergy - warmCoreThreshold);

  model.nodes.forEach((node, index) => {
    const energy = energies[index];
    const isSource = ["home", "source"].includes(node.kind);
    const isHub = Boolean(model.hubMask[index]);
    hierarchy[index] = node.resolved === false ? energy * 0.34 : energy;
    scales[index] = 0.54 + energy * 0.72 + (isHub ? 0.18 : 0) + (isSource ? 0.1 : 0);
    const warmCore = node.resolved === false
      ? 0
      : Math.pow(
        Math.max(0, (energy - warmCoreThreshold) / warmCoreRange),
        1.45,
      );
    const color = resolveMoltenOrangeColor(
      new Color(),
      node.resolved === false ? 0.12 : energy,
      warmCore,
      palette,
    );
    color.toArray(colors, index * 3);
  });
  return Object.freeze({ colors, hierarchy, scales });
}

function createEdgeEnergyStyle(model, renderEdges, palette) {
  const sourceColors = new Float32Array(renderEdges.length * 3);
  const targetColors = new Float32Array(renderEdges.length * 3);
  const strengths = new Float32Array(renderEdges.length);
  const widths = new Float32Array(renderEdges.length);
  const scores = new Float32Array(renderEdges.length);
  let maximumDegree = 1;
  for (let index = 0; index < model.nodes.length; index += 1) {
    maximumDegree = Math.max(maximumDegree, Number(model.degrees[index]) || 0);
  }
  renderEdges.forEach((edge, index) => {
    const sourceDegree = Math.sqrt(
      (Number(model.degrees[edge.sourceIndex]) || 0) / maximumDegree,
    );
    const targetDegree = Math.sqrt(
      (Number(model.degrees[edge.targetIndex]) || 0) / maximumDegree,
    );
    const degreeScore = Math.max(sourceDegree, targetDegree) * 0.72
      + Math.min(sourceDegree, targetDegree) * 0.28;
    const weightScore = Math.min(
      1,
      Math.sqrt(Math.max(0.1, Number(edge.weight) || 1)) / 2.2,
    );
    const sourceNode = model.nodes[edge.sourceIndex];
    const targetNode = model.nodes[edge.targetIndex];
    const sourceIdentity = ["home", "source"].includes(sourceNode?.kind);
    const targetIdentity = ["home", "source"].includes(targetNode?.kind);
    const hubBoost = model.hubMask[edge.sourceIndex] || model.hubMask[edge.targetIndex]
      ? 0.14
      : 0;
    const sourceBoost = sourceIdentity || targetIdentity ? 0.08 : 0;
    const semanticBoost = /wiki|embed|contain|parent|tag/u.test(
      String(edge.kind ?? "link").toLowerCase(),
    ) ? 0.045 : 0;
    scores[index] = degreeScore * 0.52
      + weightScore * 0.24
      + hubBoost
      + sourceBoost
      + semanticBoost;
  });

  const orderedScores = Array.from(scores).sort((left, right) => left - right);
  const minimumScore = orderedScores[0] ?? 0;
  const maximumScore = orderedScores.at(-1) ?? 1;
  const scoreRange = Math.max(0.001, maximumScore - minimumScore);
  const warmCoreThreshold = orderedScores[
    Math.floor(Math.max(0, orderedScores.length - 1) * 0.88)
  ] ?? maximumScore;
  const warmCoreRange = Math.max(0.001, maximumScore - warmCoreThreshold);

  renderEdges.forEach((edge, index) => {
    const normalizedScore = Math.max(0, (scores[index] - minimumScore) / scoreRange);
    const strength = 0.1 + Math.pow(normalizedScore, 0.82) * 0.9;
    const sourceDegree = Math.sqrt(
      (Number(model.degrees[edge.sourceIndex]) || 0) / maximumDegree,
    );
    const targetDegree = Math.sqrt(
      (Number(model.degrees[edge.targetIndex]) || 0) / maximumDegree,
    );
    const sourceEnergy = Math.min(1, strength * 0.88 + sourceDegree * 0.12);
    const targetEnergy = Math.min(1, strength * 0.88 + targetDegree * 0.12);
    const warmCore = Math.pow(
      Math.max(0, (scores[index] - warmCoreThreshold) / warmCoreRange),
      1.4,
    );
    strengths[index] = strength;
    widths[index] = 0.48 + Math.pow(strength, 1.55) * 0.88;
    resolveMoltenOrangeColor(
      EDGE_ORB_SOURCE_COLOR,
      sourceEnergy,
      warmCore,
      palette,
    ).toArray(sourceColors, index * 3);
    resolveMoltenOrangeColor(
      EDGE_ORB_TARGET_COLOR,
      targetEnergy,
      warmCore,
      palette,
    ).toArray(targetColors, index * 3);
  });

  return Object.freeze({ sourceColors, strengths, targetColors, widths });
}

function resolveNodeColor(
  node,
  index,
  { adjacent, hovered, selected },
  hubMask,
  palette,
) {
  if (selected) return palette.selected;
  if (hovered) return NODE_COLOR.copy(palette.selected).lerp(palette.hub, 0.18);
  if (!node.resolved) return palette.muted;
  let color;
  if (["home", "source"].includes(node.kind) || hubMask[index]) color = palette.hub;
  else if (isGroupNode(node)) color = palette.group;
  else {
    color = palette.base;
    const semanticKey = node.group || node.tags?.[0];
    if (semanticKey) {
      color = NODE_COLOR.copy(palette.base).lerp(
        palette.group,
        0.12 + semanticHash(semanticKey) * 0.18,
      );
    }
  }
  return adjacent ? NODE_COLOR.copy(color).lerp(palette.selected, 0.34) : color;
}

function resolveEdgeColors(edge, highlighted, palette, edgeColor) {
  const kind = String(edge.kind ?? "link").toLowerCase();
  let semantic = edgeColor;
  if (/tag|hashtag/u.test(kind)) semantic = palette.group;
  else if (/contain|folder|parent/u.test(kind)) {
    semantic = EDGE_SOURCE_COLOR.copy(edgeColor).lerp(palette.group, 0.52);
  } else if (/wiki|embed/u.test(kind)) {
    semantic = EDGE_SOURCE_COLOR.copy(edgeColor).lerp(palette.hub, 0.28);
  }
  const weightGain = Math.min(1.32, 0.72 + Math.sqrt(Math.max(0.1, edge.weight || 1)) * 0.16);
  if (highlighted) {
    EDGE_SOURCE_COLOR.copy(semantic).lerp(palette.selected, 0.72).multiplyScalar(weightGain);
    EDGE_TARGET_COLOR.copy(palette.selected).lerp(semantic, 0.16).multiplyScalar(weightGain * 1.08);
  } else {
    EDGE_SOURCE_COLOR.copy(semantic).multiplyScalar(weightGain * 0.72);
    EDGE_TARGET_COLOR.copy(semantic).lerp(palette.hub, 0.14).multiplyScalar(weightGain);
  }
  return [EDGE_SOURCE_COLOR, EDGE_TARGET_COLOR];
}

function StarField({ color, count }) {
  const positions = useMemo(() => createDeterministicStarField(count), [count]);
  if (count <= 0) return null;
  return (
    <points raycast={() => null} renderOrder={0}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        blending={AdditiveBlending}
        color={color}
        depthWrite={false}
        opacity={0.18}
        size={0.72}
        sizeAttenuation={false}
        transparent
        toneMapped={false}
      />
    </points>
  );
}

function createOrbAmbientField(count, radius, seed) {
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const scales = new Float32Array(count);
  const hierarchy = new Float32Array(count);
  let state = seed >>> 0;
  const random = () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
  for (let index = 0; index < count; index += 1) {
    const azimuth = random() * Math.PI * 2;
    const vertical = random() * 2 - 1;
    const ring = Math.sqrt(Math.max(0, 1 - vertical * vertical));
    const distance = radius * (1.18 + (random() ** 0.72) * 1.12);
    const offset = index * 3;
    positions[offset] = Math.cos(azimuth) * ring * distance;
    positions[offset + 1] = vertical * distance;
    positions[offset + 2] = Math.sin(azimuth) * ring * distance * 0.72;
    phases[index] = random() * Math.PI * 2;
    const scaleEnergy = random() ** 2.1;
    scales[index] = 0.68 + scaleEnergy * 2.12;
    hierarchy[index] = 0.26 + Math.pow(scaleEnergy, 0.6) * 0.72;
  }
  return Object.freeze({ hierarchy, phases, positions, scales });
}

function createLayoutKey(layout) {
  return [
    layout.repulsion,
    layout.linkDistance,
    layout.linkStrength,
    layout.collision,
    layout.center,
    layout.edgeBudget,
    layout.tickBudget,
    layout.nodeScale,
    layout.hubScale,
  ].map((value) => Number(value).toFixed(3)).join(":");
}

function useCoarsePointer() {
  const [coarse, setCoarse] = useState(
    () => typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches,
  );
  useEffect(() => {
    if (typeof matchMedia === "undefined") return undefined;
    const query = matchMedia("(pointer: coarse)");
    const update = () => setCoarse(query.matches);
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return coarse;
}

function createLabelMaterial(texture, opacity) {
  return new ShaderMaterial({
    depthTest: true,
    depthWrite: false,
    fragmentShader: LABEL_FRAGMENT_SHADER,
    transparent: true,
    toneMapped: false,
    uniforms: {
      labelAtlas: { value: texture },
      labelOpacity: { value: opacity },
    },
    vertexShader: LABEL_VERTEX_SHADER,
  });
}

function createEnergyPointMaterial(color, pointSize, pointOpacity, whiteCore = 1) {
  return new ShaderMaterial({
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    fragmentShader: ENERGY_POINT_FRAGMENT_SHADER,
    transparent: true,
    toneMapped: false,
    uniforms: {
      energyColor: { value: new Color(color) },
      energyTime: { value: 0 },
      orbStyle: { value: 0 },
      pointColorVariation: { value: 0 },
      pointCoreEmissionIntensity: { value: 1 },
      pointCoreOpacity: { value: 1 },
      pointCoreVisibility: { value: 1 },
      pointHaloEmissionIntensity: { value: 1 },
      pointHaloOpacity: { value: 1 },
      pointHaloVisibility: { value: 1 },
      pointOpacity: { value: pointOpacity },
      pointSize: { value: pointSize },
      pointScaleVariation: { value: 0 },
      pointPulseMotion: { value: 1 },
      pointPulseVisibility: { value: 0 },
      pulseAmount: { value: 0 },
      pulseRate: { value: 1 },
      whiteCore: { value: whiteCore },
    },
    vertexShader: ENERGY_POINT_VERTEX_SHADER,
  });
}

function cameraMatricesChanged(camera, previous) {
  camera.updateMatrixWorld();
  const projection = camera.projectionMatrix.elements;
  const view = camera.matrixWorldInverse.elements;
  let changed = previous.length !== projection.length + view.length;
  for (let index = 0; index < projection.length; index += 1) {
    if (Math.abs((previous[index] ?? Infinity) - projection[index]) > 0.000001) changed = true;
    previous[index] = projection[index];
  }
  for (let index = 0; index < view.length; index += 1) {
    const targetIndex = projection.length + index;
    if (Math.abs((previous[targetIndex] ?? Infinity) - view[index]) > 0.000001) changed = true;
    previous[targetIndex] = view[index];
  }
  return changed;
}

function createNodeScreenIndex({
  camera,
  coarsePointer,
  dimension,
  height,
  model,
  nodeScale,
  hubScale,
  positions,
  width,
}) {
  const entries = [];
  const minimumRadius = coarsePointer
    ? graphScreenPickingPolicy.coarseMinimumRadius
    : graphScreenPickingPolicy.fineMinimumRadius;
  const cameraElements = camera.matrixWorld.elements;
  PICK_RIGHT.set(cameraElements[0], cameraElements[1], cameraElements[2]).normalize();

  model.nodes.forEach((_, nodeIndex) => {
    const offset = nodeIndex * 3;
    const z = dimension === 3 ? positions[offset + 2] : 0;
    const worldRadius = model.sizes[nodeIndex]
      * nodeScale
      * (model.hubMask[nodeIndex] ? hubScale : 1);
    PICK_CENTER.set(positions[offset], positions[offset + 1], z);
    PICK_EDGE.copy(PICK_CENTER).addScaledVector(PICK_RIGHT, worldRadius);
    PICK_CENTER.project(camera);
    PICK_EDGE.project(camera);
    if (PICK_CENTER.z < -1 || PICK_CENTER.z > 1) return;
    const x = (PICK_CENTER.x * 0.5 + 0.5) * width;
    const y = (-PICK_CENTER.y * 0.5 + 0.5) * height;
    const radius = Math.min(
      graphScreenPickingPolicy.maximumRadius,
      Math.max(minimumRadius, Math.hypot(
        (PICK_EDGE.x - PICK_CENTER.x) * width * 0.5,
        (PICK_EDGE.y - PICK_CENTER.y) * height * 0.5,
      )),
    );
    entries.push({ depth: PICK_CENTER.z, nodeIndex, radius, x, y });
  });

  return createGraphScreenIndex(entries, {
    cellSize: graphScreenPickingPolicy.cellSize,
    height,
    width,
  });
}

export function GraphScene({
  cameraCommand = null,
  graph,
  dimension = 2,
  hoveredNodeId = null,
  interactive = false,
  renderPlan,
  selectedNodeId = null,
  onNodeHover,
  onNodeSelect,
  onLayoutState,
  presentation = "graph",
  reducedMotion = false,
  zoom = 1,
}) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const viewportSize = useThree((state) => state.size);
  const runtime = useGraphicsRuntimeContext();
  const coarsePointer = useCoarsePointer();
  const scenePlan = useMemo(
    () => applyGraphRuntimeQuality(renderPlan, runtime?.qualityProfile, graph),
    [graph, renderPlan, runtime?.qualityProfile],
  );
  const profile3d = scenePlan.profiles["3d"];
  const profile3dRef = useRef(profile3d);
  profile3dRef.current = profile3d;
  const fxRevisionKey = JSON.stringify(profile3d);
  const edgeBudget = scenePlan.edges.count;
  const model = useMemo(
    () => createGraphTopologyModel(graph, {
      dimension,
      labelBudget: MAX_GRAPH_LABEL_ATLAS_ENTRIES,
    }),
    [dimension, graph],
  );
  const renderEdges = useMemo(
    () => createGraphEdgeView(model, edgeBudget),
    [edgeBudget, model],
  );
  const edgeCapacity = renderEdges.length;
  const morphSeed = Number.parseInt(model.topologyKey, 36) || 0x4a415256;
  const shellEdgeCount = Math.min(
    768,
    Math.max(edgeCapacity, Math.round(model.nodes.length * 3)),
  );
  const orbMorphModel = useMemo(
    () => createGraphOrbMorphModel(model.nodes, edgeCapacity, {
      radius: 188,
      seed: morphSeed,
      shellEdgeCount,
    }),
    [edgeCapacity, model.nodes, morphSeed, shellEdgeCount],
  );
  const planarMorphModel = useMemo(
    () => createGraphPlanarMorphModel(model.nodes, edgeCapacity, {
      radius: 220,
      seed: morphSeed ^ 0x32444a56,
      shellEdgeCount,
    }),
    [edgeCapacity, model.nodes, morphSeed, shellEdgeCount],
  );
  const presentationTarget = presentation === "graph" ? 1 : 0;
  const presentationTargetRef = useRef(presentationTarget);
  presentationTargetRef.current = presentationTarget;
  const dimensionTarget = dimension === 3 ? 1 : 0;
  const extraShellEdgeCount = Math.max(
    0,
    orbMorphModel.shellEdgePairs.length / 2 - edgeCapacity,
  );
  const focusedEdgeBudget = Math.min(
    model.layoutEdges.length,
    Math.min(1_024, Math.max(64, Math.ceil(edgeBudget * 0.125))),
  );
  const focusedEdges = useMemo(
    () => createGraphFocusedEdgeView(
      model,
      focusedEdgeBudget,
      selectedNodeId,
      hoveredNodeId,
    ),
    [focusedEdgeBudget, hoveredNodeId, model, selectedNodeId],
  );
  const layoutKey = createLayoutKey(scenePlan.layout);
  const layoutSettings = useMemo(() => ({ ...scenePlan.layout }), [layoutKey]);
  const layoutEdges = useMemo(
    () => createGraphLayoutEdgeView(model, layoutSettings.edgeBudget),
    [layoutSettings.edgeBudget, model],
  );
  const revision = [
    graph.source?.revision || graph.source?.name || "graph",
    model.topologyKey,
    dimension,
    layoutKey,
  ].join(":");
  const palette = useMemo(
    () => createNodePalette(scenePlan.nodes),
    [
      scenePlan.nodes.baseColor,
      scenePlan.nodes.groupColor,
      scenePlan.nodes.hubColor,
      scenePlan.nodes.activeColor,
    ],
  );
  const edgeBaseColor = useMemo(
    () => new Color(scenePlan.edges.color),
    [scenePlan.edges.color],
  );
  const orbShellColor = useMemo(
    () => new Color(scenePlan.nodes.activeColor),
    [scenePlan.nodes.activeColor],
  );
  const adjacentNodeIds = useMemo(
    () => createGraphAdjacentNodeSet(model, selectedNodeId, hoveredNodeId),
    [hoveredNodeId, model, selectedNodeId],
  );
  const colorKey = [
    selectedNodeId ?? "",
    hoveredNodeId ?? "",
    scenePlan.nodes.baseColor,
    scenePlan.nodes.hubColor,
    scenePlan.nodes.activeColor,
    scenePlan.nodes.groupColor,
    scenePlan.edges.color,
  ].join(":");
  const nodeMeshRef = useRef(null);
  const nodeHaloMeshRef = useRef(null);
  const nodePointPositionAttributeRef = useRef(null);
  const edgePositionAttributeRef = useRef(null);
  const edgeColorAttributeRef = useRef(null);
  const edgeMaterialRef = useRef(null);
  const energyLineObjectRef = useRef(null);
  const energyLineStartAttributeRef = useRef(null);
  const energyLineEndAttributeRef = useRef(null);
  const shellEdgeObjectRef = useRef(null);
  const innerShellEdgeObjectRef = useRef(null);
  const shellEdgePositionAttributeRef = useRef(null);
  const innerShellEdgePositionAttributeRef = useRef(null);
  const shellEdgeMaterialRef = useRef(null);
  const innerShellEdgeMaterialRef = useRef(null);
  const orbAmbientRef = useRef(null);
  const orbRimRef = useRef(null);
  const focusedEdgeGeometryRef = useRef(null);
  const focusedEdgePositionAttributeRef = useRef(null);
  const signalGeometryRef = useRef(null);
  const signalPositionAttributeRef = useRef(null);
  const labelMeshRef = useRef(null);
  const labelRectAttributeRef = useRef(null);
  const labelColorAttributeRef = useRef(null);
  const graphPositionsRef = useRef(model.initialPositions);
  const displayPositions = useMemo(
    () => new Float32Array(model.nodes.length * 3),
    [model.nodes.length],
  );
  const orbFramePositions = useMemo(
    () => new Float32Array(model.nodes.length * 3),
    [model.nodes.length],
  );
  const planarFramePositions = useMemo(
    () => new Float32Array(model.nodes.length * 3),
    [model.nodes.length],
  );
  const idleFramePositions = useMemo(
    () => new Float32Array(model.nodes.length * 3),
    [model.nodes.length],
  );
  const graphFramePositions = useMemo(
    () => new Float32Array(model.nodes.length * 3),
    [model.nodes.length],
  );
  const positionsRef = useRef(displayPositions);
  const morphProgressRef = useRef(presentationTarget);
  const dimensionProgressRef = useRef(dimensionTarget);
  const orbAngleRef = useRef(0);
  const lastElapsedRef = useRef(0);
  const workerRef = useRef(null);
  const ensureWorkerRef = useRef(null);
  const postLayoutRequestRef = useRef(null);
  const failWorkerRef = useRef(null);
  const cancelWatchdogRef = useRef(null);
  const layoutRequestRef = useRef(null);
  const activeRevisionRef = useRef(revision);
  const onLayoutStateRef = useRef(onLayoutState);
  onLayoutStateRef.current = onLayoutState;
  const pointerQueueRef = useRef(createGraphPointerQueue());
  const pointerInteractionRef = useRef({ down: null });
  const pointerCallbacksRef = useRef({ onNodeHover, onNodeSelect });
  pointerCallbacksRef.current = { onNodeHover, onNodeSelect };
  const lastPickedNodeIdRef = useRef(hoveredNodeId);
  const pickingCacheRef = useRef({
    cameraMatrices: new Float32Array(32),
    coarsePointer: null,
    height: 0,
    hubScale: 0,
    index: null,
    nodeScale: 0,
    positions: null,
    width: 0,
  });
  const [documentVisible, setDocumentVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  const documentVisibleRef = useRef(documentVisible);
  documentVisibleRef.current = documentVisible;
  const edgePositions = useMemo(
    () => new Float32Array(edgeCapacity * 6),
    [edgeCapacity],
  );
  const edgeColors = useMemo(
    () => new Float32Array(edgeCapacity * 6),
    [edgeCapacity],
  );
  const energyLineStarts = useMemo(
    () => new Float32Array(edgeCapacity * 3),
    [edgeCapacity],
  );
  const energyLineEnds = useMemo(
    () => new Float32Array(edgeCapacity * 3),
    [edgeCapacity],
  );
  const extraShellEdgePositions = useMemo(
    () => new Float32Array(extraShellEdgeCount * 6),
    [extraShellEdgeCount],
  );
  const focusedEdgePositions = useMemo(
    () => new Float32Array(focusedEdgeBudget * 6),
    [focusedEdgeBudget],
  );
  const signalPositions = useMemo(
    () => new Float32Array(orbMorphModel.signalEdgeIndices.length * 3),
    [orbMorphModel.signalEdgeIndices.length],
  );
  const signalPointScales = useMemo(
    () => new Float32Array(signalPositions.length / 3).fill(1),
    [signalPositions.length],
  );
  const signalPointPhases = useMemo(
    () => new Float32Array(signalPositions.length / 3),
    [signalPositions.length],
  );
  const signalPointColors = useMemo(
    () => createSolidPointColors(
      signalPositions.length / 3,
      scenePlan.nodes.activeColor,
    ),
    [scenePlan.nodes.activeColor, signalPositions.length],
  );
  const signalPointHierarchy = useMemo(
    () => new Float32Array(signalPositions.length / 3).fill(1),
    [signalPositions.length],
  );
  const orbAmbientCount = runtime?.qualityProfile?.id === "high"
    ? 64
    : runtime?.qualityProfile?.id === "low" ? 32 : 48;
  const orbAmbientField = useMemo(
    () => createOrbAmbientField(orbAmbientCount, orbMorphModel.radius, morphSeed ^ 0x4f5242),
    [morphSeed, orbAmbientCount, orbMorphModel.radius],
  );
  const orbAmbientColors = useMemo(
    () => createSolidPointColors(orbAmbientCount, scenePlan.nodes.activeColor),
    [orbAmbientCount, scenePlan.nodes.activeColor],
  );
  const orbAmbientHierarchy = orbAmbientField.hierarchy;
  const nodeEnergyStyle = useMemo(
    () => createNodeEnergyStyle(model, palette),
    [model, palette],
  );
  const edgeEnergyStyle = useMemo(
    () => createEdgeEnergyStyle(model, renderEdges, palette),
    [model, palette, renderEdges],
  );
  const relationHaloQualityScale = runtime?.qualityProfile?.id === "high"
    ? 1.12
    : runtime?.qualityProfile?.id === "low" ? 0.88 : 1;
  const energyLineMaterial = useMemo(() => new ShaderMaterial({
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    fragmentShader: ENERGY_LINE_FRAGMENT_SHADER,
    side: DoubleSide,
    toneMapped: false,
    transparent: true,
    uniforms: {
      lineCoreEmissionByStrength: { value: 1 },
      lineCoreEmissionIntensity: { value: 1 },
      lineCoreOpacity: { value: 0.76 },
      lineCoreVisibility: { value: 1 },
      lineHaloRadiusScale: { value: 1 },
      lineHaloFalloff: { value: 1.65 },
      lineHaloByStrength: { value: 1 },
      lineHaloColor: { value: new Color(scenePlan.nodes.activeColor) },
      lineHaloEmissionIntensity: { value: 1 },
      lineHaloOpacity: { value: 0.46 },
      lineHaloVisibility: { value: 1 },
      lineMasterOpacity: { value: 0 },
      lineWidthByStrength: { value: 1 },
      lineWidthScale: { value: 1 },
      viewportSize: { value: new Vector2(1, 1) },
    },
    vertexShader: ENERGY_LINE_VERTEX_SHADER,
  }), [scenePlan.nodes.activeColor]);
  const energyLineUniforms = energyLineMaterial.uniforms;
  const nodeEnergyMaterial = useMemo(
    () => createEnergyPointMaterial(
      scenePlan.nodes.activeColor,
      dimension === 3 ? 14.5 : 15.4,
      0.84,
      1,
    ),
    [dimension, scenePlan.nodes.activeColor],
  );
  const signalEnergyMaterial = useMemo(
    () => createEnergyPointMaterial(
      scenePlan.nodes.activeColor,
      dimension === 3 ? 16.5 : 9.5,
      0.96,
      0.86,
    ),
    [dimension, scenePlan.nodes.activeColor],
  );
  const ambientEnergyMaterial = useMemo(
    () => createEnergyPointMaterial(
      scenePlan.nodes.activeColor,
      6.8,
      0.24,
      0.72,
    ),
    [scenePlan.nodes.activeColor],
  );
  const orbRimMaterial = useMemo(() => new ShaderMaterial({
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    fragmentShader: GRAPH_ORB_RIM_FRAGMENT_SHADER,
    side: FrontSide,
    toneMapped: false,
    transparent: true,
    uniforms: {
      rimColor: { value: new Color(scenePlan.nodes.activeColor) },
      rimFresnelPower: { value: 5.2 },
      rimIntensity: { value: 0 },
    },
    vertexShader: GRAPH_ORB_RIM_VERTEX_SHADER,
  }), [scenePlan.nodes.activeColor]);
  const orbRimUniforms = orbRimMaterial.uniforms;
  const instanceColorAttribute = useMemo(
    () => new InstancedBufferAttribute(
      new Float32Array(model.nodes.length * 3).fill(1),
      3,
    ),
    [model.nodes.length],
  );

  const labelBaseIndices = useMemo(() => model.labelIndices.slice(
    0,
    Math.min(
      Math.max(0, scenePlan.labels.count),
      MAX_GRAPH_LABEL_ATLAS_ENTRIES - GRAPH_LABEL_DYNAMIC_SLOTS,
    ),
  ), [model.labelIndices, scenePlan.labels.count]);
  const labelAtlas = useMemo(() => {
    if (typeof document === "undefined") return null;
    return createGraphLabelAtlas([
      ...labelBaseIndices.map((nodeIndex) => model.nodes[nodeIndex]?.title),
      "",
      "",
    ]);
  }, [labelBaseIndices, model.nodes]);
  const labelSlotCount = labelAtlas?.layout.count ?? 0;
  const labelNodeIndicesRef = useRef(new Int32Array(0));
  const labelRectAttribute = useMemo(() => new InstancedBufferAttribute(
    new Float32Array(labelSlotCount * 4),
    4,
  ), [labelSlotCount]);
  const labelColorAttribute = useMemo(() => new InstancedBufferAttribute(
    new Float32Array(labelSlotCount * 3).fill(1),
    3,
  ), [labelSlotCount]);
  const labelMaterial = useMemo(
    () => (labelAtlas ? createLabelMaterial(labelAtlas.texture, scenePlan.labels.opacity) : null),
    [labelAtlas, scenePlan.labels.opacity],
  );
  const lastVisibleLabelCountRef = useRef(-1);

  useEffect(() => {
    lastPickedNodeIdRef.current = hoveredNodeId;
  }, [hoveredNodeId]);

  const getNodeColor = useCallback((nodeIndex) => {
    const node = model.nodes[nodeIndex];
    return resolveNodeColor(node, nodeIndex, {
      adjacent: adjacentNodeIds.has(node.id),
      hovered: node.id === hoveredNodeId,
      selected: node.id === selectedNodeId,
    }, model.hubMask, palette);
  }, [adjacentNodeIds, hoveredNodeId, model.hubMask, model.nodes, palette, selectedNodeId]);

  const updateNodeMatrices = useCallback((positions, presentationProgress = 1) => {
    const mesh = nodeMeshRef.current;
    const haloMesh = nodeHaloMeshRef.current;
    if (!mesh && !haloMesh) return;
    const fx3d = profile3dRef.current;
    const progress = presentationProgress;
    const dimensionProgress = easeGraphOrbMorph(dimensionProgressRef.current);
    const orbHierarchyWeight = (1 - progress) * dimensionProgress;
    model.nodes.forEach((_, index) => {
      const offset = index * 3;
      const hierarchy = nodeEnergyStyle.hierarchy[index] ?? 0.5;
      const hubPresence = Math.min(1, progress + orbHierarchyWeight * 0.62);
      const hubMultiplier = model.hubMask[index]
        ? 1 + (scenePlan.nodes.hubScale - 1) * hubPresence
        : 1;
      const orbScale = orbMorphModel.scales[index] ?? 1;
      const planarScale = planarMorphModel.scales[index] ?? 1;
      const idleScale = planarScale + (orbScale - planarScale) * dimensionProgress;
      const presentationScale = idleScale + (1 - idleScale) * progress;
      const idlePointScale = 0.7 - dimensionProgress * 0.08;
      const energyPointScale = idlePointScale + progress * (1 - idlePointScale);
      const hierarchyScale = 1
        + orbHierarchyWeight
          * (hierarchy - 0.48)
          * 0.52
          * fx3d.node.size.byImportance;
      const masterScale = 1
        + (fx3d.node.master.scale - 1) * orbHierarchyWeight;
      const size = model.sizes[index]
        * scenePlan.nodes.scale
        * hubMultiplier
        * presentationScale
        * energyPointScale
        * hierarchyScale
        * masterScale;
      NODE_MATRIX.makeScale(size, size, dimension === 3 ? size : 1);
      NODE_MATRIX.setPosition(
        positions[offset],
        positions[offset + 1],
        positions[offset + 2],
      );
      mesh?.setMatrixAt(index, NODE_MATRIX);
      if (haloMesh) {
        const baseHaloScale = dimension === 3 ? 1.52 : 1.74;
        const haloScale = baseHaloScale
          * (1 + (fx3d.node.halo.radiusScale - 1) * orbHierarchyWeight);
        NODE_MATRIX.makeScale(
          size * haloScale,
          size * haloScale,
          dimension === 3 ? size * haloScale : 1,
        );
        NODE_MATRIX.setPosition(
          positions[offset],
          positions[offset + 1],
          positions[offset + 2],
        );
        haloMesh.setMatrixAt(index, NODE_MATRIX);
      }
    });
    if (mesh) mesh.instanceMatrix.needsUpdate = true;
    if (haloMesh) haloMesh.instanceMatrix.needsUpdate = true;
  }, [
    dimension,
    model,
    nodeEnergyStyle.hierarchy,
    orbMorphModel.scales,
    planarMorphModel.scales,
    scenePlan.nodes.hubScale,
    scenePlan.nodes.scale,
  ]);

  const updateNodeColors = useCallback(() => {
    const mesh = nodeMeshRef.current;
    if (!mesh) return;
    model.nodes.forEach((_, index) => mesh.setColorAt(index, getNodeColor(index)));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [getNodeColor, model.nodes]);

  const updateEdges = useCallback((positions, graphPositions, idlePositions, progress) => {
    const useIdleShell = progress < 0.999;
    const dimensionProgress = easeGraphOrbMorph(dimensionProgressRef.current);
    const shellEdgePairs = dimensionProgress >= 0.5
      ? orbMorphModel.shellEdgePairs
      : planarMorphModel.shellEdgePairs;
    renderEdges.forEach((edge, index) => {
      const sourceOffset = edge.sourceIndex * 3;
      const targetOffset = edge.targetIndex * 3;
      const edgeOffset = index * 6;
      if (useIdleShell) {
        const shellSource = shellEdgePairs[index * 2] ?? edge.sourceIndex;
        const shellTarget = shellEdgePairs[index * 2 + 1] ?? edge.targetIndex;
        const shellSourceOffset = shellSource * 3;
        const shellTargetOffset = shellTarget * 3;
        for (let axis = 0; axis < 3; axis += 1) {
          edgePositions[edgeOffset + axis] = idlePositions[shellSourceOffset + axis]
            + (graphPositions[sourceOffset + axis] - idlePositions[shellSourceOffset + axis])
              * progress;
          edgePositions[edgeOffset + 3 + axis] = idlePositions[shellTargetOffset + axis]
            + (graphPositions[targetOffset + axis] - idlePositions[shellTargetOffset + axis])
              * progress;
        }
      } else {
        edgePositions[edgeOffset] = positions[sourceOffset];
        edgePositions[edgeOffset + 1] = positions[sourceOffset + 1];
        edgePositions[edgeOffset + 2] = dimension === 3 ? positions[sourceOffset + 2] : -0.5;
        edgePositions[edgeOffset + 3] = positions[targetOffset];
        edgePositions[edgeOffset + 4] = positions[targetOffset + 1];
        edgePositions[edgeOffset + 5] = dimension === 3 ? positions[targetOffset + 2] : -0.5;
      }
      const energyOffset = index * 3;
      for (let axis = 0; axis < 3; axis += 1) {
        energyLineStarts[energyOffset + axis] = edgePositions[edgeOffset + axis];
        energyLineEnds[energyOffset + axis] = edgePositions[edgeOffset + 3 + axis];
      }
      const [sourceColor, targetColor] = resolveEdgeColors(
        edge,
        false,
        palette,
        edgeBaseColor,
      );
      const idleWeight = 1 - progress;
      const orbLineWeight = idleWeight * dimensionProgress;
      const planarCoreGain = idleWeight * (1 - dimensionProgress) * 0.14;
      const energyColorGain = 0.34 + idleWeight * (dimension === 3 ? 0.44 : 0.36);
      sourceColor.lerp(palette.selected, energyColorGain);
      targetColor.lerp(palette.selected, energyColorGain * 0.86);
      if (orbLineWeight > 0.001) {
        EDGE_ORB_SOURCE_COLOR.fromArray(edgeEnergyStyle.sourceColors, energyOffset);
        EDGE_ORB_TARGET_COLOR.fromArray(edgeEnergyStyle.targetColors, energyOffset);
        sourceColor.lerp(EDGE_ORB_SOURCE_COLOR, orbLineWeight);
        targetColor.lerp(EDGE_ORB_TARGET_COLOR, orbLineWeight);
      } else {
        sourceColor.lerp(palette.base, planarCoreGain)
          .multiplyScalar(1.14 + energyColorGain * 0.34);
        targetColor.lerp(palette.base, planarCoreGain * 0.74)
          .multiplyScalar(1.14 + energyColorGain * 0.3);
      }
      sourceColor.toArray(edgeColors, edgeOffset);
      targetColor.toArray(edgeColors, edgeOffset + 3);
    });
    if (edgePositionAttributeRef.current) edgePositionAttributeRef.current.needsUpdate = true;
    if (edgeColorAttributeRef.current) edgeColorAttributeRef.current.needsUpdate = true;
    if (energyLineStartAttributeRef.current) {
      energyLineStartAttributeRef.current.needsUpdate = true;
    }
    if (energyLineEndAttributeRef.current) {
      energyLineEndAttributeRef.current.needsUpdate = true;
    }
  }, [
    dimension,
    edgeBaseColor,
    edgeColors,
    edgeEnergyStyle.sourceColors,
    edgeEnergyStyle.targetColors,
    edgePositions,
    energyLineEnds,
    energyLineStarts,
    orbMorphModel.shellEdgePairs,
    palette,
    planarMorphModel.shellEdgePairs,
    renderEdges,
  ]);

  const updateExtraShellEdges = useCallback((idlePositions, progress) => {
    const fx3d = profile3dRef.current;
    const dimensionProgress = easeGraphOrbMorph(dimensionProgressRef.current);
    const shellEdgePairs = dimensionProgress >= 0.5
      ? orbMorphModel.shellEdgePairs
      : planarMorphModel.shellEdgePairs;
    const dimensionVisibility = 0.32 + Math.abs(dimensionProgress - 0.5) * 1.36;
    for (let index = 0; index < extraShellEdgeCount; index += 1) {
      const pairOffset = (edgeCapacity + index) * 2;
      const sourceOffset = shellEdgePairs[pairOffset] * 3;
      const targetOffset = shellEdgePairs[pairOffset + 1] * 3;
      const edgeOffset = index * 6;
      extraShellEdgePositions.set(
        idlePositions.subarray(sourceOffset, sourceOffset + 3),
        edgeOffset,
      );
      extraShellEdgePositions.set(
        idlePositions.subarray(targetOffset, targetOffset + 3),
        edgeOffset + 3,
      );
    }
    if (shellEdgePositionAttributeRef.current) {
      shellEdgePositionAttributeRef.current.needsUpdate = true;
    }
    if (innerShellEdgePositionAttributeRef.current) {
      innerShellEdgePositionAttributeRef.current.needsUpdate = true;
    }
    if (shellEdgeMaterialRef.current) {
      const configuredCoreOpacity = fx3d.edge.core.enabled
        ? fx3d.edge.master.opacity * fx3d.edge.core.opacity / 0.76
        : 0;
      const coreOpacityScale = 1
        + (configuredCoreOpacity - 1) * dimensionProgress;
      shellEdgeMaterialRef.current.opacity = Math.max(
        0,
        Math.pow(1 - progress, 1.65)
          * (0.24 + dimensionProgress * 0.24)
          * dimensionVisibility
          * coreOpacityScale,
      );
    }
    if (shellEdgeObjectRef.current) {
      shellEdgeObjectRef.current.visible = progress < 0.998
        && (dimensionProgress < 0.002 || fx3d.edge.core.enabled);
    }
    if (innerShellEdgeMaterialRef.current) {
      innerShellEdgeMaterialRef.current.opacity = Math.max(
        0,
        Math.pow(1 - progress, 1.65)
          * fx3d.orb.innerNetwork.opacity
          * dimensionProgress
          * dimensionVisibility,
      );
    }
    if (innerShellEdgeObjectRef.current) {
      innerShellEdgeObjectRef.current.visible = fx3d.orb.innerNetwork.enabled
        && progress < 0.998
        && dimensionProgress > 0.002;
    }
  }, [
    edgeCapacity,
    extraShellEdgeCount,
    extraShellEdgePositions,
    orbMorphModel.shellEdgePairs,
    planarMorphModel.shellEdgePairs,
  ]);

  const updateFocusedEdges = useCallback((positions) => {
    focusedEdges.forEach((edge, index) => {
      const sourceOffset = edge.sourceIndex * 3;
      const targetOffset = edge.targetIndex * 3;
      const edgeOffset = index * 6;
      focusedEdgePositions[edgeOffset] = positions[sourceOffset];
      focusedEdgePositions[edgeOffset + 1] = positions[sourceOffset + 1];
      focusedEdgePositions[edgeOffset + 2] = dimension === 3 ? positions[sourceOffset + 2] : 0.35;
      focusedEdgePositions[edgeOffset + 3] = positions[targetOffset];
      focusedEdgePositions[edgeOffset + 4] = positions[targetOffset + 1];
      focusedEdgePositions[edgeOffset + 5] = dimension === 3 ? positions[targetOffset + 2] : 0.35;
    });
    focusedEdgeGeometryRef.current?.setDrawRange(0, focusedEdges.length * 2);
    if (focusedEdgePositionAttributeRef.current) {
      focusedEdgePositionAttributeRef.current.needsUpdate = true;
    }
  }, [dimension, focusedEdgePositions, focusedEdges]);

  const writeLabelSlot = useCallback((slot, nodeIndex, atlasEntry) => {
    const rectAttribute = labelRectAttributeRef.current ?? labelRectAttribute;
    const colorAttribute = labelColorAttributeRef.current ?? labelColorAttribute;
    if (!atlasEntry || slot < 0 || slot >= labelSlotCount) return;
    rectAttribute.setXYZW(
      slot,
      atlasEntry.x,
      atlasEntry.y,
      atlasEntry.width,
      atlasEntry.height,
    );
    const color = nodeIndex >= 0 ? getNodeColor(nodeIndex) : palette.base;
    colorAttribute.setXYZ(slot, color.r, color.g, color.b);
  }, [getNodeColor, labelColorAttribute, labelRectAttribute, labelSlotCount, palette.base]);

  const syncDynamicLabelSlots = useCallback(() => {
    if (!labelAtlas) return;
    const selection = selectGraphLabelIndices(
      model,
      labelBaseIndices.length,
      selectedNodeId,
      hoveredNodeId,
    );
    const nextIndices = new Int32Array(labelSlotCount).fill(-1);
    selection.base.forEach((nodeIndex, slot) => {
      nextIndices[slot] = nodeIndex;
      writeLabelSlot(slot, nodeIndex, labelAtlas.entries[slot]);
    });
    selection.dynamic.forEach((nodeIndex, dynamicIndex) => {
      const slot = labelBaseIndices.length + dynamicIndex;
      if (slot >= labelSlotCount) return;
      nextIndices[slot] = nodeIndex;
      const entry = labelAtlas.update(slot, nodeIndex >= 0 ? model.nodes[nodeIndex]?.title : "");
      writeLabelSlot(slot, nodeIndex, entry);
    });
    labelNodeIndicesRef.current = nextIndices;
    labelRectAttribute.needsUpdate = true;
    labelColorAttribute.needsUpdate = true;
    lastVisibleLabelCountRef.current = -1;
  }, [
    hoveredNodeId,
    labelAtlas,
    labelBaseIndices.length,
    labelColorAttribute,
    labelRectAttribute,
    labelSlotCount,
    model,
    selectedNodeId,
    writeLabelSlot,
  ]);

  const updateLabelMatrices = useCallback((positions, visibleBaseCount) => {
    const mesh = labelMeshRef.current;
    if (!mesh) return;
    const nodeIndices = labelNodeIndicesRef.current;
    for (let slot = 0; slot < labelSlotCount; slot += 1) {
      const nodeIndex = nodeIndices[slot] ?? -1;
      const dynamic = slot >= labelBaseIndices.length;
      const visible = nodeIndex >= 0 && (dynamic || slot < visibleBaseCount);
      if (!visible) {
        NODE_MATRIX.makeScale(0, 0, 0);
        NODE_MATRIX.setPosition(0, 0, -10_000);
        mesh.setMatrixAt(slot, NODE_MATRIX);
        continue;
      }
      const atlasEntry = labelAtlas?.entries[slot];
      const offset = nodeIndex * 3;
      const hubMultiplier = model.hubMask[nodeIndex] ? scenePlan.nodes.hubScale : 1;
      const nodeSize = model.sizes[nodeIndex] * scenePlan.nodes.scale * hubMultiplier;
      const emphasized = model.nodes[nodeIndex].id === selectedNodeId
        || model.nodes[nodeIndex].id === hoveredNodeId;
      const labelHeight = scenePlan.labels.fontSize * (emphasized ? 1.34 : 1.12);
      const labelWidth = Math.max(labelHeight, (atlasEntry?.aspect ?? 2) * labelHeight);
      NODE_MATRIX.makeScale(labelWidth, labelHeight, 1);
      NODE_MATRIX.setPosition(
        positions[offset] + nodeSize + 4 + labelWidth * 0.5,
        positions[offset + 1],
        dimension === 3 ? positions[offset + 2] + nodeSize * 0.24 : 1,
      );
      mesh.setMatrixAt(slot, NODE_MATRIX);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [
    dimension,
    hoveredNodeId,
    labelAtlas,
    labelBaseIndices.length,
    labelSlotCount,
    model,
    scenePlan.labels.fontSize,
    scenePlan.nodes.hubScale,
    scenePlan.nodes.scale,
    selectedNodeId,
  ]);

  const getLabelLodCount = useCallback(() => {
    if (labelBaseIndices.length === 0) return 0;
    let ratio = 1;
    if (camera.isOrthographicCamera) {
      if (camera.zoom < 0.58) ratio = 0.24;
      else if (camera.zoom < 0.82) ratio = 0.5;
      else if (camera.zoom < 1.05) ratio = 0.74;
    } else {
      const distance = camera.position.length();
      if (distance > 1_500) ratio = 0.24;
      else if (distance > 1_050) ratio = 0.5;
      else if (distance > 760) ratio = 0.74;
    }
    return Math.max(1, Math.ceil(labelBaseIndices.length * ratio));
  }, [camera, labelBaseIndices.length]);

  const applyPresentationPositions = useCallback((linearProgress, elapsed = 0) => {
    const graphPositions = graphPositionsRef.current;
    if (!(graphPositions instanceof Float32Array)
      || graphPositions.length !== model.nodes.length * 3) return;
    const fx3d = profile3dRef.current;
    const progress = easeGraphOrbMorph(linearProgress);
    const idleWeight = 1 - progress;
    const transitionEnergy = Math.sin(progress * Math.PI);
    const dimensionProgress = easeGraphOrbMorph(dimensionProgressRef.current);
    const threeDEnergyWeight = dimensionProgress;
    const orbEnergyWeight = idleWeight * threeDEnergyWeight;
    const orbAngle = orbAngleRef.current * idleWeight;
    const planarAngle = (reducedMotion ? 0 : Math.sin(elapsed * 0.11) * 0.035) * idleWeight;
    const tilt = 0.12 * idleWeight * dimensionProgress;
    const cosine = Math.cos(orbAngle);
    const sine = Math.sin(orbAngle);
    const planarCosine = Math.cos(planarAngle);
    const planarSine = Math.sin(planarAngle);
    const tiltCosine = Math.cos(tilt);
    const tiltSine = Math.sin(tilt);
    const breathingScale = reducedMotion
      ? 1
      : 1
        + Math.sin(elapsed * 0.52 * fx3d.motion.breathingRate)
          * 0.008
          * fx3d.motion.breathingAmount
          * idleWeight;
    const graphPresentationScale = dimension === 3 ? 1.72 : 1.18;

    for (let offset = 0; offset < graphPositions.length; offset += 3) {
      const nodeIndex = offset / 3;
      const planarPulse = reducedMotion
        ? 1
        : 1 + Math.sin(elapsed * 0.74 + planarMorphModel.phases[nodeIndex])
          * 0.006
          * idleWeight;
      const planarX = planarMorphModel.positions[offset] * breathingScale * planarPulse;
      const planarY = planarMorphModel.positions[offset + 1] * breathingScale * planarPulse;
      planarFramePositions[offset] = planarX * planarCosine - planarY * planarSine;
      planarFramePositions[offset + 1] = planarX * planarSine + planarY * planarCosine + 4;
      planarFramePositions[offset + 2] = 0;

      const orbX = orbMorphModel.positions[offset] * breathingScale;
      const orbY = orbMorphModel.positions[offset + 1] * breathingScale;
      const orbZ = orbMorphModel.positions[offset + 2] * breathingScale;
      const rotatedX = orbX * cosine + orbZ * sine;
      const rotatedZ = -orbX * sine + orbZ * cosine;
      const rotatedY = orbY * tiltCosine - rotatedZ * tiltSine;
      const tiltedZ = orbY * tiltSine + rotatedZ * tiltCosine;
      orbFramePositions[offset] = rotatedX;
      orbFramePositions[offset + 1] = rotatedY - 10;
      orbFramePositions[offset + 2] = tiltedZ;

      idleFramePositions[offset] = planarFramePositions[offset]
        + (orbFramePositions[offset] - planarFramePositions[offset]) * dimensionProgress;
      idleFramePositions[offset + 1] = planarFramePositions[offset + 1]
        + (orbFramePositions[offset + 1] - planarFramePositions[offset + 1])
          * dimensionProgress;
      idleFramePositions[offset + 2] = orbFramePositions[offset + 2] * dimensionProgress;
      graphFramePositions[offset] = graphPositions[offset] * graphPresentationScale;
      graphFramePositions[offset + 1] = graphPositions[offset + 1] * graphPresentationScale;
      graphFramePositions[offset + 2] = dimension === 3
        ? graphPositions[offset + 2] * graphPresentationScale
        : 0;
      displayPositions[offset] = idleFramePositions[offset]
        + (graphFramePositions[offset] - idleFramePositions[offset]) * progress;
      displayPositions[offset + 1] = idleFramePositions[offset + 1]
        + (graphFramePositions[offset + 1] - idleFramePositions[offset + 1]) * progress;
      displayPositions[offset + 2] = idleFramePositions[offset + 2]
        + (graphFramePositions[offset + 2] - idleFramePositions[offset + 2]) * progress;
    }

    positionsRef.current = displayPositions;
    pickingCacheRef.current.positions = null;
    if (nodePointPositionAttributeRef.current) {
      nodePointPositionAttributeRef.current.needsUpdate = true;
    }
    updateNodeMatrices(displayPositions, progress);
    updateEdges(displayPositions, graphFramePositions, idleFramePositions, progress);
    updateExtraShellEdges(idleFramePositions, progress);
    updateFocusedEdges(displayPositions);
    updateLabelMatrices(displayPositions, getLabelLodCount());
    if (edgeMaterialRef.current) {
      const idleEdgeOpacity = 0.44 + dimensionProgress * 0.36;
      const dimensionVisibility = 0.32 + Math.abs(dimensionProgress - 0.5) * 1.36;
      const presentationVisibility = 1
        - transitionEnergy * (0.34 + (1 - dimensionProgress) * 0.08);
      const configuredCoreOpacity = fx3d.edge.core.enabled
        ? fx3d.edge.master.opacity * fx3d.edge.core.opacity / 0.76
        : 0;
      const coreOpacityScale = 1
        + (configuredCoreOpacity - 1) * threeDEnergyWeight;
      const energyCoreUnderlay = 1
        - Number(fx3d.edge.core.enabled) * threeDEnergyWeight * 0.82;
      edgeMaterialRef.current.opacity = (
        scenePlan.edges.opacity + (idleEdgeOpacity - scenePlan.edges.opacity) * idleWeight
      ) * dimensionVisibility
        * presentationVisibility
        * coreOpacityScale
        * energyCoreUnderlay;
    }
    const energyLineVisibility = Math.pow(threeDEnergyWeight, 1.28)
      * (1 - transitionEnergy * 0.12);
    energyLineUniforms.lineHaloRadiusScale.value = relationHaloQualityScale
      * fx3d.edge.halo.radiusScale
      * (1 + transitionEnergy * 0.04);
    energyLineUniforms.lineCoreEmissionByStrength.value = fx3d.edge.core.emissionByStrength;
    energyLineUniforms.lineCoreEmissionIntensity.value = fx3d.edge.core.emissionIntensity;
    energyLineUniforms.lineCoreOpacity.value = fx3d.edge.core.opacity;
    energyLineUniforms.lineCoreVisibility.value = Number(fx3d.edge.core.enabled);
    energyLineUniforms.lineHaloByStrength.value = fx3d.edge.halo.byStrength;
    energyLineUniforms.lineHaloEmissionIntensity.value = fx3d.edge.halo.emissionIntensity;
    energyLineUniforms.lineHaloFalloff.value = fx3d.edge.halo.falloff;
    energyLineUniforms.lineHaloOpacity.value = fx3d.edge.halo.opacity;
    energyLineUniforms.lineHaloVisibility.value = Number(fx3d.edge.halo.enabled);
    energyLineUniforms.lineMasterOpacity.value = fx3d.edge.master.opacity
      * energyLineVisibility;
    energyLineUniforms.lineWidthByStrength.value = fx3d.edge.core.widthByStrength;
    energyLineUniforms.lineWidthScale.value = fx3d.edge.core.widthScale
      * (0.98 + transitionEnergy * 0.1);
    if (energyLineObjectRef.current) {
      energyLineObjectRef.current.visible = energyLineVisibility > 0.002
        && (fx3d.edge.core.enabled || fx3d.edge.halo.enabled);
    }
    if (nodeMeshRef.current?.material) {
      const configuredCoreOpacity = fx3d.node.core.enabled
        ? fx3d.node.master.opacity
        : 0;
      nodeMeshRef.current.material.opacity = scenePlan.nodes.opacity
        * (1 - threeDEnergyWeight * 0.74)
        * (1 + (configuredCoreOpacity - 1) * threeDEnergyWeight);
    }
    if (nodeHaloMeshRef.current?.material) {
      const referenceHaloOpacity = 0.06
        + idleWeight
          * (0.1 - dimensionProgress * 0.02);
      const configuredHaloOpacity = fx3d.node.halo.enabled
        ? fx3d.node.halo.opacity * fx3d.node.master.opacity
        : 0;
      nodeHaloMeshRef.current.material.opacity = referenceHaloOpacity
        + (configuredHaloOpacity - referenceHaloOpacity) * threeDEnergyWeight;
      nodeHaloMeshRef.current.material.color
        .set(scenePlan.nodes.activeColor)
        .multiplyScalar(
          1 + (fx3d.node.halo.emissionIntensity - 1) * threeDEnergyWeight,
        );
    }
    if (nodeEnergyMaterial.uniforms?.pointOpacity) {
      const idlePointOpacity = 0.96 - dimensionProgress * 0.06;
      const referenceCoreOpacity = Math.min(
        1,
        0.82 + idleWeight * (idlePointOpacity - 0.82) + transitionEnergy * 0.06,
      );
      nodeEnergyMaterial.uniforms.pointOpacity.value = referenceCoreOpacity
        + (1 - referenceCoreOpacity) * threeDEnergyWeight;
    }
    if (nodeEnergyMaterial.uniforms?.pointSize) {
      const idlePointSize = 15.4 - dimensionProgress * 0.9;
      const graphPointSize = 13.2 + dimensionProgress * 0.3;
      const pointSize = idlePointSize
        + (graphPointSize - idlePointSize) * progress
        + transitionEnergy * 0.65;
      nodeEnergyMaterial.uniforms.pointSize.value = pointSize
        * (1 + (
          fx3d.node.master.scale * fx3d.node.core.sizeScale - 1
        ) * threeDEnergyWeight);
    }
    nodeEnergyMaterial.uniforms.energyTime.value = elapsed;
    nodeEnergyMaterial.uniforms.orbStyle.value = orbEnergyWeight;
    nodeEnergyMaterial.uniforms.pointColorVariation.value = threeDEnergyWeight;
    nodeEnergyMaterial.uniforms.pointCoreEmissionIntensity.value = 1
      + (fx3d.node.core.emissionIntensity - 1) * threeDEnergyWeight;
    nodeEnergyMaterial.uniforms.pointCoreOpacity.value = 1
      + (
        fx3d.node.core.opacity * fx3d.node.master.opacity - 1
      ) * threeDEnergyWeight;
    nodeEnergyMaterial.uniforms.pointCoreVisibility.value = 1
      + (Number(fx3d.node.core.enabled) - 1) * threeDEnergyWeight;
    nodeEnergyMaterial.uniforms.pointHaloEmissionIntensity.value = 1
      + (fx3d.node.halo.emissionIntensity - 1) * threeDEnergyWeight;
    nodeEnergyMaterial.uniforms.pointHaloOpacity.value = 1
      + (
        fx3d.node.halo.opacity * fx3d.node.master.opacity - 1
      ) * threeDEnergyWeight;
    nodeEnergyMaterial.uniforms.pointHaloVisibility.value = 1
      + (Number(fx3d.node.halo.enabled) - 1) * threeDEnergyWeight;
    nodeEnergyMaterial.uniforms.pointScaleVariation.value = threeDEnergyWeight
      * fx3d.node.size.byImportance;
    nodeEnergyMaterial.uniforms.pointPulseMotion.value = Number(!reducedMotion);
    nodeEnergyMaterial.uniforms.pointPulseVisibility.value = Number(
      fx3d.node.pulse.enabled,
    ) * fx3d.node.master.opacity * threeDEnergyWeight;
    nodeEnergyMaterial.uniforms.pulseAmount.value = fx3d.node.pulse.amount;
    nodeEnergyMaterial.uniforms.pulseRate.value = fx3d.node.pulse.rate;
    ambientEnergyMaterial.uniforms.energyTime.value = elapsed;
    ambientEnergyMaterial.uniforms.orbStyle.value = 1;
    ambientEnergyMaterial.uniforms.pointCoreEmissionIntensity.value = fx3d.orb.sparks.emissionIntensity;
    ambientEnergyMaterial.uniforms.pointHaloEmissionIntensity.value = fx3d.orb.sparks.emissionIntensity;
    ambientEnergyMaterial.uniforms.pointOpacity.value = fx3d.orb.sparks.enabled
      ? Math.min(1, fx3d.orb.sparks.opacity * 1.55) * orbEnergyWeight
      : 0;
    ambientEnergyMaterial.uniforms.pointSize.value = 6.8 * fx3d.orb.sparks.sizeScale;
    ambientEnergyMaterial.uniforms.pointScaleVariation.value = orbEnergyWeight;
    ambientEnergyMaterial.uniforms.pointPulseMotion.value = Number(!reducedMotion);
    ambientEnergyMaterial.uniforms.pointPulseVisibility.value = Number(
      fx3d.orb.sparks.enabled,
    ) * orbEnergyWeight;
    ambientEnergyMaterial.uniforms.pulseAmount.value = reducedMotion
      ? 0
      : 0.64 * orbEnergyWeight;
    ambientEnergyMaterial.uniforms.pulseRate.value = 1.65;
    signalEnergyMaterial.uniforms.orbStyle.value = threeDEnergyWeight;
    signalEnergyMaterial.uniforms.pointCoreEmissionIntensity.value = 1
      + (fx3d.signal.emissionIntensity - 1) * threeDEnergyWeight;
    signalEnergyMaterial.uniforms.pointHaloEmissionIntensity.value = 1
      + (fx3d.signal.emissionIntensity - 1) * threeDEnergyWeight;
    signalEnergyMaterial.uniforms.pointOpacity.value = 0.96
      + (fx3d.signal.opacity - 0.96) * threeDEnergyWeight;
    signalEnergyMaterial.uniforms.pointSize.value = (
      (dimension === 3 ? 10.5 : 9.5) + 6 * threeDEnergyWeight
    ) * (1 + (fx3d.signal.sizeScale - 1) * threeDEnergyWeight);
    if (orbAmbientRef.current) {
      orbAmbientRef.current.visible = fx3d.orb.sparks.enabled
        && orbEnergyWeight > 0.002;
      orbAmbientRef.current.rotation.y = orbAngle * 1.85
        + Math.sin(elapsed * 0.19) * 0.035;
      orbAmbientRef.current.rotation.x = Math.sin(elapsed * 0.21) * 0.04;
    }
    orbRimUniforms.rimFresnelPower.value = fx3d.orb.rim.fresnelPower;
    orbRimUniforms.rimIntensity.value = fx3d.orb.rim.intensity
      * orbEnergyWeight;
    if (orbRimRef.current) {
      orbRimRef.current.visible = fx3d.orb.rim.enabled
        && orbEnergyWeight > 0.002;
      orbRimRef.current.scale.setScalar(breathingScale);
    }
    if (innerShellEdgeObjectRef.current) {
      innerShellEdgeObjectRef.current.rotation.y = 0.44
        - orbAngle * 0.49 * fx3d.orb.innerNetwork.rotationSpeed;
    }
    if (labelMaterial?.uniforms?.labelOpacity) {
      const reveal = progress <= 0.42
        ? 0
        : Math.min(1, (progress - 0.42) / 0.58);
      labelMaterial.uniforms.labelOpacity.value = scenePlan.labels.opacity * reveal;
    }
    invalidate();
  }, [
    dimension,
    displayPositions,
    ambientEnergyMaterial,
    relationHaloQualityScale,
    energyLineUniforms,
    getLabelLodCount,
    graphFramePositions,
    idleFramePositions,
    invalidate,
    labelMaterial,
    model.nodes.length,
    nodeEnergyMaterial,
    orbFramePositions,
    orbMorphModel.positions,
    orbRimUniforms,
    planarFramePositions,
    planarMorphModel.phases,
    planarMorphModel.positions,
    reducedMotion,
    scenePlan.edges.opacity,
    scenePlan.labels.opacity,
    scenePlan.nodes.opacity,
    signalEnergyMaterial,
    updateEdges,
    updateExtraShellEdges,
    updateFocusedEdges,
    updateLabelMatrices,
    updateNodeMatrices,
  ]);
  const applyPresentationPositionsRef = useRef(applyPresentationPositions);
  applyPresentationPositionsRef.current = applyPresentationPositions;

  const applyPositions = useCallback((positions) => {
    if (!(positions instanceof Float32Array) || positions.length !== model.nodes.length * 3) return;
    graphPositionsRef.current = positions;
    applyPresentationPositionsRef.current(morphProgressRef.current, lastElapsedRef.current);
  }, [model.nodes.length]);
  const applyPositionsRef = useRef(applyPositions);
  applyPositionsRef.current = applyPositions;

  const getPickingIndex = useCallback((sample) => {
    if (!sample?.active || sample.width <= 0 || sample.height <= 0) return null;
    const cache = pickingCacheRef.current;
    const positions = positionsRef.current;
    const matricesChanged = cameraMatricesChanged(camera, cache.cameraMatrices);
    const requiresRebuild = cache.index === null
      || matricesChanged
      || cache.positions !== positions
      || cache.width !== sample.width
      || cache.height !== sample.height
      || cache.coarsePointer !== coarsePointer
      || cache.nodeScale !== scenePlan.nodes.scale
      || cache.hubScale !== scenePlan.nodes.hubScale;
    if (requiresRebuild) {
      cache.index = createNodeScreenIndex({
        camera,
        coarsePointer,
        dimension,
        height: sample.height,
        hubScale: scenePlan.nodes.hubScale,
        model,
        nodeScale: scenePlan.nodes.scale,
        positions,
        width: sample.width,
      });
      cache.positions = positions;
      cache.width = sample.width;
      cache.height = sample.height;
      cache.coarsePointer = coarsePointer;
      cache.nodeScale = scenePlan.nodes.scale;
      cache.hubScale = scenePlan.nodes.hubScale;
    }
    return cache.index;
  }, [
    camera,
    coarsePointer,
    dimension,
    model,
    scenePlan.nodes.hubScale,
    scenePlan.nodes.scale,
  ]);

  useLayoutEffect(() => {
    const mesh = nodeMeshRef.current;
    if (mesh) {
      mesh.instanceColor = instanceColorAttribute;
      mesh.instanceColor.setUsage(DynamicDrawUsage);
      mesh.material.needsUpdate = true;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    }
    nodeHaloMeshRef.current?.instanceMatrix.setUsage(DynamicDrawUsage);
    nodePointPositionAttributeRef.current?.setUsage(DynamicDrawUsage);
    edgePositionAttributeRef.current?.setUsage(DynamicDrawUsage);
    edgeColorAttributeRef.current?.setUsage(DynamicDrawUsage);
    energyLineStartAttributeRef.current?.setUsage(DynamicDrawUsage);
    energyLineEndAttributeRef.current?.setUsage(DynamicDrawUsage);
    shellEdgePositionAttributeRef.current?.setUsage(DynamicDrawUsage);
    innerShellEdgePositionAttributeRef.current?.setUsage(DynamicDrawUsage);
    focusedEdgePositionAttributeRef.current?.setUsage(DynamicDrawUsage);
    signalPositionAttributeRef.current?.setUsage(DynamicDrawUsage);
    labelMeshRef.current?.instanceMatrix.setUsage(DynamicDrawUsage);
    graphPositionsRef.current = model.initialPositions;
    positionsRef.current = displayPositions;
    morphProgressRef.current = presentationTargetRef.current;
    applyPositionsRef.current(model.initialPositions);
  }, [
    displayPositions,
    edgePositions,
    extraShellEdgePositions,
    focusedEdgePositions,
    instanceColorAttribute,
    model,
    signalPositions,
  ]);

  useLayoutEffect(() => {
    energyLineUniforms.viewportSize.value.set(viewportSize.width, viewportSize.height);
    invalidate();
  }, [energyLineUniforms, invalidate, viewportSize.height, viewportSize.width]);

  useLayoutEffect(() => {
    const signalCount = dimension === 3
      ? Math.min(profile3d.signal.count, orbMorphModel.signalEdgeIndices.length)
      : orbMorphModel.signalEdgeIndices.length;
    signalGeometryRef.current?.setDrawRange(0, signalCount);
    applyPresentationPositionsRef.current(
      morphProgressRef.current,
      lastElapsedRef.current,
    );
    invalidate();
  }, [
    colorKey,
    dimension,
    edgePositions,
    fxRevisionKey,
    invalidate,
    orbMorphModel.signalEdgeIndices.length,
    profile3d.signal.count,
    scenePlan.edges.opacity,
    scenePlan.nodes.opacity,
  ]);

  useLayoutEffect(() => {
    syncDynamicLabelSlots();
    updateNodeColors();
    updateFocusedEdges(positionsRef.current);
    updateLabelMatrices(positionsRef.current, getLabelLodCount());
    invalidate();
  }, [
    colorKey,
    getLabelLodCount,
    invalidate,
    syncDynamicLabelSlots,
    updateFocusedEdges,
    updateLabelMatrices,
    updateNodeColors,
  ]);

  useEffect(() => {
    if (!labelAtlas) return undefined;
    let active = true;
    ensureGraphLabelFont(GRAPH_LABEL_FONT).then((loaded) => {
      if (!active || !loaded) return;
      labelAtlas.redraw();
      labelAtlas.entries.forEach((entry, slot) => {
        writeLabelSlot(slot, labelNodeIndicesRef.current[slot] ?? -1, entry);
      });
      labelRectAttribute.needsUpdate = true;
      invalidate();
    });
    return () => {
      active = false;
    };
  }, [invalidate, labelAtlas, labelRectAttribute, writeLabelSlot]);

  useEffect(() => () => labelAtlas?.dispose(), [labelAtlas]);
  useEffect(() => () => labelMaterial?.dispose(), [labelMaterial]);
  useEffect(() => () => energyLineMaterial.dispose(), [energyLineMaterial]);
  useEffect(() => () => orbRimMaterial.dispose(), [orbRimMaterial]);
  useEffect(() => () => nodeEnergyMaterial.dispose(), [nodeEnergyMaterial]);
  useEffect(() => () => signalEnergyMaterial.dispose(), [signalEnergyMaterial]);
  useEffect(() => () => ambientEnergyMaterial.dispose(), [ambientEnergyMaterial]);

  useEffect(() => {
    const canvas = gl.domElement;
    const pointerQueue = pointerQueueRef.current;
    const pointerInteraction = pointerInteractionRef.current;
    if (!interactive) {
      if (lastPickedNodeIdRef.current !== null) {
        lastPickedNodeIdRef.current = null;
        pointerCallbacksRef.current.onNodeHover?.(null);
      }
      return undefined;
    }

    const readSample = (event, active = true) => {
      const rect = canvas.getBoundingClientRect();
      return {
        active,
        height: rect.height,
        width: rect.width,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    };
    const queueHover = (sample) => {
      pointerQueue.queueHover(sample);
      invalidate();
    };
    const handlePointerDown = (event) => {
      pointerInteraction.down = {
        button: event.button,
        moved: false,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
    };
    const handlePointerMove = (event) => {
      const down = pointerInteraction.down;
      if (down?.pointerId === event.pointerId) {
        const distance = Math.hypot(event.clientX - down.x, event.clientY - down.y);
        if (distance > 4) down.moved = true;
      }
      if (event.buttons !== 0) {
        queueHover({ active: false });
        return;
      }
      queueHover(readSample(event));
    };
    const handlePointerUp = (event) => {
      const down = pointerInteraction.down;
      pointerInteraction.down = null;
      const sample = readSample(event);
      pointerQueue.queueHover(sample);
      if (down?.pointerId === event.pointerId && down.button === 0 && !down.moved) {
        pointerQueue.queueSelection(sample);
      }
      invalidate();
    };
    const handlePointerCancel = () => {
      pointerInteraction.down = null;
      queueHover({ active: false });
    };
    const handlePointerLeave = () => queueHover({ active: false });

    canvas.addEventListener("pointerdown", handlePointerDown, { passive: true });
    canvas.addEventListener("pointermove", handlePointerMove, { passive: true });
    canvas.addEventListener("pointerup", handlePointerUp, { passive: true });
    canvas.addEventListener("pointercancel", handlePointerCancel, { passive: true });
    canvas.addEventListener("pointerleave", handlePointerLeave, { passive: true });
    return () => {
      pointerInteraction.down = null;
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerCancel);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
    };
  }, [gl, interactive, invalidate]);

  useEffect(() => {
    if (reducedMotion) {
      morphProgressRef.current = presentationTarget;
      dimensionProgressRef.current = dimensionTarget;
      applyPresentationPositionsRef.current(presentationTarget, lastElapsedRef.current);
    }
    invalidate();
  }, [dimensionTarget, invalidate, presentationTarget, reducedMotion]);

  useFrame((state, delta) => {
    const fx3d = profile3dRef.current;
    const elapsed = state.clock.elapsedTime;
    const frameDelta = Math.min(0.05, Math.max(0, delta));
    lastElapsedRef.current = elapsed;
    let presentationChanged = false;
    let dimensionChanged = false;
    if (reducedMotion) {
      if (morphProgressRef.current !== presentationTarget) {
        morphProgressRef.current = presentationTarget;
        presentationChanged = true;
      }
      if (dimensionProgressRef.current !== dimensionTarget) {
        dimensionProgressRef.current = dimensionTarget;
        dimensionChanged = true;
      }
    } else {
      const current = morphProgressRef.current;
      const direction = Math.sign(presentationTarget - current);
      if (direction !== 0) {
        const next = current + direction * frameDelta / GRAPH_MORPH_DURATION_SECONDS;
        morphProgressRef.current = direction > 0
          ? Math.min(presentationTarget, next)
          : Math.max(presentationTarget, next);
        presentationChanged = true;
      }
      const currentDimension = dimensionProgressRef.current;
      const dimensionDirection = Math.sign(dimensionTarget - currentDimension);
      if (dimensionDirection !== 0) {
        const nextDimension = currentDimension
          + dimensionDirection * frameDelta / DIMENSION_MORPH_DURATION_SECONDS;
        dimensionProgressRef.current = dimensionDirection > 0
          ? Math.min(dimensionTarget, nextDimension)
          : Math.max(dimensionTarget, nextDimension);
        dimensionChanged = true;
      }
      if (presentationTarget === 0 || morphProgressRef.current < 0.999) {
        orbAngleRef.current = (
          orbAngleRef.current
          + frameDelta * 0.072 * fx3d.motion.idleRotationSpeed
        ) % (Math.PI * 2);
        presentationChanged = true;
      }
    }
    if (presentationChanged || dimensionChanged) {
      applyPresentationPositionsRef.current(morphProgressRef.current, elapsed);
    }

    const signalLayerActive = isGraphSignalLayerActive({
      dimension,
      signalCount: fx3d.signal.count,
      signalEnabled: fx3d.signal.enabled,
      signalPositionLength: signalPositions.length,
    });
    if (!reducedMotion && signalLayerActive) {
      const visibleSignalCount = dimension === 3
        ? Math.min(fx3d.signal.count, orbMorphModel.signalEdgeIndices.length)
        : orbMorphModel.signalEdgeIndices.length;
      orbMorphModel.signalEdgeIndices.forEach((edgeIndex, signalIndex) => {
        if (signalIndex >= visibleSignalCount) return;
        const edgeOffset = edgeIndex * 6;
        const positionOffset = signalIndex * 3;
        const signalSpeed = dimension === 3 ? fx3d.signal.speed : 1;
        const rawProgress = (elapsed * 0.18 * signalSpeed + signalIndex * 0.173) % 1;
        const travel = rawProgress * rawProgress * (3 - 2 * rawProgress);
        signalPositions[positionOffset] = edgePositions[edgeOffset]
          + (edgePositions[edgeOffset + 3] - edgePositions[edgeOffset]) * travel;
        signalPositions[positionOffset + 1] = edgePositions[edgeOffset + 1]
          + (edgePositions[edgeOffset + 4] - edgePositions[edgeOffset + 1]) * travel;
        signalPositions[positionOffset + 2] = edgePositions[edgeOffset + 2]
          + (edgePositions[edgeOffset + 5] - edgePositions[edgeOffset + 2]) * travel;
      });
      if (signalPositionAttributeRef.current) {
        signalPositionAttributeRef.current.needsUpdate = true;
      }
    }

    const pointerQueue = pointerQueueRef.current;
    if (pointerQueue.hasPending()) {
      const pending = pointerQueue.consume();
      if (pending.hover !== null) {
        const pickingIndex = getPickingIndex(pending.hover);
        const nodeIndex = pending.hover.active
          ? pickGraphScreenNode(pickingIndex, pending.hover.x, pending.hover.y)
          : null;
        const node = nodeIndex === null ? null : model.nodes[nodeIndex] ?? null;
        const nodeId = node?.id ?? null;
        if (nodeId !== lastPickedNodeIdRef.current) {
          lastPickedNodeIdRef.current = nodeId;
          pointerCallbacksRef.current.onNodeHover?.(node);
        }
      }
      if (pending.selection !== null) {
        const pickingIndex = getPickingIndex(pending.selection);
        const nodeIndex = pickGraphScreenNode(
          pickingIndex,
          pending.selection.x,
          pending.selection.y,
        );
        const node = nodeIndex === null ? null : model.nodes[nodeIndex] ?? null;
        if (node) pointerCallbacksRef.current.onNodeSelect?.(node);
      }
    }
    const visibleCount = getLabelLodCount();
    if (visibleCount !== lastVisibleLabelCountRef.current) {
      lastVisibleLabelCountRef.current = visibleCount;
      updateLabelMatrices(positionsRef.current, visibleCount);
    }
    if (shouldContinueGraphFrame({
      dimensionChanged,
      documentVisible: documentVisibleRef.current,
      idlePresentation: presentationTarget === 0,
      presentationChanged,
      reducedMotion,
      signalLayerActive,
    })) {
      invalidate();
    }
  });

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const handleVisibility = () => {
      const visible = document.visibilityState !== "hidden";
      documentVisibleRef.current = visible;
      setDocumentVisible(visible);
      if (visible) ensureWorkerRef.current?.();
      else cancelWatchdogRef.current?.();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  useEffect(() => {
    let disposed = false;
    let worker = null;
    let retryTimer = null;
    let watchdogTimer = null;
    let consecutiveFailures = 0;

    function canRunWorker() {
      return documentVisibleRef.current
        && (typeof document === "undefined" || document.visibilityState !== "hidden");
    }

    function cancelWatchdog() {
      if (watchdogTimer !== null) clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }

    function keepStaticFallback() {
      applyPositionsRef.current(graphPositionsRef.current);
      onLayoutStateRef.current?.("error", 0);
    }

    function terminateWorker(target) {
      if (!target) return;
      cancelWatchdog();
      target.removeEventListener("message", handleMessage);
      target.removeEventListener("error", handleWorkerError);
      target.removeEventListener("messageerror", handleWorkerError);
      if (worker === target) worker = null;
      if (workerRef.current === target) workerRef.current = null;
      try {
        target.postMessage({ type: "stop" });
      } catch {
        // A failed Worker may already reject messages; termination is sufficient.
      }
      target.terminate();
    }

    function scheduleRetry() {
      if (disposed
        || retryTimer !== null
        || consecutiveFailures > MAX_LAYOUT_WORKER_RETRIES
        || !canRunWorker()) return;
      const retryIndex = Math.max(0, consecutiveFailures - 1);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        ensureWorker();
      }, LAYOUT_WORKER_RETRY_DELAYS[retryIndex] ?? LAYOUT_WORKER_RETRY_DELAYS.at(-1));
    }

    function failWorker(target) {
      if (disposed || (target && target !== worker)) return;
      consecutiveFailures += 1;
      terminateWorker(target ?? worker);
      keepStaticFallback();
      scheduleRetry();
    }

    function armWatchdog(target, requestRevision) {
      cancelWatchdog();
      if (!canRunWorker()) return;
      watchdogTimer = setTimeout(() => {
        watchdogTimer = null;
        if (target === worker && activeRevisionRef.current === requestRevision) failWorker(target);
      }, LAYOUT_PROGRESS_WATCHDOG_MS);
    }

    function postLatestLayout(target) {
      const request = layoutRequestRef.current;
      if (!request || !canRunWorker() || target !== worker) return;
      activeRevisionRef.current = request.revision;
      onLayoutStateRef.current?.("running", 0);
      try {
        target.postMessage(request);
        armWatchdog(target, request.revision);
      } catch {
        failWorker(target);
      }
    }

    function handleMessage(event) {
      if (event.currentTarget !== worker) return;
      const message = event.data;
      if (message?.revision !== activeRevisionRef.current) return;
      if (message?.type === "error") {
        failWorker(event.currentTarget);
        return;
      }
      if (message?.type === "progress") {
        consecutiveFailures = 0;
        cancelWatchdog();
        onLayoutStateRef.current?.("running", message.iteration);
        armWatchdog(event.currentTarget, message.revision);
        return;
      }
      if (message?.type !== "positions") return;
      consecutiveFailures = 0;
      cancelWatchdog();
      applyPositionsRef.current(message.positions);
      onLayoutStateRef.current?.(message.settled ? "settled" : "running", message.iteration);
      if (!message.settled) armWatchdog(event.currentTarget, message.revision);
    }

    function handleWorkerError(event) {
      event.preventDefault?.();
      failWorker(event.currentTarget);
    }

    function ensureWorker() {
      if (disposed || worker || retryTimer !== null || !canRunWorker()) return;
      if (consecutiveFailures > MAX_LAYOUT_WORKER_RETRIES) return;
      let nextWorker;
      try {
        nextWorker = new Worker(new URL("../layout/layout-worker.js", import.meta.url), {
          type: "module",
          name: "jarvis-graph-layout",
        });
      } catch {
        consecutiveFailures += 1;
        keepStaticFallback();
        scheduleRetry();
        return;
      }
      worker = nextWorker;
      workerRef.current = nextWorker;
      nextWorker.addEventListener("message", handleMessage);
      nextWorker.addEventListener("error", handleWorkerError);
      nextWorker.addEventListener("messageerror", handleWorkerError);
      postLatestLayout(nextWorker);
    }

    ensureWorkerRef.current = ensureWorker;
    postLayoutRequestRef.current = postLatestLayout;
    failWorkerRef.current = failWorker;
    cancelWatchdogRef.current = cancelWatchdog;
    ensureWorker();

    return () => {
      disposed = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
      cancelWatchdog();
      terminateWorker(worker);
      if (ensureWorkerRef.current === ensureWorker) ensureWorkerRef.current = null;
      if (postLayoutRequestRef.current === postLatestLayout) postLayoutRequestRef.current = null;
      if (failWorkerRef.current === failWorker) failWorkerRef.current = null;
      if (cancelWatchdogRef.current === cancelWatchdog) cancelWatchdogRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!documentVisible) {
      layoutRequestRef.current = null;
      cancelWatchdogRef.current?.();
      const pausedWorker = workerRef.current;
      try {
        pausedWorker?.postMessage({ type: "stop" });
      } catch {
        failWorkerRef.current?.(pausedWorker);
      }
      onLayoutStateRef.current?.("paused", 0);
      return undefined;
    }
    const seedPositions = graphPositionsRef.current.length === model.initialPositions.length
      ? graphPositionsRef.current
      : model.initialPositions;
    const request = {
      type: "layout",
      revision,
      dimension,
      emitIntermediate: !reducedMotion,
      force: layoutSettings,
      tickBudget: layoutSettings.tickBudget,
      nodes: model.nodes.map((node, index) => ({
        id: node.id,
        weight: node.weight,
        radius: model.sizes[index]
          * layoutSettings.nodeScale
          * (model.hubMask[index] ? layoutSettings.hubScale : 1),
        x: seedPositions[index * 3],
        y: seedPositions[index * 3 + 1],
        z: seedPositions[index * 3 + 2],
      })),
      edges: layoutEdges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        weight: edge.weight,
      })),
    };
    layoutRequestRef.current = request;
    const worker = workerRef.current;
    if (!worker) {
      onLayoutStateRef.current?.("error", 0);
      applyPositionsRef.current(graphPositionsRef.current);
      ensureWorkerRef.current?.();
      return undefined;
    }
    activeRevisionRef.current = revision;
    postLayoutRequestRef.current?.(worker);
    return () => {
      if (layoutRequestRef.current === request) layoutRequestRef.current = null;
      cancelWatchdogRef.current?.();
      if (workerRef.current !== worker) return;
      try {
        worker.postMessage({ type: "stop", revision });
      } catch {
        // Worker lifecycle recovery owns failed instances and pending retries.
      }
    };
  }, [
    dimension,
    documentVisible,
    layoutEdges,
    layoutKey,
    layoutSettings,
    model.initialPositions,
    model.hubMask,
    model.nodes,
    model.sizes,
    reducedMotion,
    revision,
  ]);

  const getPositions = useCallback(() => positionsRef.current, []);

  return (
    <group>
      <GraphCameraNavigation
        command={cameraCommand}
        dimension={dimension}
        getPositions={getPositions}
        interactive={interactive}
        reducedMotion={reducedMotion}
        zoom={zoom}
      />
      {dimension === 3 ? (
        <>
          <ambientLight intensity={0.72} />
          <directionalLight intensity={1.35} position={[240, 320, 520]} />
          <directionalLight intensity={0.42} position={[-280, -120, 180]} />
        </>
      ) : null}
      <StarField color={scenePlan.nodes.baseColor} count={scenePlan.scene.starCount} />
      <points
        ref={orbAmbientRef}
        frustumCulled={false}
        position={[0, -10, 0]}
        raycast={() => null}
        renderOrder={0.5}
        visible={dimension === 3}
      >
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[orbAmbientField.positions, 3]}
          />
          <bufferAttribute
            attach="attributes-pointColor"
            args={[orbAmbientColors, 3]}
          />
          <bufferAttribute
            attach="attributes-pointHierarchy"
            args={[orbAmbientHierarchy, 1]}
          />
          <bufferAttribute
            attach="attributes-pointScale"
            args={[orbAmbientField.scales, 1]}
          />
          <bufferAttribute
            attach="attributes-pointPhase"
            args={[orbAmbientField.phases, 1]}
          />
        </bufferGeometry>
        <primitive attach="material" object={ambientEnergyMaterial} />
      </points>
      <mesh
        ref={orbRimRef}
        frustumCulled={false}
        position={[0, -10, 0]}
        raycast={() => null}
        renderOrder={0.7}
        visible={dimension === 3}
      >
        <sphereGeometry args={[orbMorphModel.radius * 1.018, 48, 32]} />
        <primitive attach="material" object={orbRimMaterial} />
      </mesh>
      {extraShellEdgeCount > 0 ? (
        <>
          <lineSegments
            ref={innerShellEdgeObjectRef}
            position={[0, -2.7, 0]}
            raycast={() => null}
            renderOrder={0.75}
            rotation={[-0.16, 0.44, 0.1]}
            scale={profile3d.orb.innerNetwork.scale}
            visible={dimension === 3}
          >
            <bufferGeometry>
              <bufferAttribute
                ref={innerShellEdgePositionAttributeRef}
                attach="attributes-position"
                args={[extraShellEdgePositions, 3]}
              />
            </bufferGeometry>
            <lineBasicMaterial
              ref={innerShellEdgeMaterialRef}
              blending={AdditiveBlending}
              color={dimension === 3 ? orbShellColor : scenePlan.nodes.activeColor}
              depthTest={false}
              depthWrite={false}
              opacity={0.2}
              transparent
              toneMapped={false}
            />
          </lineSegments>
          <lineSegments
            ref={shellEdgeObjectRef}
            raycast={() => null}
            renderOrder={0.8}
          >
            <bufferGeometry>
              <bufferAttribute
                ref={shellEdgePositionAttributeRef}
                attach="attributes-position"
                args={[extraShellEdgePositions, 3]}
              />
            </bufferGeometry>
            <lineBasicMaterial
              ref={shellEdgeMaterialRef}
              blending={AdditiveBlending}
              color={dimension === 3 ? orbShellColor : scenePlan.nodes.activeColor}
              depthTest={false}
              depthWrite={false}
              opacity={0.36}
              transparent
              toneMapped={false}
            />
          </lineSegments>
        </>
      ) : null}
      <lineSegments raycast={() => null} renderOrder={1}>
        <bufferGeometry>
          <bufferAttribute
            ref={edgePositionAttributeRef}
            attach="attributes-position"
            args={[edgePositions, 3]}
          />
          <bufferAttribute
            ref={edgeColorAttributeRef}
            attach="attributes-color"
            args={[edgeColors, 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial
          ref={edgeMaterialRef}
          blending={AdditiveBlending}
          depthWrite={false}
          opacity={scenePlan.edges.opacity}
          transparent
          toneMapped={false}
          vertexColors
        />
      </lineSegments>
      {edgeCapacity > 0 ? (
        <mesh
          ref={energyLineObjectRef}
          frustumCulled={false}
          raycast={() => null}
          renderOrder={1.25}
          visible={dimension === 3}
        >
          <instancedBufferGeometry instanceCount={edgeCapacity}>
            <bufferAttribute
              attach="attributes-position"
              args={[ENERGY_LINE_QUAD_POSITIONS, 3]}
            />
            <instancedBufferAttribute
              ref={energyLineStartAttributeRef}
              attach="attributes-edgeStart"
              args={[energyLineStarts, 3]}
            />
            <instancedBufferAttribute
              ref={energyLineEndAttributeRef}
              attach="attributes-edgeEnd"
              args={[energyLineEnds, 3]}
            />
            <instancedBufferAttribute
              attach="attributes-edgeColorStart"
              args={[edgeEnergyStyle.sourceColors, 3]}
            />
            <instancedBufferAttribute
              attach="attributes-edgeColorEnd"
              args={[edgeEnergyStyle.targetColors, 3]}
            />
            <instancedBufferAttribute
              attach="attributes-edgeWidth"
              args={[edgeEnergyStyle.widths, 1]}
            />
            <instancedBufferAttribute
              attach="attributes-edgeEnergy"
              args={[edgeEnergyStyle.strengths, 1]}
            />
          </instancedBufferGeometry>
          <primitive attach="material" object={energyLineMaterial} />
        </mesh>
      ) : null}
      {focusedEdgeBudget > 0 ? (
        <lineSegments
          raycast={() => null}
          renderOrder={1.5}
          visible={focusedEdges.length > 0}
        >
          <bufferGeometry ref={focusedEdgeGeometryRef}>
            <bufferAttribute
              ref={focusedEdgePositionAttributeRef}
              attach="attributes-position"
              args={[focusedEdgePositions, 3]}
            />
          </bufferGeometry>
          <lineBasicMaterial
            blending={AdditiveBlending}
            color={scenePlan.nodes.activeColor}
            depthTest={false}
            depthWrite={false}
            opacity={0.96}
            transparent
            toneMapped={false}
          />
        </lineSegments>
      ) : null}
      <points
        frustumCulled={false}
        raycast={() => null}
        renderOrder={1.7}
      >
        <bufferGeometry>
          <bufferAttribute
            ref={nodePointPositionAttributeRef}
            attach="attributes-position"
            args={[displayPositions, 3]}
          />
          <bufferAttribute
            attach="attributes-pointColor"
            args={[nodeEnergyStyle.colors, 3]}
          />
          <bufferAttribute
            attach="attributes-pointHierarchy"
            args={[nodeEnergyStyle.hierarchy, 1]}
          />
          <bufferAttribute
            attach="attributes-pointScale"
            args={[nodeEnergyStyle.scales, 1]}
          />
          <bufferAttribute
            attach="attributes-pointPhase"
            args={[orbMorphModel.phases, 1]}
          />
        </bufferGeometry>
        <primitive attach="material" object={nodeEnergyMaterial} />
      </points>
      <instancedMesh
        ref={nodeHaloMeshRef}
        args={[undefined, undefined, model.nodes.length]}
        frustumCulled={false}
        raycast={() => null}
        renderOrder={1.8}
      >
        {dimension === 3
          ? <sphereGeometry args={[1, 10, 6]} />
          : <circleGeometry args={[1, 18]} />}
        <meshBasicMaterial
          blending={AdditiveBlending}
          color={scenePlan.nodes.activeColor}
          depthTest={false}
          depthWrite={false}
          opacity={0.08}
          transparent
          toneMapped={false}
        />
      </instancedMesh>
      <instancedMesh
        ref={nodeMeshRef}
        args={[undefined, undefined, model.nodes.length]}
        frustumCulled={false}
        raycast={() => null}
        renderOrder={2}
      >
        {dimension === 3
          ? <sphereGeometry args={[1, 12, 8]} />
          : <circleGeometry args={[1, 18]} />}
        {dimension === 3 ? (
          <meshBasicMaterial
            blending={AdditiveBlending}
            color="#ffffff"
            depthWrite={false}
            opacity={scenePlan.nodes.opacity}
            transparent
            toneMapped={false}
            vertexColors
          />
        ) : (
          <meshBasicMaterial
            blending={AdditiveBlending}
            color="#ffffff"
            depthWrite={false}
            opacity={scenePlan.nodes.opacity}
            transparent
            toneMapped={false}
            vertexColors
          />
        )}
      </instancedMesh>
      {!reducedMotion
        && signalPositions.length > 0
        && (dimension !== 3 || (profile3d.signal.enabled && profile3d.signal.count > 0)) ? (
        <points
          frustumCulled={false}
          raycast={() => null}
          renderOrder={2.6}
        >
          <bufferGeometry ref={signalGeometryRef}>
            <bufferAttribute
              ref={signalPositionAttributeRef}
              attach="attributes-position"
              args={[signalPositions, 3]}
            />
            <bufferAttribute
              attach="attributes-pointColor"
              args={[signalPointColors, 3]}
            />
            <bufferAttribute
              attach="attributes-pointHierarchy"
              args={[signalPointHierarchy, 1]}
            />
            <bufferAttribute
              attach="attributes-pointScale"
              args={[signalPointScales, 1]}
            />
            <bufferAttribute
              attach="attributes-pointPhase"
              args={[signalPointPhases, 1]}
            />
          </bufferGeometry>
          <primitive attach="material" object={signalEnergyMaterial} />
        </points>
      ) : null}
      {labelAtlas && labelMaterial && labelSlotCount > 0 ? (
        <instancedMesh
          ref={labelMeshRef}
          args={[undefined, undefined, labelSlotCount]}
          frustumCulled={false}
          raycast={() => null}
          renderOrder={4}
        >
          <planeGeometry args={[1, 1]}>
            <instancedBufferAttribute
              ref={labelRectAttributeRef}
              attach="attributes-atlasRect"
              args={[labelRectAttribute.array, 4]}
            />
            <instancedBufferAttribute
              ref={labelColorAttributeRef}
              attach="attributes-labelTint"
              args={[labelColorAttribute.array, 3]}
            />
          </planeGeometry>
          <primitive attach="material" object={labelMaterial} />
        </instancedMesh>
      ) : null}
    </group>
  );
}
