import assert from "node:assert/strict";
import test from "node:test";
import {
  getLocalizedWorkspaceWindowTitle,
  localizeWorkspaceWindow,
  localizeWorkspaceWindows,
} from "../src/workspace-window-labels.js";

const copy = Object.freeze({
  "workspaceWindow.title.agent": "JARVIS Agent",
  "workspaceWindow.title.explorer": "JARVIS File Explorer",
  "workspaceWindow.title.inspector": "系统检查器",
  "workspaceWindow.title.terminal": "JARVIS Terminal Workbench",
});
const t = (key) => copy[key] ?? key;

test("workspace window titles localize by stable semantic window id", () => {
  assert.equal(
    getLocalizedWorkspaceWindowTitle("inspector", t, "System Inspector"),
    "系统检查器",
  );
  assert.equal(
    getLocalizedWorkspaceWindowTitle("terminal", t, "JARVIS Terminal Workbench"),
    "JARVIS Terminal Workbench",
  );
  assert.equal(getLocalizedWorkspaceWindowTitle("unknown", t, "External"), "External");
});

test("consumer localization leaves runtime records and external titles intact", () => {
  const internal = Object.freeze({
    windowId: "jarvis:inspector",
    internalWindowId: "inspector",
    title: "System Inspector",
    active: true,
  });
  const external = Object.freeze({
    windowId: "native:1",
    title: "用户项目 — Visual Studio Code",
  });
  const localized = localizeWorkspaceWindows([internal, external], t);

  assert.equal(localized[0].title, "系统检查器");
  assert.equal(localized[0].internalWindowId, "inspector");
  assert.equal(internal.title, "System Inspector");
  assert.equal(localized[1], external);
});

test("jarvis runtime ids are sufficient when a switcher entry omits internalWindowId", () => {
  const entry = { windowId: "jarvis:inspector", title: "System Inspector" };
  assert.equal(localizeWorkspaceWindow(entry, t).title, "系统检查器");
});
