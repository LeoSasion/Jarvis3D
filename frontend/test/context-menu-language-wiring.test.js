import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceRoot = new URL("../src/", import.meta.url);

async function readSource(path) {
  return readFile(new URL(path, sourceRoot), "utf8");
}

test("desktop and Explorer context menus use semantic language keys", async () => {
  const [desktopMenu, explorerMenu] = await Promise.all([
    readSource("components/DesktopContextMenu.jsx"),
    readSource("components/ExplorerContextMenu.jsx"),
  ]);

  for (const source of [desktopMenu, explorerMenu]) {
    assert.match(source, /import \{ useLanguage \} from "\.\.\/i18n\/language-system\.js"/u);
    assert.match(source, /const \{ t \} = useLanguage\(\)/u);
  }

  assert.match(desktopMenu, /t\("desktop\.context\.accessibility\.itemCommands", \{/u);
  assert.match(desktopMenu, /t\("desktop\.context\.action\.openLocation"\)/u);
  assert.match(desktopMenu, /t\("desktop\.context\.sort\.windowsOrder"\)/u);
  assert.doesNotMatch(desktopMenu, />\s*(?:Open file location|Auto arrange icons|JARVIS settings)\s*</u);

  assert.match(explorerMenu, /t\(action\.labelKey\)/u);
  assert.match(explorerMenu, /action\.shortcut \? <kbd>\{action\.shortcut\}<\/kbd> : null/u);
  assert.doesNotMatch(explorerMenu, /"Selected file commands"|"Current folder commands"/u);
});

test("desktop operation dialogs translate their chrome without altering caller content", async () => {
  const dialog = await readSource("components/DesktopOperationDialog.jsx");

  assert.match(dialog, /const \{ t \} = useLanguage\(\)/u);
  assert.match(dialog, /t\("desktop\.operation\.error\.nameRequired"\)/u);
  assert.match(dialog, /nextError\?\.message \?\? t\("desktop\.operation\.error\.failed"\)/u);
  assert.match(dialog, /<strong id="desktop-operation-title">\{title\}<\/strong>/u);
  assert.match(dialog, /\{description \? <p>\{description\}<\/p> : null\}/u);
  assert.match(dialog, /confirmLabel \?\? t\("desktop\.operation\.action\.confirm"\)/u);
  assert.doesNotMatch(dialog, /FILE OPERATION|A name is required|WORKING…/u);
});
