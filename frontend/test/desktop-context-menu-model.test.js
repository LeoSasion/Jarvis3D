import assert from "node:assert/strict";
import test from "node:test";
import {
  getDesktopContextMenuPosition,
  getDesktopDensityTier,
  getDesktopFallbackPosition,
  getDesktopIconMetrics,
  getDesktopLayoutProfileId,
  getVisibleDesktopEntries,
  MAX_VISIBLE_DESKTOP_SHORTCUTS,
  snapDesktopPosition,
  sortDesktopEntries,
} from "../src/desktop-layout.js";

const entries = [
  {
    id: "z",
    label: "Zeta 10",
    kind: "file",
    extension: ".txt",
    source: "public",
  },
  {
    id: "a",
    label: "Alpha",
    kind: "directory",
    extension: "",
    source: "user",
  },
  {
    id: "b",
    label: "Zeta 2",
    kind: "file",
    extension: ".lnk",
    source: "user",
  },
];

test("desktop icon metrics preserve the current medium layout and support view sizes", () => {
  assert.deepEqual(getDesktopIconMetrics("medium"), {
    cellWidth: 96,
    cellHeight: 88,
    iconSize: 44,
    labelSize: 13,
  });
  assert.equal(getDesktopIconMetrics("small").cellWidth, 80);
  assert.equal(getDesktopIconMetrics("large").iconSize, 58);
  assert.equal(getDesktopDensityTier(1_019, 619), "compact");
  assert.equal(getDesktopDensityTier(1_535, 959), "comfortable");
  assert.equal(getDesktopDensityTier(2_074, 1_303), "spacious");
  assert.equal(getDesktopDensityTier(2_640, 1_647), "ultra");
  assert.deepEqual(getDesktopIconMetrics("medium", "comfortable"), {
    cellWidth: 108,
    cellHeight: 96,
    iconSize: 52,
    labelSize: 14,
  });
  assert.deepEqual(getDesktopIconMetrics("medium", "ultra"), {
    cellWidth: 152,
    cellHeight: 136,
    iconSize: 76,
    labelSize: 16,
  });
  assert.deepEqual(
    getDesktopFallbackPosition(4, 300, getDesktopIconMetrics("large")),
    { x: 258, y: 18 },
  );
  assert.equal(getDesktopLayoutProfileId(1_535, 959, 1), "comfortable@100");
  assert.equal(getDesktopLayoutProfileId(1_535, 959, 1.5), "comfortable@150");
});

test("desktop sorting is stable by intent and never mutates source entries", () => {
  assert.equal(sortDesktopEntries(entries, "none"), entries);
  assert.deepEqual(sortDesktopEntries(entries, "name").map(({ id }) => id), ["a", "b", "z"]);
  assert.deepEqual(sortDesktopEntries(entries, "type").map(({ id }) => id), ["a", "b", "z"]);
  assert.deepEqual(sortDesktopEntries(entries, "source").map(({ id }) => id), ["z", "a", "b"]);
  assert.deepEqual(entries.map(({ id }) => id), ["z", "a", "b"]);
});

test("desktop rail exposes six entries while the full source remains searchable", () => {
  const source = Array.from({ length: 10 }, (_, index) => ({ id: `entry-${index}` }));
  const visible = getVisibleDesktopEntries(source);

  assert.equal(MAX_VISIBLE_DESKTOP_SHORTCUTS, 6);
  assert.deepEqual(visible.map(({ id }) => id), [
    "entry-0",
    "entry-1",
    "entry-2",
    "entry-3",
    "entry-4",
    "entry-5",
  ]);
  assert.equal(source.length, 10);
  const shortSource = source.slice(0, 4);
  assert.equal(getVisibleDesktopEntries(shortSource), shortSource);
});

test("desktop labels sort with the selected UI language", () => {
  const localizedEntries = ["中", "阿", "A"].map((label) => ({ label }));

  assert.deepEqual(
    sortDesktopEntries(localizedEntries, "name", "en-US").map(({ label }) => label),
    ["A", "中", "阿"],
  );
  assert.deepEqual(
    sortDesktopEntries(localizedEntries, "name", "zh-CN").map(({ label }) => label),
    ["阿", "中", "A"],
  );
});

test("manual desktop positions snap to the selected grid and remain on screen", () => {
  const metrics = getDesktopIconMetrics("medium");
  assert.deepEqual(
    snapDesktopPosition({ x: 61, y: 124 }, metrics, { width: 500, height: 400 }),
    { x: 18, y: 106 },
  );
  assert.deepEqual(
    snapDesktopPosition({ x: 490, y: 390 }, metrics, { width: 500, height: 400 }),
    { x: 404, y: 312 },
  );
});

test("context menus stay inside the viewport and submenus flip near the right edge", () => {
  assert.deepEqual(getDesktopContextMenuPosition({
    clientX: 20,
    clientY: 20,
    viewportWidth: 1280,
    viewportHeight: 720,
    kind: "desktop",
  }), {
    x: 20,
    y: 20,
    submenuSide: "right",
  });
  assert.deepEqual(getDesktopContextMenuPosition({
    clientX: 1260,
    clientY: 710,
    viewportWidth: 1280,
    viewportHeight: 720,
    kind: "desktop",
  }), {
    x: 1024,
    y: 386,
    submenuSide: "left",
  });
  assert.equal(getDesktopContextMenuPosition({
    clientX: 1260,
    clientY: 710,
    viewportWidth: 1280,
    viewportHeight: 720,
    kind: "item",
  }).y, 486);
});
