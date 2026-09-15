import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { normalizeGraphFxProfile } from "../src/graphics/graph/graph-fx-profile.js";
import {
  getGraphVisualSettingsSnapshot,
  normalizeGraphVisualSettings,
  resetGraphVisualSettings,
  setGraphSharedNeuronStyle,
  setGraphVisualProfileSetting,
} from "../src/graphics/graph/graph-visual-settings.js";

test("light settings migrate safely and round-trip through shared profiles", () => {
  assert.deepEqual(normalizeGraphFxProfile("3d", {}).postFx.radiance,
    { temperature: 0, focus: 0, transmissionLink: 1 });
  assert.deepEqual(normalizeGraphFxProfile("2d", { postFx: { radiance: {
    temperature: 2, focus: -4, transmissionLink: Infinity,
  } } }).postFx.radiance, { temperature: 1, focus: 0, transmissionLink: 1 });
  resetGraphVisualSettings();
  setGraphSharedNeuronStyle(true);
  setGraphVisualProfileSetting("2d", "postFx.radiance.transmissionLink", 0.8);
  setGraphVisualProfileSetting("3d", "postFx.radiance.temperature", 0.85);
  const saved = getGraphVisualSettingsSnapshot();
  assert.deepEqual(saved.profiles["2d"].postFx.radiance, saved.profiles["3d"].postFx.radiance);
  assert.equal(saved.profiles["3d"].postFx.radiance.transmissionLink, 0.8);
  assert.deepEqual(normalizeGraphVisualSettings(JSON.parse(JSON.stringify(saved))), saved);
  resetGraphVisualSettings();
});

test("thermal color reuses translucency without edge length or camera inputs", () => {
  const source = readFileSync(new URL("../src/graphics/graph/GraphScene.jsx", import.meta.url), "utf8");
  const heat = source.slice(source.indexOf("float densityResponse ="), source.indexOf("vec3 luminousCore ="));
  assert.match(heat, /materialDensity/u);
  assert.match(source, /materialDensity \* mix\(0\.55, 1\.0, sectionHeight\)/u);
  assert.match(heat, /energyLineWorldWidth/u);
  assert.doesNotMatch(heat, /DepthPresence|coreWidthPixels|resolvedSection|fwidth|hotSpine|crest|perspectiveWidth|nodeDistance|arcLength|edgeLength/u);
  const pointHeat = source.slice(source.indexOf("float pointHeat ="), source.indexOf("orbColor = mix(orbColor"));
  assert.doesNotMatch(pointHeat, /DepthPresence|hierarchy|fwidth/u);
});

test("route signal controls migrate, persist and link without changing background signals", () => {
  assert.deepEqual(normalizeGraphFxProfile("2d", {}).edge.signal,
    { enabled: true, speed: 1, emissionIntensity: 1 });
  assert.deepEqual(normalizeGraphFxProfile("3d", { edge: { signal: {
    enabled: false, speed: Infinity, emissionIntensity: -1,
  } } }).edge.signal, { enabled: false, speed: 1, emissionIntensity: 0 });
  resetGraphVisualSettings();
  setGraphSharedNeuronStyle(true);
  const background = getGraphVisualSettingsSnapshot().profiles["3d"].signal;
  setGraphVisualProfileSetting("2d", "edge.signal.enabled", false);
  setGraphVisualProfileSetting("3d", "edge.signal.speed", 2);
  setGraphVisualProfileSetting("3d", "edge.signal.emissionIntensity", 0.5);
  const saved = getGraphVisualSettingsSnapshot();
  assert.deepEqual(saved.profiles["2d"].edge.signal, { enabled: false, speed: 2, emissionIntensity: 0.5 });
  assert.deepEqual(saved.profiles["2d"].edge.signal, saved.profiles["3d"].edge.signal);
  assert.deepEqual(saved.profiles["3d"].signal, background);
  assert.deepEqual(normalizeGraphVisualSettings(JSON.parse(JSON.stringify(saved))), saved);
  resetGraphVisualSettings();
});
