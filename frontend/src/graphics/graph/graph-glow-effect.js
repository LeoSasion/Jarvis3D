import { BlendFunction, BloomEffect, Effect } from "postprocessing";
import { SRGBColorSpace, Uniform } from "three";

const MAX_LEVELS = 8;

// A mixture of progressively doubled kernels approximates a power-law tail.
// Equal energy per scale approaches inverse-square falloff; changing the
// exponent changes the tail, independently of the largest supported radius.
export function createGlowWeights(levels, radius, falloff) {
  const count = Math.max(1, Math.min(MAX_LEVELS, Math.round(levels)));
  const extent = Math.max(0, Math.min(1, radius)) * (count - 1);
  const exponent = Math.max(1, Math.min(3, falloff));
  const weights = new Float32Array(MAX_LEVELS);
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    const inclusion = Math.max(0, Math.min(1, extent - index + 1));
    weights[index] = inclusion * Math.pow(2, (2 - exponent) * index);
    total += weights[index];
  }
  for (let index = 0; index < count; index += 1) weights[index] /= total;
  return weights;
}

const fragmentShader = `
  ${Array.from({ length: MAX_LEVELS }, (_, index) => `uniform sampler2D glowMap${index};`).join("\n")}
  uniform float glowWeights[8];
  uniform float glowIntensity;
  uniform float glowColorPreservation;
  uniform float surfaceTransmission;
  uniform sampler2D sceneRadianceMap;

  vec3 glowToLinear(vec3 value) {
    return mix(value / 12.92, pow((value + 0.055) / 1.055, vec3(2.4)),
      step(vec3(0.04045), value));
  }

  vec3 glowToDisplay(vec3 value) {
    return mix(value * 12.92, 1.055 * pow(max(value, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055,
      step(vec3(0.0031308), value));
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    float coverage = clamp(inputColor.a, 0.0, 1.0);
    // Recover the actual emitter's chroma before tone mapping can bleach it.
    // Compress RGB together: clipping channels separately turns orange HDR
    // heads and nuclei white at the translucent coverage ceiling.
    vec3 radiance = max(vec3(0.0), texture2D(sceneRadianceMap, uv).rgb);
    float radiancePeak = max(radiance.r, max(radiance.g, radiance.b));
    vec3 mappedLinear = glowToLinear(inputColor.rgb);
    float mappedPeak = max(mappedLinear.r, max(mappedLinear.g, mappedLinear.b));
    vec3 emitterBody = glowToDisplay(radiance * mappedPeak / max(0.00001, radiancePeak));
    float emitterPeak = max(emitterBody.r, max(emitterBody.g, emitterBody.b));
    emitterBody *= min(1.0, coverage / max(0.00001, emitterPeak));
    // Restore half of the earlier tonal variation in translucent middles;
    // HDR heads still retain full source chroma so the white-core fix holds.
    vec3 coveredBody = min(inputColor.rgb, vec3(coverage));
    float hueRetention = 0.5 + 0.5 * smoothstep(0.8, 1.6, radiancePeak);
    vec3 body = mix(inputColor.rgb, mix(coveredBody, emitterBody, hueRetention), surfaceTransmission);
    vec3 scatter = vec3(0.0);
    if (glowIntensity > 0.0) {
      ${Array.from({ length: MAX_LEVELS }, (_, index) => `scatter += texture2D(glowMap${index}, uv).rgb * glowWeights[${index}];`).join("\n")}
    }
    scatter = max(vec3(0.0), scatter * glowIntensity);
    float peak = max(scatter.r, max(scatter.g, scatter.b));
    vec3 coloredGlow = scatter * ((1.0 - exp(-peak)) / max(0.00001, peak));
    vec3 glow = mix(vec3(1.0) - exp(-scatter), coloredGlow, glowColorPreservation);
    // Composite in linear light. The bounded shoulder keeps bright cores
    // legible while the surrounding lower-energy scales retain their hue.
    vec3 bodyLinear = glowToLinear(body);
    vec3 screenLight = vec3(1.0) - (vec3(1.0) - bodyLinear) * (vec3(1.0) - glow);
    vec3 combinedLight = bodyLinear + glow;
    combinedLight /= max(1.0, max(combinedLight.r, max(combinedLight.g, combinedLight.b)));
    // Compress all channels together instead of screening each independently,
    // which would rotate overlapping orange light toward yellow/white again.
    vec3 color = glowToDisplay(mix(screenLight, combinedLight, glowColorPreservation * 0.5));
    // Emitted light carries enough coverage for valid premultiplied output.
    // Browsers and video exports therefore cannot reinterpret its brightness.
    float glowCoverage = max(color.r, max(color.g, color.b));
    outputColor = vec4(color, max(coverage, glowCoverage));
  }
`;

export class GraphGlowEffect extends Effect {
  constructor(levels = 6) {
    const count = Math.max(3, Math.min(MAX_LEVELS, Math.round(levels)));
    const bloom = new BloomEffect({ levels: count, mipmapBlur: true });
    const uniforms = new Map([
      ["glowWeights", new Uniform(createGlowWeights(count, 0.55, 2))],
      ["glowIntensity", new Uniform(0)],
      ["glowColorPreservation", new Uniform(0.8)],
      ["surfaceTransmission", new Uniform(1)],
      ["sceneRadianceMap", new Uniform(null)],
    ]);
    for (let index = 0; index < MAX_LEVELS; index += 1) {
      uniforms.set(`glowMap${index}`, new Uniform(bloom.mipmapBlurPass.downsamplingMipmaps[Math.min(index, count - 1)].texture));
    }
    super("GraphGlowEffect", fragmentShader, { blendFunction: BlendFunction.SRC, uniforms });
    this.bloom = bloom;
    this.levels = count;
    this.enabled = false;
    this.inputColorSpace = SRGBColorSpace;
    this.outputColorSpace = SRGBColorSpace;
  }

  configure(pass, transmission) {
    this.enabled = pass.enabled && pass.intensity > 0;
    this.uniforms.get("glowIntensity").value = this.enabled ? pass.intensity : 0;
    this.uniforms.get("glowColorPreservation").value = pass.colorPreservation;
    this.uniforms.get("surfaceTransmission").value = transmission ? 1 : 0;
    this.uniforms.get("glowWeights").value.set(createGlowWeights(this.levels, pass.radius, pass.falloff));
    this.bloom.luminanceMaterial.threshold = pass.luminanceThreshold;
    this.bloom.luminanceMaterial.smoothing = pass.luminanceSmoothing;
  }

  update(renderer, inputBuffer) {
    // Borrow the composer's HDR scene, including when optical scatter is off.
    if (inputBuffer) this.uniforms.get("sceneRadianceMap").value = inputBuffer.texture;
    if (!this.enabled) return;
    // Reuse the library's filtered HDR extraction and downsampling pyramid.
    // Sample scales directly in the merged pass; no upsampling chain is needed.
    const luminance = this.bloom.luminancePass;
    luminance.render(renderer, inputBuffer);
    const pyramid = this.bloom.mipmapBlurPass;
    const material = pyramid.downsamplingMaterial;
    pyramid.fullscreenMaterial = material;
    let previous = luminance.renderTarget;
    for (const target of pyramid.downsamplingMipmaps) {
      material.setSize(previous.width, previous.height);
      material.inputBuffer = previous.texture;
      renderer.setRenderTarget(target);
      renderer.render(pyramid.scene, pyramid.camera);
      previous = target;
    }
  }

  setSize(width, height) {
    this.bloom.setSize(width, height);
  }

  initialize(renderer, alpha, frameBufferType) {
    this.bloom.initialize(renderer, alpha, frameBufferType);
  }

  dispose() {
    this.bloom.dispose();
    super.dispose();
  }
}
