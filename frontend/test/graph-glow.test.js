import assert from "node:assert/strict";
import test from "node:test";
import { createGlowWeights, GraphGlowEffect } from "../src/graphics/graph/graph-glow-effect.js";
import { createGraphicsPassRegistry, getGraphicsPass } from "../src/graphics/runtime/pass-registry.js";
import { normalizeGraphFxProfile } from "../src/graphics/graph/graph-fx-profile.js";
import { getGraphVisualSettingsSnapshot, resetGraphVisualSettings, setGraphSharedNeuronStyle, setGraphVisualProfileSetting } from "../src/graphics/graph/graph-visual-settings.js";

function radialEnergy(weights, distance) {
  return weights.reduce((sum, weight, index) => {
    const variance = 4 ** (index + 1);
    return sum + weight * Math.exp(-distance * distance / (2 * variance)) / variance;
  }, 0);
}

test("multiscale glow keeps its energy bounded and approaches inverse-square radial decay", () => {
  const weights = createGlowWeights(8, 1, 2);
  assert.ok(Math.abs(weights.reduce((sum, value) => sum + value, 0) - 1) < 0.000001);
  for (const radius of [8, 16, 32]) {
    const ratio = radialEnergy(weights, radius) / radialEnergy(weights, radius * 2);
    assert.ok(ratio > 3.8 && ratio < 4.3, `Inverse-square ratio at ${radius}: ${ratio}`);
  }
  const tight = createGlowWeights(8, 0, 2);
  assert.equal(tight[0], 1);
  assert.ok(tight.slice(1).every((value) => value === 0));
  const soft = createGlowWeights(8, 1, 1.4);
  const fast = createGlowWeights(8, 1, 2.8);
  assert.ok(radialEnergy(soft, 32) / radialEnergy(soft, 4)
    > radialEnergy(fast, 32) / radialEnergy(fast, 4));
  assert.ok(createGlowWeights(5, 1, 2).slice(5).every((value) => value === 0));
});

test("glow disable and parameter changes preserve the producer buffers and skip all blur work", () => {
  const effect = new GraphGlowEffect(5);
  const pass = getGraphicsPass(createGraphicsPassRegistry({ bloom: false }), "bloom");
  const texture = effect.uniforms.get("glowMap0").value;
  const weights = effect.uniforms.get("glowWeights").value;
  effect.configure(pass, true);
  assert.doesNotThrow(() => effect.update(null, null));
  const scene = { texture: { dispose() { assert.fail("The composer owns this texture"); } } };
  effect.update(null, scene);
  assert.equal(effect.uniforms.get("sceneRadianceMap").value, scene.texture);
  assert.equal(effect.uniforms.get("glowIntensity").value, 0);
  effect.configure({ ...pass, enabled: true, radius: 0.75, falloff: 1.5, colorPreservation: 0.65 }, true);
  assert.equal(effect.uniforms.get("glowMap0").value, texture);
  assert.equal(effect.uniforms.get("glowWeights").value, weights);
  assert.equal(effect.uniforms.get("glowColorPreservation").value, 0.65);
  // StrictMode / context restoration may reuse disposed Three resources.
  effect.dispose();
  assert.equal(effect.uniforms.get("glowMap0").value, texture);
});

test("optical glow settings migrate, clamp and persist across shared views", () => {
  const old = normalizeGraphFxProfile("3d", { postFx: { bloom: { intensity: 0.6 } } });
  assert.equal(old.postFx.bloom.intensity, 0.6);
  assert.equal(old.postFx.bloom.falloff, 2);
  assert.equal(old.postFx.bloom.colorPreservation, 0.8);
  const invalid = normalizeGraphFxProfile("2d", { postFx: { bloom: { falloff: 0, colorPreservation: 8 } } });
  assert.equal(invalid.postFx.bloom.falloff, 1);
  assert.equal(invalid.postFx.bloom.colorPreservation, 1);
  resetGraphVisualSettings();
  try {
    setGraphSharedNeuronStyle(true);
    setGraphVisualProfileSetting("3d", "postFx.bloom.falloff", 1.6);
    setGraphVisualProfileSetting("2d", "postFx.bloom.colorPreservation", 0.55);
    const saved = getGraphVisualSettingsSnapshot();
    for (const view of ["2d", "3d"]) {
      assert.equal(saved.profiles[view].postFx.bloom.falloff, 1.6);
      assert.equal(saved.profiles[view].postFx.bloom.colorPreservation, 0.55);
    }
  } finally { resetGraphVisualSettings(); }
});
