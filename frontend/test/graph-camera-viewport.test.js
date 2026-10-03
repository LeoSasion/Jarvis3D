import assert from "node:assert/strict";
import test from "node:test";
import {
  clampGraphViewportInsets, getGraphPlanarCameraTarget, getGraphVisibleViewport,
  measureGraphViewportInsets,
} from "../src/graphics/graph/graph-camera-viewport.js";

test("fit viewport uses the exposed region between left browser and right settings panel", () => {
  const canvasRect = { left: 0, top: 0, right: 1200, bottom: 700, width: 1200, height: 700 };
  const overlays = [
    { left: 24, right: 354, top: 78, bottom: 620 },
    { left: 800, right: 1200, top: 0, bottom: 700 },
  ];
  const root = { querySelectorAll: () => overlays.map((rect) => ({
    getClientRects: () => [rect], getBoundingClientRect: () => rect,
  })) };
  const canvas = { closest: () => root, getBoundingClientRect: () => canvasRect };
  const insets = measureGraphViewportInsets(canvas);
  assert.deepEqual(insets, { left: 366, right: 412, top: 0, bottom: 0 });
  const visible = getGraphVisibleViewport(canvasRect.width, canvasRect.height, insets);
  assert.equal(visible.width, 422);
  assert.equal(visible.offsetX, -23);
});

test("insets remain bounded when narrow panels cover most of the canvas", () => {
  const insets = clampGraphViewportInsets(360, 240, { left: 280, right: 260, top: 180, bottom: 120 });
  const visible = getGraphVisibleViewport(360, 240, insets);
  assert.ok(visible.width >= 144);
  assert.ok(visible.height >= 96);
  assert.ok(Number.isFinite(visible.offsetX));
});

test("a taller top inset moves the available viewport center downward", () => {
  const visible = getGraphVisibleViewport(800, 600, { top: 160, bottom: 40 });
  assert.equal(visible.height, 400);
  assert.equal(visible.offsetY, 60);
  assert.deepEqual(getGraphPlanarCameraTarget({ x: 10, y: 20 }, 2, visible), { x: 10, y: 50 });
});
