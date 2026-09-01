import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceRoot = new URL("../src/", import.meta.url);

async function readSource(path) {
  return readFile(new URL(path, sourceRoot), "utf8");
}

test("desktop telemetry can release the right workspace without stopping its data hooks", async () => {
  const [rail, shellStyles] = await Promise.all([
    readSource("components/TelemetryRail.jsx"),
    readSource("shell-aesthetic.css"),
  ]);

  assert.match(rail, /const \[railCollapsed, setRailCollapsed\] = useState\(false\)/u);
  assert.match(rail, /setRailCollapsed\(\(current\) => !current\)/u);
  assert.match(rail, /aria-label=\{t\("telemetry\.action\.hide"\)\}/u);
  assert.match(rail, /aria-label=\{t\("telemetry\.action\.show"\)\}/u);
  assert.match(rail, /aria-expanded="true"/u);
  assert.match(rail, /aria-expanded="false"/u);
  assert.match(rail, /is-rail-collapsed/u);
  assert.ok(
    rail.indexOf("useSystemSnapshot()") < rail.indexOf("if (railCollapsed)"),
    "telemetry subscriptions must remain mounted while the rail is collapsed",
  );

  assert.match(shellStyles, /--telemetry-rail-width:\s*44px/u);
  assert.match(shellStyles, /:has\(> \.telemetry-rail\.is-rail-collapsed\)/u);
  assert.match(shellStyles, /\.graph-visual-settings\.is-overlay/u);
  assert.match(shellStyles, /right:\s*calc\(var\(--telemetry-rail-width\) \+ 16px\) !important/u);
});
