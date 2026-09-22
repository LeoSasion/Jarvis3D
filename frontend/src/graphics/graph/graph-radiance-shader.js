// Shared by node sprites and relation ribbons. The ramp is derived from the
// active semantic color in linear light, so custom and cool themes still work.
export const GRAPH_RADIANCE_SHADER = `
  uniform float radianceTemperature;
  uniform float radianceFocus;
  uniform float radianceTransmissionLink;

  vec3 radianceToDisplay(vec3 value) {
    return mix(value * 12.92, 1.055 * pow(value, vec3(1.0 / 2.4)) - 0.055,
      step(vec3(0.0031308), value));
  }

  vec3 radianceToLinear(vec3 value) {
    return mix(value / 12.92, pow((value + 0.055) / 1.055, vec3(2.4)),
      step(vec3(0.04045), value));
  }

  vec3 graphRadianceColor(vec3 sourceColor, float energy) {
    float peak = max(sourceColor.r, max(sourceColor.g, sourceColor.b));
    vec3 chroma = clamp(sourceColor / max(0.0001, peak), 0.0, 1.0);
    // Keep half of each approved range: the original ember/gold/warm peak
    // and the restrained orange pass. Mix in display space to retain contrast.
    float highlight = smoothstep(0.76, 1.08, energy);
    vec3 body = mix(radianceToDisplay(chroma), vec3(1.0), 0.22 * highlight);
    float value = mix(0.88, 1.0, smoothstep(0.18, 0.64, energy));
    vec3 ember = pow(chroma, vec3(1.16));
    vec3 gold = pow(chroma, vec3(0.52));
    vec3 warmWhite = mix(vec3(1.0), gold, 0.08);
    vec3 broad = mix(ember, chroma, smoothstep(0.18, 0.64, energy));
    broad = mix(broad, gold, smoothstep(0.80, 1.02, energy));
    broad = mix(broad, warmWhite, smoothstep(0.96, 1.08, energy));
    return radianceToLinear(mix(body * value, radianceToDisplay(broad), 0.5)) * min(1.0, peak);
  }
`;

export function createGraphRadianceUniforms() {
  return {
    radianceTemperature: { value: 0 },
    radianceFocus: { value: 0 },
    radianceTransmissionLink: { value: 1 },
  };
}
