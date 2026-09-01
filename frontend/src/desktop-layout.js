export const DESKTOP_ICON_CELL_WIDTH = 96;
export const DESKTOP_ICON_CELL_HEIGHT = 88;
export const DESKTOP_ICON_GRID_PADDING = 18;
export const MAX_VISIBLE_DESKTOP_SHORTCUTS = 6;

export const DESKTOP_ICON_SIZES = {
  small: {
    cellWidth: 80,
    cellHeight: 74,
    iconSize: 34,
    labelSize: 11,
  },
  medium: {
    cellWidth: DESKTOP_ICON_CELL_WIDTH,
    cellHeight: DESKTOP_ICON_CELL_HEIGHT,
    iconSize: 44,
    labelSize: 13,
  },
  large: {
    cellWidth: 120,
    cellHeight: 108,
    iconSize: 58,
    labelSize: 13,
  },
};

const DESKTOP_DENSITY_OFFSETS = Object.freeze({
  compact: Object.freeze({ cellWidth: 0, cellHeight: 0, iconSize: 0, labelSize: 0 }),
  comfortable: Object.freeze({ cellWidth: 12, cellHeight: 8, iconSize: 8, labelSize: 1 }),
  spacious: Object.freeze({ cellWidth: 24, cellHeight: 20, iconSize: 16, labelSize: 2 }),
  ultra: Object.freeze({ cellWidth: 56, cellHeight: 48, iconSize: 32, labelSize: 3 }),
});

export function clampDesktopCoordinate(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function getDesktopDensityTier(width, height) {
  const safeWidth = Number.isFinite(width) ? width : 0;
  const safeHeight = Number.isFinite(height) ? height : 0;
  if (safeWidth >= 1_600 && safeHeight >= 1_500) return "ultra";
  if (safeWidth >= 1_200 && safeHeight >= 1_100) return "spacious";
  if (safeWidth >= 800 && safeHeight >= 620) return "comfortable";
  return "compact";
}

export function getDesktopLayoutProfileId(width, height, devicePixelRatio = 1) {
  const density = getDesktopDensityTier(width, height);
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? devicePixelRatio
    : 1;
  const dprBucket = Math.min(250, Math.max(100, Math.round(dpr * 4) * 25));
  return `${density}@${dprBucket}`;
}

export function getDesktopIconMetrics(size = "medium", density = "compact") {
  const base = DESKTOP_ICON_SIZES[size] ?? DESKTOP_ICON_SIZES.medium;
  const offset = DESKTOP_DENSITY_OFFSETS[density] ?? DESKTOP_DENSITY_OFFSETS.compact;
  return Object.freeze({
    cellWidth: base.cellWidth + offset.cellWidth,
    cellHeight: base.cellHeight + offset.cellHeight,
    iconSize: base.iconSize + offset.iconSize,
    labelSize: base.labelSize + offset.labelSize,
  });
}

export function getDesktopFallbackPosition(index, height, metrics = DESKTOP_ICON_SIZES.medium) {
  const availableHeight = Math.max(
    metrics.cellHeight,
    height - DESKTOP_ICON_GRID_PADDING * 2,
  );
  const rowCount = Math.max(
    1,
    Math.floor(availableHeight / metrics.cellHeight),
  );
  return {
    x: DESKTOP_ICON_GRID_PADDING +
      Math.floor(index / rowCount) * metrics.cellWidth,
    y: DESKTOP_ICON_GRID_PADDING +
      (index % rowCount) * metrics.cellHeight,
  };
}

export function sortDesktopEntries(entries, sortMode = "none", language = undefined) {
  if (sortMode === "none") return entries;
  const compareTechnical = (left, right) => String(left ?? "").localeCompare(
    String(right ?? ""),
    undefined,
    { numeric: true, sensitivity: "base" },
  );
  const compareLabel = (left, right) => String(left.label ?? "").localeCompare(
    String(right.label ?? ""),
    language,
    { numeric: true, sensitivity: "base" },
  );
  return [...entries].sort((left, right) => {
    if (sortMode === "type") {
      return compareTechnical(left.kind, right.kind) ||
        compareTechnical(left.extension, right.extension) ||
        compareLabel(left, right);
    }
    if (sortMode === "source") {
      return compareTechnical(left.source, right.source) ||
        compareLabel(left, right);
    }
    return compareLabel(left, right);
  });
}

export function getVisibleDesktopEntries(
  entries,
  limit = MAX_VISIBLE_DESKTOP_SHORTCUTS,
) {
  const maximum = Number.isInteger(limit) && limit > 0
    ? limit
    : MAX_VISIBLE_DESKTOP_SHORTCUTS;
  return entries.length <= maximum ? entries : entries.slice(0, maximum);
}

export function snapDesktopPosition(position, metrics, containerSize) {
  const maximumX = Math.max(0, containerSize.width - metrics.cellWidth);
  const maximumY = Math.max(0, containerSize.height - metrics.cellHeight);
  const gridX = Math.round(
    (position.x - DESKTOP_ICON_GRID_PADDING) / metrics.cellWidth,
  ) * metrics.cellWidth + DESKTOP_ICON_GRID_PADDING;
  const gridY = Math.round(
    (position.y - DESKTOP_ICON_GRID_PADDING) / metrics.cellHeight,
  ) * metrics.cellHeight + DESKTOP_ICON_GRID_PADDING;
  return {
    x: clampDesktopCoordinate(gridX, 0, maximumX),
    y: clampDesktopCoordinate(gridY, 0, maximumY),
  };
}

export function getDesktopContextMenuPosition({
  clientX,
  clientY,
  viewportWidth,
  viewportHeight,
  kind = "desktop",
}) {
  const menuWidth = 248;
  const menuHeight = kind === "item" ? 226 : 326;
  const margin = 8;
  const x = clampDesktopCoordinate(clientX, margin, viewportWidth - menuWidth - margin);
  const y = clampDesktopCoordinate(clientY, margin, viewportHeight - menuHeight - margin);
  const submenuSide = x + menuWidth * 2 + margin <= viewportWidth ? "right" : "left";
  return { x, y, submenuSide };
}
