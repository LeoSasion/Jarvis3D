import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isGraphSignalLayerActive,
  shouldContinueGraphFrame,
} from "../src/graphics/graph/graph-frame-policy.js";
import { getLayoutChunkMessageType } from "../src/graphics/layout/layout-worker-policy.js";

const graphSceneUrl = new URL("../src/graphics/graph/GraphScene.jsx", import.meta.url);
const layoutWorkerUrl = new URL("../src/graphics/layout/layout-worker.js", import.meta.url);

test("reduced-motion layout chunks emit heartbeat progress without position frames", async () => {
  assert.equal(getLayoutChunkMessageType({ emitIntermediate: false, settled: false }), "progress");
  assert.equal(getLayoutChunkMessageType({ emitIntermediate: false, settled: true }), "positions");
  assert.equal(getLayoutChunkMessageType({ emitIntermediate: true, settled: false }), "positions");

  const [sceneSource, workerSource] = await Promise.all([
    readFile(graphSceneUrl, "utf8"),
    readFile(layoutWorkerUrl, "utf8"),
  ]);
  assert.match(workerSource, /else postLayoutProgress\(job\);/u);
  assert.match(
    sceneSource,
    /if \(message\?\.type === "progress"\) \{[\s\S]*cancelWatchdog\(\);[\s\S]*armWatchdog\(event\.currentTarget, message\.revision\);[\s\S]*return;/u,
  );
  const progressHandler = sceneSource.slice(
    sceneSource.indexOf('if (message?.type === "progress")'),
    sceneSource.indexOf('if (message?.type !== "positions")'),
  );
  assert.doesNotMatch(progressHandler, /applyPositionsRef|invalidate/u);
});

test("a settled 3D graph stops frames when its Signal layer is disabled or empty", () => {
  const disabledSignal = isGraphSignalLayerActive({
    dimension: 3,
    signalCount: 8,
    signalEnabled: false,
    signalPositionLength: 36,
  });
  const emptySignal = isGraphSignalLayerActive({
    dimension: 3,
    signalCount: 0,
    signalEnabled: true,
    signalPositionLength: 36,
  });

  assert.equal(disabledSignal, false);
  assert.equal(emptySignal, false);
  assert.equal(shouldContinueGraphFrame({
    dimensionChanged: false,
    documentVisible: true,
    idlePresentation: false,
    presentationChanged: false,
    reducedMotion: false,
    signalLayerActive: disabledSignal,
  }), false);
  assert.equal(shouldContinueGraphFrame({
    documentVisible: true,
    signalLayerActive: true,
  }), true);
  assert.equal(shouldContinueGraphFrame({
    documentVisible: true,
    idlePresentation: true,
  }), true);
});
