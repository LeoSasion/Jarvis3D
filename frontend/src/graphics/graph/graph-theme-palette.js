const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export const GRAPH_LABEL_BACKGROUND_COLOR = "#010101";
export const GRAPH_NORMAL_TEXT_MIN_CONTRAST = 4.5;

const ordinaryLabelRoles = Object.freeze([
  Object.freeze({ key: "baseColor", label: "BASE" }),
  Object.freeze({ key: "hubColor", label: "HUB" }),
  Object.freeze({ key: "groupColor", label: "GROUP" }),
]);
const activeLabelRole = Object.freeze({ key: "activeColor", label: "ACTIVE" });

function normalizeHexColor(value) {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value)
    ? value.toUpperCase()
    : null;
}

function hexToRgb(value) {
  const normalized = normalizeHexColor(value);
  if (!normalized) return null;
  return [1, 3, 5].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
}

function linearizeSrgb(channel) {
  const value = channel / 255;
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(rgb) {
  const [red, green, blue] = rgb.map(linearizeSrgb);
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function clampOpacity(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : 1;
}

export function createGraphThemePalette(semanticColors) {
  return Object.freeze({
    background: semanticColors.canvas,
    node: semanticColors.content,
    hub: semanticColors.hub,
    active: semanticColors.action,
    group: semanticColors.group,
    edge: semanticColors.relation,
  });
}

export function getGraphColorContrastRatio(
  foreground,
  background = GRAPH_LABEL_BACKGROUND_COLOR,
  opacity = 1,
) {
  const foregroundRgb = hexToRgb(foreground);
  const backgroundRgb = hexToRgb(background);
  if (!foregroundRgb || !backgroundRgb) return 0;

  const alpha = clampOpacity(opacity);
  const compositedRgb = foregroundRgb.map((channel, index) => (
    (channel * alpha) + (backgroundRgb[index] * (1 - alpha))
  ));
  const foregroundLuminance = relativeLuminance(compositedRgb);
  const backgroundLuminance = relativeLuminance(backgroundRgb);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function getGraphLabelContrastReport(colors, {
  background = GRAPH_LABEL_BACKGROUND_COLOR,
  opacity = 1,
  includeActive = false,
} = {}) {
  const roles = includeActive
    ? [...ordinaryLabelRoles, activeLabelRole]
    : ordinaryLabelRoles;
  const resolvedBackground = normalizeHexColor(background) ?? GRAPH_LABEL_BACKGROUND_COLOR;
  const resolvedOpacity = clampOpacity(opacity);
  const entries = Object.freeze(roles.map(({ key, label }) => {
    const color = normalizeHexColor(colors?.[key]);
    const ratio = getGraphColorContrastRatio(color, resolvedBackground, resolvedOpacity);
    return Object.freeze({
      key,
      label,
      color,
      ratio,
      passes: ratio >= GRAPH_NORMAL_TEXT_MIN_CONTRAST,
    });
  }));
  const minimumRatio = Math.min(...entries.map((entry) => entry.ratio));

  return Object.freeze({
    background: resolvedBackground,
    opacity: resolvedOpacity,
    minimumRatio,
    minimum: GRAPH_NORMAL_TEXT_MIN_CONTRAST,
    passes: entries.every((entry) => entry.passes),
    entries,
    failures: Object.freeze(entries.filter((entry) => !entry.passes)),
  });
}
