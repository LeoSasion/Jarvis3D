import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const desktopSource = readFileSync(
  new URL("../src/components/DesktopShortcuts.jsx", import.meta.url),
  "utf8",
);
const desktopMenuSource = readFileSync(
  new URL("../src/components/DesktopContextMenu.jsx", import.meta.url),
  "utf8",
);
const explorerSource = readFileSync(
  new URL("../src/components/FileExplorerWindow.jsx", import.meta.url),
  "utf8",
);
const explorerMenuSource = readFileSync(
  new URL("../src/components/ExplorerContextMenu.jsx", import.meta.url),
  "utf8",
);

test("desktop background keyboard menus take focus and restore it on dismissal", () => {
  assert.match(desktopSource, /tabIndex=\{0\}/u);
  assert.match(desktopSource, /aria-keyshortcuts="ContextMenu Shift\+F10"/u);
  assert.match(desktopSource, /contextMenuReturnFocusRef/u);
  assert.match(desktopSource, /target\?\.focus\(\{ preventScroll: true \}\)/u);
  assert.match(desktopMenuSource, /role="menu" aria-label=\{rootMenuLabel\}/u);
  assert.match(desktopMenuSource, /menuRef\.current\?\.querySelector[\s\S]+?\.focus\(\)/u);
  assert.match(desktopMenuSource, /event\.key === "Escape" \|\| event\.key === "Tab"/u);
});

test("Explorer keeps its non-empty background keyboard reachable", () => {
  assert.match(
    explorerSource,
    /className="explorer-file-viewport"[\s\S]+?tabIndex=\{0\}/u,
  );
  assert.match(explorerSource, /aria-keyshortcuts="ContextMenu Shift\+F10"/u);
  assert.match(explorerSource, /openBackgroundContextMenu\([\s\S]+?bounds\.left/u);
  assert.match(explorerSource, /fileViewportRef\.current\?\.focus\(\)/u);
  assert.match(explorerMenuSource, /itemRefs\.current\.get\(nextIndex\)\?\.focus\(\)/u);
});
