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
  BufferAttribute,
  NormalBlending,
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
import { GRAPH_RADIANCE_SHADER, createGraphRadianceUniforms } from "./graph-radiance-shader.js";
import { GRAPH_CELL_SHADER } from "./graph-cell-shader.js";
import { createGraphCellRoles, createGraphCellVariations, writeGraphCellHighlights, usesGraphCellMaterial } from "./graph-cell-state.js";
import {
  createRestingRouteIndex, createFocusedRestingRoutePlan, getFocusedFilamentGain,
  writeFocusedRouteMask, writeFocusedSignalDistances, FOCUSED_SIGNAL_SHADER, advanceFocusedSignalTravel,
} from "./graph-focus-filament.js";
import { GraphCameraNavigation } from "./GraphCameraNavigation.jsx";
import {
  createNeuronEdgeView,
  createNeuronStructure,
  NEURON_EDGE_SEGMENTS,
  writeNeuronCurve,
} from "./graph-neuron-model.js";
import { createSpatialNeuronEdgeView, writeSpatialNeuronCurve } from "./graph-neuron-spatial-model.js";
import { createNeuronFilamentWeights, writeNeuronRibbonTangents } from "./graph-neuron-filament.js";
import {
  GRAPH_LABEL_DYNAMIC_SLOTS,
  MAX_GRAPH_LABEL_ATLAS_ENTRIES,
  createGraphLabelAtlas,
  ensureGraphLabelFont,
  selectGraphLabelIndices,
} from "./graph-label-atlas.js";
import { GRAPH_LABEL_LAYER } from "./graph-label-rendering.js";
import { createNeuronSphereModel, createNeuronSphereCurves } from "./graph-neuron-sphere-model.js";
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
  attribute float pointLayerScale;
  attribute vec2 pointCellRoles;
  attribute vec4 pointCellVariation;
  attribute float pointHighlight;
  uniform float pointLayering;
  uniform float pointCellStyle;
  uniform float pointAbsoluteLayer;
  uniform float pointOrbRadius;
  uniform float energyTime;
  uniform float pointSize;
  uniform float pointPerspectiveFloor;
  uniform float pointScaleVariation;
  uniform float pointCoreSizeScale;
  uniform float pointHaloRadiusScale;
  uniform float pulseAmount;
  uniform float pointPulseMotion;
  uniform float pointPulseVisibility;
  uniform float pulseRate;
  varying vec3 pointEnergyColor;
  varying float pointEnergyHierarchy;
  varying float pointDepthPresence;
  varying float pointPulseEnvelope;
  varying float pointPulse;
  varying float pointPulseWave;
  varying float pointCellRotation;
  varying float pointCellPrimary;
  varying float pointCellHighlight;
  varying vec3 pointCellColor;

  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    float centerDepth = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z;
    pointDepthPresence = smoothstep(-0.8, 0.65,
      (viewPosition.z - centerDepth) / max(1.0, pointOrbRadius));
    float perspective = clamp(520.0 / max(1.0, -viewPosition.z), pointPerspectiveFloor, 1.9);
    float scaleGain = mix(1.0, max(0.45, pointScale), pointScaleVariation);
    scaleGain = mix(scaleGain, mix(1.0, pointLayerScale, pointScaleVariation), pointAbsoluteLayer);
    float pulseStrength = clamp(pulseAmount, 0.0, 2.0);
    float pulsePhase = energyTime * 1.18 * pulseRate + pointPhase * 0.42;
    pointEnergyColor = pointColor;
    pointCellRotation = pointPhase * 0.71;
    pointCellPrimary = mix(pointCellRoles.x, pointCellRoles.y, pointAbsoluteLayer);
    pointCellHighlight = pointHighlight;
    pointCellColor = pointCellVariation.rgb;
    pointEnergyHierarchy = pointHierarchy;
    pointEnergyHierarchy = mix(pointEnergyHierarchy, clamp(pointLayerScale / 2.5, 0.1, 1.0), pointAbsoluteLayer);
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
      * mix(1.0, mix(pointCellVariation.w, 1.0, pointCellPrimary), pointCellStyle)
      * mix(1.0, pointLayerScale, pointLayering)
      * pointPulse
      * pointPulseEnvelope
      * mix(max(1.0, max(pointCoreSizeScale, pointHaloRadiusScale)),
        pointCoreSizeScale * 0.80, pointCellStyle)
      * perspective;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const ENERGY_POINT_FRAGMENT_SHADER = `
  ${GRAPH_RADIANCE_SHADER}
  uniform vec3 energyColor;
  uniform float orbStyle;
  uniform float pointCellStyle;
  uniform float pointColorVariation;
  uniform float pointDepthContrast;
  uniform float pointCoreEmissionIntensity;
  uniform float pointCoreOpacity;
  uniform float pointCoreSizeScale;
  uniform float pointHaloRadiusScale;
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
  varying float pointDepthPresence;
  varying float pointPulseEnvelope;
  varying float pointPulse;
  varying float pointPulseWave;

  ${GRAPH_CELL_SHADER}

  void main() {
    if (pointCellStyle > 0.5) {
      gl_FragColor = graphCellSurface(gl_PointCoord,
        mix(energyColor, pointEnergyColor, pointColorVariation));
      gl_FragColor.a *= mix(1.0, mix(0.12, 1.0, pointDepthPresence), pointDepthContrast);
      return;
    }
    float spriteRadius = length(gl_PointCoord - vec2(0.5)) * 2.0;
    if (spriteRadius > 1.0) discard;
    float radius = spriteRadius * pointPulseEnvelope
      * max(1.0, max(pointCoreSizeScale, pointHaloRadiusScale));
    float coreRadius = radius / pointCoreSizeScale;
    float haloRadius = radius / pointHaloRadiusScale;
    float originalHalo = pow(max(0.0, 1.0 - haloRadius), 2.15);
    float originalCore = pow(max(0.0, 1.0 - coreRadius), 8.0);
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
    float orbHalo = exp(-haloRadius * haloRadius * 5.5)
      * (1.0 - smoothstep(0.72, 1.0, haloRadius));
    float orbCore = 1.0 - smoothstep(0.0, 0.64, coreRadius);
    float spark = 1.0 - smoothstep(0.0, 0.14, coreRadius);
    float hierarchy = clamp(pointEnergyHierarchy, 0.0, 1.0);
    float hierarchyCore = smoothstep(0.62, 1.0, hierarchy);
    float orbCoreMix = (orbCore * 0.76 + spark * 0.24)
      * whiteCore * mix(0.06, 0.82, hierarchyCore)
      * pointCoreVisibility;
    // A small incandescent center sits inside the colored core. Increasing
    // emission heats this center without whitening the entire halo.
    float thermalCore = pow(max(0.0, 1.0 - coreRadius / 0.42), 2.0)
      * smoothstep(1.0, 3.0, pointCoreEmissionIntensity)
      * mix(0.4, 0.8, hierarchy) * pointCoreVisibility * whiteCore;
    orbCoreMix = max(orbCoreMix, thermalCore);
    vec3 orbBaseColor = mix(energyColor, pointEnergyColor, pointColorVariation);
    vec3 orbColor = mix(orbBaseColor, vec3(1.0), orbCoreMix)
      * mix(1.0, 1.26, hierarchy);
    float pointHeat = (0.3 + 0.78 * pow(orbCore, mix(0.65, 1.5, radianceFocus)))
      * smoothstep(0.3, 2.6, pointCoreEmissionIntensity);
    orbColor = mix(orbColor, graphRadianceColor(orbBaseColor, pointHeat), radianceTemperature);
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
        * mix(1.0, mix(0.12, 1.0, pointDepthPresence), pointDepthContrast)
    );
  }
`;

const ENERGY_LINE_VERTEX_SHADER = `
  attribute vec3 edgeStart;
  attribute vec3 edgeEnd;
  attribute vec3 edgeTangentStart;
  attribute vec3 edgeTangentEnd;
  attribute vec2 edgeFilamentWeights;
  attribute vec3 edgeColorStart;
  attribute vec3 edgeColorEnd;
  attribute float edgeWidth;
  attribute float edgeEnergy;
  attribute float edgeFocus;
  attribute vec4 edgeSignalDistances;
  uniform vec2 viewportSize;
  uniform float lineHaloRadiusScale;
  uniform float lineHaloVisibility;
  uniform float lineWidthByStrength;
  uniform float lineWidthScale;
  uniform float lineOrbRadius;
  uniform float lineFilamentEnabled;
  uniform float lineTaper;
  uniform float lineRootWidth;
  uniform float linePerspective;
  varying vec3 energyLineColor;
  varying float energyLineCoreBoundary;
  varying float energyLineDistance;
  varying float energyLineProgress;
  varying float energyLineStrength;
  varying float energyLineDepthPresence;
  varying float energyLineBranchPresence;
  varying float energyLineGlint;
  varying float energyLineWorldWidth;
  varying float energyLineFocus;
  varying vec2 energyLineSignalDistance;

  void main() {
    vec4 startView = modelViewMatrix * vec4(edgeStart, 1.0);
    vec4 endView = modelViewMatrix * vec4(edgeEnd, 1.0);
    // Clip before screen-space extrusion: dividing behind-camera endpoints by
    // a positive epsilon creates enormous streaks when dollying into the graph.
    const float nearZ = -0.1;
    if (startView.z > nearZ && endView.z > nearZ) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    if (startView.z > nearZ) {
      startView = mix(startView, endView, (nearZ - startView.z) / (endView.z - startView.z));
    }
    if (endView.z > nearZ) {
      endView = mix(endView, startView, (nearZ - endView.z) / (startView.z - endView.z));
    }
    vec4 startClip = projectionMatrix * startView;
    vec4 endClip = projectionMatrix * endView;
    vec2 safeViewport = max(viewportSize, vec2(1.0));
    vec2 startNdc = startClip.xy / max(0.001, startClip.w);
    vec2 endNdc = endClip.xy / max(0.001, endClip.w);
    vec2 screenDirection = (endNdc - startNdc) * safeViewport;
    float along = position.x;
    float side = position.y;
    vec4 clipPosition = mix(startClip, endClip, along);
    // Shared endpoint tangents give adjacent ribbon segments the same join.
    vec4 tangentClip = projectionMatrix * modelViewMatrix
      * vec4(mix(edgeTangentStart, edgeTangentEnd, along), 0.0);
    vec3 tangentWorld = (modelMatrix
      * vec4(mix(edgeTangentStart, edgeTangentEnd, along), 0.0)).xyz;
    float lightAcross = clamp(1.0 - abs(dot(tangentWorld / max(0.001, length(tangentWorld)),
      normalize(vec3(-0.6, 0.5, 0.7)))), 0.0, 1.0);
    energyLineGlint = 0.12 + 0.88 * pow(lightAcross, 3.0);
    vec2 tangentDirection = (tangentClip.xy * clipPosition.w
      - clipPosition.xy * tangentClip.w) * safeViewport;
    if (lineFilamentEnabled > 0.0 && dot(tangentDirection, tangentDirection) > 0.000001) {
      screenDirection = tangentDirection;
    }
    float screenLength = max(0.001, length(screenDirection));
    vec2 screenNormal = vec2(-screenDirection.y, screenDirection.x) / screenLength;
    float centerDepth = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z;
    energyLineDepthPresence = smoothstep(-0.8, 0.65,
      (mix(startView.z, endView.z, along) - centerDepth) / max(1.0, lineOrbRadius));
    float strength = clamp(edgeEnergy, 0.0, 1.0);
    float hierarchyWidth = mix(
      1.0,
      max(1.0, edgeWidth / 0.48),
      lineWidthByStrength
    );
    energyLineBranchPresence = mix(edgeFilamentWeights.x, edgeFilamentWeights.y, along);
    float widthProfile = mix(1.0,
      0.32 + (lineRootWidth - 0.32) * pow(energyLineBranchPresence, 1.18),
      lineTaper * lineFilamentEnabled);
    float perspectiveWidth = mix(1.0,
      clamp(720.0 / max(0.1, -mix(startView.z, endView.z, along)), 0.55, 1.7),
      linePerspective * lineFilamentEnabled);
    float modelWidth = 0.48
      * mix(hierarchyWidth, 1.0 + (hierarchyWidth - 1.0) * 0.35, lineFilamentEnabled)
      * lineWidthScale * widthProfile;
    float worldScale = length(modelMatrix[0].xyz);
    energyLineWorldWidth = modelWidth * worldScale;
    float coreWidthPixels = max(mix(0.0, 0.2, lineFilamentEnabled), modelWidth * perspectiveWidth);
    float haloStrength = pow(strength, 1.35);
    float haloPixels = (2.4 + haloStrength * 6.8)
      * lineHaloRadiusScale
      * lineHaloVisibility
      * mix(1.0, clamp(sqrt(widthProfile) * 0.6, 0.24, 1.4)
        * perspectiveWidth, lineFilamentEnabled);
    // Rasterize enough area for one-pixel coverage even without a local halo.
    // This padding carries no glow; it prevents subpixel ribbons dropping out.
    float expandedWidthPixels = coreWidthPixels + max(haloPixels, lineFilamentEnabled * 0.9);
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
      0.001,
      0.82
    );
    energyLineDistance = side;
    energyLineProgress = along;
    energyLineStrength = edgeEnergy;
    energyLineFocus = edgeFocus;
    energyLineSignalDistance = mix(edgeSignalDistances.xz, edgeSignalDistances.yw, along);
  }
`;

const ENERGY_LINE_FRAGMENT_SHADER = `
  ${GRAPH_RADIANCE_SHADER}
  ${FOCUSED_SIGNAL_SHADER}
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
  uniform float lineDepthContrast;
  uniform float lineSegmented;
  uniform float lineFilamentEnabled;
  uniform float lineRoundness;
  uniform float lineTranslucency;
  uniform float lineFocusGain;
  uniform float lineSignalGain;
  uniform vec3 lineHotColor;
  varying vec3 energyLineColor;
  varying float energyLineCoreBoundary;
  varying float energyLineDistance;
  varying float energyLineProgress;
  varying float energyLineStrength;
  varying float energyLineDepthPresence;
  varying float energyLineBranchPresence;
  varying float energyLineGlint;
  varying float energyLineWorldWidth;
  varying float energyLineFocus;

  void main() {
    float lineDistance = abs(energyLineDistance);
    float coreFeather = mix(max(0.018, energyLineCoreBoundary * 0.3),
      max(energyLineCoreBoundary * 0.12, fwidth(energyLineDistance) * 0.7),
      lineFilamentEnabled);
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
    float endpointFade = mix(min(
      smoothstep(0.0, 0.018, energyLineProgress),
      smoothstep(0.0, 0.018, 1.0 - energyLineProgress)
    ), 1.0, lineSegmented);
    float strength = clamp(energyLineStrength, 0.0, 1.0);
    float coreGain = smoothstep(0.18, 1.0, strength);
    float coreStrengthAlpha = mix(
      1.0,
      mix(0.1, 1.0, pow(strength, 1.45)),
      lineCoreEmissionByStrength
    );
    float across = clamp(energyLineDistance / max(0.001, energyLineCoreBoundary), -1.0, 1.0);
    // Average the section when it is smaller than a pixel, so fine tips do not
    // flicker as the narrow highlight crosses individual screen pixels.
    float resolvedSection = smoothstep(0.65, 1.8,
      energyLineCoreBoundary / max(0.0001, fwidth(energyLineDistance)));
    float sectionHeight = mix(0.8, sqrt(max(0.0, 1.0 - across * across)), resolvedSection);
    float hotSpine = mix(0.22, exp(-pow((across + 0.18) / 0.28, 2.0)), resolvedSection);
    float crest = mix(energyLineGlint, pow(energyLineGlint, 2.2), radianceFocus);
    // Share the existing longitudinal transparency profile with emission.
    // Cross-section antialiasing only filters coverage, never thermal color.
    float materialDensity = 0.3 + 0.52 * sqrt(energyLineBranchPresence);
    float transmission = mix(1.0,
      materialDensity * mix(0.55, 1.0, sectionHeight),
      lineTranslucency * lineFilamentEnabled);
    transmission *= mix(1.0, 0.72 + 0.28 * hotSpine * crest, radianceFocus);
    float coreAlpha = core
      * coreStrengthAlpha
      * lineCoreOpacity
      * lineCoreVisibility
      * transmission;
    float haloStrengthAlpha = mix(
      1.0,
      mix(0.22, 1.0, pow(strength, 1.3)),
      lineHaloByStrength
    );
    float haloAlpha = halo
      * lineHaloOpacity
      * haloStrengthAlpha
      * lineHaloVisibility
      * transmission;
    float alpha = lineMasterOpacity
      * endpointFade
      * mix(1.0, mix(0.12, 1.0, energyLineDepthPresence), lineDepthContrast)
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
    // A warm translucent body and narrow off-center glint suggest a round
    // section without tube geometry, lights or an additional render pass.
    vec3 roundedColor = mix(
      energyLineColor * (0.42 + 0.58 * sectionHeight),
      lineHotColor,
      hotSpine * (0.38 + energyLineBranchPresence * 0.5) * energyLineGlint
    ) * lineCoreEmissionIntensity * coreEmissionGain;
    coreColor = mix(coreColor, roundedColor, lineRoundness * lineFilamentEnabled);
    // Each connection follows its own transparency gradient. Total arc length,
    // camera Z and projected width cannot change its intrinsic light profile.
    float densityResponse = clamp((materialDensity - 0.3) / 0.52, 0.0, 1.0);
    float thicknessHeat = smoothstep(0.12, 2.6, energyLineWorldWidth);
    float gradientEnergy = 0.2 + 0.7 * densityResponse + 0.08 * thicknessHeat;
    float heat = mix(0.68, gradientEnergy, radianceTransmissionLink)
      * clamp(lineCoreEmissionIntensity * coreEmissionGain / 1.8, 0.0, 1.25);
    vec3 luminousCore = graphRadianceColor(energyLineColor, heat)
      * lineCoreEmissionIntensity * coreEmissionGain
      * mix(1.0, 0.58 + 0.7 * densityResponse, radianceTransmissionLink)
      * mix(1.0, 0.58 + 0.42 * sectionHeight + 0.25 * hotSpine * crest,
        lineRoundness * lineFilamentEnabled);
    coreColor = mix(coreColor, luminousCore, radianceTemperature);
    haloColor = mix(haloColor,
      graphRadianceColor(lineHaloColor, heat * 0.28)
        * haloColorGain * lineHaloEmissionIntensity,
      radianceTemperature);
    float coreMix = coreAlpha / max(0.0001, coreAlpha + haloAlpha);
    vec3 signalLight = vec3(0.0);
    if (energyLineFocus > 0.0 && lineSignalTravel >= 0.0) {
      // Use the brighter packet at crossings instead of doubling shared light.
      vec2 packet = max(focusedSignal(energyLineSignalDistance.x), focusedSignal(energyLineSignalDistance.y));
      signalLight = (
        graphRadianceColor(energyLineColor, 1.1) * packet.x * 7.0
        + graphRadianceColor(energyLineColor, 0.74) * packet.y * 1.7
      ) * lineCoreEmissionIntensity * coreEmissionGain * coreMix * lineSignalGain;
    }
    gl_FragColor = vec4(
      // Boost the completed resting gradient, without raising its heat input
      // or flattening the orange body into a uniformly yellow/white stroke.
      mix(haloColor, coreColor, coreMix) * mix(1.0, lineFocusGain, energyLineFocus) + signalLight,
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
  uniform vec2 labelViewport;
  varying vec2 vAtlasUv;
  varying vec3 vLabelTint;

  void main() {
    vec4 center = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float width = length(instanceMatrix[0].xyz);
    float height = length(instanceMatrix[1].xyz);
    vAtlasUv = atlasRect.xy + uv * atlasRect.zw;
    vLabelTint = labelTint;
    gl_Position = projectionMatrix * center;
    // Project only the anchor. Glyph dimensions stay in framebuffer pixels while
    // orbiting or zooming, so neither distance nor hover resamples the text.
    vec2 pixel = (gl_Position.xy / gl_Position.w * 0.5 + 0.5) * labelViewport
      + (position.xy + vec2(0.5, 0.0)) * vec2(width, height);
    gl_Position.xy = (floor(pixel + 0.5) / labelViewport * 2.0 - 1.0) * gl_Position.w;
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
    #include <colorspace_fragment>
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
    layout.depth,
    layout.branchSpread,
    layout.repulsion,
    layout.linkDistance,
    layout.linkStrength,
    layout.collision,
    layout.center,
    layout.edgeBudget,
    layout.tickBudget,
    layout.nodeScale,
    layout.hubScale,
  ].map((value) => Number(value).toFixed(3)).join(":") + `:${layout.mode ?? "force"}`;
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
    depthTest: false,
    depthWrite: false,
    fragmentShader: LABEL_FRAGMENT_SHADER,
    transparent: true,
    toneMapped: false,
    uniforms: {
      labelAtlas: { value: texture },
      labelOpacity: { value: opacity },
      labelViewport: { value: new Vector2(1, 1) },
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
      ...createGraphRadianceUniforms(),
      energyColor: { value: new Color(color) },
      energyTime: { value: 0 },
      orbStyle: { value: 0 },
      pointCellStyle: { value: 0 },
      pointAbsoluteLayer: { value: 0 },
      pointColorVariation: { value: 0 },
      pointDepthContrast: { value: 0 },
      pointOrbRadius: { value: 188 },
      pointCoreEmissionIntensity: { value: 1 },
      pointCoreOpacity: { value: 1 },
      pointCoreSizeScale: { value: 1 },
      pointHaloRadiusScale: { value: 1 },
      pointCoreVisibility: { value: 1 },
      pointHaloEmissionIntensity: { value: 1 },
      pointHaloOpacity: { value: 1 },
      pointHaloVisibility: { value: 1 },
      pointOpacity: { value: pointOpacity },
      pointSize: { value: pointSize },
      pointPerspectiveFloor: { value: 0.68 },
      pointScaleVariation: { value: 0 },
      pointLayering: { value: 0 },
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
  onCameraViewChange,
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
  const profile3d = useMemo(() => ({
    ...scenePlan.profiles[`${dimension}d`],
    // Orb-only layers are never visible in 2D.
    orb: scenePlan.profiles["3d"].orb,
  }), [dimension, scenePlan.profiles]);
  const profile3dRef = useRef(profile3d);
  profile3dRef.current = profile3d;
  const fxRevisionKey = JSON.stringify(profile3d);
  const edgeBudget = scenePlan.edges.count;
  const neuronMode = scenePlan.layout.mode === "neuron";
  const neuronSphere = scenePlan.idleShape === "neuronSphere";
  const sharedStyle = scenePlan.sharedStyle === true;
  const spatialNeuron = neuronMode && dimension === 3;
  const edgeSegments = neuronMode ? NEURON_EDGE_SEGMENTS : 1;
  const model = useMemo(
    () => {
      const topology = createGraphTopologyModel(graph, {
        dimension, labelBudget: MAX_GRAPH_LABEL_ATLAS_ENTRIES,
      });
      if (neuronMode) {
        topology.neuron = createNeuronStructure(topology.nodes, topology.layoutEdges);
        topology.hubMask = topology.neuron.rootMask;
        topology.sizes = Float32Array.from(topology.sizes, (size, index) => (
          topology.hubMask[index] ? 3.6 : 0.42 + Math.sqrt(topology.degrees[index]) * 0.16
        ));
        topology.labelIndices = [...topology.neuron.roots, ...topology.labelIndices.filter(
          (index) => !topology.hubMask[index],
        )];
      }
      return topology;
    },
    [dimension, graph, neuronMode],
  );
  const renderEdges = useMemo(
    () => spatialNeuron ? createSpatialNeuronEdgeView(model, edgeBudget, scenePlan.layout.crossLinks)
      : model.neuron ? createNeuronEdgeView(model, edgeBudget) : createGraphEdgeView(model, edgeBudget),
    [edgeBudget, model, scenePlan.layout.crossLinks, spatialNeuron],
  );
  const edgeCapacity = renderEdges.length;
  const morphSeed = Number.parseInt(model.topologyKey, 36) || 0x4a415256;
  const shellEdgeCount = Math.min(
    768,
    Math.max(edgeCapacity, Math.round(model.nodes.length * 3)),
  );
  const orbMorphModel = useMemo(
    () => neuronSphere ? createNeuronSphereModel(model.nodes, {
      radius: 265 * profile3d.orb.network.sizeScale,
      branchSpread: profile3d.orb.network.branchSpread,
      degrees: model.degrees, density: profile3d.orb.network.density, shellRatio: profile3d.orb.network.shellRatio,
      edgeCount: edgeCapacity,
    }) : createGraphOrbMorphModel(model.nodes, edgeCapacity, {
      radius: 188,
      seed: morphSeed,
      shellEdgeCount: Math.round(Math.max(4, Math.round(model.nodes.length * profile3d.orb.network.shellRatio)) * profile3d.orb.network.density),
      shellRatio: profile3d.orb.network.shellRatio,
    }),
    [edgeCapacity, model.nodes, model.degrees, morphSeed, neuronSphere, profile3d.orb.network.sizeScale, profile3d.orb.network.branchSpread, profile3d.orb.network.density, profile3d.orb.network.shellRatio],
  );
  const sphereCurves = useMemo(() => neuronSphere ? createNeuronSphereCurves(orbMorphModel, 24, profile3d.orb.network.weave) : null,
    [neuronSphere, orbMorphModel, profile3d.orb.network.weave]);
  const sphereLineRef = useRef(null);
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
    (dimension === 3 ? orbMorphModel.shellEdgePairs.length : planarMorphModel.shellEdgePairs.length) / 2 - edgeCapacity,
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
  const restingRouteIndex = useMemo(
    () => createRestingRouteIndex(model.nodes, renderEdges),
    [model.nodes, renderEdges],
  );
  const focusedRoutePlan = useMemo(
    () => neuronMode ? createFocusedRestingRoutePlan(
      restingRouteIndex, focusedEdges, [selectedNodeId, hoveredNodeId],
    ) : { edges: new Set(), trees: [] },
    [neuronMode, restingRouteIndex, focusedEdges, selectedNodeId, hoveredNodeId],
  );
  const focusedRouteEdges = focusedRoutePlan.edges;
  const edgeFocusAttribute = useMemo(
    () => new InstancedBufferAttribute(new Float32Array(edgeCapacity * edgeSegments), 1).setUsage(DynamicDrawUsage),
    [edgeCapacity, edgeSegments],
  );
  const edgeSignalDistanceAttribute = useMemo(
    () => new InstancedBufferAttribute(new Float32Array(edgeCapacity * edgeSegments * 4).fill(-1), 4).setUsage(DynamicDrawUsage),
    [edgeCapacity, edgeSegments],
  );
  const focusedSignalTravelRef = useRef(0);
  const focusedSignalMaximumRef = useRef(0);
  useLayoutEffect(() => {
    writeFocusedRouteMask(edgeFocusAttribute.array, focusedRouteEdges, edgeSegments,
      neuronMode && presentationTarget === 1);
    edgeFocusAttribute.needsUpdate = true;
    invalidate();
  }, [edgeFocusAttribute, focusedRouteEdges, edgeSegments, neuronMode, presentationTarget, invalidate]);
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
  const energyLineTangentStartAttributeRef = useRef(null);
  const energyLineTangentEndAttributeRef = useRef(null);
  const shellEdgeObjectRef = useRef(null);
  const baseEdgeGeometryRef = useRef(null);
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
  const positionedModelRef = useRef(null);
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
    () => new Float32Array(edgeCapacity * 6 * edgeSegments),
    [edgeCapacity, edgeSegments],
  );
  const edgeColors = useMemo(
    () => new Float32Array(edgeCapacity * 6 * edgeSegments),
    [edgeCapacity, edgeSegments],
  );
  const energyLineStarts = useMemo(
    () => new Float32Array(edgeCapacity * edgeSegments * 3),
    [edgeCapacity, edgeSegments],
  );
  const energyLineEnds = useMemo(
    () => new Float32Array(edgeCapacity * edgeSegments * 3),
    [edgeCapacity, edgeSegments],
  );
  const updateFocusedSignals = useCallback(() => {
    focusedSignalMaximumRef.current = writeFocusedSignalDistances(edgeSignalDistanceAttribute.array, focusedRoutePlan,
      edgeSegments, energyLineStarts, energyLineEnds);
    edgeSignalDistanceAttribute.needsUpdate = true;
  }, [edgeSignalDistanceAttribute, focusedRoutePlan, edgeSegments, energyLineStarts, energyLineEnds]);
  useLayoutEffect(() => {
    updateFocusedSignals();
    focusedSignalTravelRef.current = 0;
    invalidate();
  }, [updateFocusedSignals, presentationTarget, reducedMotion, invalidate]);
  const energyLineTangentStarts = useMemo(
    () => new Float32Array(edgeCapacity * edgeSegments * 3),
    [edgeCapacity, edgeSegments],
  );
  const energyLineTangentEnds = useMemo(
    () => new Float32Array(edgeCapacity * edgeSegments * 3),
    [edgeCapacity, edgeSegments],
  );
  const energyLineFilamentWeights = useMemo(
    () => createNeuronFilamentWeights(model.nodes.length, model.neuron, renderEdges, edgeSegments),
    [model.nodes.length, model.neuron, renderEdges, edgeSegments],
  );
  const innerShellEdgePositions = useMemo(
    () => new Float32Array(Math.min(768, orbMorphModel.shellEdgePairs.length / 2) * 6),
    [orbMorphModel.shellEdgePairs.length],
  );
  const extraShellEdgePositions = useMemo(
    () => new Float32Array(extraShellEdgeCount * 6),
    [extraShellEdgeCount],
  );
  const focusedEdgePositions = useMemo(
    () => new Float32Array(neuronMode ? 0 : focusedEdgeBudget * 6 * edgeSegments),
    [neuronMode, focusedEdgeBudget, edgeSegments],
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
    () => {
      const style = createNodeEnergyStyle(model, palette);
      if (model.neuron) {
        model.nodes.forEach((_, index) => {
          style.scales[index] = model.hubMask[index]
            ? 2.2 * scenePlan.nodes.hubScale / 1.8
            : 0.45 + Math.min(0.45, model.degrees[index] * 0.007);
          palette.selected.toArray(style.colors, index * 3);
        });
      }
      return style;
    },
    [model, palette, scenePlan.nodes.hubScale],
  );
  const nodeCellRoles = useMemo(
    () => createGraphCellRoles(model, orbMorphModel.rootMask ?? model.hubMask),
    [model, orbMorphModel.rootMask],
  );
  const nodeCellVariations = useMemo(
    () => createGraphCellVariations(model, scenePlan.nodes.activeColor),
    [model, scenePlan.nodes.activeColor],
  );
  const nodeHighlightAttribute = useMemo(
    () => new BufferAttribute(new Float32Array(model.nodes.length), 1).setUsage(DynamicDrawUsage),
    [model.nodes.length],
  );
  useLayoutEffect(() => {
    writeGraphCellHighlights(nodeHighlightAttribute.array, model.nodes, adjacentNodeIds, presentationTarget === 1);
    nodeHighlightAttribute.needsUpdate = true;
    invalidate();
  }, [adjacentNodeIds, invalidate, model.nodes, nodeHighlightAttribute, presentationTarget]);
  const edgeEnergyStyle = useMemo(
    () => {
      const style = createEdgeEnergyStyle(model, renderEdges, palette);
      if (edgeSegments === 1) return style;
      // The selected relation color supplies the body; the filament shader adds local glints.
      for (let index = 0; index < renderEdges.length; index += 1) {
        edgeBaseColor.toArray(style.sourceColors, index * 3);
        edgeBaseColor.toArray(style.targetColors, index * 3);
      }
      return Object.fromEntries(Object.entries(style).map(([key, values]) => {
        const stride = key.endsWith("Colors") ? 3 : 1;
        const expanded = new Float32Array(values.length * edgeSegments);
        for (let index = 0; index < renderEdges.length; index += 1) {
          for (let segment = 0; segment < edgeSegments; segment += 1) {
            for (let channel = 0; channel < stride; channel += 1) {
              expanded[(index * edgeSegments + segment) * stride + channel] = values[index * stride + channel];
            }
          }
        }
        return [key, expanded];
      }));
    },
    [edgeBaseColor, edgeSegments, model, palette, renderEdges],
  );
  const relationHaloQualityScale = runtime?.qualityProfile?.id === "high"
    ? 1.12
    : runtime?.qualityProfile?.id === "low" ? 0.88 : 1;
  const energyLineMaterial = useMemo(() => new ShaderMaterial({
    blending: NormalBlending,
    depthTest: false,
    depthWrite: false,
    fragmentShader: ENERGY_LINE_FRAGMENT_SHADER,
    side: DoubleSide,
    toneMapped: false,
    transparent: true,
    uniforms: {
      ...createGraphRadianceUniforms(),
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
      lineDepthContrast: { value: 0 },
      lineSegmented: { value: 0 },
      lineFilamentEnabled: { value: 0 },
      lineTaper: { value: 0 },
      lineRootWidth: { value: 4.2 },
      lineRoundness: { value: 0 },
      lineTranslucency: { value: 0 },
      lineFocusGain: { value: 1 },
      lineSignalTravel: { value: -1 },
      lineSignalGain: { value: 1 },
      linePerspective: { value: 0 },
      lineHotColor: { value: new Color(scenePlan.nodes.hubColor) },
      lineOrbRadius: { value: 188 },
      lineWidthByStrength: { value: 1 },
      lineWidthScale: { value: 1 },
      viewportSize: { value: new Vector2(1, 1) },
    },
    vertexShader: ENERGY_LINE_VERTEX_SHADER,
  }), [scenePlan.nodes.activeColor, scenePlan.nodes.hubColor]);
  const energyLineUniforms = energyLineMaterial.uniforms;
  const sphereLineMaterial = useMemo(() => {
    const material = energyLineMaterial.clone();
    material.uniforms = {
      ...energyLineMaterial.uniforms,
      lineMasterOpacity: { value: 0 }, lineSegmented: { value: 1 }, lineHaloVisibility: { value: 0 },
    };
    return material;
  }, [energyLineMaterial]);
  const sphereLineColors = useMemo(() => {
    const colors = new Float32Array(sphereCurves?.starts.length ?? 0);
    for (let offset = 0; offset < colors.length; offset += 3) edgeBaseColor.toArray(colors, offset);
    return colors;
  }, [sphereCurves, edgeBaseColor]);
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
  const labelDpr = runtime?.effectiveDpr ?? 1;
  const labelRasterSize = Math.round(scenePlan.labels.fontSize * labelDpr);
  const labelAtlas = useMemo(() => {
    if (typeof document === "undefined") return null;
    return createGraphLabelAtlas([
      ...labelBaseIndices.map((nodeIndex) => model.nodes[nodeIndex]?.title),
      "",
      "",
    ], null, labelRasterSize);
  }, [labelBaseIndices, labelRasterSize, model.nodes]);
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
  const labelAtlasDisposalRef = useRef(null);

  useEffect(() => {
    lastPickedNodeIdRef.current = hoveredNodeId;
  }, [hoveredNodeId]);

  const getNodeColor = useCallback((nodeIndex) => {
    const node = model.nodes[nodeIndex];
    if (neuronMode) {
      return node.id === selectedNodeId || node.id === hoveredNodeId ? palette.base : palette.selected;
    }
    return resolveNodeColor(node, nodeIndex, {
      adjacent: adjacentNodeIds.has(node.id),
      hovered: node.id === hoveredNodeId,
      selected: node.id === selectedNodeId,
    }, model.hubMask, palette);
  }, [adjacentNodeIds, hoveredNodeId, model.hubMask, model.nodes, neuronMode, palette, selectedNodeId]);

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
        + (hierarchy - 0.48)
          * 0.52
          * fx3d.node.size.byImportance;
      const masterScale = fx3d.node.master.scale;
      const size = model.sizes[index]
        * scenePlan.nodes.scale
        * hubMultiplier
        * presentationScale
        * energyPointScale
        * hierarchyScale
        * masterScale;
      const coreSize = size * fx3d.node.core.sizeScale;
      NODE_MATRIX.makeScale(coreSize, coreSize, dimension === 3 ? coreSize : 1);
      NODE_MATRIX.setPosition(
        positions[offset],
        positions[offset + 1],
        positions[offset + 2],
      );
      mesh?.setMatrixAt(index, NODE_MATRIX);
      if (haloMesh) {
        const baseHaloScale = dimension === 3 ? 1.52 : 1.74;
        const haloScale = baseHaloScale
          * fx3d.node.halo.radiusScale;
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
    const visibleCount = dimension === 3 && progress < 0.001
      ? Math.min(renderEdges.length, shellEdgePairs.length / 2)
      : renderEdges.length;
    baseEdgeGeometryRef.current?.setDrawRange(0, visibleCount * 2 * edgeSegments);
    if (energyLineObjectRef.current) energyLineObjectRef.current.geometry.instanceCount = visibleCount * edgeSegments;
    renderEdges.forEach((edge, index) => {
      const sourceOffset = edge.sourceIndex * 3;
      const targetOffset = edge.targetIndex * 3;
      const edgeOffset = index * 6 * edgeSegments;
      if (model.neuron && (dimension === 2 || progress >= 0.999)) {
        if (dimension === 3) {
          writeSpatialNeuronCurve(edgePositions, edgeOffset, positions, edge, model.neuron, edgeSegments, scenePlan.layout.weave);
        } else {
          writeNeuronCurve(edgePositions, edgeOffset, positions, edge, model.neuron, edgeSegments, progress);
        }
        const isCross = model.neuron.cluster[edge.sourceIndex] !== model.neuron.cluster[edge.targetIndex];
        const isHub = model.hubMask[edge.sourceIndex] || model.hubMask[edge.targetIndex];
        const energy = isCross ? 2.8 : isHub ? 3.5 : 2.2;
        const color = EDGE_ORB_SOURCE_COLOR.copy(edgeBaseColor).lerp(palette.base, 0.045).multiplyScalar(energy);
        for (let segment = 0; segment < edgeSegments; segment += 1) {
          color.toArray(edgeColors, edgeOffset + segment * 6);
          color.toArray(edgeColors, edgeOffset + segment * 6 + 3);
          const energyOffset = (index * edgeSegments + segment) * 3;
          for (let axis = 0; axis < 3; axis += 1) {
            energyLineStarts[energyOffset + axis] = edgePositions[edgeOffset + segment * 6 + axis];
            energyLineEnds[energyOffset + axis] = edgePositions[edgeOffset + segment * 6 + 3 + axis];
          }
        }
        return;
      }
      if (useIdleShell) {
        const shellSource = shellEdgePairs[index * 2] ?? edge.sourceIndex;
        const shellTarget = shellEdgePairs[index * 2 + 1] ?? (dimension === 3 ? shellSource : edge.targetIndex);
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
      const energyOffset = index * edgeSegments * 3;
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
      const orbLineWeight = dimensionProgress;
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
      if (edgeSegments > 1) {
        // Idle keeps the accepted spatial shell. Subdivide its straight chord
        // into the same buffer capacity used by the exploration curves.
        const ax = edgePositions[edgeOffset];
        const ay = edgePositions[edgeOffset + 1];
        const az = edgePositions[edgeOffset + 2];
        const dx = edgePositions[edgeOffset + 3] - ax;
        const dy = edgePositions[edgeOffset + 4] - ay;
        const dz = edgePositions[edgeOffset + 5] - az;
        for (let segment = 0; segment < edgeSegments; segment += 1) {
          const t0 = segment / edgeSegments;
          const t1 = (segment + 1) / edgeSegments;
          const offset = edgeOffset + segment * 6;
          edgePositions.set([ax + dx * t0, ay + dy * t0, az + dz * t0, ax + dx * t1, ay + dy * t1, az + dz * t1], offset);
          sourceColor.toArray(edgeColors, offset);
          targetColor.toArray(edgeColors, offset + 3);
          for (let axis = 0; axis < 3; axis += 1) {
            energyLineStarts[energyOffset + segment * 3 + axis] = edgePositions[offset + axis];
            energyLineEnds[energyOffset + segment * 3 + axis] = edgePositions[offset + 3 + axis];
          }
        }
      }
    });
    writeNeuronRibbonTangents(energyLineStarts, energyLineEnds, edgeSegments,
      energyLineTangentStarts, energyLineTangentEnds);
    if (focusedRouteEdges.size > 0) updateFocusedSignals();
    if (energyLineTangentStartAttributeRef.current) energyLineTangentStartAttributeRef.current.needsUpdate = true;
    if (energyLineTangentEndAttributeRef.current) energyLineTangentEndAttributeRef.current.needsUpdate = true;
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
    edgeSegments,
    model.neuron,
    model.hubMask,
    energyLineEnds,
    energyLineStarts,
    energyLineTangentStarts,
    energyLineTangentEnds,
    orbMorphModel.shellEdgePairs,
    palette,
    planarMorphModel.shellEdgePairs,
    renderEdges,
    scenePlan.layout.weave,
    focusedRouteEdges,
    updateFocusedSignals,
  ]);

  const updateExtraShellEdges = useCallback((idlePositions, progress) => {
    const fx3d = profile3dRef.current;
    const dimensionProgress = easeGraphOrbMorph(dimensionProgressRef.current);
    const shellEdgePairs = dimensionProgress >= 0.5
      ? orbMorphModel.shellEdgePairs
      : planarMorphModel.shellEdgePairs;
    const dimensionVisibility = 0.32 + Math.abs(dimensionProgress - 0.5) * 1.36;
    for (let index = 0; index < innerShellEdgePositions.length / 6; index += 1) {
      const source = orbMorphModel.shellEdgePairs[index * 2] * 3;
      const target = orbMorphModel.shellEdgePairs[index * 2 + 1] * 3;
      innerShellEdgePositions.set(idlePositions.subarray(source, source + 3), index * 6);
      innerShellEdgePositions.set(idlePositions.subarray(target, target + 3), index * 6 + 3);
    }
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
      shellEdgeObjectRef.current.visible = !neuronSphere && progress < 0.998
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
      innerShellEdgeObjectRef.current.visible = !neuronSphere && fx3d.orb.innerNetwork.enabled
        && progress < 0.998
        && dimensionProgress > 0.002;
    }
  }, [
    edgeCapacity,
    extraShellEdgeCount,
    extraShellEdgePositions,
    innerShellEdgePositions,
    neuronSphere,
    orbMorphModel.shellEdgePairs,
    planarMorphModel.shellEdgePairs,
  ]);

  const updateFocusedEdges = useCallback((positions) => {
    if (neuronMode) return;
    focusedEdges.forEach((edge, index) => {
      const sourceOffset = edge.sourceIndex * 3;
      const targetOffset = edge.targetIndex * 3;
      const edgeOffset = index * 6 * edgeSegments;
      focusedEdgePositions[edgeOffset] = positions[sourceOffset];
      focusedEdgePositions[edgeOffset + 1] = positions[sourceOffset + 1];
      focusedEdgePositions[edgeOffset + 2] = dimension === 3 ? positions[sourceOffset + 2] : 0.35;
      focusedEdgePositions[edgeOffset + 3] = positions[targetOffset];
      focusedEdgePositions[edgeOffset + 4] = positions[targetOffset + 1];
      focusedEdgePositions[edgeOffset + 5] = dimension === 3 ? positions[targetOffset + 2] : 0.35;
    });
    focusedEdgeGeometryRef.current?.setDrawRange(0, focusedEdges.length * 2 * edgeSegments);
    if (focusedEdgePositionAttributeRef.current) {
      focusedEdgePositionAttributeRef.current.needsUpdate = true;
    }
  }, [dimension, edgeSegments, focusedEdgePositions, focusedEdges, neuronMode]);

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
    const color = palette.base;
    colorAttribute.setXYZ(slot, color.r, color.g, color.b);
    rectAttribute.needsUpdate = true;
    colorAttribute.needsUpdate = true;
  }, [labelColorAttribute, labelRectAttribute, labelSlotCount, palette.base]);

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
    gl.getDrawingBufferSize(labelMaterial.uniforms.labelViewport.value);
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
      const labelHeight = labelAtlas.layout.cellHeight;
      const labelWidth = (atlasEntry?.aspect ?? 2) * labelHeight;
      NODE_MATRIX.makeScale(labelWidth, labelHeight, 1);
      NODE_MATRIX.setPosition(
        positions[offset] + nodeSize + 4,
        positions[offset + 1] - (neuronMode ? 18 / camera.zoom : 0),
        dimension === 3 ? positions[offset + 2] : 1,
      );
      mesh.setMatrixAt(slot, NODE_MATRIX);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [
    camera,
    dimension,
    gl,
    labelAtlas,
    labelBaseIndices.length,
    labelMaterial,
    labelSlotCount,
    model,
    neuronMode,
    scenePlan.nodes.hubScale,
    scenePlan.nodes.scale,
  ]);

  const getLabelLodCount = useCallback(() => {
    if (labelBaseIndices.length === 0) return 0;
    if (neuronMode) return labelBaseIndices.length;
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
  }, [camera, labelBaseIndices.length, neuronMode]);

  const applyPresentationPositions = useCallback((linearProgress, elapsed = 0) => {
    const graphPositions = graphPositionsRef.current;
    if (!(graphPositions instanceof Float32Array)
      || graphPositions.length !== model.nodes.length * 3) return;
    const fx3d = profile3dRef.current;
    const progress = easeGraphOrbMorph(linearProgress);
    const neuronMaterials = usesGraphCellMaterial(neuronMode, neuronSphere, progress);
    const idleWeight = 1 - progress;
    const transitionEnergy = Math.sin(progress * Math.PI);
    const dimensionProgress = easeGraphOrbMorph(dimensionProgressRef.current);
    const threeDEnergyWeight = sharedStyle ? 1 : dimensionProgress;
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
    const graphPresentationScale = spatialNeuron ? 0.95 : dimension === 3 ? 1.72 : neuronMode ? 0.8 : 1.18;
    let spatialRadius = 1;

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
      if (spatialNeuron) spatialRadius = Math.max(spatialRadius, Math.hypot(
        graphFramePositions[offset], graphFramePositions[offset + 1], graphFramePositions[offset + 2],
      ));
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
    if (!neuronSphere || progress > 0.001) updateEdges(displayPositions, graphFramePositions, idleFramePositions, progress);
    if (neuronSphere) {
      if (shellEdgeObjectRef.current) shellEdgeObjectRef.current.visible = false;
      if (innerShellEdgeObjectRef.current) innerShellEdgeObjectRef.current.visible = false;
    } else updateExtraShellEdges(idleFramePositions, progress);
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
      const coreOpacityScale = configuredCoreOpacity;
      // The energy band already draws the full relation core. Its additive
      // underlay overwhelms dense 3D Explore graphs; retain it only for the
      // accepted idle composition and the independent 2D renderer.
      const energyCoreUnderlay = neuronMaterials ? 0 : 1
        - Number(fx3d.edge.core.enabled) * (0.82 + progress * threeDEnergyWeight * 0.18);
      edgeMaterialRef.current.opacity = (
        scenePlan.edges.opacity + (idleEdgeOpacity - scenePlan.edges.opacity) * idleWeight
      ) * dimensionVisibility
        * presentationVisibility
        * coreOpacityScale
        * energyCoreUnderlay;
    }
    const energyLineVisibility = 1 - transitionEnergy * 0.12;
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
    energyLineUniforms.lineHaloVisibility.value = Number(fx3d.edge.halo.enabled && !neuronMaterials);
    energyLineUniforms.lineMasterOpacity.value = fx3d.edge.master.opacity
      * energyLineVisibility * scenePlan.edges.opacity;
    energyLineUniforms.lineSegmented.value = Number(edgeSegments > 1);
    const radianceWeight = neuronMode ? 1 : neuronSphere ? idleWeight : 0;
    for (const uniforms of [energyLineUniforms, nodeEnergyMaterial.uniforms, signalEnergyMaterial.uniforms, ambientEnergyMaterial.uniforms]) {
      uniforms.radianceTemperature.value = fx3d.postFx.radiance.temperature * radianceWeight;
      uniforms.radianceFocus.value = fx3d.postFx.radiance.focus * radianceWeight;
      uniforms.radianceTransmissionLink.value = fx3d.postFx.radiance.transmissionLink;
    }
    const filament = fx3d.edge.filament;
    energyLineUniforms.lineFilamentEnabled.value = (neuronMode ? 1 : neuronSphere ? idleWeight : 0)
      * Number(filament.taper > 0 || filament.roundness > 0 || filament.translucency > 0);
    energyLineUniforms.lineTaper.value = filament.taper;
    energyLineUniforms.lineRootWidth.value = filament.rootWidth;
    energyLineUniforms.lineRoundness.value = filament.roundness;
    energyLineUniforms.lineTranslucency.value = filament.translucency;
    energyLineUniforms.linePerspective.value = neuronSphere
      ? idleWeight + Number(dimension === 3) * progress : Number(dimension === 3);
    energyLineUniforms.lineHotColor.value.copy(palette.hub);
    energyLineUniforms.lineDepthContrast.value = (fx3d.orb?.network.depthContrast ?? 0)
      * orbEnergyWeight + (spatialNeuron ? scenePlan.layout.depthContrast * progress : 0);
    energyLineUniforms.lineOrbRadius.value = spatialNeuron
      ? orbMorphModel.radius + (spatialRadius - orbMorphModel.radius) * progress : orbMorphModel.radius;
    energyLineUniforms.lineWidthByStrength.value = fx3d.edge.core.widthByStrength;
    energyLineUniforms.lineWidthScale.value = fx3d.edge.core.widthScale
      * (0.98 + transitionEnergy * 0.1);
    if (energyLineObjectRef.current) {
      energyLineObjectRef.current.visible = energyLineVisibility > 0.002
        && (!neuronSphere || progress > 0.001)
        && (fx3d.edge.core.enabled || fx3d.edge.halo.enabled);
    }
    if (nodeMeshRef.current?.material) {
      nodeMeshRef.current.visible = !neuronMaterials;
      const configuredCoreOpacity = fx3d.node.core.enabled
        ? fx3d.node.master.opacity
        : 0;
      nodeMeshRef.current.material.opacity = scenePlan.nodes.opacity
        * (1 - threeDEnergyWeight * 0.74)
        * (1 - orbEnergyWeight)
        * configuredCoreOpacity * fx3d.node.core.opacity;
    }
    if (nodeHaloMeshRef.current?.material) {
      nodeHaloMeshRef.current.visible = dimension === 2 && !neuronMaterials;
      const configuredHaloOpacity = fx3d.node.halo.enabled
        ? fx3d.node.halo.opacity * fx3d.node.master.opacity
        : 0;
      nodeHaloMeshRef.current.material.opacity = configuredHaloOpacity;
      nodeHaloMeshRef.current.material.color
        .set(scenePlan.nodes.activeColor)
        .multiplyScalar(
          fx3d.node.halo.emissionIntensity,
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
      const idlePointSize = sharedStyle ? 9 : 15.4 - dimensionProgress * 0.9;
      // Explore changes the topology, not the selected 3D core/halo style.
      const graphPointSize = sharedStyle || spatialNeuron ? 9 : dimension === 3 ? idlePointSize : neuronMode ? 14 : 13.2;
      const pointSize = idlePointSize
        + (graphPointSize - idlePointSize) * progress
        + (sharedStyle ? 0 : transitionEnergy * 0.65);
      nodeEnergyMaterial.uniforms.pointSize.value = pointSize
        * fx3d.node.master.scale * scenePlan.nodes.scale;
    }
    nodeEnergyMaterial.uniforms.pointCoreSizeScale.value = fx3d.node.core.sizeScale;
    nodeEnergyMaterial.uniforms.pointCellStyle.value = Number(neuronMaterials);
    nodeEnergyMaterial.blending = neuronMaterials ? NormalBlending : AdditiveBlending;
    nodeEnergyMaterial.uniforms.pointPerspectiveFloor.value = spatialNeuron ? 0.68 - progress * 0.38 : 0.68;
    nodeEnergyMaterial.uniforms.pointHaloRadiusScale.value = fx3d.node.halo.radiusScale;
    nodeEnergyMaterial.uniforms.energyTime.value = elapsed;
    nodeEnergyMaterial.uniforms.orbStyle.value = neuronMode ? 1 : threeDEnergyWeight;
    nodeEnergyMaterial.uniforms.pointLayering.value = neuronSphere ? 0 : orbEnergyWeight;
    nodeEnergyMaterial.uniforms.pointAbsoluteLayer.value = neuronSphere ? idleWeight : 0;
    nodeEnergyMaterial.uniforms.pointOrbRadius.value = energyLineUniforms.lineOrbRadius.value;
    nodeEnergyMaterial.uniforms.pointDepthContrast.value = (fx3d.orb?.network.depthContrast ?? 0)
      * orbEnergyWeight + (spatialNeuron ? scenePlan.layout.depthContrast * progress : 0);
    nodeEnergyMaterial.uniforms.pointColorVariation.value = neuronMode ? 1 : threeDEnergyWeight;
    nodeEnergyMaterial.uniforms.pointCoreEmissionIntensity.value = fx3d.node.core.emissionIntensity;
    nodeEnergyMaterial.uniforms.pointCoreOpacity.value = fx3d.node.core.opacity * fx3d.node.master.opacity * scenePlan.nodes.opacity;
    nodeEnergyMaterial.uniforms.pointCoreVisibility.value = Number(fx3d.node.core.enabled);
    nodeEnergyMaterial.uniforms.pointHaloEmissionIntensity.value = fx3d.node.halo.emissionIntensity;
    nodeEnergyMaterial.uniforms.pointHaloOpacity.value = fx3d.node.halo.opacity * fx3d.node.master.opacity;
    nodeEnergyMaterial.uniforms.pointHaloVisibility.value = Number(fx3d.node.halo.enabled && !neuronMaterials);
    nodeEnergyMaterial.uniforms.pointScaleVariation.value = fx3d.node.size.byImportance;
    nodeEnergyMaterial.uniforms.pointPulseMotion.value = Number(!reducedMotion);
    nodeEnergyMaterial.uniforms.pointPulseVisibility.value = Number(
      fx3d.node.pulse.enabled,
    ) * fx3d.node.master.opacity;
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
    signalEnergyMaterial.uniforms.pointCoreEmissionIntensity.value = fx3d.signal.emissionIntensity;
    signalEnergyMaterial.uniforms.pointHaloEmissionIntensity.value = fx3d.signal.emissionIntensity;
    signalEnergyMaterial.uniforms.pointOpacity.value = fx3d.signal.opacity;
    signalEnergyMaterial.uniforms.pointSize.value = (sharedStyle ? 16.5 : (
      (dimension === 3 ? 10.5 : 9.5) + 6 * threeDEnergyWeight
    )) * fx3d.signal.sizeScale;
    if (sphereLineRef.current) {
      sphereLineRef.current.visible = idleWeight > 0.001 && (fx3d.edge.core.enabled || fx3d.edge.halo.enabled);
      sphereLineRef.current.rotation.set(tilt, orbAngle, 0);
      sphereLineRef.current.position.set(0, -10, 0);
      sphereLineRef.current.scale.setScalar(breathingScale);
      sphereLineRef.current.updateMatrixWorld();
      sphereLineMaterial.uniforms.lineMasterOpacity.value = energyLineUniforms.lineMasterOpacity.value * idleWeight;
      energyLineUniforms.lineMasterOpacity.value *= progress;
      if (edgeMaterialRef.current) edgeMaterialRef.current.opacity *= progress;
    }
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
    neuronSphere,
    sharedStyle,
    sphereLineMaterial,
    relationHaloQualityScale,
    energyLineUniforms,
    getLabelLodCount,
    graphFramePositions,
    idleFramePositions,
    invalidate,
    labelMaterial,
    model.nodes.length,
    nodeEnergyMaterial,
    neuronMode,
    orbFramePositions,
    orbMorphModel.positions,
    orbMorphModel.radius,
    orbRimUniforms,
    planarFramePositions,
    planarMorphModel.phases,
    planarMorphModel.positions,
    reducedMotion,
    spatialNeuron,
    edgeSegments,
    scenePlan.layout.depthContrast,
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
    energyLineTangentStartAttributeRef.current?.setUsage(DynamicDrawUsage);
    energyLineTangentEndAttributeRef.current?.setUsage(DynamicDrawUsage);
    shellEdgePositionAttributeRef.current?.setUsage(DynamicDrawUsage);
    innerShellEdgePositionAttributeRef.current?.setUsage(DynamicDrawUsage);
    focusedEdgePositionAttributeRef.current?.setUsage(DynamicDrawUsage);
    signalPositionAttributeRef.current?.setUsage(DynamicDrawUsage);
    labelMeshRef.current?.instanceMatrix.setUsage(DynamicDrawUsage);
    if (positionedModelRef.current !== model) {
      positionedModelRef.current = model;
      graphPositionsRef.current = model.initialPositions;
      morphProgressRef.current = presentationTargetRef.current;
    }
    positionsRef.current = displayPositions;
    applyPositionsRef.current(graphPositionsRef.current);
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
    const signalCount = Math.min(profile3d.signal.count, orbMorphModel.signalEdgeIndices.length);
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
    labelMaterial,
    orbMorphModel.signalEdgeIndices.length,
    profile3d.signal.count,
    scenePlan.edges.opacity,
    scenePlan.nodes.opacity,
    scenePlan.layout.weave,
    scenePlan.layout.depthContrast,
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

  useEffect(() => {
    // StrictMode replays effect setup/cleanup while retaining memoized resources.
    // Defer destructive canvas cleanup so the replay can reclaim the same atlas.
    if (labelAtlasDisposalRef.current?.atlas === labelAtlas) {
      clearTimeout(labelAtlasDisposalRef.current.timer);
    }
    return () => {
      labelAtlasDisposalRef.current = {
        atlas: labelAtlas,
        timer: setTimeout(() => labelAtlas?.dispose(), 0),
      };
    };
  }, [labelAtlas]);
  useEffect(() => () => labelMaterial?.dispose(), [labelMaterial]);
  useEffect(() => () => sphereLineMaterial.dispose(), [sphereLineMaterial]);
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

    const focusedFilamentActive = neuronMode && presentationTarget === 1 && focusedRouteEdges.size > 0
      && fx3d.edge.core.enabled && fx3d.edge.core.opacity > 0
      && fx3d.edge.core.emissionIntensity > 0
      && fx3d.edge.master.opacity > 0 && scenePlan.edges.opacity > 0;
    energyLineUniforms.lineFocusGain.value = getFocusedFilamentGain(elapsed, reducedMotion);
    const routeSignalActive = focusedFilamentActive && !reducedMotion && documentVisibleRef.current
      && fx3d.edge.signal.enabled && fx3d.edge.signal.emissionIntensity > 0
      && morphProgressRef.current >= 0.999 && !dimensionChanged;
    if (routeSignalActive) focusedSignalTravelRef.current = advanceFocusedSignalTravel(
      focusedSignalTravelRef.current, frameDelta, focusedSignalMaximumRef.current, fx3d.edge.signal.speed,
    );
    energyLineUniforms.lineSignalTravel.value = routeSignalActive ? focusedSignalTravelRef.current : -1;
    energyLineUniforms.lineSignalGain.value = fx3d.edge.signal.emissionIntensity;
    const signalLayerActive = isGraphSignalLayerActive({
      dimension,
      signalCount: fx3d.signal.count,
      signalEnabled: fx3d.signal.enabled,
      signalPositionLength: signalPositions.length,
    });
    if (!reducedMotion && signalLayerActive) {
      const visibleSignalCount = Math.min(fx3d.signal.count, orbMorphModel.signalEdgeIndices.length);
      orbMorphModel.signalEdgeIndices.forEach((edgeIndex, signalIndex) => {
        if (signalIndex >= visibleSignalCount) return;
        const positionOffset = signalIndex * 3;
        const signalSpeed = fx3d.signal.speed;
        const rawProgress = (elapsed * 0.18 * signalSpeed + signalIndex * 0.173) % 1;
        const curveTravel = rawProgress * rawProgress * (3 - 2 * rawProgress) * edgeSegments;
        const segment = Math.min(edgeSegments - 1, Math.floor(curveTravel));
        const edgeOffset = (edgeIndex * edgeSegments + segment) * 6;
        const travel = curveTravel - segment;
        if (sphereCurves && morphProgressRef.current < 0.001 && sphereLineRef.current) {
          const sphereTravel = rawProgress * rawProgress * (3 - 2 * rawProgress) * sphereCurves.segments;
          const sphereSegment = Math.min(sphereCurves.segments - 1, Math.floor(sphereTravel));
          const curveIndex = Math.floor((signalIndex + 0.35) / Math.max(1, visibleSignalCount) * orbMorphModel.edges.length);
          const offset = (curveIndex * sphereCurves.segments + sphereSegment) * 3;
          PICK_CENTER.fromArray(sphereCurves.starts, offset);
          PICK_EDGE.fromArray(sphereCurves.ends, offset);
          PICK_CENTER.lerp(PICK_EDGE, sphereTravel - sphereSegment).applyMatrix4(sphereLineRef.current.matrixWorld).toArray(signalPositions, positionOffset);
          return;
        }
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
    lastVisibleLabelCountRef.current = visibleCount;
    updateLabelMatrices(positionsRef.current, visibleCount);
    if (shouldContinueGraphFrame({
      dimensionChanged,
      documentVisible: documentVisibleRef.current,
      focusedFilamentActive,
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
      neuronStructure: model.neuron ? {
        roots: model.neuron.roots, members: model.neuron.members,
        children: model.neuron.children, satellites: model.neuron.satellites,
      } : undefined,
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

  useEffect(() => {
    Object.assign(gl.domElement.dataset, {
      graphNodeCount: String(model.nodes.length),
      graphLayout: neuronMode ? "neuron" : "force",
      graphRenderedEdgeCount: String(renderEdges.length),
      orbSurfaceNodeCount: String(orbMorphModel.shellNodeCount),
      orbLinkCount: String(orbMorphModel.shellEdgePairs.length / 2),
    });
  }, [gl, model.nodes.length, neuronMode, renderEdges.length, orbMorphModel.shellNodeCount, orbMorphModel.shellEdgePairs.length]);

  const getPositions = useCallback(() => positionsRef.current, []);

  return (
    <group>
      {sphereCurves ? (
        <mesh ref={sphereLineRef} frustumCulled={false} raycast={() => null} renderOrder={1.25}>
          <instancedBufferGeometry key={sphereCurves.strengths.length} instanceCount={sphereCurves.strengths.length}>
            <bufferAttribute attach="attributes-position" args={[ENERGY_LINE_QUAD_POSITIONS, 3]} />
            <instancedBufferAttribute attach="attributes-edgeStart" args={[sphereCurves.starts, 3]} />
            <instancedBufferAttribute attach="attributes-edgeEnd" args={[sphereCurves.ends, 3]} />
            <instancedBufferAttribute attach="attributes-edgeTangentStart" args={[sphereCurves.tangentStarts, 3]} />
            <instancedBufferAttribute attach="attributes-edgeTangentEnd" args={[sphereCurves.tangentEnds, 3]} />
            <instancedBufferAttribute attach="attributes-edgeFilamentWeights" args={[sphereCurves.filamentWeights, 2]} />
            <instancedBufferAttribute attach="attributes-edgeColorStart" args={[sphereLineColors, 3]} />
            <instancedBufferAttribute attach="attributes-edgeColorEnd" args={[sphereLineColors, 3]} />
            <instancedBufferAttribute attach="attributes-edgeWidth" args={[sphereCurves.widths, 1]} />
            <instancedBufferAttribute attach="attributes-edgeEnergy" args={[sphereCurves.strengths, 1]} />
          </instancedBufferGeometry>
          <primitive attach="material" object={sphereLineMaterial} />
        </mesh>
      ) : null}
      <GraphCameraNavigation
        onViewChange={onCameraViewChange}
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
      {dimension === 3 && innerShellEdgePositions.length > 0 ? (
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
                args={[innerShellEdgePositions, 3]}
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
      ) : null}
      {extraShellEdgeCount > 0 ? (
        <>

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
        <bufferGeometry ref={baseEdgeGeometryRef}>
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
          name="graph-resting-filaments"
          ref={energyLineObjectRef}
          frustumCulled={false}
          raycast={() => null}
          renderOrder={1.25}
          visible={dimension === 3}
        >
          <instancedBufferGeometry key={`${edgeCapacity}:${edgeSegments}`} instanceCount={edgeCapacity * edgeSegments}>
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
              ref={energyLineTangentStartAttributeRef}
              attach="attributes-edgeTangentStart"
              args={[energyLineTangentStarts, 3]}
            />
            <instancedBufferAttribute
              ref={energyLineTangentEndAttributeRef}
              attach="attributes-edgeTangentEnd"
              args={[energyLineTangentEnds, 3]}
            />
            <instancedBufferAttribute
              attach="attributes-edgeFilamentWeights"
              args={[energyLineFilamentWeights, 2]}
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
            <primitive attach="attributes-edgeFocus" object={edgeFocusAttribute} />
            <primitive attach="attributes-edgeSignalDistances" object={edgeSignalDistanceAttribute} />
          </instancedBufferGeometry>
          <primitive attach="material" object={energyLineMaterial} />
        </mesh>
      ) : null}
      {!neuronMode && focusedEdgeBudget > 0 ? (
        <lineSegments
          raycast={() => null}
          renderOrder={1.5}
          visible={presentationTarget === 1 && focusedEdges.length > 0}
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
            attach="attributes-pointCellRoles"
            args={[nodeCellRoles, 2]}
          />
          <bufferAttribute
            attach="attributes-pointCellVariation"
            args={[nodeCellVariations, 4]}
          />
          <primitive attach="attributes-pointHighlight" object={nodeHighlightAttribute} />
          <bufferAttribute
            attach="attributes-pointScale"
            args={[nodeEnergyStyle.scales, 1]}
          />
          <bufferAttribute
            attach="attributes-pointLayerScale"
            args={[orbMorphModel.scales, 1]}
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
        visible={dimension === 2 && !usesGraphCellMaterial(neuronMode, neuronSphere, presentationTarget)}
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
        visible={!usesGraphCellMaterial(neuronMode, neuronSphere, presentationTarget)}
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
        && profile3d.signal.enabled && profile3d.signal.count > 0 ? (
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
          layers-mask={1 << GRAPH_LABEL_LAYER}
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
