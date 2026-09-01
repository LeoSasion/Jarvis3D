import {
  CanvasTexture,
  LinearFilter,
  SRGBColorSpace,
} from "three";
import { formatGraphLabelText } from "./graph-label-text.js";

export const MAX_GRAPH_LABEL_ATLAS_ENTRIES = 64;
export const GRAPH_LABEL_DYNAMIC_SLOTS = 2;

const CELL_WIDTH = 448;
const CELL_HEIGHT = 64;
const COLUMN_COUNT = 4;
const TEXT_PADDING = 12;
const TEXT_BASELINE = 42;
const FONT_SIZE = 30;
const MAX_CHARACTERS = 18;
const FONT_FAMILY = '"JARVIS Graph Noto Sans SC", "Microsoft YaHei", sans-serif';

let graphLabelFontPromise = null;

function truncateLabel(value) {
  const characters = Array.from(formatGraphLabelText(value));
  return characters.length <= MAX_CHARACTERS
    ? characters.join("")
    : `${characters.slice(0, MAX_CHARACTERS - 1).join("")}…`;
}

function nextPowerOfTwo(value) {
  return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
}

export function createGraphLabelAtlasLayout(entryCount) {
  const count = Math.min(
    MAX_GRAPH_LABEL_ATLAS_ENTRIES,
    Math.max(1, Math.floor(entryCount || 1)),
  );
  const columns = Math.min(COLUMN_COUNT, count);
  const rows = Math.ceil(count / columns);
  return Object.freeze({
    count,
    columns,
    rows,
    cellWidth: CELL_WIDTH,
    cellHeight: CELL_HEIGHT,
    width: nextPowerOfTwo(columns * CELL_WIDTH),
    height: nextPowerOfTwo(rows * CELL_HEIGHT),
  });
}

export function selectGraphLabelIndices(
  model,
  requestedCount,
  selectedNodeId = null,
  hoveredNodeId = null,
) {
  const baseLimit = Math.max(
    0,
    Math.min(
      MAX_GRAPH_LABEL_ATLAS_ENTRIES - GRAPH_LABEL_DYNAMIC_SLOTS,
      Math.floor(requestedCount || 0),
    ),
  );
  const indices = model.labelIndices.slice(0, baseLimit);
  const baseSet = new Set(indices);
  const dynamic = [selectedNodeId, hoveredNodeId].map((nodeId) => {
    const nodeIndex = nodeId == null ? undefined : model.nodeIndex.get(nodeId);
    return nodeIndex === undefined || baseSet.has(nodeIndex) ? -1 : nodeIndex;
  });
  if (dynamic[0] === dynamic[1]) dynamic[1] = -1;
  return Object.freeze({
    base: Object.freeze(indices),
    dynamic: Object.freeze(dynamic),
    all: Object.freeze([...indices, ...dynamic]),
  });
}

export function ensureGraphLabelFont(fontUrl) {
  if (graphLabelFontPromise || typeof FontFace === "undefined" || !globalThis.document?.fonts) {
    return graphLabelFontPromise ?? Promise.resolve(false);
  }
  graphLabelFontPromise = new FontFace(
    "JARVIS Graph Noto Sans SC",
    `url(${fontUrl}) format("woff")`,
    { style: "normal", weight: "400" },
  ).load().then((font) => {
    document.fonts.add(font);
    return true;
  }).catch(() => false);
  return graphLabelFontPromise;
}

function clearCell(context, layout, slot) {
  const column = slot % layout.columns;
  const row = Math.floor(slot / layout.columns);
  context.clearRect(
    column * layout.cellWidth,
    row * layout.cellHeight,
    layout.cellWidth,
    layout.cellHeight,
  );
  return { column, row };
}

function drawEntry(context, layout, slot, value) {
  const { column, row } = clearCell(context, layout, slot);
  const text = truncateLabel(value);
  context.save();
  context.font = `400 ${FONT_SIZE}px ${FONT_FAMILY}`;
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.lineJoin = "round";
  context.miterLimit = 2;
  context.strokeStyle = "rgba(0, 0, 0, 0.96)";
  context.lineWidth = 6;
  context.fillStyle = "#ffffff";
  const x = column * layout.cellWidth + TEXT_PADDING;
  const y = row * layout.cellHeight + TEXT_BASELINE;
  context.strokeText(text, x, y, layout.cellWidth - TEXT_PADDING * 2);
  context.fillText(text, x, y, layout.cellWidth - TEXT_PADDING * 2);
  const measuredWidth = Math.min(
    layout.cellWidth - TEXT_PADDING,
    Math.ceil(context.measureText(text).width) + TEXT_PADDING * 2,
  );
  context.restore();
  return Object.freeze({
    x: (column * layout.cellWidth) / layout.width,
    y: 1 - ((row + 1) * layout.cellHeight) / layout.height,
    width: measuredWidth / layout.width,
    height: layout.cellHeight / layout.height,
    aspect: measuredWidth / layout.cellHeight,
    text,
  });
}

export function createGraphLabelAtlas(values, canvasFactory = null) {
  const createCanvas = canvasFactory ?? (() => document.createElement("canvas"));
  const layout = createGraphLabelAtlasLayout(values.length);
  const canvas = createCanvas();
  canvas.width = layout.width;
  canvas.height = layout.height;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Canvas2D is unavailable for graph labels");
  const entries = Array.from({ length: layout.count }, (_, slot) => (
    drawEntry(context, layout, slot, values[slot] ?? "")
  ));
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  let disposed = false;

  return {
    canvas,
    entries,
    layout,
    texture,
    update(slot, value) {
      if (disposed || slot < 0 || slot >= layout.count) return null;
      const entry = drawEntry(context, layout, slot, value);
      entries[slot] = entry;
      texture.needsUpdate = true;
      return entry;
    },
    redraw() {
      if (disposed) return;
      entries.forEach((entry, slot) => {
        entries[slot] = drawEntry(context, layout, slot, entry.text);
      });
      texture.needsUpdate = true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      texture.dispose();
      canvas.width = 1;
      canvas.height = 1;
    },
  };
}
