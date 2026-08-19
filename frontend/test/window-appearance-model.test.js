import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  normalizeWindowAppearanceProcessName,
  normalizeWindowAppearanceRules,
  normalizeWindowCompatibilityMatrix,
} from "../src/window-appearance-model.js";
import { normalizeWindowAppearanceState } from "../src/hooks/usePlatformData.js";
import { createMockPlatform } from "../src/platform/mock-platform.js";

const shellPanelsSource = readFileSync(
  new URL("../src/components/ShellPanels.jsx", import.meta.url),
  "utf8",
);

test("normalizes process filenames without accepting paths or wildcards", () => {
  assert.equal(normalizeWindowAppearanceProcessName(" Code.EXE "), "Code");
  assert.equal(normalizeWindowAppearanceProcessName("C:\\Windows\\notepad.exe"), "");
  assert.equal(normalizeWindowAppearanceProcessName("bad*name"), "");
});

test("deduplicates rules and bounds compatibility matrix values", () => {
  const rules = normalizeWindowAppearanceRules([
    { ProcessName: "Code.exe", Action: "allow" },
    { processName: "code", action: "deny" },
    { processName: "../bad", action: "allow" },
  ]);
  assert.deepEqual(rules, [{ processName: "code", action: "deny" }]);

  const matrix = normalizeWindowCompatibilityMatrix([{
    ProcessName: "notepad.exe",
    WindowCount: -3,
    EligibleWindowCount: 1.9,
    StyledWindowCount: 1,
    Decision: "automatic",
    ReasonCode: "automatic",
  }]);
  assert.deepEqual(matrix[0], {
    processName: "notepad",
    windowCount: 0,
    eligibleWindowCount: 1,
    styledWindowCount: 1,
    decision: "automatic",
    reasonCode: "automatic",
  });
});

test("normalizes native PascalCase window appearance state", () => {
  const state = normalizeWindowAppearanceState({
    Mode: "enhanced",
    EffectiveMode: "enhanced",
    Rules: [{ ProcessName: "Code", Action: "deny" }],
    CompatibilityMatrix: [{
      ProcessName: "Code",
      WindowCount: 1,
      EligibleWindowCount: 0,
      StyledWindowCount: 0,
      Decision: "denied",
      ReasonCode: "user-deny",
    }],
  });

  assert.equal(state.rules[0].action, "deny");
  assert.equal(state.compatibilityMatrix[0].decision, "denied");
});

test("mock platform applies and removes window appearance rules", async () => {
  const mock = createMockPlatform();
  const denied = await mock.windowAppearance.setRule("Code.exe", "deny");
  assert.deepEqual(denied.rules, [{ processName: "Code", action: "deny" }]);
  assert.equal(
    denied.compatibilityMatrix.find((entry) => entry.processName === "Code").decision,
    "denied",
  );

  const automatic = await mock.windowAppearance.removeRule("code");
  assert.equal(automatic.rules.length, 0);
  assert.equal(
    automatic.compatibilityMatrix.find((entry) => entry.processName === "Code").decision,
    "automatic",
  );
  await assert.rejects(
    () => mock.windowAppearance.setRule("SearchHost", "allow"),
    /protected/u,
  );
});

test("browser preview provenance survives window appearance normalization", async () => {
  const mock = createMockPlatform();
  const state = normalizeWindowAppearanceState(
    await mock.windowAppearance.setMode("immersive"),
  );

  assert.equal(state.mode, "immersive");
  assert.equal(state.effectiveMode, "off");
  assert.equal(state.styledWindowCount, 0);
  assert.equal(state.simulation, true);
  assert.deepEqual(state.provenance, {
    kind: "browser-preview",
    dataClass: "simulated-fixture",
    simulated: true,
    nativeHostConnected: false,
  });
});

test("window appearance preview copy cannot imply a native change", () => {
  assert.match(shellPanelsSource, /预览选择 · PREVIEW/u);
  assert.match(shellPanelsSource, /<small>WINDOWS<\/small><strong>NOT INSPECTED<\/strong>/u);
  assert.match(shellPanelsSource, /<small>NATIVE CHANGE<\/small><strong>NONE<\/strong>/u);
  assert.match(shellPanelsSource, /Windows unchanged/u);
});
