import assert from "node:assert/strict";
import test from "node:test";
import { formatGraphLabelText } from "../src/graphics/graph/graph-label-text.js";

test("graph labels preserve glyphs bundled in the offline font", () => {
  assert.equal(formatGraphLabelText("服装 Knowledge 2026 — A/B"), "服装 Knowledge 2026 — A/B");
});

test("graph labels replace unsupported unicode before offline atlas generation", () => {
  assert.equal(formatGraphLabelText("针织🧵𠮷✓→"), "针织□□□□");
});

test("graph labels retain a readable fallback for empty titles", () => {
  assert.equal(formatGraphLabelText(" \n\t "), "Untitled");
});
