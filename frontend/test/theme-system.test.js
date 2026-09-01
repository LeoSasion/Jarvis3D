import assert from "node:assert/strict";
import test from "node:test";
import {
  customVisualPaletteFields,
  getCustomVisualPaletteSnapshot,
  getVisualPaletteContrastReport,
  getVisualThemeDefinition,
  getVisualThemeOptions,
  getVisualThemeSnapshot,
  getVisualThemeVersionSnapshot,
  importCustomVisualTheme,
  normalizeCustomVisualPalette,
  parseCustomVisualTheme,
  serializeCustomVisualTheme,
  setCustomVisualPalette,
  setVisualTheme,
  visualThemes,
} from "../src/theme-system.js";

const REQUIRED_SHELL_VARIABLES = Object.freeze([
  "--shell-bg",
  "--shell-surface",
  "--shell-card",
  "--shell-hover",
  "--shell-text",
  "--shell-text-strong",
  "--shell-muted",
  "--shell-border",
  "--shell-accent",
  "--shell-accent-foreground",
  "--shell-danger",
  "--shell-warning",
  "--shell-success",
  "--shell-transient-backdrop",
  "--shell-modal-scrim",
  "--shell-effect-contrast",
  "--shell-effect-shadow",
  "--shell-effect-grain",
]);

test("every theme family provides one complete semantic shell palette", () => {
  for (const theme of visualThemes) {
    for (const variable of REQUIRED_SHELL_VARIABLES) {
      assert.match(theme.variables[variable], /\S/u, `${theme.id} ${variable}`);
    }
    assert.equal(theme.variables["--void"], theme.variables["--shell-bg"]);
    assert.equal(theme.variables["--theme-action"], theme.variables["--shell-accent"]);
    assert.equal(theme.variables["--success"], theme.variables["--shell-success"]);
    assert.equal(theme.variables["--danger"], theme.variables["--shell-danger"]);
  }
  assert.deepEqual(
    getVisualThemeOptions().map((theme) => theme.id),
    ["nexus", "stealth", "clarity", "custom"],
  );
  assert.deepEqual(getVisualThemeDefinition("nexus").palette, {
    background: "#000000",
    surface: "#070605",
    card: "#100E0C",
    text: "#F5F1E9",
    textStrong: "#FFFDF8",
    muted: "#AAA39A",
    border: "#35312D",
    accent: "#FF5A00",
  });
  for (const theme of visualThemes) {
    assert.equal(getVisualPaletteContrastReport(theme.palette).passes, true, theme.id);
  }
});

test("custom palettes accept only normalized six-digit color values", () => {
  const normalized = normalizeCustomVisualPalette({
    background: "#112233",
    surface: "url(https://example.invalid)",
    accent: "#aabbcc",
  });
  assert.equal(normalized.background, "#112233");
  assert.equal(normalized.accent, "#AABBCC");
  assert.doesNotMatch(normalized.surface, /url|var|;/iu);
  assert.deepEqual(Object.keys(normalized), customVisualPaletteFields.map(({ key }) => key));
});

test("editing the active custom theme changes its revision without changing its id", () => {
  const beforeVersion = getVisualThemeVersionSnapshot();
  const next = setCustomVisualPalette({
    ...getCustomVisualPaletteSnapshot(),
    accent: "#CC5500",
  });
  assert.equal(next.accent, "#CC5500");
  assert.equal(getVisualThemeSnapshot(), "custom");
  assert.notEqual(getVisualThemeVersionSnapshot(), beforeVersion);
  const custom = getVisualThemeDefinition();
  assert.equal(custom.palette.accent, "#CC5500");
  assert.equal(custom.variables["--shell-accent"], "#CC5500");
});

test("custom theme documents round trip and reject CSS-shaped or incomplete input", () => {
  const documentText = serializeCustomVisualTheme();
  const beforeImport = getCustomVisualPaletteSnapshot();
  assert.deepEqual(parseCustomVisualTheme(documentText), beforeImport);
  assert.equal(getCustomVisualPaletteSnapshot(), beforeImport);
  const palette = importCustomVisualTheme(documentText);
  assert.deepEqual(palette, getCustomVisualPaletteSnapshot());

  assert.throws(() => importCustomVisualTheme(JSON.stringify({
    kind: "jarvis-visual-theme",
    schemaVersion: 1,
    palette: { accent: "#CC5500" },
  })), /supported color fields/u);
  assert.throws(() => importCustomVisualTheme(JSON.stringify({
    kind: "jarvis-visual-theme",
    schemaVersion: 1,
    palette: Object.fromEntries(customVisualPaletteFields.map(({ key }) => [
      key,
      key === "accent" ? "var(--unsafe)" : "#112233",
    ])),
  })), /supported color fields/u);

  setVisualTheme("nexus");
});

test("custom theme drafts can be exported before apply and unreadable palettes are rejected", () => {
  const draft = {
    background: "#000000",
    surface: "#080706",
    card: "#12100E",
    text: "#F5F1E9",
    textStrong: "#FFFFFF",
    muted: "#B0A89E",
    border: "#3A3530",
    accent: "#FF7A2F",
  };
  assert.deepEqual(JSON.parse(serializeCustomVisualTheme(draft)).palette, draft);

  const unreadable = Object.fromEntries(customVisualPaletteFields.map(({ key }) => [key, "#111111"]));
  const report = getVisualPaletteContrastReport(unreadable);
  assert.equal(report.passes, false);
  assert.ok(report.checks.some((check) => !check.passes));
  assert.throws(() => setCustomVisualPalette(unreadable), /minimum contrast/u);
  setVisualTheme("nexus");
});
