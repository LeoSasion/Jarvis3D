import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [taskbarSource, desktopSource, commandOverlaySource] = await Promise.all([
  readFile(new URL("../src/components/Taskbar.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/DesktopShortcuts.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/CommandOverlay.jsx", import.meta.url), "utf8"),
]);

test("P0 shell surfaces consume the shared language store", () => {
  for (const source of [taskbarSource, desktopSource, commandOverlaySource]) {
    assert.match(source, /import \{ useLanguage \} from "\.\.\/i18n\/language-system\.js"/u);
    assert.match(source, /useLanguage\(\)/u);
  }
});

test("taskbar recomputes clock presentation from the resolved locale", () => {
  assert.match(taskbarSource, /formatClockPresentation\(clock\.dateTime, language\)/u);
  assert.doesNotMatch(taskbarSource, /clock\.(?:longDate|shortDate)/u);
});

test("shell labels use semantic keys while host-owned identities remain data", () => {
  assert.match(desktopSource, /getDesktopShortcutLabelKey\(shortcut\.id\)/u);
  assert.match(commandOverlaySource, /getDesktopShortcutLabelKey\(result\.entry\?\.id\)/u);
  assert.match(desktopSource, /: shortcut;/u);
  assert.match(commandOverlaySource, /placeholder=\{t\("quickSearch\.placeholder"\)\}/u);
  assert.match(commandOverlaySource, /t\("quickSearch\.empty\.description"\)/u);
  assert.match(taskbarSource, /t\("taskbar\.flyout\.noOverflowMatchHint"\)/u);
  assert.match(desktopSource, /sortDesktopEntries\(localizedEntries, sortMode, language\)/u);
  assert.match(commandOverlaySource, /searchQuickIndex\(searchIndex, deferredValue, undefined, language\)/u);
  assert.match(taskbarSource, /applicationCatalog\.applications,\s*language,/u);
});
