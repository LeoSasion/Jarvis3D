import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceRoot = new URL("../src/", import.meta.url);

async function readSource(path) {
  return readFile(new URL(path, sourceRoot), "utf8");
}

test("desktop panels preserve telemetry subscriptions and keep controls outside panel contents", async () => {
  const [rail, workspace, tools, styles] = await Promise.all([
    readSource("components/TelemetryRail.jsx"),
    readSource("components/DesktopWorkspace.jsx"),
    readSource("components/GraphViewControls.jsx"),
    readSource("desktop-tool-rail.css"),
  ]);

  assert.match(rail, /useSystemSnapshot\(\)/u);
  assert.match(rail, /useSystemFeed\(\)/u);
  assert.match(rail, /hidden=\{railCollapsed\}/u);
  assert.doesNotMatch(rail, /if \(railCollapsed\) return/u);
  assert.match(workspace, /aria-controls="desktop-system-panel"/u);
  assert.match(workspace, /aria-expanded=\{systemOpen\}/u);
  assert.match(workspace, /"telemetry\.action\.hide" : "telemetry\.action\.show"/u);
  assert.match(tools, /createPortal\(/u);
  assert.match(tools, /if \(!active \|\| !graphToolsTarget\) return null/u);
  assert.doesNotMatch(rail, /<GraphViewControls|CoreVisualCanvas/u);
  assert.match(styles, /--desktop-tool-rail-width: 48px/u);
  assert.match(styles, /inset: 0 var\(--desktop-tool-rail-width\) 0 auto/u);
  assert.doesNotMatch(workspace, /issueCameraCommand|setZoom|CoreVisualCanvas/u);
});
