import assert from "node:assert/strict";
import test from "node:test";
import { isLocalGraphRequest, readVisualSettingsRequest } from "../scripts/local-graph-preview.mjs";
import { Readable } from "node:stream";
import { createLocalGraphPreview } from "../src/platform/local-graph-preview.js";
import { loadDefaultKnowledgeGraph } from "../src/graph/default-knowledge-graph-loader.js";

test("local visual writes require bounded JSON and never accept filesystem paths", async () => {
  const request = (body, type = "application/json") => Object.assign(Readable.from([body]), { headers: { "content-type": type } });
  const valid = JSON.stringify({ revision: null, settings: { version: 7 } });
  assert.equal((await readVisualSettingsRequest(request(valid))).method, "visual.write");
  await assert.rejects(readVisualSettingsRequest(request(valid, "text/plain")));
  await assert.rejects(readVisualSettingsRequest(request(JSON.stringify({ revision: null, settings: {}, path: "elsewhere" }))));
  await assert.rejects(readVisualSettingsRequest(request("x".repeat(65 * 1024))));
});

test("local graph bridge rejects remote connections, foreign hosts, and cross-origin reads", () => {
  const request = (remoteAddress, host = "127.0.0.1:8888", origin) => ({
    socket: { remoteAddress }, headers: { host, origin },
  });
  assert.equal(isLocalGraphRequest(request("127.0.0.1")), true);
  assert.equal(isLocalGraphRequest(request("::1", "localhost:8888", "http://localhost:8888")), true);
  assert.equal(isLocalGraphRequest(request("::ffff:127.0.0.1", "[::1]:8888")), true);
  assert.equal(isLocalGraphRequest(request("192.168.1.10")), false);
  assert.equal(isLocalGraphRequest(request("127.0.0.1", "example.org:8888")), false);
  assert.equal(isLocalGraphRequest(request("127.0.0.1", "localhost:8888", "https://example.org")), false);
  assert.equal(isLocalGraphRequest(request("127.0.0.1", "localhost:8888", "null")), false);
});

test("local graph failures reach the loader without falling back to simulated nodes", async () => {
  const urls = [];
  const api = createLocalGraphPreview(async (url) => {
    urls.push(url);
    return { ok: false, json: async () => ({ code: "LOCAL_GRAPH_UNAVAILABLE" }) };
  });
  await assert.rejects(loadDefaultKnowledgeGraph({ knowledgeGraph: api }, { forceRefresh: true }), {
    code: "LOCAL_GRAPH_UNAVAILABLE",
  });
  assert.equal(urls[0], "/__jarvis/graph/manifest?force=true");
  assert.equal(api.chooseVault, undefined);
});

test("local graph stale revisions retain the loader's retry contract", async () => {
  const api = createLocalGraphPreview(async (url) => {
    assert.match(url, /revision=obsolete/u);
    return { ok: false, json: async () => ({ code: "GRAPH_REVISION_STALE" }) };
  });
  await assert.rejects(api.getDefaultChunk({ revision: "obsolete", nodeOffset: 0, nodeLimit: 256 }), {
    code: "GRAPH_REVISION_STALE",
  });
});
