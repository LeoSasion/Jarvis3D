import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("managed workspace resize accessibility uses a localized consumer title", async () => {
  const source = await readSource("components/ManagedWorkspaceWindow.jsx");
  assert.match(source, /getLocalizedWorkspaceWindowTitle\(id, t, definition\.label\)/u);
  assert.match(source, /window: windowTitle/u);
  assert.doesNotMatch(source, /window: definition\.label/u);
});

test("taskbar and window switcher localize internal runtime records at display time", async () => {
  const [appSource, taskbarSource, switcherSource] = await Promise.all([
    readSource("App.jsx"),
    readSource("components/Taskbar.jsx"),
    readSource("WindowSwitcherSurface.jsx"),
  ]);
  assert.match(taskbarSource, /localizeWorkspaceWindows\(internalWindows, t\)/u);
  assert.match(taskbarSource, /onAppClick\(item, item\.selectedWindow\)/u);
  assert.match(appSource, /feedback\.window\.switching", \{ label: item\.label \}/u);
  assert.match(switcherSource, /localizeWorkspaceWindow\(entry\.window, t\)/u);
});

test("workspace state and runtime channels stay independent of language preferences", async () => {
  const [stateSource, runtimeSource, switcherModelSource] = await Promise.all([
    readSource("workspace-window-state.js"),
    readSource("workspace-runtime-channel.js"),
    readSource("window-switcher-model.js"),
  ]);
  assert.doesNotMatch(stateSource, /useLanguage|translate\(/u);
  assert.doesNotMatch(runtimeSource, /useLanguage|translate\(/u);
  assert.doesNotMatch(switcherModelSource, /useLanguage|translate\(/u);
});
