import { createGraphThemePalette } from "./graphics/graph/graph-theme-palette.js";

const STORAGE_KEY = "jarvis.visual-theme.v2";
const LEGACY_STORAGE_KEY = "jarvis.visual-theme.v1";
const CUSTOM_PALETTE_STORAGE_KEY = "jarvis.visual-theme.custom.v1";
const CUSTOM_THEME_DOCUMENT_KIND = "jarvis-visual-theme";
const CUSTOM_THEME_DOCUMENT_VERSION = 1;
const MAX_CUSTOM_THEME_DOCUMENT_LENGTH = 16_384;
const DEFAULT_THEME_ID = "nexus";
const CUSTOM_THEME_ID = "custom";
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/iu;
const listeners = new Set();

export const customVisualPaletteFields = Object.freeze([
  Object.freeze({ key: "background", label: "Background" }),
  Object.freeze({ key: "surface", label: "Navigation" }),
  Object.freeze({ key: "card", label: "Raised surface" }),
  Object.freeze({ key: "text", label: "Text" }),
  Object.freeze({ key: "textStrong", label: "Strong text" }),
  Object.freeze({ key: "muted", label: "Muted text" }),
  Object.freeze({ key: "border", label: "Border" }),
  Object.freeze({ key: "accent", label: "Accent" }),
]);

const DEFAULT_CUSTOM_PALETTE = Object.freeze({
  background: "#000000",
  surface: "#070605",
  card: "#100E0C",
  text: "#F5F1E9",
  textStrong: "#FFFDF8",
  muted: "#AAA39A",
  border: "#35312D",
  accent: "#FF5A00",
});

const BUILT_IN_THEME_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "nexus",
    label: "Carbon",
    description: "Quiet dark surfaces with a warm command accent.",
    palette: DEFAULT_CUSTOM_PALETTE,
  }),
  Object.freeze({
    id: "stealth",
    label: "Ember",
    description: "Warmer dark surfaces with a softer copper signal.",
    palette: Object.freeze({
      background: "#17110F",
      surface: "#201815",
      card: "#29201C",
      text: "#D8C8B8",
      textStrong: "#F1E8E1",
      muted: "#9B887D",
      border: "#4B3930",
      accent: "#D88950",
    }),
  }),
  Object.freeze({
    id: "clarity",
    label: "Paper",
    description: "A light, warm workspace with an oxide-red accent.",
    palette: Object.freeze({
      background: "#F7F4EF",
      surface: "#EFEAE3",
      card: "#FFFFFF",
      text: "#4A443C",
      textStrong: "#211E1A",
      muted: "#5F574F",
      border: "#C8BFB3",
      accent: "#963A1E",
    }),
  }),
]);

function normalizeHexColor(value, fallback) {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return HEX_COLOR_PATTERN.test(normalized) ? normalized : fallback;
}

function hexChannels(value) {
  const normalized = normalizeHexColor(value, "#000000");
  return [1, 3, 5].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
}

function channelsToHex(channels) {
  return `#${channels.map((channel) => Math.round(channel)
    .toString(16)
    .padStart(2, "0")).join("")}`.toUpperCase();
}

function mixHex(base, overlay, overlayWeight) {
  const weight = Math.min(1, Math.max(0, overlayWeight));
  const baseChannels = hexChannels(base);
  const overlayChannels = hexChannels(overlay);
  return channelsToHex(baseChannels.map((channel, index) => (
    (channel * (1 - weight)) + (overlayChannels[index] * weight)
  )));
}

function rgba(value, alpha) {
  const [red, green, blue] = hexChannels(value);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function linearize(channel) {
  const value = channel / 255;
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(value) {
  const [red, green, blue] = hexChannels(value).map(linearize);
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function contrastRatio(foreground, background) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

function inferColorScheme(background) {
  return relativeLuminance(background) > 0.42 ? "light" : "dark";
}

function selectAccentForeground(accent) {
  const dark = "#000000";
  const light = "#FFFFFF";
  return contrastRatio(dark, accent) >= contrastRatio(light, accent) ? dark : light;
}

export function normalizeCustomVisualPalette(value, fallback = DEFAULT_CUSTOM_PALETTE) {
  const source = value && typeof value === "object" ? value : {};
  return Object.freeze(Object.fromEntries(customVisualPaletteFields.map(({ key }) => [
    key,
    normalizeHexColor(source[key], fallback[key]),
  ])));
}

const CUSTOM_PALETTE_CONTRAST_RULES = Object.freeze([
  Object.freeze({ id: "text-background", label: "Text on background", foreground: "text", background: "background", minimum: 4.5 }),
  Object.freeze({ id: "text-surface", label: "Text on navigation", foreground: "text", background: "surface", minimum: 4.5 }),
  Object.freeze({ id: "strong-card", label: "Strong text on raised surface", foreground: "textStrong", background: "card", minimum: 4.5 }),
  Object.freeze({ id: "muted-background", label: "Muted text on background", foreground: "muted", background: "background", minimum: 4.5 }),
  Object.freeze({ id: "accent-background", label: "Accent on background", foreground: "accent", background: "background", minimum: 3 }),
]);

export function getVisualPaletteContrastReport(value) {
  const palette = normalizeCustomVisualPalette(value);
  const checks = CUSTOM_PALETTE_CONTRAST_RULES.map((rule) => {
    const ratio = contrastRatio(palette[rule.foreground], palette[rule.background]);
    return Object.freeze({
      ...rule,
      ratio,
      passes: ratio >= rule.minimum,
    });
  });
  return Object.freeze({
    passes: checks.every((check) => check.passes),
    minimumRatio: Math.min(...checks.map((check) => check.ratio)),
    checks: Object.freeze(checks),
  });
}

export function serializeCustomVisualTheme(palette = customPalette) {
  return JSON.stringify({
    kind: CUSTOM_THEME_DOCUMENT_KIND,
    schemaVersion: CUSTOM_THEME_DOCUMENT_VERSION,
    label: "JARVIS custom palette",
    palette: normalizeCustomVisualPalette(palette),
  }, null, 2);
}

export function parseCustomVisualTheme(value) {
  if (typeof value === "string" && value.length > MAX_CUSTOM_THEME_DOCUMENT_LENGTH) {
    throw new TypeError("Theme document is too large");
  }
  let documentValue;
  try {
    documentValue = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw new TypeError("Theme document is not valid JSON");
  }
  if (!documentValue || typeof documentValue !== "object" ||
      documentValue.kind !== CUSTOM_THEME_DOCUMENT_KIND ||
      documentValue.schemaVersion !== CUSTOM_THEME_DOCUMENT_VERSION ||
      !documentValue.palette || typeof documentValue.palette !== "object") {
    throw new TypeError("Theme document uses an unsupported format");
  }
  const allowedKeys = new Set(customVisualPaletteFields.map(({ key }) => key));
  const suppliedKeys = Object.keys(documentValue.palette);
  if (suppliedKeys.length !== allowedKeys.size ||
      suppliedKeys.some((key) => !allowedKeys.has(key)) ||
      customVisualPaletteFields.some(({ key }) => (
        !HEX_COLOR_PATTERN.test(String(documentValue.palette[key] ?? "").trim())
      ))) {
    throw new TypeError("Theme palette must contain only the supported color fields");
  }
  return normalizeCustomVisualPalette(documentValue.palette);
}

export function importCustomVisualTheme(value) {
  return setCustomVisualPalette(parseCustomVisualTheme(value));
}

function createTheme({ id, label, description, palette }) {
  const normalizedPalette = normalizeCustomVisualPalette(palette);
  const colorScheme = inferColorScheme(normalizedPalette.background);
  const lightMode = colorScheme === "light";
  const white = "#FFFFFF";
  const black = "#000000";
  const towardForeground = lightMode ? black : white;
  const towardBackground = lightMode ? white : black;
  const colors = Object.freeze({
    canvas: normalizedPalette.background,
    content: normalizedPalette.textStrong,
    hub: normalizedPalette.text,
    action: normalizedPalette.accent,
    actionEmphasis: mixHex(normalizedPalette.accent, towardForeground, 0.16),
    group: normalizedPalette.muted,
    relation: mixHex(normalizedPalette.border, normalizedPalette.text, 0.28),
  });
  const surfaceHover = mixHex(normalizedPalette.surface, normalizedPalette.textStrong, 0.07);
  const elevated = mixHex(normalizedPalette.card, normalizedPalette.textStrong, 0.04);
  const borderWeak = mixHex(normalizedPalette.border, normalizedPalette.background, 0.48);
  const borderStrong = mixHex(normalizedPalette.border, normalizedPalette.text, 0.34);
  const accentForeground = selectAccentForeground(normalizedPalette.accent);
  const danger = lightMode ? "#B4232A" : "#F97066";
  const warning = lightMode ? "#8A5500" : "#F5A524";
  const success = lightMode ? "#176B3A" : "#65C982";
  const shellModalScrim = rgba(towardBackground, lightMode ? 0.34 : 0.58);
  const variables = Object.freeze({
    "--shell-bg": normalizedPalette.background,
    "--shell-bg-accent": mixHex(normalizedPalette.background, normalizedPalette.accent, 0.025),
    "--shell-sidebar": normalizedPalette.surface,
    "--shell-surface": normalizedPalette.surface,
    "--shell-card": normalizedPalette.card,
    "--shell-elevated": elevated,
    "--shell-hover": surfaceHover,
    "--shell-text": normalizedPalette.text,
    "--shell-text-strong": normalizedPalette.textStrong,
    "--shell-muted": normalizedPalette.muted,
    "--shell-border-subtle": borderWeak,
    "--shell-border": normalizedPalette.border,
    "--shell-border-strong": borderStrong,
    "--shell-accent": colors.action,
    "--shell-accent-hover": colors.actionEmphasis,
    "--shell-accent-subtle": rgba(colors.action, 0.12),
    "--shell-accent-foreground": accentForeground,
    "--shell-selection": rgba(colors.action, 0.2),
    "--shell-focus": colors.action,
    "--shell-danger": danger,
    "--shell-warning": warning,
    "--shell-success": success,
    "--shell-transient-backdrop": rgba(towardBackground, 0),
    "--shell-modal-scrim": shellModalScrim,
    "--shell-scrim": shellModalScrim,
    "--shell-shadow-soft": `0 10px 28px ${rgba(towardBackground, lightMode ? 0.12 : 0.3)}`,
    "--shell-shadow-float": `0 24px 64px ${rgba(towardBackground, lightMode ? 0.18 : 0.44)}`,
    "--shell-effect-contrast": towardForeground,
    "--shell-effect-shadow": black,
    "--shell-effect-grain": normalizedPalette.muted,
    "--structure-seam": rgba(normalizedPalette.textStrong, 0.14),
    "--structure-ledger": rgba(normalizedPalette.textStrong, 0.08),
    "--void": normalizedPalette.background,
    "--surface-0": normalizedPalette.background,
    "--surface-1": normalizedPalette.surface,
    "--surface-2": normalizedPalette.card,
    "--surface-3": surfaceHover,
    "--surface-canvas": normalizedPalette.background,
    "--ink-1": normalizedPalette.textStrong,
    "--ink-2": normalizedPalette.text,
    "--ink-3": normalizedPalette.muted,
    "--structure-weak": borderWeak,
    "--structure": normalizedPalette.border,
    "--structure-strong": borderStrong,
    "--theme-action": colors.action,
    "--theme-action-emphasis": colors.actionEmphasis,
    "--status-warning": warning,
    "--status-danger": danger,
    "--success": success,
    "--danger": danger,
    "--bg-0": normalizedPalette.background,
    "--bg-1": normalizedPalette.surface,
    "--surface": normalizedPalette.surface,
    "--surface-raised": normalizedPalette.card,
    "--line-dim": borderWeak,
    "--line-mid": borderStrong,
    "--energy-blue": mixHex(colors.action, towardBackground, 0.24),
    "--energy-cyan": colors.action,
    "--energy-ice": normalizedPalette.textStrong,
    "--glow-core": normalizedPalette.textStrong,
    "--glow-edge": colors.actionEmphasis,
    "--glow-halo": rgba(colors.action, 0.28),
    "--glow-bloom": rgba(colors.action, 0.1),
    "--terminal-bg": normalizedPalette.background,
    "--terminal-fg": normalizedPalette.textStrong,
  });
  const graphPalette = createGraphThemePalette(colors);
  return Object.freeze({
    id,
    label,
    description,
    colorScheme,
    palette: normalizedPalette,
    semanticColors: colors,
    variables,
    graphPalette,
  });
}

export const visualThemes = Object.freeze(BUILT_IN_THEME_DEFINITIONS.map(createTheme));
const themeById = new Map(visualThemes.map((theme) => [theme.id, theme]));
let customPalette = DEFAULT_CUSTOM_PALETTE;
let customTheme = createTheme({
  id: CUSTOM_THEME_ID,
  label: "Custom",
  description: "Your complete workspace palette.",
  palette: customPalette,
});
let activeThemeId = DEFAULT_THEME_ID;
let revision = 0;
let initialized = false;

function readStoredCustomPalette() {
  if (typeof window === "undefined") return DEFAULT_CUSTOM_PALETTE;
  try {
    const palette = normalizeCustomVisualPalette(
      JSON.parse(window.localStorage.getItem(CUSTOM_PALETTE_STORAGE_KEY) ?? "null"),
    );
    return getVisualPaletteContrastReport(palette).passes ? palette : DEFAULT_CUSTOM_PALETTE;
  } catch {
    return DEFAULT_CUSTOM_PALETTE;
  }
}

function readStoredThemeId() {
  if (typeof window === "undefined") return DEFAULT_THEME_ID;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_STORAGE_KEY);
    return stored === CUSTOM_THEME_ID || themeById.has(stored) ? stored : DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

function resolveTheme(themeId = activeThemeId) {
  return themeId === CUSTOM_THEME_ID
    ? customTheme
    : themeById.get(themeId) ?? themeById.get(DEFAULT_THEME_ID);
}

function applyVariables(theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.dataset.themeMode = theme.colorScheme;
  root.style.colorScheme = theme.colorScheme;
  Object.entries(theme.variables).forEach(([name, value]) => root.style.setProperty(name, value));
}

function notifyThemeChanged() {
  listeners.forEach((listener) => listener());
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function" &&
      typeof CustomEvent === "function") {
    window.dispatchEvent(new CustomEvent("jarvis:theme-changed", {
      detail: { themeId: activeThemeId, revision },
    }));
  }
}

function commitThemeChange({ persist = true } = {}) {
  revision += 1;
  applyVariables(resolveTheme());
  if (persist && typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, activeThemeId);
      if (activeThemeId === CUSTOM_THEME_ID) {
        window.localStorage.setItem(CUSTOM_PALETTE_STORAGE_KEY, JSON.stringify(customPalette));
      }
    } catch {
      // The current surface still receives the selected palette.
    }
  }
  notifyThemeChanged();
}

function handleStorage(event) {
  if (event.key !== STORAGE_KEY && event.key !== LEGACY_STORAGE_KEY &&
      event.key !== CUSTOM_PALETTE_STORAGE_KEY) return;
  const nextPalette = readStoredCustomPalette();
  const paletteChanged = customVisualPaletteFields.some(({ key }) => (
    nextPalette[key] !== customPalette[key]
  ));
  if (paletteChanged) {
    customPalette = nextPalette;
    customTheme = createTheme({
      id: CUSTOM_THEME_ID,
      label: "Custom",
      description: "Your complete workspace palette.",
      palette: customPalette,
    });
  }
  const nextThemeId = readStoredThemeId();
  if (!paletteChanged && nextThemeId === activeThemeId) return;
  activeThemeId = nextThemeId;
  commitThemeChange({ persist: false });
}

export function initializeVisualTheme() {
  customPalette = readStoredCustomPalette();
  customTheme = createTheme({
    id: CUSTOM_THEME_ID,
    label: "Custom",
    description: "Your complete workspace palette.",
    palette: customPalette,
  });
  activeThemeId = readStoredThemeId();
  applyVariables(resolveTheme());
  if (!initialized && typeof window !== "undefined") {
    initialized = true;
    window.addEventListener("storage", handleStorage);
  }
  return activeThemeId;
}

export function getVisualThemeSnapshot() {
  return activeThemeId;
}

export function getVisualThemeVersionSnapshot() {
  return `${activeThemeId}:${revision}`;
}

export function getVisualThemeDefinition(themeId = activeThemeId) {
  return resolveTheme(themeId);
}

export function getVisualThemeOptions() {
  return Object.freeze([...visualThemes, customTheme]);
}

export function getCustomVisualPaletteSnapshot() {
  return customPalette;
}

export function getGraphThemePalette(themeId = activeThemeId) {
  return resolveTheme(themeId).graphPalette;
}

export function subscribeVisualTheme(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setVisualTheme(themeId) {
  const nextTheme = resolveTheme(themeId);
  if (nextTheme.id !== themeId || nextTheme.id === activeThemeId) return activeThemeId;
  activeThemeId = nextTheme.id;
  commitThemeChange();
  return activeThemeId;
}

export function setCustomVisualPalette(nextPalette) {
  const normalized = normalizeCustomVisualPalette(nextPalette, customPalette);
  const contrast = getVisualPaletteContrastReport(normalized);
  if (!contrast.passes) {
    throw new TypeError("Theme palette does not meet the minimum contrast requirements");
  }
  const changed = customVisualPaletteFields.some(({ key }) => (
    normalized[key] !== customPalette[key]
  ));
  if (!changed && activeThemeId === CUSTOM_THEME_ID) return customPalette;
  customPalette = normalized;
  customTheme = createTheme({
    id: CUSTOM_THEME_ID,
    label: "Custom",
    description: "Your complete workspace palette.",
    palette: customPalette,
  });
  activeThemeId = CUSTOM_THEME_ID;
  commitThemeChange();
  return customPalette;
}

export function resetCustomVisualPalette() {
  return setCustomVisualPalette(DEFAULT_CUSTOM_PALETTE);
}
