import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sources = Object.fromEntries(await Promise.all([
  "SystemNotice",
  "BootSequence",
  "ManagedWorkspaceWindow",
  "LinkedWorkspaceHandle",
].map(async (name) => [name, await readFile(
  new URL(`../src/components/${name}.jsx`, import.meta.url),
  "utf8",
)])));

test("secondary shell surfaces subscribe to the shared language runtime", () => {
  Object.values(sources).forEach((source) => {
    assert.match(source, /import \{ useLanguage \} from "\.\.\/i18n\/language-system\.js"/u);
    assert.match(source, /useLanguage\(\)/u);
  });
});

test("system notices translate chrome while preserving dynamic notice payloads", () => {
  assert.match(sources.SystemNotice, /t\("systemNotice\.dismiss"\)/u);
  assert.match(sources.SystemNotice, /\{notice\.title\}/u);
  assert.match(sources.SystemNotice, /\{notice\.detail\}/u);
  assert.match(sources.SystemNotice, /\{action\.label\}/u);
});

test("boot checks and workspace controls use semantic copy keys", () => {
  assert.match(sources.BootSequence, /labelKey: "boot\.check\.runtime\.label"/u);
  assert.match(sources.BootSequence, /t\(`boot\.state\.\$\{state\}`\)/u);
  assert.doesNotMatch(sources.BootSequence, /state\.toUpperCase\(\)/u);
  assert.match(sources.ManagedWorkspaceWindow, /DIRECTION_KEYS/u);
  assert.match(sources.ManagedWorkspaceWindow, /t\(`workspaceWindow\.resize\./u);
  assert.match(sources.LinkedWorkspaceHandle, /t\("linkedWorkspaceHandle\.showPaneAria"/u);
  assert.match(sources.LinkedWorkspaceHandle, /aria-keyshortcuts="Alt\+F8"/u);
});
