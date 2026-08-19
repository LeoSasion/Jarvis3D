import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getTaskbarFallbackMark } from "../src/taskbar-icon-model.js";

const taskbarSource = readFileSync(
  new URL("../src/components/Taskbar.jsx", import.meta.url),
  "utf8",
);
const taskbarStyles = readFileSync(
  new URL("../src/operator-workspace.css", import.meta.url),
  "utf8",
);

test("taskbar fallback marks preserve a stable short process identity", () => {
  assert.equal(getTaskbarFallbackMark({ processName: "Code.exe", label: "Visual Studio Code" }), "CO");
  assert.equal(getTaskbarFallbackMark({ label: "Visual Studio Code" }), "VS");
  assert.equal(getTaskbarFallbackMark({ processName: "msedge.exe" }), "MS");
  assert.equal(getTaskbarFallbackMark({
    processName: "ApplicationFrameHost.exe",
    label: "Windows Photos",
  }), "WP");
  assert.equal(getTaskbarFallbackMark({
    processName: "WWAHost.exe",
    title: "Microsoft To Do",
  }), "MT");
  assert.equal(getTaskbarFallbackMark({ processName: "微信.exe" }), "微信");
  assert.equal(getTaskbarFallbackMark(), "?");
});

test("taskbar generic applications render an identity mark in the fixed icon slot", () => {
  assert.match(taskbarSource, /fallbackMark: getTaskbarFallbackMark/u);
  assert.match(taskbarSource, /className="taskbar-app-fallback-mark"/u);
  assert.doesNotMatch(taskbarSource, /Icon:\s*WindowAppsRegular/u);
  assert.match(taskbarStyles, /button\[data-density\] > \.taskbar-app-fallback-mark/u);
  assert.match(taskbarStyles, /width:\s*22px/u);
  assert.match(taskbarStyles, /^\.taskbar-app-fallback-mark\s*\{/mu);
  assert.match(taskbarStyles, /\.taskbar-flyout-grid[^\n]+\.taskbar-app-fallback-mark/u);
});

test("contextual labels stay inside the taskbar and appear only on hover or focus", () => {
  const contextualRule = taskbarStyles.match(
    /button\[data-label-mode="contextual"\] > \.taskbar-app-label[\s\S]*?\n\}/u,
  )?.[0] ?? "";
  const revealRule = taskbarStyles.match(
    /button\[data-label-mode="contextual"\]:where\([^\n]+\) > \.taskbar-app-label[^{]*\{/u,
  )?.[0] ?? "";

  assert.match(contextualRule, /bottom:\s*1px/u);
  assert.doesNotMatch(contextualRule, /calc\(100%/u);
  assert.match(revealRule, /:hover/u);
  assert.match(revealRule, /:focus-visible/u);
  assert.doesNotMatch(revealRule, /\.is-active/u);
});
