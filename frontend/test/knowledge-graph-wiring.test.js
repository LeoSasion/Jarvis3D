import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceRoot = new URL("../src/", import.meta.url);

async function readSource(path) {
  return readFile(new URL(path, sourceRoot), "utf8");
}

test("Explorer metadata snapshots are retained by App and routed into the graph", async () => {
  const [app, explorer, core] = await Promise.all([
    readSource("App.jsx"),
    readSource("components/FileExplorerWindow.jsx"),
    readSource("components/CoreStage.jsx"),
  ]);

  assert.match(app, /const \[graphSource, setGraphSource\] = useState\(null\)/u);
  assert.match(app, /graphSource=\{graphSource\}/u);
  assert.match(app, /onGraphSourceChange=\{setGraphSource\}/u);
  assert.match(app, /knowledge-graph-source-prompt/u);
  assert.match(app, /connectedPath/u);
  assert.match(explorer, /if \(!snapshot\.currentPath\) return;/u);
  assert.match(explorer, /onGraphSourceChange\?\.\(snapshot\)/u);
  assert.match(explorer, /provenance,/u);
  assert.match(explorer, /simulation:\s*Boolean/u);
  assert.match(core, /<KnowledgeGraphWorkspace/u);
});

test("connected graph actions use the bounded Agent metadata path", async () => {
  const [app, workspace, model] = await Promise.all([
    readSource("App.jsx"),
    readSource("components/KnowledgeGraphWorkspace.jsx"),
    readSource("knowledge-graph-model.js"),
  ]);

  assert.match(app, /agentSession\.addContextItems\(entry \? \[entry\] : \[\]\)/u);
  assert.match(workspace, /getKnowledgeGraphNodeContextItem\(selectedNode\)/u);
  assert.match(workspace, /ASK AGENT/u);
  assert.match(workspace, /platformKind === "windows"/u);
  assert.doesNotMatch(workspace, /platformKind === "native"/u);
  assert.match(workspace, /wheelFrameRef/u);
  assert.match(app, /Agent context is locked while the current response is running/u);
  assert.doesNotMatch(model, /fileContent|contents?:/iu);
});

test("linked telemetry uses the real platform kind contract", async () => {
  const rail = await readSource("components/LinkedSystemRail.jsx");

  assert.match(rail, /platformKind === "windows"/u);
  assert.doesNotMatch(rail, /platformKind === "native"/u);
});

test("operator stylesheet owns contextual taskbar labels and DPI safeguards", async () => {
  const style = await readSource("operator-workspace.css");

  assert.match(style, /data-label-mode="contextual"/u);
  assert.match(style, /position:\s*absolute/u);
  assert.match(style, /@media \(min-resolution:\s*144dpi\)/u);
  assert.match(style, /linked-system-rail\.is-collapsed/u);
  assert.match(style, /--linked-system-collapsed-width/u);
  assert.match(style, /data-node-density="expanded"/u);
  assert.match(style, /core-stage__media\.is-interactive\s*\{[^}]*pointer-events:\s*auto/su);
});
