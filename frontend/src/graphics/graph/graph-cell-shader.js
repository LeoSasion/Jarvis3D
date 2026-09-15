// A single bounded cell surface. Only subpixel edge coverage is antialiased;
// radiance outside the polygon belongs exclusively to the scene Bloom pass.
export const GRAPH_CELL_SHADER = `
  varying float pointCellRotation;
  varying float pointCellPrimary;
  varying float pointCellHighlight;
  varying vec3 pointCellColor;

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
    // Ordinary cells use one of three theme-derived group hues. Pale light identifies a soma or
    // an active hover/selection/one-hop relation, never projected node size.
    float primary = clamp(pointCellPrimary, 0.0, 1.0);
    float highlight = clamp(pointCellHighlight, 0.0, 1.0);
    float pale = max(primary, highlight);
    vec3 baseColor = mix(pointCellColor, sourceColor, primary);
    float emission = pointCoreEmissionIntensity * pointPulse * mix(1.0, 1.35, highlight);
    vec3 cytoplasm = baseColor * mix(0.22, 0.46, interior) * emission;
    vec3 membraneColor = mix(baseColor, graphRadianceColor(baseColor, 1.065), pale) * emission * 0.38;
    vec3 nucleusColor = mix(baseColor, graphRadianceColor(baseColor, 1.08), pale) * emission * 0.65;
    vec3 color = mix(cytoplasm, membraneColor, membrane);
    color = mix(color, nucleusColor, nucleus);
    float alpha = mix(0.20, 0.42, interior);
    alpha = mix(alpha, 0.96, membrane);
    alpha = mix(alpha, 0.94, nucleus);
    return vec4(color, alpha * coverage * pointCoreOpacity
      * pointCoreVisibility * pointOpacity);
  }
`;
