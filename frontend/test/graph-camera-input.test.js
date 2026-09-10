import assert from "node:assert/strict";
import test from "node:test";
import { graphWheelDepth, graphWheelPixels, graphWheelZoom } from "../src/graphics/graph/graph-camera-input.js";

test("wheel normalization supports mouse lines and trackpad pixels with bounded page steps", () => {
  assert.equal(graphWheelPixels(3, 1), 48);
  assert.equal(graphWheelPixels(48, 0), 48);
  assert.equal(graphWheelPixels(-1, 2, 1080), -240);
  assert.equal(graphWheelPixels(1, 2, 120), 120);
  assert.equal(graphWheelPixels(NaN), 0);
});

test("wheel up magnifies 2D but decreases 3D camera distance; inverse steps restore view", () => {
  const closer = graphWheelDepth(720, -120);
  const larger = graphWheelZoom(1, -120);
  assert.ok(closer < 720);
  assert.ok(larger > 1);
  assert.ok(Math.abs(graphWheelDepth(closer, 120) - 720) < 1e-10);
  assert.ok(Math.abs(graphWheelZoom(larger, 120) - 1) < 1e-10);
});

test("camera bounds prevent crossing the target or losing the entire graph", () => {
  assert.equal(graphWheelDepth(80, -240), 80);
  assert.equal(graphWheelDepth(3200, 240), 3200);
  assert.equal(graphWheelZoom(0.1, 240), 0.1);
  assert.equal(graphWheelZoom(8, -240), 8);
});
