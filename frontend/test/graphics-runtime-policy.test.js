import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateEffectiveGraphicsDpr,
  getAdaptiveGraphicsDprScale,
  getDowngradedGraphicsQualityProfile,
  getGraphCameraZoom,
  getGraphViewportScale,
  graphicsQualityProfiles,
  selectGraphicsQualityProfile,
} from "../src/graphics/graphics-runtime-policy.js";

test("graphics quality drops for reduced motion and constrained devices", () => {
  assert.equal(selectGraphicsQualityProfile({
    reducedMotion: true,
    hardwareConcurrency: 16,
    deviceMemory: 16,
  }).id, "low");
  assert.equal(selectGraphicsQualityProfile({
    hardwareConcurrency: 4,
    deviceMemory: 8,
  }).id, "low");
});

test("graphics quality chooses high only for capable devices", () => {
  assert.equal(selectGraphicsQualityProfile({
    devicePixelRatio: 1.5,
    hardwareConcurrency: 16,
    deviceMemory: 16,
  }).id, "high");
  assert.equal(selectGraphicsQualityProfile({
    devicePixelRatio: 2.5,
    hardwareConcurrency: 16,
    deviceMemory: 16,
  }).id, "balanced");
});

test("unknown optional hardware signals do not force low quality", () => {
  assert.equal(selectGraphicsQualityProfile({ devicePixelRatio: 1.5 }).id, "balanced");
  assert.equal(selectGraphicsQualityProfile({}, "high").id, "high");
});

test("graph composition grows at 1920 and remains bounded on 4K displays", () => {
  assert.equal(getGraphViewportScale(820, 600), 1);
  assert.equal(getGraphViewportScale(1_440, 960), 1.5);
  assert.equal(getGraphViewportScale(3_200, 2_000), 2);
});

test("graph camera zoom clamps relative intent before applying viewport scale", () => {
  assert.equal(getGraphCameraZoom(0.01, 960, 640), 0.1);
  assert.equal(getGraphCameraZoom(Number.NaN, 960, 640), 1);
  assert.equal(getGraphCameraZoom(80, 960, 640), 8);
  assert.equal(getGraphCameraZoom(2.2, 1_440, 960), 3.3000000000000003);
  assert.equal(getGraphCameraZoom(2.2, 3_200, 2_000), 4.4);
});

test("effective DPR respects quality, pixel budget, and GPU texture limits", () => {
  assert.equal(calculateEffectiveGraphicsDpr({
    devicePixelRatio: 2,
    height: 1_080,
    maxTextureSize: 8_192,
    qualityProfile: graphicsQualityProfiles.high,
    width: 1_920,
  }), 1.6);
  assert.equal(calculateEffectiveGraphicsDpr({
    devicePixelRatio: 2,
    height: 2_160,
    maxTextureSize: 8_192,
    qualityProfile: graphicsQualityProfiles.high,
    width: 3_840,
  }), 0.95);
  assert.equal(calculateEffectiveGraphicsDpr({
    devicePixelRatio: 2,
    height: 2_160,
    maxTextureSize: 2_048,
    qualityProfile: graphicsQualityProfiles.high,
    width: 3_840,
  }), 0.533);
});

test("adaptive quality only moves down and forced colors uses the low profile", () => {
  assert.equal(getDowngradedGraphicsQualityProfile(graphicsQualityProfiles.high, 1).id, "balanced");
  assert.equal(getDowngradedGraphicsQualityProfile(graphicsQualityProfiles.high, 2).id, "low");
  assert.equal(getDowngradedGraphicsQualityProfile(graphicsQualityProfiles.low, 2).id, "low");
  assert.equal(
    getDowngradedGraphicsQualityProfile(graphicsQualityProfiles.high, 0, true).id,
    "low",
  );
  assert.equal(getAdaptiveGraphicsDprScale(0), 1);
  assert.equal(getAdaptiveGraphicsDprScale(1), 0.9);
  assert.equal(getAdaptiveGraphicsDprScale(99), 0.75);
});
