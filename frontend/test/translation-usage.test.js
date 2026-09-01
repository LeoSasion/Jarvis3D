import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { TRANSLATION_DICTIONARIES } from "../src/i18n/translations.js";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const languageCallPattern = /(?:\bt|\btranslate)\(\s*["']([^"']+)["']/gu;
const retiredTranslationKeys = Object.freeze([
  "common.action.reset",
  "common.action.save",
  "quickSearch.scope.shortcutHint",
  "settings.interface.title",
  "settings.theme.title",
]);
const graphGroupTranslationKeys = Object.freeze([
  "graph.workspace.group.folder",
  "graph.workspace.group.code",
  "graph.workspace.group.document",
  "graph.workspace.group.media",
  "graph.workspace.group.archive",
  "graph.workspace.group.other",
  "graph.workspace.group.items.one",
  "graph.workspace.group.items.other",
  "graph.workspace.group.matches",
  "graph.workspace.source.items",
]);

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(target);
    return /\.[cm]?[jt]sx?$/u.test(entry.name) ? [target] : [];
  }));
  return nested.flat();
}

test("every static language key used by the interface exists in the catalog", async () => {
  const dictionary = TRANSLATION_DICTIONARIES["en-US"];
  const files = await collectSourceFiles(sourceRoot);
  const missing = [];

  await Promise.all(files.map(async (file) => {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(languageCallPattern)) {
      if (!Object.hasOwn(dictionary, match[1])) {
        missing.push(`${path.relative(sourceRoot, file)}: ${match[1]}`);
      }
    }
  }));

  assert.deepEqual(missing.sort(), []);
});

test("translation catalogs exclude retired dead keys", () => {
  for (const dictionary of Object.values(TRANSLATION_DICTIONARIES)) {
    for (const key of retiredTranslationKeys) {
      assert.equal(Object.hasOwn(dictionary, key), false, key);
    }
  }
});

test("dynamic graph group translations are complete in every interface language", () => {
  for (const dictionary of Object.values(TRANSLATION_DICTIONARIES)) {
    for (const key of graphGroupTranslationKeys) {
      assert.equal(Object.hasOwn(dictionary, key), true, key);
    }
  }
});
