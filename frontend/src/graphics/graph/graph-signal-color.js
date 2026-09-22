import { Color } from "three";
import { FOCUSED_SIGNAL_SPEED } from "./graph-focus-filament.js";

// Independent of the walk RNG: changing color never reroutes or retimes packets.
export function signalBirthSample(seed, birth, channel = 0) {
  let value = (seed ^ Math.imul(birth + 1, 0x9e3779b1) ^ Math.imul(channel + 1, 0x85ebca6b)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

// Split the difference between the original yellow-white endpoint and the
// orange-only pass, in display space so neither brightness range dominates.
// Store the endpoints in linear light for rendering and node activation.
export function createSignalColorPalette(source, colorStart = 0, colorEnd = 1) {
  const color = new Color(source);
  const peak = Math.max(color.r, color.g, color.b, 0.0001);
  const orange = [color.r / peak, color.g / peak, color.b / peak];
  const light = new Color().fromArray(orange).convertLinearToSRGB();
  light.r = 0.22 + 0.78 * light.r;
  light.g = 0.22 + 0.78 * light.g;
  light.b = 0.22 + 0.78 * light.b;
  const broadPeak = new Color().fromArray(orange.map((value) => 0.74 + 0.26 * Math.pow(value, 0.52)))
    .convertLinearToSRGB();
  light.lerp(broadPeak, 0.5);
  return {
    orange,
    pale: light.convertSRGBToLinear().toArray(),
    start: Math.max(0, Math.min(1, colorStart)),
    end: Math.max(0, Math.min(1, colorEnd)),
  };
}

export function sampleSignalBirthColor(palette, sample) {
  const tone = palette.start + (palette.end - palette.start) * sample;
  // Favor saturated orange, with occasional pale warm packets as accents.
  const blend = tone * tone;
  return palette.orange.map((value, axis) => value + (palette.pale[axis] - value) * blend);
}

export function sampleFocusedSignalColor(palette, origin, pulse) {
  return sampleSignalBirthColor(palette, signalBirthSample(origin + 1, ((pulse % 4096) + 4096) % 4096));
}

// The bounded travel clock can wrap while older packets still cross the graph.
// Carry its emission index forward so those particles never change identity.
export function advanceSignalCycleBase(base, previous, next, delta, speed, spacing) {
  const unwrapped = previous + Math.min(0.05, Math.max(0, delta)) * FOCUSED_SIGNAL_SPEED * speed;
  return (base + Math.round((unwrapped - next) / spacing)) % 4096;
}

export const SIGNAL_BIRTH_COLOR_SHADER = `
  uniform vec3 lineSignalOrange;
  uniform vec3 lineSignalPale;
  uniform vec2 lineSignalColorRange;
  uniform vec2 lineSignalOrigins;
  uniform float lineSignalCycleBase;
  varying vec3 energyLineSignalColor;

  // The same integer hash as signalBirthSample: the CPU contact and GPU head
  // must identify the same packet, without driver-dependent sine rounding.
  float focusedBirthSample(uint seed, uint birth) {
    uint value = seed ^ ((birth + 1u) * 0x9e3779b1u) ^ 0x85ebca6bu;
    value = (value ^ (value >> 16u)) * 0x7feb352du;
    value = (value ^ (value >> 15u)) * 0x846ca68bu;
    return float(value ^ (value >> 16u)) / 4294967296.0;
  }

  vec3 signalBirthColor(float distanceFromOrigin, float originSeed) {
    if (lineSignalPeriod <= 0.0) return energyLineSignalColor;
    float birth = mod(floor((lineSignalTravel - distanceFromOrigin) / lineSignalPeriod)
      + lineSignalCycleBase, 4096.0);
    float sampleValue = focusedBirthSample(uint(originSeed), uint(birth));
    float tone = mix(lineSignalColorRange.x, lineSignalColorRange.y, sampleValue);
    return mix(lineSignalOrange, lineSignalPale, tone * tone);
  }
`;
