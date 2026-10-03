import assert from "node:assert/strict";
import test from "node:test";
import {
  consumePendingGraphFocus, shouldApplyGraphCameraCommand,
} from "../src/graphics/graph/graph-camera-command.js";

test("node focus waits for its layout and is consumed once across later layout completions", () => {
  const focus = { id: 7, type: "focus-node", dimension: 3, nodeId: "a" };
  assert.equal(shouldApplyGraphCameraCommand(focus, null, 3, false), false);
  assert.equal(shouldApplyGraphCameraCommand(focus, null, 3, true), true);
  const consumedId = focus.id;
  assert.equal(shouldApplyGraphCameraCommand(focus, consumedId, 3, false), false);
  assert.equal(shouldApplyGraphCameraCommand(focus, consumedId, 3, true), false);
  assert.equal(shouldApplyGraphCameraCommand(focus, null, 2, true), false);
  assert.equal(shouldApplyGraphCameraCommand({ ...focus, id: 8, dimension: 2 }, consumedId, 2, true), true);
});

test("manual camera input cancels a pending focus before layout settles", () => {
  const focus = { id: 12, type: "focus-node", dimension: 2, nodeId: "b" };
  const consumedId = consumePendingGraphFocus(focus, null, 2);
  assert.equal(consumedId, 12);
  assert.equal(shouldApplyGraphCameraCommand(focus, consumedId, 2, true), false);
  assert.equal(consumePendingGraphFocus(focus, consumedId, 2), consumedId);
  assert.equal(consumePendingGraphFocus(focus, null, 3), null);
});
