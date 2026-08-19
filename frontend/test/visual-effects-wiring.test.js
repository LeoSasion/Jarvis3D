import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../src/", import.meta.url);

async function readSource(name) {
  return readFile(new URL(name, sourceUrl), "utf8");
}

test("the visual-effects root mounts after and independently from the functional root", async () => {
  const [entry, mount] = await Promise.all([
    readSource("main.jsx"),
    readSource("visual-effects/mount-global-visual-effects.jsx"),
  ]);

  const functionalRender = entry.indexOf('createRoot(document.getElementById("root")).render');
  const effectsImport = entry.indexOf('import("./visual-effects/mount-global-visual-effects.jsx")');
  assert.ok(functionalRender >= 0);
  assert.ok(effectsImport > functionalRender);
  assert.match(entry, /if \(surface === "desktop"\)/u);
  assert.match(entry, /\.catch\(\(\) => \{\s*document\.documentElement\.dataset\.visualEffectsRuntime = "unavailable"/u);
  assert.match(mount, /document\.body\.append\(host\)/u);
  assert.match(mount, /host\.setAttribute\("aria-hidden", "true"\)/u);
  assert.match(mount, /host\.style\.pointerEvents = "none"/u);
  assert.match(mount, /VisualEffectsErrorBoundary/u);
});

test("disabled effects stay unmounted and the backend remains conditionally loaded", async () => {
  const [boundary, compositor, css] = await Promise.all([
    readSource("visual-effects/GlobalVisualEffects.jsx"),
    readSource("visual-effects/VisualEffectsCompositor.jsx"),
    readSource("visual-effects/visual-effects.css"),
  ]);

  assert.match(boundary, /lazy\(\(\) => import\("\.\/VisualEffectsCompositor\.jsx"\)\)/u);
  assert.match(boundary, /if \(!preferences\.enabled \|\| surface !== "desktop" \|\| forcedOff\) return null/u);
  assert.match(boundary, /if \(plan\.backend === "none"\) \{\s*publishVisualEffectsRenderPlan\(plan\)/u);
  assert.match(compositor, /\{staticBackground \? \(/u);
  assert.match(compositor, /\{plan\.grain \? \(/u);
  assert.match(compositor, /useEffect\(\(\) => \{\s*publishVisualEffectsRenderPlan\(plan\)/u);
  assert.match(compositor, /"167ms" : "333ms"/u);
  assert.match(css, /pointer-events: none/u);
  assert.match(css, /contain: strict/u);
  assert.match(css, /z-index: 200/u);
  assert.doesNotMatch(css, /255 106 0/u);
  assert.doesNotMatch(css, /filter:/u);
  assert.doesNotMatch(css, /backdrop-filter:/u);
});

test("functional components do not import or receive the effects runtime", async () => {
  const functionalSources = await Promise.all([
    readSource("App.jsx"),
    readSource("TaskbarSurface.jsx"),
    readSource("WindowSwitcherSurface.jsx"),
    readSource("components/TerminalWorkbench.jsx"),
    readSource("components/AgentConversationWindow.jsx"),
    readSource("components/FileExplorerWindow.jsx"),
  ]);

  for (const source of functionalSources) {
    assert.doesNotMatch(source, /visual-effects/u);
    assert.doesNotMatch(source, /visualEffects/u);
  }
});

test("optional effects settings are isolated from the functional settings chunk", async () => {
  const [settings, panels] = await Promise.all([
    readSource("visual-effects/VisualEffectsSettings.jsx"),
    readSource("components/ShellPanels.jsx"),
  ]);

  assert.match(settings, /Turning this off unmounts every effect layer/u);
  assert.doesNotMatch(settings, /Bloom|Ghost|Chromatic|Curvature|Distortion/u);
  assert.doesNotMatch(settings, /\b(?:COMPOSITOR|PASSES?)\b/u);
  assert.match(settings, /getVisualEffectsRuntimeSnapshot/u);
  assert.match(panels, /lazy\(\(\) => import\("\.\.\/visual-effects\/VisualEffectsSettings\.jsx"\)/u);
  assert.match(panels, /<OptionalSettingsBoundary>/u);
  assert.match(panels, /await import\("\.\.\/visual-effects\/visual-effects-system\.js"\)/u);
  assert.doesNotMatch(panels, /import \{ VisualEffectsSettings \}/u);
});
