import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (await readFile(
  new URL("../src/components/FileExplorerWindow.jsx", import.meta.url),
  "utf8",
)).replaceAll("\r\n", "\n");

function readBlock(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return source.slice(start, end);
}

test("File Explorer subscribes to language changes and formats dates by locale", () => {
  assert.match(source, /import \{ useLanguage \} from "\.\.\/i18n\/language-system\.js"/u);
  assert.match(source, /import \{ formatDateTime \} from "\.\.\/i18n\/locale-format\.js"/u);
  assert.match(source, /const \{ language, t \} = useLanguage\(\)/u);
  assert.match(source, /formatModified\(entry\.modified, language\)/u);
  assert.match(source, /sortExplorerEntries\(snapshot\.entries, explorerPreferences, language\)/u);
  assert.doesNotMatch(source, /new Intl\.DateTimeFormat\("zh-CN"/u);
});

test("language changes do not reset an open File Explorer browse session", () => {
  const browseSource = readBlock(
    "const browse = useCallback",
    "\n\n  useEffect(() => {\n    writeExplorerPreferences",
  );
  const initializationEffect = readBlock(
    "useEffect(() => {\n    if (!open) return undefined;\n    let cancelled = false;\n    setHistory([]);",
    "\n\n  useEffect(() => {\n    if (!open) return undefined;\n    let cancelled = false;\n    platform.clipboard.read()",
  );

  assert.match(source, /const tRef = useRef\(t\);\s+tRef\.current = t;/u);
  assert.match(
    browseSource,
    /tRef\.current\("explorer\.notice\.openFolderFailed"/u,
  );
  assert.match(browseSource, /\}, \[onToast\]\);/u);
  assert.doesNotMatch(browseSource, /\bt\(/u);
  assert.match(initializationEffect, /browse\(initialPath\)/u);
  assert.match(
    initializationEffect,
    /\}, \[browse, initialPath, open, requestSequence\]\);/u,
  );
  assert.doesNotMatch(initializationEffect, /\b(?:t|language)\b/u);
});

test("File Explorer chrome, commands, states, and accessibility copy use semantic keys", () => {
  for (const key of [
    "explorer.window.aria",
    "explorer.navigation.back",
    "explorer.address.aria",
    "explorer.search.placeholder",
    "explorer.sort.aria",
    "explorer.operations.aria",
    "explorer.column.sortedAria",
    "explorer.empty.noSearchMatch",
    "explorer.inspector.aria",
    "explorer.status.filesystemReady",
    "explorer.dialog.createFolder.title",
    "explorer.transfer.statusAria",
  ]) {
    assert.ok(source.includes(`"${key}"`), `missing ${key}`);
  }

  assert.doesNotMatch(source, /placeholder="Search current folder"/u);
  assert.doesNotMatch(source, />ACCESS INTERRUPTED</u);
  assert.doesNotMatch(source, />FOLDER EMPTY</u);
});

test("compact Explorer command buttons keep localized accessible names", () => {
  for (const key of [
    "explorer.context.action.newFolder",
    "explorer.context.action.rename",
    "explorer.context.action.copy",
    "explorer.context.action.copyPath",
    "explorer.context.action.cut",
    "explorer.context.action.paste",
    "explorer.context.action.recycle",
  ]) {
    assert.ok(
      source.includes(`aria-label={t("${key}")}`),
      `missing accessible command name for ${key}`,
    );
  }
});

test("File Explorer preserves host identities, paths, warnings, and native errors", () => {
  assert.match(source, /\{location\.label\}/u);
  assert.match(source, /\{drive\.label\}/u);
  assert.match(source, /value=\{entry\.name\}/u);
  assert.match(source, /value=\{entry\.typeLabel\}/u);
  assert.match(source, /\{error\.message\}/u);
  assert.match(source, /\{snapshot\.warning\}/u);
  assert.match(source, /message: operationError\.message/u);
  assert.match(source, /message: clipboardError\.message/u);
});

test("File Explorer localizes known transfer states but preserves unknown host states", () => {
  assert.match(source, /const TRANSFER_STATUS_KEYS = Object\.freeze/u);
  assert.match(source, /getLocalizedTransferStatus\(transfer\.status, t\)/u);
  assert.match(source, /String\(status \?\? ""\)\.replaceAll/u);
  assert.match(source, /transfer\.error \|\| transfer\.result\.failures\[0\]\?\.message/u);
});
