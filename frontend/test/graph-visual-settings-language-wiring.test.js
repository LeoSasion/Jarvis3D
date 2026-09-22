import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { TRANSLATION_DICTIONARIES } from "../src/i18n/translations.js";

const panelSource = await readFile(
  new URL("../src/graphics/graph/GraphVisualSettings.jsx", import.meta.url),
  "utf8",
);

test("graph visual settings subscribes to the shared language runtime", () => {
  assert.match(
    panelSource,
    /import \{ useLanguage \} from "\.\.\/\.\.\/i18n\/language-system\.js"/u,
  );
  assert.match(panelSource, /const \{ t \} = useLanguage\(\)/u);
  assert.match(panelSource, /t\("graphVisualSettings\.title"\)/u);
  assert.match(panelSource, /t\("graphVisualSettings\.action\.closeAria"\)/u);
  assert.match(panelSource, /t\("graphVisualSettings\.preset\.aria"\)/u);
});

test("panel sections, controls, layer switches, feedback, and explanations use semantic keys", () => {
  assert.match(panelSource, /t\(settings\.sharedStyle \? "graphVisualSettings\.editor\.shared" : "graphVisualSettings\.editor\.independent"\)/u);
  assert.match(panelSource, /t\("graphVisualSettings\.category\.relationFx"\)/u);
  assert.match(panelSource, /t\("graphVisualSettings\.section\.viewHelp"\)/u);
  assert.match(panelSource, /t\("graphVisualSettings\.control\.nodeHaloEmission\.detail"\)/u);
  assert.match(panelSource, /t\("graphVisualSettings\.layer\.toggleAria", \{/u);
  assert.match(panelSource, /t\("graphVisualSettings\.toast\.presetSelected", \{/u);
  assert.match(panelSource, /t\("graphVisualSettings\.scope\.reset", \{/u);
  assert.match(panelSource, /t\("graphVisualSettings\.footer\.activeConstraints", \{/u);
  assert.doesNotMatch(panelSource, /aria-label="Close graph visual settings"/u);
  assert.doesNotMatch(panelSource, /Graph visuals restored to Nebula defaults/u);
});

test("every technical control has a localized display label in each supported language", () => {
  const labels = [...panelSource.matchAll(/technicalLabel\(t, "([^"]+)"\)/gu)].map((match) => match[1]);
  assert.ok(labels.length > 0);
  for (const [locale, dictionary] of Object.entries(TRANSLATION_DICTIONARIES)) {
    for (const label of labels) {
      const key = `graphVisualSettings.label.${label.toLowerCase().replaceAll(" ", "_")}`;
      assert.ok(dictionary[key], `${locale} is missing ${key}`);
      assert.notEqual(dictionary[key], label, `${locale} still exposes the raw control identifier`);
    }
  }
});

test("technical identifiers, profile names, dimensions, paths, and units stay raw", () => {
  assert.match(panelSource, /<strong>\{preset\.labelKey \? t\(preset\.labelKey\) : preset\.label\}<\/strong>/u);
  assert.match(panelSource, /Object\.freeze\(\{ id: 2, label: "2D" \}\)/u);
  assert.match(panelSource, /Object\.freeze\(\{ id: 3, label: "3D" \}\)/u);
  assert.match(panelSource, /technicalLabel\(t, "NODE HALO EMISSION INTENSITY"\)/u);
  assert.match(panelSource, /technicalLabel\(t, "RELATION HALO EMISSION INTENSITY"\)/u);
  assert.match(panelSource, /technicalLabel\(t, "BLOOM RADIUS"\)/u);
  assert.match(panelSource, /path="postFx\.bloom\.radius"/u);
  assert.match(panelSource, /return `\$\{Math\.round\(value\)\} PX`/u);
  assert.match(panelSource, /return `\$\{Number\(value\)\.toFixed\(2\)\}×`/u);
});
