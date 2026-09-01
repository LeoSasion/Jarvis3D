import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceRoot = new URL("../src/", import.meta.url);

async function readSource(path) {
  return readFile(new URL(path, sourceRoot), "utf8");
}

test("persistent desktop chrome subscribes to the shared language runtime", async () => {
  const [topStatusBar, telemetryRail, coreStage] = await Promise.all([
    readSource("components/TopStatusBar.jsx"),
    readSource("components/TelemetryRail.jsx"),
    readSource("components/CoreStage.jsx"),
  ]);

  for (const source of [topStatusBar, telemetryRail, coreStage]) {
    assert.match(source, /import \{ useLanguage \} from "\.\.\/i18n\/language-system\.js"/u);
    assert.match(source, /const \{[^}]*t[^}]*\} = useLanguage\(\)/u);
  }

  assert.match(topStatusBar, /t\("topbar\.search\.aria"\)/u);
  assert.match(topStatusBar, /t\("topbar\.agent\.stop\.title"\)/u);
  assert.doesNotMatch(topStatusBar, /Open local quick search|Stop active Agent response/u);
});

test("telemetry localizes controls and accessibility copy while preserving live platform text", async () => {
  const telemetryRail = await readSource("components/TelemetryRail.jsx");

  assert.match(telemetryRail, /t\("telemetry\.accessibility\.label"\)/u);
  assert.match(telemetryRail, /t\("telemetry\.compact\.summary", \{/u);
  assert.match(telemetryRail, /t\("telemetry\.process\.inspect", \{/u);
  assert.match(telemetryRail, /formatTime\(timestamp, language\)/u);
  assert.doesNotMatch(telemetryRail, /toLocaleTimeString/u);
  assert.match(telemetryRail, /detail: priorityState\.detail/u);
  assert.match(telemetryRail, /meta: priorityState\.meta/u);
  assert.doesNotMatch(telemetryRail, /aria-label="(?:Hide|Show) system telemetry"/u);
});

test("the desktop graph translates interaction copy without translating technical terms", async () => {
  const coreStage = await readSource("components/CoreStage.jsx");

  assert.match(coreStage, /t\("core\.graph\.toolbar\.explore"\)/u);
  assert.match(coreStage, /t\("core\.graph\.health\.chooseVault"\)/u);
  assert.match(coreStage, /t\("core\.graph\.readout\.gpuReleased"\)/u);
  assert.match(coreStage, /dimension: "3D"/u);
  assert.match(coreStage, />2D<\/button>/u);
  assert.match(coreStage, />3D<\/button>/u);
  assert.doesNotMatch(coreStage, /aria-label="JARVIS knowledge graph workspace"/u);
  assert.doesNotMatch(coreStage, /SEARCH NODES|CHOOSE A LOCAL START|SHOW START OPTIONS/u);
});
