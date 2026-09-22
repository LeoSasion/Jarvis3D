import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGraphRangeInput } from "../src/graphics/graph/graph-settings-input.js";

const opacityRange = { min: 0, max: 1, step: 0.01 };

test("numeric editing converts displayed percentages and bounds values", () => {
  assert.equal(normalizeGraphRangeInput("85", opacityRange, "percent", 1), 0.85);
  assert.equal(normalizeGraphRangeInput("1000", opacityRange, "percent", 0.5), 1);
  assert.equal(normalizeGraphRangeInput("-20", opacityRange, "percent", 0.5), 0);
});

test("incomplete or invalid input preserves the existing visual setting", () => {
  for (const input of ["", " ", "-", "1e", "Infinity", "NaN", "orange"]) {
    assert.equal(normalizeGraphRangeInput(input, opacityRange, "percent", 0.65), 0.65);
  }
});

test("numeric editing follows slider steps without floating point residue", () => {
  assert.equal(normalizeGraphRangeInput("0.31", { min: 0.2, max: 2, step: 0.05 }, "strength", 1), 0.3);
  assert.equal(normalizeGraphRangeInput("85", { min: 32, max: 4096, step: 32 }, "count", 1024), 96);
  assert.equal(normalizeGraphRangeInput("10000", { min: 32, max: 4096, step: 32 }, "count", 1024), 4096);
});

test("merely focusing an off-step preset value does not alter the preset", () => {
  assert.equal(normalizeGraphRangeInput("1.28", { min: 0.75, max: 2.5, step: 0.05 }, "strength", 1.28), 1.28);
  assert.equal(normalizeGraphRangeInput("65.5", opacityRange, "percent", 0.655), 0.655);
});
