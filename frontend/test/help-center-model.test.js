import assert from "node:assert/strict";
import test from "node:test";
import { helpCenterSections } from "../src/help-center-model.js";
import { isHelpShortcut } from "../src/shell-shortcuts.js";

test("help center keeps task, shortcut, privacy, and recovery guidance discoverable", () => {
  assert.ok(helpCenterSections.length >= 5);
  assert.ok(helpCenterSections.some((section) => section.id === "linked"));
  assert.ok(helpCenterSections.some((section) =>
    section.entries.some((entry) => entry.command === "CTRL SHIFT Q")));
  assert.equal(
    helpCenterSections.some((section) =>
      Object.hasOwn(section, "label") ||
      Object.hasOwn(section, "title") ||
      Object.hasOwn(section, "summary") ||
      section.entries.some((entry) => Object.hasOwn(entry, "detail"))),
    false,
  );
});

test("F1 opens help only when it is unmodified and not repeated", () => {
  assert.equal(isHelpShortcut({ key: "F1" }), true);
  assert.equal(isHelpShortcut({ key: "F1", repeat: true }), false);
  assert.equal(isHelpShortcut({ key: "F1", altKey: true }), false);
  assert.equal(isHelpShortcut({ key: "F1", ctrlKey: true }), false);
  assert.equal(isHelpShortcut({ key: "F2" }), false);
});
