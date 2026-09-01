import assert from "node:assert/strict";
import test from "node:test";
import {
  GRAPH_LABEL_DYNAMIC_SLOTS,
  MAX_GRAPH_LABEL_ATLAS_ENTRIES,
  createGraphLabelAtlasLayout,
  selectGraphLabelIndices,
} from "../src/graphics/graph/graph-label-atlas.js";

test("graph label atlas is power-of-two and bounded to one 64-entry texture", () => {
  const layout = createGraphLabelAtlasLayout(200);

  assert.equal(layout.count, MAX_GRAPH_LABEL_ATLAS_ENTRIES);
  assert.equal((layout.width & (layout.width - 1)), 0);
  assert.equal((layout.height & (layout.height - 1)), 0);
  assert.ok(layout.width <= 2_048);
  assert.ok(layout.height <= 1_024);
});

test("selected and hovered nodes reserve dynamic LOD slots without exceeding the atlas", () => {
  const nodes = Array.from({ length: 80 }, (_, index) => ({ id: `node-${index}` }));
  const model = {
    nodes,
    nodeIndex: new Map(nodes.map((node, index) => [node.id, index])),
    labelIndices: nodes.map((_, index) => index),
  };
  const selection = selectGraphLabelIndices(model, 64, "node-70", "node-71");

  assert.equal(selection.base.length, MAX_GRAPH_LABEL_ATLAS_ENTRIES - GRAPH_LABEL_DYNAMIC_SLOTS);
  assert.deepEqual(selection.dynamic, [70, 71]);
  assert.equal(selection.all.length, MAX_GRAPH_LABEL_ATLAS_ENTRIES);
});
