// A single bounded cell surface. Only subpixel edge coverage is antialiased;
// radiance outside the polygon belongs exclusively to the scene Bloom pass.
export const GRAPH_CELL_SHADER = `
  varying float pointCellRotation;
  varying float pointCellPrimary;
  varying float pointCellHighlight;
  varying float pointCellActivation;
  varying vec3 pointCellActivationColor;
  varying vec3 pointCellColor;
  uniform float pointActivationEnabled;
  uniform float pointActivationStrength;
  uniform float pointRestingBrightness;

  float cellHexDistance(vec2 p) {
    vec2 q = abs(p);
    return max(dot(q, vec2(0.8660254, 0.5)), q.y);
  }

  vec4 graphCellSurface(vec2 coordinate, vec3 sourceColor) {
    float c = cos(pointCellRotation);
    float s = sin(pointCellRotation);
    vec2 p = mat2(c, -s, s, c) * ((coordinate - 0.5) * 2.0);
    p *= vec2(0.94, 1.06);
    float distanceToEdge = cellHexDistance(p) - 0.72;
    float aa = max(0.0001, fwidth(distanceToEdge) * 0.5);
    if (distanceToEdge > aa) discard;
    float coverage = 1.0 - smoothstep(-aa, aa, distanceToEdge);
    float membrane = smoothstep(-0.070 - aa, -0.070 + aa, distanceToEdge);
    vec2 nucleusPosition = p - vec2(0.065, -0.045);
    float nucleusEdge = cellHexDistance(nucleusPosition) - 0.17;
    float nucleusAa = max(0.0001, fwidth(nucleusEdge) * 0.5);
    float nucleus = 1.0 - smoothstep(-nucleusAa, nucleusAa, nucleusEdge);

    float interior = clamp(1.0 - length(p + vec2(0.18, 0.12)) / 0.95, 0.0, 1.0);
    // With activation enabled, soma identity affects size, not permanent heat.
    // Direct hover/selection stays legible; related cells heat only on arrival.
    float primary = clamp(pointCellPrimary, 0.0, 1.0);
    float highlight = step(0.001, pointCellHighlight);
    float directHighlight = step(0.99, pointCellHighlight);
    float charge = max(pointCellActivation * pointActivationStrength, directHighlight);
    float response = clamp(charge, 0.0, 1.0);
    float pale = mix(max(primary, highlight), directHighlight, pointActivationEnabled);
    float signalResponse = clamp(pointCellActivation * pointActivationStrength, 0.0, 1.0) * pointActivationEnabled;
    vec3 baseColor = mix(pointCellColor, sourceColor, primary);
    float interactionGain = mix(highlight, directHighlight, pointActivationEnabled);
    float activationGain = mix(1.0, mix(pointRestingBrightness, 1.0, response)
      + max(0.0, charge - 1.0), pointActivationEnabled);
    float emission = pointCoreEmissionIntensity * pointPulse * mix(1.0, 1.35, interactionGain) * activationGain;
    // All parts of a charged cell inherit the arriving signal, including the
    // nucleus. Its stored hue stays fixed while energy fades back to rest.
    vec3 cytoplasm = mix(baseColor, pointCellActivationColor, signalResponse)
      * mix(0.22, 0.46, interior) * emission;
    vec3 membraneColor = mix(mix(baseColor, graphRadianceColor(baseColor, 1.065), pale),
      pointCellActivationColor, signalResponse) * emission * 0.38;
    vec3 nucleusColor = mix(mix(baseColor, graphRadianceColor(baseColor, 1.08), pale),
      pointCellActivationColor, signalResponse) * emission * 0.65;
    vec3 color = mix(cytoplasm, membraneColor, membrane);
    color = mix(color, nucleusColor, nucleus);
    float alpha = mix(0.20, 0.42, interior);
    alpha = mix(alpha, 0.96, membrane);
    alpha = mix(alpha, 0.94, nucleus);
    return vec4(color, alpha * coverage * pointCoreOpacity
      * pointCoreVisibility * pointOpacity);
  }
`;
