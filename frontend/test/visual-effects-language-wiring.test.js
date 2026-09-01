import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../src/visual-effects/VisualEffectsSettings.jsx", import.meta.url);

test("desktop screen-effect settings localize chrome without changing effect identifiers", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(source, /const \{ t \} = useLanguage\(\)/u);
  assert.match(source, /t\("visualEffects\.title"\)/u);
  assert.match(source, /t\(effect\.labelKey\)/u);
  assert.match(source, /t\(effect\.detailKey\)/u);
  assert.match(source, /setVisualEffectEnabled\(effect\.id, !active\)/u);
  assert.match(source, /setVisualEffectsCadence\(option\.id\)/u);
});
