import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const managerSource = await readFile(
  new URL("../src/graph/GraphProfileManager.jsx", import.meta.url),
  "utf8",
);

test("graph Profile manager subscribes to the shared language runtime", () => {
  assert.match(
    managerSource,
    /import \{ useLanguage \} from "\.\.\/i18n\/language-system\.js"/u,
  );
  assert.match(managerSource, /const \{ language, t \} = useLanguage\(\)/u);
  assert.match(managerSource, /t\("graph\.profileManager\.title"\)/u);
  assert.match(managerSource, /t\("graph\.profileManager\.scope\.aria"\)/u);
  assert.match(managerSource, /t\("graph\.profileManager\.list\.empty"\)/u);
});

test("Profile actions, import/export feedback, errors, and dates use semantic locale wiring", () => {
  assert.match(managerSource, /t\("graph\.profileManager\.toast\.saved", \{/u);
  assert.match(managerSource, /"graph\.profileManager\.toast\.imported\.one"/u);
  assert.match(managerSource, /"graph\.profileManager\.toast\.imported\.other"/u);
  assert.match(managerSource, /t\("graph\.profileManager\.toast\.exported", \{/u);
  assert.match(managerSource, /t\("graph\.profileManager\.error\.importFailed", \{/u);
  assert.match(managerSource, /t\("graph\.profileManager\.action\.deleteAria", \{/u);
  assert.match(managerSource, /formatDate\(profile\.updatedAt, language\)/u);
  assert.doesNotMatch(managerSource, /toLocaleDateString/u);
  assert.doesNotMatch(managerSource, /NAMED VISUAL PROFILES|No saved profiles in this scope/u);
  assert.doesNotMatch(managerSource, />\s*(?:UNDO|IMPORT|EXPORT|SAVE CURRENT)\s*</u);
});

test("Profile names, ids, scope values, JSON filenames, and dynamic error details remain raw", () => {
  assert.match(managerSource, /<strong>\{profile\.label\}<\/strong>/u);
  assert.match(managerSource, /profile: profile\.label/u);
  assert.match(managerSource, /historyKey: `profile:\$\{profile\.id\}`/u);
  assert.match(managerSource, /`vault:\$\{vaultName\}`/u);
  assert.match(managerSource, /jarvis-graph-visuals-\$\{new Date\(\)\.toISOString/u);
  assert.match(managerSource, /accept="application\/json,\.json"/u);
  assert.match(managerSource, /message: error\.message/u);
  assert.match(managerSource, /message: library\.error/u);
});
