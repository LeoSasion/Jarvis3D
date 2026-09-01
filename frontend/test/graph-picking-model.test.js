import assert from "node:assert/strict";
import test from "node:test";
import {
  createGraphPointerQueue,
  createGraphScreenIndex,
  pickGraphScreenNode,
} from "../src/graphics/graph/graph-picking-model.js";

test("screen index finds nodes across cell boundaries and ignores misses", () => {
  const index = createGraphScreenIndex([
    { nodeIndex: 4, x: 35, y: 35, radius: 10, depth: 0.2 },
    { nodeIndex: 8, x: 90, y: 80, radius: 12, depth: 0.1 },
  ], { width: 160, height: 120, cellSize: 36 });

  assert.equal(pickGraphScreenNode(index, 40, 35), 4);
  assert.equal(pickGraphScreenNode(index, 90, 72), 8);
  assert.equal(pickGraphScreenNode(index, 150, 110), null);
});

test("screen index chooses the frontmost overlapping 3D node", () => {
  const index = createGraphScreenIndex([
    { nodeIndex: 1, x: 60, y: 60, radius: 18, depth: 0.6 },
    { nodeIndex: 2, x: 60, y: 60, radius: 18, depth: 0.2 },
  ], { width: 120, height: 120 });

  assert.equal(pickGraphScreenNode(index, 60, 60), 2);
});

test("pointer queue coalesces moves and consumes at most one latest sample per frame", () => {
  const queue = createGraphPointerQueue();
  queue.queueHover({ active: true, x: 10, y: 20 });
  queue.queueHover({ active: true, x: 30, y: 40 });
  queue.queueSelection({ active: true, x: 30, y: 40 });

  assert.equal(queue.hasPending(), true);
  assert.deepEqual(queue.consume(), {
    hover: { active: true, x: 30, y: 40 },
    selection: { active: true, x: 30, y: 40 },
  });
  assert.equal(queue.hasPending(), false);
  assert.deepEqual(queue.consume(), { hover: null, selection: null });
});
