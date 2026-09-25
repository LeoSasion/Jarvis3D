import assert from "node:assert/strict";
import test from "node:test";
import { Color, SRGBColorSpace } from "three";
import { createSignalColorPalette, sampleSignalBirthColor, signalBirthSample } from "../src/graphics/graph/graph-signal-color.js";
import { createIdleSignalState, advanceIdleSignals, writeNextIdleSignalRoutes } from "../src/graphics/graph/graph-idle-signals.js";
import { createNeuronSphereModel, createNeuronSphereCurves } from "../src/graphics/graph/graph-neuron-sphere-model.js";
import { normalizeGraphFxProfile } from "../src/graphics/graph/graph-fx-profile.js";
import { getGraphVisualSettingsSnapshot, resetGraphVisualSettings, setGraphVisualProfileSetting } from "../src/graphics/graph/graph-visual-settings.js";

test("birth colors cover a bounded theme ramp and support a single-color palette", () => {
  const palette = createSignalColorPalette("#ff6500");
  assert.deepEqual(sampleSignalBirthColor(palette, 0), palette.orange);
  sampleSignalBirthColor(palette, 1).forEach((value, axis) => assert.ok(Math.abs(value - palette.pale[axis]) < 1e-12));
  const samples = Array.from({ length: 200 }, (_, birth) => signalBirthSample(17, birth));
  assert.ok(Math.min(...samples) < 0.02 && Math.max(...samples) > 0.98);
  assert.equal(new Set(samples).size, 200);
  const fixed = createSignalColorPalette("#ff6500", 0.3, 0.3);
  assert.deepEqual(sampleSignalBirthColor(fixed, 0), sampleSignalBirthColor(fixed, 1));
  assert.deepEqual(createSignalColorPalette("#00aaff").orange.slice(0, 1), [0]);
});

test("birth variation retains a moderate color range between the orange-only and near-white extremes", () => {
  for (const source of ["#ff5a00", "#00aaff", "#9b36db"]) {
    const palette = createSignalColorPalette(source);
    const base = new Color().fromArray(palette.orange).getHSL({}, SRGBColorSpace);
    const samples = Array.from({ length: 101 }, (_, i) => (
      new Color().fromArray(sampleSignalBirthColor(palette, i / 100)).getHSL({}, SRGBColorSpace)
    ));
    for (const value of samples) {
      const distance = Math.abs(value.h - base.h);
      assert.ok(Math.min(distance, 1 - distance) * 360 < 8);
      assert.ok(value.s >= base.s - 0.001);
      assert.ok(value.l <= 0.86);
    }
    assert.ok(samples.at(-1).l > samples[0].l + 0.07);
    // HSV chroma decreases even when saturated HSL endpoints keep S=1.
    const vivid = new Color().fromArray(palette.orange).convertLinearToSRGB().toArray();
    const light = new Color().fromArray(palette.pale).convertLinearToSRGB().toArray();
    const saturation = (rgb) => 1 - Math.min(...rgb) / Math.max(...rgb);
    assert.ok(saturation(light) < saturation(vivid) - 0.12);
    assert.ok(saturation(light) > 0.3 && saturation(light) < 0.5);
  }
});

test("idle birth colors survive frames, bends, hubs, palette edits and later batches without rerouting", () => {
  const model = createNeuronSphereModel(Array.from({ length: 808 }, (_, i) => ({ id: `note:${i}` })));
  const curves = createNeuronSphereCurves(model);
  const a = createIdleSignalState(model, curves, 47);
  const b = createIdleSignalState(model, curves, 47);
  a.palette = createSignalColorPalette("#ff6500");
  b.palette = createSignalColorPalette("#ff6500", 0.8, 0.8);
  writeNextIdleSignalRoutes(a);
  writeNextIdleSignalRoutes(b);
  assert.deepEqual(a.distances, b.distances);
  assert.deepEqual(a.sizes, b.sizes);
  assert.notDeepEqual(a.appearances, b.appearances);
  const initial = a.routes.slice();
  const values = new Map(initial.map((route) => [route, route.color.slice()]));
  const verify = (route) => {
    for (const step of route.steps) {
      for (let segment = 0; segment < curves.segments; segment += 1) {
        const index = (step.edge * curves.segments + segment) * 4;
        for (let axis = 0; axis < 3; axis += 1) assert.ok(Math.abs(a.appearances[index + axis] - route.color[axis]) < 1e-6);
        assert.ok(Math.abs(a.appearances[index + 3] - route.size) < 1e-6);
      }
    }
  };
  initial.forEach(verify);
  a.palette = createSignalColorPalette("#ff6500", 0, 0);
  const buffer = a.appearances;
  for (let frame = 0; frame < 60; frame += 1) advanceIdleSignals(a, 0.05);
  const survivors = a.routes.filter((route) => values.has(route));
  assert.ok(survivors.length > 0);
  for (const route of survivors) {
    assert.deepEqual(route.color, values.get(route));
    verify(route);
  }
  const newborns = a.routes.filter((route) => !values.has(route));
  assert.ok(newborns.length > 0);
  for (const route of newborns) assert.deepEqual(route.color, a.palette.orange);
  assert.equal(a.appearances, buffer);
});

test("birth color endpoints migrate, clamp and persist with the shared signal profile", () => {
  const defaults = normalizeGraphFxProfile("3d", {}).edge.signal;
  assert.equal(defaults.colorStart, 0);
  assert.equal(defaults.colorEnd, 1);
  const invalid = normalizeGraphFxProfile("2d", { edge: { signal: { colorStart: -2, colorEnd: 2 } } });
  assert.equal(invalid.edge.signal.colorStart, 0);
  assert.equal(invalid.edge.signal.colorEnd, 1);
  resetGraphVisualSettings();
  try {
    setGraphVisualProfileSetting("3d", "edge.signal.colorStart", 0.2);
    setGraphVisualProfileSetting("3d", "edge.signal.colorEnd", 0.8);
    const saved = getGraphVisualSettingsSnapshot();
    for (const id of ["2d", "3d"]) {
      assert.equal(saved.profiles[id].edge.signal.colorStart, 0.2);
      assert.equal(saved.profiles[id].edge.signal.colorEnd, 0.8);
    }
  } finally { resetGraphVisualSettings(); }
});
