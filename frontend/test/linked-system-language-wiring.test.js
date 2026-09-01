import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../src/components/LinkedSystemRail.jsx", import.meta.url);

test("the linked system rail localizes its shell while preserving live payload text", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(source, /const \{ language, t \} = useLanguage\(\)/u);
  assert.match(source, /t\("linkedSystem\.accessibility\.rail"\)/u);
  assert.match(source, /presentation\.priorityTitle \|\|\s*t\(presentation\.priorityTitleKey\)/u);
  assert.match(source, /formatTime\(clock\.dateTime, language\)/u);
  assert.match(source, /notificationItem\?\.title/u);
  assert.match(source, /presentation\.priorityDetailKey/u);
});
