import assert from "node:assert/strict";
import test from "node:test";
import { Color, SRGBColorSpace } from "three";
import { createGraphAdjacentNodeSet, createGraphTopologyModel } from "../src/graphics/graph/graph-buffer-model.js";
import { createGraphCellRoles, createGraphCellVariations, writeGraphCellHighlights, usesGraphCellMaterial } from "../src/graphics/graph/graph-cell-state.js";

test("the idle neuron sphere preserves independent legacy Explore materials", () => {
  for (const progress of [0, 0.25, 0.75, 1]) {
    assert.equal(usesGraphCellMaterial(true, true, progress), true);
    assert.equal(usesGraphCellMaterial(true, false, progress), true);
    assert.equal(usesGraphCellMaterial(false, false, progress), false);
  }
  assert.equal(usesGraphCellMaterial(false, true, 0), true);
  assert.equal(usesGraphCellMaterial(false, true, 1), false);
});

test("cell variation stays within 25 percent and survives source reordering and theme changes", () => {
  const nodes = Array.from({ length: 90 }, (_, index) => ({ id: `note-${index}`, group: `topic-${index % 3}` }));
  const variations = createGraphCellVariations({ nodes }, "#ff5a00");
  const reversed = createGraphCellVariations({ nodes: [...nodes].reverse() }, "#ff5a00");
  const recolored = createGraphCellVariations({ nodes }, "#00aaff");
  const sizes = nodes.map((_, index) => variations[index * 4 + 3]);
  assert.ok(sizes.every((size) => size >= 0.75 && size <= 1.25));
  assert.ok(Math.min(...sizes) < 0.8 && Math.max(...sizes) > 1.2);
  nodes.forEach((_, index) => {
    assert.deepEqual(variations.slice(index * 4, index * 4 + 4), reversed.slice((89 - index) * 4, (90 - index) * 4));
    assert.equal(recolored[index * 4 + 3], sizes[index]);
  });
  assert.notDeepEqual(recolored.slice(0, 3), variations.slice(0, 3));
  const colors = nodes.map((_, index) => [...variations.slice(index * 4, index * 4 + 3)].join(","));
  assert.equal(new Set(colors).size, 3);
  assert.equal(colors[0], colors[3]);
  for (let index = 0; index < 3; index += 1) {
    const hsl = new Color().fromArray(variations, index * 4).getHSL({}, SRGBColorSpace);
    assert.ok(Math.abs(hsl.s - 1) < 0.001);
    assert.ok(Math.abs(hsl.l - 0.5) < 0.001);
  }
});

test("cell colors follow source-backed neuron clusters instead of an umbrella folder", () => {
  const nodes = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, group: "vault" }));
  const model = { nodes, neuron: { roots: [0, 1, 2], cluster: [0, 1, 2, 0, 1, 2] } };
  const values = createGraphCellVariations(model, "#ff5a00");
  const colors = nodes.map((_, index) => [...values.slice(index * 4, index * 4 + 3)].join(","));
  assert.equal(new Set(colors).size, 3);
  assert.deepEqual(colors.slice(0, 3), colors.slice(3));
  assert.equal(createGraphCellVariations({ nodes: [] }, "#ff5a00").length, 0);
});

test("cell highlights follow active one-hop relations and clear without losing selection", () => {
  const model = createGraphTopologyModel({
    nodes: ["a", "b", "c", "d", "e"].map((id) => ({ id, kind: "note" })),
    edges: [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
      { source: "d", target: "e" },
    ],
  });
  const values = new Float32Array(model.nodes.length);
  const update = (selected, hovered, interactive = true) => {
    writeGraphCellHighlights(values, model.nodes, createGraphAdjacentNodeSet(model, selected, hovered), interactive);
    return model.nodes.filter((_, index) => values[index] === 1).map((node) => node.id).sort();
  };
  assert.deepEqual(update(null, null), []);
  assert.deepEqual(update(null, "b"), ["a", "b", "c"]);
  assert.deepEqual(update(null, null), []);
  assert.deepEqual(update("a", "d"), ["a", "b", "d", "e"]);
  assert.deepEqual(update("a", null), ["a", "b"]);
  assert.deepEqual(update("a", null, false), []);
  assert.deepEqual(update("a", null), ["a", "b"]);
  assert.deepEqual(update(null, null), []);

  const roles = createGraphCellRoles({ nodes: [{ id: "hub" }, { id: "leaf" }], hubMask: [1, 0] }, [0, 1]);
  assert.deepEqual([...roles], [1, 0, 0, 1]);
});
