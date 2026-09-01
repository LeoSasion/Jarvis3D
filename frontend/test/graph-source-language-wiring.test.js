import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceRoot = new URL("../src/", import.meta.url);

async function readSource(path) {
  return readFile(new URL(path, sourceRoot), "utf8");
}

test("Graph Source settings localize chrome, diagnostics, feedback, and explicit-locale dates", async () => {
  const source = await readSource("graph/GraphSourceSettings.jsx");

  assert.match(source, /import \{ useLanguage \} from "\.\.\/i18n\/language-system\.js"/u);
  assert.match(source, /const \{ language, t \} = useLanguage\(\)/u);
  assert.match(source, /formatTime\(date, language, \{ second: "2-digit" \}\)/u);
  assert.match(source, /t\("graph\.source\.summary\.aria"\)/u);
  assert.match(source, /t\("graph\.source\.diagnostic\.attention\.detail", \{/u);
  assert.match(source, /t\("graph\.source\.diagnostic\.ready\.detail", \{/u);
  assert.match(source, /t\("graph\.source\.toast\.actionFailed", \{ message: error\.message \}\)/u);
  assert.match(source, /t\("graph\.source\.privacy"\)/u);
  assert.doesNotMatch(source, /Intl\.DateTimeFormat/u);
  assert.doesNotMatch(source, />\s*(?:OBSIDIAN SOURCE|SCANNING|RESCAN|CHOOSING|CHOOSE VAULT)\s*</u);
});

test("Graph Source settings preserve dynamic Vault names and original Host error details", async () => {
  const source = await readSource("graph/GraphSourceSettings.jsx");

  assert.match(source, /<small>\{sourceName\}<\/small>/u);
  assert.match(source, /diagnostics\.id === "error" && state\?\.error\?\.message/u);
  assert.match(source, /return diagnostics\.detail;/u);
  assert.match(source, /message: error\.message/u);
});

test("Graph Source actions distinguish failed refreshes from successful scans", async () => {
  const [settings, hook] = await Promise.all([
    readSource("graph/GraphSourceSettings.jsx"),
    readSource("graph/useDefaultKnowledgeGraph.js"),
  ]);

  assert.match(settings, /if \(result\?\.ok === false\)/u);
  assert.match(settings, /if \(!result\.canceled\)/u);
  assert.match(settings, /message: result\.error\?\.message/u);
  assert.match(hook, /createRefreshOutcome\(\{ error, ok: false \}\)/u);
  assert.match(hook, /const refreshOutcome = await refresh\(\{ force: true \}\)/u);
  assert.match(hook, /if \(!refreshOutcome\.ok\) return refreshOutcome/u);
});

test("both graphics canvases share a localized recovery status", async () => {
  const source = await readSource("graphics/CoreVisualCanvas.jsx");

  assert.match(source, /function GraphicsRecoveryStatus\(\{ fallback \}\)/u);
  assert.match(source, /t\("graphics\.runtime\.recovering"\)/u);
  assert.equal(source.match(/<GraphicsRecoveryStatus fallback=\{fallback\} \/>/gu)?.length, 2);
  assert.doesNotMatch(source, /GRAPHICS CONTEXT RECOVERING/u);
});
