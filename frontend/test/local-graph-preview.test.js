import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { access, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { isLocalGraphRequest, localGraphPreview, readVisualSettingsRequest } from "../scripts/local-graph-preview.mjs";
import { createLocalGraphPreview } from "../src/platform/local-graph-preview.js";
import { loadDefaultKnowledgeGraph } from "../src/graph/default-knowledge-graph-loader.js";

test("local visual writes require bounded JSON and never accept filesystem paths", async () => {
  const request = (body, type = "application/json") => Object.assign(Readable.from([body]), { headers: { "content-type": type } });
  const valid = JSON.stringify({ revision: null, settings: { version: 7 } });
  assert.equal((await readVisualSettingsRequest(request(valid))).method, "visual.write");
  await assert.rejects(readVisualSettingsRequest(request(valid, "text/plain")));
  await assert.rejects(readVisualSettingsRequest(request(JSON.stringify({ revision: null, settings: {}, path: "elsewhere" }))));
  await assert.rejects(readVisualSettingsRequest(request(JSON.stringify({ revision: null, settings: [] }))));
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
  assert.equal(isLocalGraphRequest({ ...request("127.0.0.1"), headers: { host: "localhost:8888", "sec-fetch-site": "cross-site" } }), false);
  assert.equal(isLocalGraphRequest({ ...request("127.0.0.1"), headers: { host: "localhost:8888", "sec-fetch-site": "same-site" } }), false);
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

test("concurrent preview servers build isolated workers and clean their outputs", { timeout: 150_000 }, async (context) => {
  try { execFileSync("dotnet", ["--version"], { stdio: "ignore", windowsHide: true }); }
  catch { context.skip(".NET SDK is unavailable"); return; }

  const root = await mkdtemp(join(tmpdir(), "jarvis-graph-preview-test-"));
  const vault = join(root, "vault");
  await mkdir(vault);
  const makeServer = () => {
    const routes = new Map();
    const server = {
      httpServer: new EventEmitter(),
      middlewares: { use(path, handler) { routes.set(path, handler); } },
    };
    localGraphPreview(vault, { outputRoot: root }).configureServer(server);
    return { server, route: routes.get("/__jarvis/graph") };
  };
  const first = makeServer();
  const second = makeServer();
  const manifest = (route) => new Promise((resolveResult, reject) => {
    const request = {
      method: "GET", url: "/manifest", socket: { remoteAddress: "127.0.0.1" },
      headers: { host: "localhost:8888", "sec-fetch-site": "same-origin" },
    };
    const response = {
      statusCode: 200, setHeader() {},
      end(body) { resolveResult({ status: this.statusCode, payload: JSON.parse(body) }); },
    };
    route(request, response).catch(reject);
  });

  try {
    const responses = await Promise.all([
      manifest(first.route), manifest(first.route), manifest(second.route),
    ]);
    assert.deepEqual(responses.map(({ status }) => status), [200, 200, 200]);
    const outputs = (await readdir(root)).filter((name) => name.startsWith("jarvis-graph-preview-"));
    assert.equal(outputs.length, 2);
    await Promise.all(outputs.flatMap((name) => [
      access(join(root, name, "obj", "project.assets.json")),
      access(join(root, name, "bin", "Jarvis.GraphPreview.dll")),
    ]));

    first.server.httpServer.emit("close");
    second.server.httpServer.emit("close");
    for (let attempt = 0; attempt < 30; attempt++) {
      if ((await readdir(root)).length === 1) break;
      await delay(100);
    }
    assert.deepEqual(await readdir(root), ["vault"]);
  } finally {
    first.server.httpServer.emit("close");
    second.server.httpServer.emit("close");
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    await rm(root, { recursive: true, force: true });
  }
});
