import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getGraphThemePalette, visualThemes } from "../src/theme-system.js";
import {
  GRAPH_NORMAL_TEXT_MIN_CONTRAST,
  getGraphLabelContrastReport,
} from "../src/graphics/graph/graph-theme-palette.js";
import {
  DEFAULT_GRAPH_VISUAL_SETTINGS,
  getGraphVisualSettingsSnapshot,
  graphVisualPresets,
  normalizeGraphVisualSettings,
  resetGraphVisualSettings,
  resolveGraphVisualColors,
  setGraphVisualPreset,
} from "../src/graphics/graph/graph-visual-settings.js";

const sourceUrl = new URL("../src/", import.meta.url);

function readSource(name) {
  return readFile(new URL(name, sourceUrl), "utf8");
}

test("every visual theme derives DOM and GPU action colors from one semantic source", () => {
  for (const theme of visualThemes) {
    const palette = getGraphThemePalette(theme.id);
    assert.equal(palette, theme.graphPalette);
    assert.notEqual(palette.hub, palette.active);
    assert.equal(palette.active, theme.semanticColors.action);
    assert.equal(palette.background, theme.semanticColors.canvas);
    assert.equal(theme.variables["--theme-action"], theme.semanticColors.action);
    assert.equal(theme.variables["--theme-action-emphasis"], theme.semanticColors.actionEmphasis);
    assert.match(palette.node, /^#[0-9A-F]{6}$/u);
    assert.match(palette.edge, /^#[0-9A-F]{6}$/u);
  }
});

test("unknown graph themes fail closed to the default palette", () => {
  assert.equal(getGraphThemePalette("unknown"), visualThemes[0].graphPalette);
});

test("built-in presets keep every semantic label role above AA contrast after opacity", () => {
  for (const preset of graphVisualPresets) {
    setGraphVisualPreset(preset.id);
    const settings = getGraphVisualSettingsSnapshot();
    for (const theme of visualThemes) {
      const palette = getGraphThemePalette(theme.id);
      const colors = resolveGraphVisualColors(settings, palette);
      const report = getGraphLabelContrastReport(colors, {
        background: palette.background,
        opacity: settings.labels.opacity,
        includeActive: true,
      });
      assert.equal(
        report.passes,
        true,
        `${preset.id}/${theme.id} minimum ${report.minimumRatio.toFixed(2)}:1`,
      );
      assert.ok(report.minimumRatio >= GRAPH_NORMAL_TEXT_MIN_CONTRAST);
    }
  }
  resetGraphVisualSettings();
});

test("custom label colors report contrast without clamping user values", () => {
  const settings = normalizeGraphVisualSettings({
    ...DEFAULT_GRAPH_VISUAL_SETTINGS,
    node: {
      ...DEFAULT_GRAPH_VISUAL_SETTINGS.node,
      useThemeColors: false,
      baseColor: "#222222",
      hubColor: "#FFFFFF",
      activeColor: "#FF6A00",
      groupColor: "#333333",
    },
    labels: {
      ...DEFAULT_GRAPH_VISUAL_SETTINGS.labels,
      opacity: 0.72,
    },
  });
  const colors = resolveGraphVisualColors(settings, getGraphThemePalette("nexus"));
  const report = getGraphLabelContrastReport(colors, {
    background: getGraphThemePalette("nexus").background,
    opacity: settings.labels.opacity,
    includeActive: true,
  });

  assert.equal(settings.node.baseColor, "#222222");
  assert.equal(settings.node.groupColor, "#333333");
  assert.equal(report.passes, false);
  assert.deepEqual(
    report.failures.map((entry) => entry.label),
    ["BASE", "GROUP", "ACTIVE"],
  );
});

test("graph DOM chrome follows theme tokens and the high-resolution inspector scale", async () => {
  const [themeSystem, vectorShell, operator, panel, panelStyles] = await Promise.all([
    readSource("theme-system.js"),
    readSource("vector-shell.css"),
    readSource("operator-workspace.css"),
    readSource("graphics/graph/GraphVisualSettings.jsx"),
    readSource("graphics/graph/graph-visual-settings.css"),
  ]);

  assert.match(themeSystem, /createGraphThemePalette/u);
  assert.match(themeSystem, /"--theme-action": colors\.action/u);
  assert.match(vectorShell, /--signal-hot:\s*var\(--theme-action\)/u);
  assert.doesNotMatch(vectorShell, /--signal-hot:\s*#ff6a00/iu);
  assert.match(panel, /getGraphLabelContrastReport/u);
  assert.match(panel, /includeActive:\s*true/u);
  assert.match(panel, /t\("graphVisualSettings\.contrast\.warning"\)/u);
  assert.match(panel, /aria-live="polite"/u);
  assert.match(panelStyles, /\.graph-visual-settings__contrast-status\.is-warning/u);

  assert.match(operator, /max-width:\s*min\(620px, calc\(100% - 408px\)\)/u);
  assert.match(operator, /--operator-inspector-title-size:\s*17px/u);
  assert.match(
    operator,
    /\.knowledge-workspace__inspector :where\(header span, dt, dd, footer button\)\s*\{[^}]*font-size:\s*var\(--operator-meta-size\)/su,
  );
  assert.match(
    operator,
    /\.knowledge-workspace__inspector > footer button\s*\{[^}]*min-height:\s*var\(--operator-hit-size\)/su,
  );
});
