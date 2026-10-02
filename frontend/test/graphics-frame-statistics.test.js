import assert from "node:assert/strict";
import test from "node:test";
import { createFrameStatisticsWindow, recordFrameStatistics } from "../src/graphics/runtime/frame-statistics.js";

test("active frame statistics are bounded and retain slow intervals", () => {
  const window = createFrameStatisticsWindow();
  let summary;
  for (let i = 1; i <= 2000; i++) {
    summary = recordFrameStatistics(window, i % 10 === 0 ? 40 : 16, i * 20) ?? summary;
  }
  assert.equal(window.count, 600);
  assert.equal(summary.count, 600);
  assert.equal(summary.p50Ms, 16);
  assert.equal(summary.p95Ms, 40);
  assert.equal(summary.meanMs, 18.4);
});

test("continuous sub-one-FPS rendering is reported, not mistaken for idle", () => {
  const window = createFrameStatisticsWindow();
  let summary;
  for (let i = 1; i <= 15; i++) summary = recordFrameStatistics(window, 1500, i * 1500) ?? summary;
  assert.equal(summary.count, 15);
  assert.equal(summary.meanMs, 1500);
});

test("a pause starts a fresh statistics window without reporting invented frames", () => {
  const window = createFrameStatisticsWindow();
  for (let i = 1; i < 10; i++) recordFrameStatistics(window, 40, i * 150);
  assert.equal(recordFrameStatistics(window, 16, 10000), null);
  assert.equal(window.count, 1);
  assert.equal(recordFrameStatistics(window, NaN, 10020), null);
  assert.equal(window.count, 1);
});
