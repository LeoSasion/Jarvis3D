import assert from "node:assert/strict";
import test from "node:test";
import { createGraphSettingsFileSync } from "../src/graphics/graph/graph-settings-file-sync.js";
import { createLocalVisualSettings } from "../src/platform/local-visual-settings.js";
import {
  DEFAULT_GRAPH_VISUAL_SETTINGS,
  createGraphVisualSettingsFileSync,
  normalizeGraphVisualSettings,
  selectGraphDimensionSettings,
} from "../src/graphics/graph/graph-visual-settings.js";

const profile = (strength = 1, radius = 0.5) => ({ version: 7, fx: { strength, radius } });
function disk(initial = null) {
  let value = initial;
  let revision = value ? "1" : null;
  let sequence = 1;
  let writes = 0;
  const snapshot = () => structuredClone({ settings: value, revision });
  return {
    read: async () => snapshot(),
    async write(request) {
      if (request.revision !== revision) return { ...snapshot(), conflict: true };
      value = structuredClone(request.settings);
      revision = String(++sequence);
      writes++;
      return snapshot();
    },
    get writes() { return writes; },
  };
}
function browser(api, initial = profile(), create = createGraphSettingsFileSync) {
  const state = { value: initial, status: null, error: null };
  const sync = create({ api, initial, normalize: structuredClone,
    onValue(value) { state.value = value; },
    onStatus(status, error) { Object.assign(state, { status, error }); },
  });
  return { sync, state };
}

for (const editFirst of [true, false]) test(`dimension changes cannot redirect or revert another browser's edit (edit first: ${editFirst})`, async () => {
  const initial = normalizeGraphVisualSettings({
    ...DEFAULT_GRAPH_VISUAL_SETTINGS, sharedStyle: false,
    labels: { ...DEFAULT_GRAPH_VISUAL_SETTINGS.labels, fontSize: 9 },
  });
  const api = disk(initial);
  const a = browser(api, initial, createGraphVisualSettingsFileSync);
  const b = browser(api, initial, createGraphVisualSettingsFileSync);
  await Promise.all([a.sync.refresh(), b.sync.refresh()]);
  a.sync.edit(normalizeGraphVisualSettings({ ...initial, labels: { ...initial.labels, fontSize: 13 } }));
  b.sync.edit(normalizeGraphVisualSettings(selectGraphDimensionSettings(initial, 2)));
  await (editFirst ? a : b).sync.flush();
  await (editFirst ? b : a).sync.flush();
  await Promise.all([a.sync.refresh(), b.sync.refresh()]);
  const saved = (await api.read()).settings;
  assert.equal(saved.view.dimension, 2);
  assert.equal(saved.dimensions["3d"].labels.fontSize, 13);
  assert.equal(saved.dimensions["2d"].labels.fontSize, initial.dimensions["2d"].labels.fontSize);
  assert.deepEqual(saved.labels, saved.dimensions["2d"].labels);
  assert.deepEqual(a.state.value, b.state.value);
});

test("a stale independent browser adopts the local file without writing its cache back", async () => {
  const api = disk(profile(1.95));
  const a = browser(api, profile(0.2));
  await a.sync.refresh();
  assert.equal(a.state.value.fx.strength, 1.95);
  assert.equal(api.writes, 0);
  assert.equal(a.state.status, "saved");
});

test("only the first browser seeds an absent file; a second bootstrap loses safely", async () => {
  const api = disk();
  const a = browser(api, profile(1.95));
  const b = browser(api, profile(0.2));
  await Promise.all([a.sync.refresh(), b.sync.refresh()]);
  assert.deepEqual(a.state.value, b.state.value);
  assert.equal(a.state.value.fx.strength, 1.95);
  assert.equal(api.writes, 1);
});

test("simultaneous independent edits survive CAS conflicts and propagate without echo writes", async () => {
  const api = disk(profile());
  const a = browser(api);
  const b = browser(api);
  await Promise.all([a.sync.refresh(), b.sync.refresh()]);
  a.sync.edit(profile(1.95));
  b.sync.edit(profile(1, 0.38));
  await Promise.all([a.sync.refresh(), b.sync.refresh()]);
  await a.sync.refresh();
  assert.deepEqual(a.state.value, profile(1.95, 0.38));
  assert.deepEqual(b.state.value, a.state.value);
  assert.equal(api.writes, 2);
  await Promise.all([a.sync.refresh(), b.sync.refresh()]);
  assert.equal(api.writes, 2);
});

test("reverting an unsaved edit leaves another browser's later change intact", async () => {
  const api = disk(profile());
  const a = browser(api);
  const b = browser(api);
  await Promise.all([a.sync.refresh(), b.sync.refresh()]);
  a.sync.edit(profile(1.95));
  a.sync.edit(profile());
  b.sync.edit(profile(1.5));
  await b.sync.flush();
  await a.sync.refresh();
  assert.deepEqual(a.state.value, profile(1.5));
  assert.equal((await api.read()).settings.fx.strength, 1.5);
  assert.equal(api.writes, 1);
});

test("a remote write that already matches the pending edit needs no echo write", async () => {
  const api = disk(profile());
  const a = browser(api);
  const b = browser(api);
  await Promise.all([a.sync.refresh(), b.sync.refresh()]);
  a.sync.edit(profile(1.95));
  b.sync.edit(profile(1.95));
  await b.sync.flush();
  await a.sync.refresh();
  assert.deepEqual(a.state.value, profile(1.95));
  assert.equal(api.writes, 1);
});

test("reverting an edit during its write still saves the reversion", async () => {
  const storage = disk(profile());
  let release;
  let started;
  const began = new Promise((resolve) => { started = resolve; });
  let first = true;
  const api = { read: storage.read, write: async (request) => {
    if (first) {
      first = false;
      started();
      await new Promise((resolve) => { release = resolve; });
    }
    return storage.write(request);
  } };
  const a = browser(api);
  await a.sync.refresh();
  a.sync.edit(profile(1.95));
  const saving = a.sync.flush();
  await began;
  a.sync.edit(profile());
  release();
  await saving;
  assert.deepEqual((await storage.read()).settings, profile());
  assert.deepEqual(a.state.value, profile());
  assert.equal(storage.writes, 2);
});

test("an edit made during an in-flight save is neither acknowledged early nor lost", async () => {
  const storage = disk(profile());
  let release;
  let started;
  const began = new Promise((resolve) => { started = resolve; });
  let first = true;
  const api = { read: storage.read, write: async (request) => {
    if (first) {
      first = false;
      started();
      await new Promise((resolve) => { release = resolve; });
    }
    return storage.write(request);
  } };
  const a = browser(api);
  await a.sync.refresh();
  a.sync.edit(profile(1.5));
  const saving = a.sync.refresh();
  await began;
  a.sync.edit(profile(1.95));
  release();
  await saving;
  assert.equal((await storage.read()).settings.fx.strength, 1.95);
  assert.equal(a.state.value.fx.strength, 1.95);
});

test("failed writes retain edits and report failure until retry succeeds", async () => {
  const storage = disk(profile());
  let failing = true;
  const a = browser({ read: storage.read, write: (value) => {
    if (failing) throw new Error("disk full");
    return storage.write(value);
  } });
  await a.sync.refresh();
  a.sync.edit(profile(1.95));
  await a.sync.refresh();
  assert.equal(a.state.status, "error");
  assert.equal((await storage.read()).settings.fx.strength, 1);
  failing = false;
  await a.sync.refresh();
  assert.equal(a.state.status, "saved");
  assert.equal(a.state.value.fx.strength, 1.95);
});

test("flushing a recent edit writes immediately without waiting for another read", async () => {
  const storage = disk(profile());
  let reads = 0;
  const a = browser({ ...storage, read: async () => { reads++; return storage.read(); } });
  await a.sync.refresh();
  a.sync.edit(profile(1.95));
  await a.sync.flush();
  assert.equal(reads, 1);
  assert.equal((await storage.read()).settings.fx.strength, 1.95);
});

test("malformed or unreadable files never trigger automatic replacement", async () => {
  let writes = 0;
  const a = browser({ read: async () => ({ settings: { version: 99 }, revision: "x" }),
    write: async () => { writes++; } });
  await a.sync.refresh();
  assert.equal(a.state.status, "error");
  assert.equal(writes, 0);
});

test("an invalid write acknowledgement cannot discard unsaved edits", async () => {
  const storage = disk(profile());
  let invalid = true;
  const a = browser({ read: storage.read, write: (value) => invalid ? {} : storage.write(value) });
  await a.sync.refresh();
  a.sync.edit(profile(1.95));
  await a.sync.flush();
  assert.equal(a.state.status, "error");
  invalid = false;
  await a.sync.refresh();
  assert.equal((await storage.read()).settings.fx.strength, 1.95);
});

test("loopback transport bypasses browser caches and preserves compare-and-swap revisions", async () => {
  const requests = [];
  const api = createLocalVisualSettings(async (url, options) => {
    requests.push({ url, ...options });
    return { ok: true, json: async () => ({ settings: profile(), revision: "r" }) };
  });
  await api.read();
  await api.write({ settings: profile(), revision: "r" });
  assert.equal(requests[0].cache, "no-store");
  assert.equal(requests[1].method, "PUT");
  assert.equal(requests[1].keepalive, true);
  assert.equal(JSON.parse(requests[1].body).revision, "r");
});
