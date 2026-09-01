import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../src/", import.meta.url);

test("the semantic shell override layers consume themes without local color literals", async () => {
  const layers = await Promise.all([
    "vector-shell.css",
    "operator-workspace.css",
    "shell-aesthetic.css",
  ].map((name) => readFile(new URL(name, sourceUrl), "utf8")));
  for (const css of layers) {
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/iu);
    assert.doesNotMatch(css, /(?:rgb|rgba|hsl|hsla)\s*\(/iu);
  }
  const aestheticCss = layers.at(-1);
  assert.match(aestheticCss, /var\(--shell-bg\)/u);
  assert.match(aestheticCss, /var\(--shell-accent\)/u);
  assert.match(aestheticCss, /var\(--shell-accent-foreground\)/u);
});

test("shell aesthetics load after legacy geometry and before the motion owner", async () => {
  const main = await readFile(new URL("main.jsx", sourceUrl), "utf8");
  const vectorIndex = main.indexOf('import "./vector-shell.css"');
  const operatorIndex = main.indexOf('import "./operator-workspace.css"');
  const aestheticIndex = main.indexOf('import "./shell-aesthetic.css"');
  const motionIndex = main.indexOf('import "./motion.css"');
  assert.ok(vectorIndex >= 0 && vectorIndex < operatorIndex);
  assert.ok(operatorIndex < aestheticIndex);
  assert.ok(aestheticIndex < motionIndex);
});

test("desktop graph and modeless menus cannot be dimmed by shell state", async () => {
  const [legacy, vector, aesthetic] = await Promise.all([
    "styles.css",
    "vector-shell.css",
    "shell-aesthetic.css",
  ].map((name) => readFile(new URL(name, sourceUrl), "utf8")));

  assert.doesNotMatch(vector, /\.jarvis-shell\.has-open-window\s+\.core-stage/u);
  assert.match(
    aesthetic,
    /\.desktop-shortcuts\s*\{[^}]*border-right:\s*0\s*!important;[^}]*background:\s*var\(--shell-transient-backdrop\)\s*!important;/su,
  );
  assert.match(
    aesthetic,
    /\.overlay-layer,\s*\.shell-panel-layer\s*\{[^}]*background:\s*var\(--shell-transient-backdrop\)\s*!important;[^}]*animation:\s*none\s*!important;/su,
  );
  assert.match(
    aesthetic,
    /\.explorer-dialog-layer\s*\{[^}]*background:\s*var\(--shell-modal-scrim\)\s*!important;/su,
  );
  assert.doesNotMatch(
    `${legacy}\n${vector}\n${aesthetic}`,
    /(?:\.overlay-layer|\.shell-panel-layer)[^{]*\{[^}]*var\(--shell-scrim\)/su,
  );
});

test("modeless menu motion stays on anchored surfaces instead of the desktop", async () => {
  const aesthetic = await readFile(new URL("shell-aesthetic.css", sourceUrl), "utf8");

  assert.match(aesthetic, /\.shell-panel-layer\[data-state="entering"\]\s*>\s*div/su);
  assert.match(aesthetic, /\.shell-panel-layer\[data-state="closing"\]\s*>\s*div/su);
  assert.match(aesthetic, /@keyframes shell-menu-rise-in/u);
  assert.match(aesthetic, /@keyframes shell-menu-collapse-out/u);
  assert.match(aesthetic, /\.command-palette\[data-state="entering"\]/u);
  assert.match(aesthetic, /\.command-palette\[data-state="closing"\]/u);
});
