const DEFAULT_CELL_SIZE = 36;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cellKey(column, row) {
  return `${column}:${row}`;
}

export function createGraphScreenIndex(entries = [], options = {}) {
  const width = Math.max(1, finiteNumber(options.width, 1));
  const height = Math.max(1, finiteNumber(options.height, 1));
  const cellSize = Math.max(12, finiteNumber(options.cellSize, DEFAULT_CELL_SIZE));
  const maxColumn = Math.max(0, Math.ceil(width / cellSize) - 1);
  const maxRow = Math.max(0, Math.ceil(height / cellSize) - 1);
  const nodes = [];
  const cells = new Map();

  for (const candidate of entries) {
    const x = finiteNumber(candidate?.x, Number.NaN);
    const y = finiteNumber(candidate?.y, Number.NaN);
    const radius = Math.max(1, finiteNumber(candidate?.radius, 1));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x + radius < 0 || y + radius < 0 || x - radius > width || y - radius > height) {
      continue;
    }
    const entry = {
      depth: finiteNumber(candidate?.depth, 0),
      nodeIndex: Math.max(0, Math.floor(finiteNumber(candidate?.nodeIndex, nodes.length))),
      radius,
      x,
      y,
    };
    const entryIndex = nodes.push(entry) - 1;
    const minimumColumn = Math.max(0, Math.floor((x - radius) / cellSize));
    const maximumColumn = Math.min(maxColumn, Math.floor((x + radius) / cellSize));
    const minimumRow = Math.max(0, Math.floor((y - radius) / cellSize));
    const maximumRow = Math.min(maxRow, Math.floor((y + radius) / cellSize));
    for (let column = minimumColumn; column <= maximumColumn; column += 1) {
      for (let row = minimumRow; row <= maximumRow; row += 1) {
        const key = cellKey(column, row);
        const bucket = cells.get(key);
        if (bucket) bucket.push(entryIndex);
        else cells.set(key, [entryIndex]);
      }
    }
  }

  return { cellSize, cells, height, nodes, width };
}

export function pickGraphScreenNode(index, x, y) {
  if (!index) return null;
  const pointerX = finiteNumber(x, Number.NaN);
  const pointerY = finiteNumber(y, Number.NaN);
  if (!Number.isFinite(pointerX) || !Number.isFinite(pointerY)) return null;
  if (pointerX < 0 || pointerY < 0 || pointerX > index.width || pointerY > index.height) {
    return null;
  }
  const column = Math.floor(pointerX / index.cellSize);
  const row = Math.floor(pointerY / index.cellSize);
  const candidates = index.cells.get(cellKey(column, row)) ?? [];
  let best = null;
  let bestNormalizedDistance = Infinity;

  for (const entryIndex of candidates) {
    const entry = index.nodes[entryIndex];
    const deltaX = pointerX - entry.x;
    const deltaY = pointerY - entry.y;
    const distanceSquared = deltaX * deltaX + deltaY * deltaY;
    const radiusSquared = entry.radius * entry.radius;
    if (distanceSquared > radiusSquared) continue;
    const normalizedDistance = distanceSquared / radiusSquared;
    if (!best
      || entry.depth < best.depth - 0.0001
      || (Math.abs(entry.depth - best.depth) <= 0.0001
        && normalizedDistance < bestNormalizedDistance)) {
      best = entry;
      bestNormalizedDistance = normalizedDistance;
    }
  }

  return best?.nodeIndex ?? null;
}

export function createGraphPointerQueue() {
  let hover = null;
  let selection = null;
  return {
    hasPending() {
      return hover !== null || selection !== null;
    },
    queueHover(sample) {
      hover = sample;
    },
    queueSelection(sample) {
      selection = sample;
    },
    consume() {
      const pending = { hover, selection };
      hover = null;
      selection = null;
      return pending;
    },
  };
}

export const graphScreenPickingPolicy = Object.freeze({
  cellSize: DEFAULT_CELL_SIZE,
  coarseMinimumRadius: 16,
  fineMinimumRadius: 8,
  maximumRadius: 160,
});
