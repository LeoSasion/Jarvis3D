import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.match(panelSource, /t\("graphVisualSettings\.section\.profile3d"\)/u);
  assert.match(panelSource, /t\("graphVisualSettings\.category\.relationFx"\)/u);
  assert.match(panelSource, /t\("graphVisualSettings\.section\.viewHelp"\)/u);
  assert.match(panelSource, /t\("graphVisualSettings\.control\.technicalLabel", \{ label \}\)/u);
  assert.match(panelSource, /t\("graphVisualSettings\.control\.nodeHaloEmission\.detail"\)/u);
  assert.match(panelSource, /t\("graphVisualSettings\.layer\.toggleAria", \{/u);
  assert.match(panelSource, /t\("graphVisualSettings\.toast\.presetSelected", \{/u);
  assert.match(panelSource, /t\("graphVisualSettings\.toast\.resetNebula"\)/u);
  assert.match(panelSource, /t\("graphVisualSettings\.footer\.activeConstraints", \{/u);
  assert.doesNotMatch(panelSource, /aria-label="Close graph visual settings"/u);
  assert.doesNotMatch(panelSource, /Graph visuals restored to Nebula defaults/u);
});

test("technical identifiers, profile names, dimensions, paths, and units stay raw", () => {
  assert.match(panelSource, /<strong>\{preset\.label\}<\/strong>/u);
  assert.match(panelSource, /Object\.freeze\(\{ id: 2, label: "2D" \}\)/u);
  assert.match(panelSource, /Object\.freeze\(\{ id: 3, label: "3D" \}\)/u);
  assert.match(panelSource, /technicalLabel\(t, "NODE HALO EMISSION INTENSITY"\)/u);
  assert.match(panelSource, /technicalLabel\(t, "RELATION HALO EMISSION INTENSITY"\)/u);
  assert.match(panelSource, /technicalLabel\(t, "BLOOM RADIUS"\)/u);
  assert.match(panelSource, /path="postFx\.bloom\.radius"/u);
  assert.match(panelSource, /return `\$\{Math\.round\(value\)\} PX`/u);
  assert.match(panelSource, /return `\$\{Number\(value\)\.toFixed\(2\)\}×`/u);
});
