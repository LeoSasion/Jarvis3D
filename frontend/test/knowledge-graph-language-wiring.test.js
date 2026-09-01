import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../src/components/KnowledgeGraphWorkspace.jsx", import.meta.url);

test("connected graph chrome follows the shared language runtime", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(source, /import \{ useLanguage \} from "\.\.\/i18n\/language-system\.js"/u);
  assert.match(source, /const \{ language, t \} = useLanguage\(\)/u);
  assert.match(source, /t\("graph\.workspace\.action\.explore"\)/u);
  assert.match(source, /t\("graph\.workspace\.search\.placeholder"\)/u);
  assert.match(source, /t\("graph\.workspace\.inspector\.modified"\)/u);
  assert.match(source, /formatDateTime\(selectedNode\.modified, language\)/u);
  assert.match(source, /localizeKnowledgeGraph\(graphModel, t\)/u);
  assert.match(source, /label: node\.labelKey \? t\(node\.labelKey\) : node\.label/u);
  assert.match(source, /meta: node\.metaKey \? t\(node\.metaKey, node\.metaValues\) : node\.meta/u);
  assert.doesNotMatch(source, /new Intl\.DateTimeFormat\("zh-CN"/u);
});

test("accessible graph navigation localizes guidance without translating graph data", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(source, /t\("graph\.navigator\.nodes\.aria"\)/u);
  assert.match(source, /relation: activeConnection\.kind/u);
  assert.match(source, /types: selectedRelationTypes\.join\(t\("common\.separator\.list"\)\)/u);
  assert.doesNotMatch(source, /Graph nodes\. Use arrow keys/u);
});
