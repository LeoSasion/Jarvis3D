const MIN_VISIBLE_PIXELS = 160;

export function clampGraphViewportInsets(width, height, insets = {}) {
  const boundedWidth = Math.max(1, Number(width) || 1);
  const boundedHeight = Math.max(1, Number(height) || 1);
  const left = Math.max(0, Math.min(boundedWidth, Number(insets.left) || 0));
  const right = Math.max(0, Math.min(boundedWidth, Number(insets.right) || 0));
  const top = Math.max(0, Math.min(boundedHeight, Number(insets.top) || 0));
  const bottom = Math.max(0, Math.min(boundedHeight, Number(insets.bottom) || 0));
  const maximumHorizontalInset = Math.max(0, boundedWidth - Math.min(MIN_VISIBLE_PIXELS, boundedWidth * 0.4));
  const maximumVerticalInset = Math.max(0, boundedHeight - Math.min(MIN_VISIBLE_PIXELS, boundedHeight * 0.4));
  const horizontalScale = Math.min(1, maximumHorizontalInset / Math.max(1, left + right));
  const verticalScale = Math.min(1, maximumVerticalInset / Math.max(1, top + bottom));
  return {
    left: left * horizontalScale,
    right: right * horizontalScale,
    top: top * verticalScale,
    bottom: bottom * verticalScale,
  };
}

export function getGraphVisibleViewport(width, height, insets = {}) {
  const bounded = clampGraphViewportInsets(width, height, insets);
  return {
    ...bounded,
    width: Math.max(1, width - bounded.left - bounded.right),
    height: Math.max(1, height - bounded.top - bounded.bottom),
    offsetX: (bounded.left - bounded.right) * 0.5,
    offsetY: (bounded.top - bounded.bottom) * 0.5,
  };
}

export function getGraphPlanarCameraTarget(point, zoom, visible) {
  const scale = Math.max(0.01, zoom);
  return {
    x: point.x - visible.offsetX / scale,
    y: point.y + visible.offsetY / scale,
  };
}

export function measureGraphViewportInsets(canvas) {
  const root = canvas?.closest?.(".desktop-workspace") ?? canvas?.closest?.(".core-stage");
  if (!root) return {};
  const rect = canvas.getBoundingClientRect();
  const insets = { left: 0, right: 0, top: 0, bottom: 0 };
  const selectors = [
    ".knowledge-browser",
    ".graph-visual-settings.is-overlay",
    ".knowledge-workspace__inspector",
    ".core-stage__graph-inspector",
    ".telemetry-rail:not([hidden])",
  ];
  for (const overlay of root.querySelectorAll(selectors.join(","))) {
    if (overlay.getClientRects().length === 0) continue;
    const bounds = overlay.getBoundingClientRect();
    const overlapWidth = Math.max(0, Math.min(rect.right, bounds.right) - Math.max(rect.left, bounds.left));
    const overlapHeight = Math.max(0, Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, bounds.top));
    if (overlapWidth === 0 || overlapHeight < rect.height * 0.18) continue;
    if ((bounds.left + bounds.right) * 0.5 < rect.left + rect.width * 0.5) {
      insets.left = Math.max(insets.left, bounds.right - rect.left + 12);
    } else {
      insets.right = Math.max(insets.right, rect.right - bounds.left + 12);
    }
  }
  return clampGraphViewportInsets(rect.width, rect.height, insets);
}
