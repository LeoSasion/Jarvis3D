import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/components/SystemInspector.jsx", import.meta.url),
  "utf8",
);

test("System inspector localizes window chrome, views, states, and accessibility", () => {
  assert.match(source, /const \{ language, t \} = useLanguage\(\)/u);
  assert.match(source, /t\("systemInspector\.accessibility\.window"\)/u);
  assert.match(source, /t\("systemInspector\.header\.title"\)/u);
  assert.match(source, /t\("systemInspector\.tabs\.aria"\)/u);
  assert.match(source, /t\("systemInspector\.process\.filterAria"\)/u);
  assert.match(source, /t\("systemInspector\.loading"\)/u);
});

test("System inspector formats timestamps by locale while preserving native payloads", () => {
  assert.match(source, /formatDateTime\(date, language\)/u);
  assert.match(source, /formatTime\(details\.capturedAt, language\)/u);
  assert.match(source, /resource\.label/u);
  assert.match(source, /process\.name/u);
  assert.match(source, /adapter\.name/u);
  assert.match(source, /drive\.fileSystem/u);
});
