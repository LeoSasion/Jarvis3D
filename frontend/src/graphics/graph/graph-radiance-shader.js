// Shared by node sprites and relation ribbons. The ramp is derived from the
// active semantic color in linear light, so custom and cool themes still work.
export const GRAPH_RADIANCE_SHADER = `
  uniform float radianceTemperature;
  uniform float radianceFocus;
  uniform float radianceTransmissionLink;

  vec3 graphRadianceColor(vec3 sourceColor, float energy) {
    float peak = max(sourceColor.r, max(sourceColor.g, sourceColor.b));
    vec3 chroma = clamp(sourceColor / max(0.0001, peak), 0.0, 1.0);
    vec3 ember = pow(chroma, vec3(1.16));
    vec3 gold = pow(chroma, vec3(0.32));
    vec3 warmWhite = mix(vec3(1.0), gold, 0.08);
    // Keep the original orange across the body; yellow has a short shoulder
    // near the local energy peak and falls back quickly along the same gradient.
    vec3 body = mix(ember, chroma, smoothstep(0.18, 0.64, energy));
    body = mix(body, gold, smoothstep(0.80, 1.02, energy));
    return mix(body, warmWhite, smoothstep(0.96, 1.08, energy))
      * min(1.0, peak);
  }
`;

export function createGraphRadianceUniforms() {
  return {
    radianceTemperature: { value: 0 },
    radianceFocus: { value: 0 },
    radianceTransmissionLink: { value: 1 },
  };
}
