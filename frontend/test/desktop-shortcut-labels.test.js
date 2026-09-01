import assert from "node:assert/strict";
import test from "node:test";
import {
  DESKTOP_SHORTCUT_IDS,
  getDesktopShortcutLabelKey,
} from "../src/desktop-shortcut-labels.js";
import { TRANSLATION_DICTIONARIES } from "../src/i18n/translations.js";

test("built-in desktop shortcuts share one localized label registry", () => {
  assert.equal(new Set(DESKTOP_SHORTCUT_IDS).size, DESKTOP_SHORTCUT_IDS.length);
  for (const id of DESKTOP_SHORTCUT_IDS) {
    const key = getDesktopShortcutLabelKey(id);
    assert.match(key, /^desktop\.shortcut\./u);
    for (const language of ["en-US", "zh-CN"]) {
      assert.ok(Object.hasOwn(TRANSLATION_DICTIONARIES[language], key));
    }
  }
  assert.equal(getDesktopShortcutLabelKey("external-item"), null);
});
