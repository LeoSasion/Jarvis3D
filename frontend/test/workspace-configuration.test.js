import assert from "node:assert/strict";
import test from "node:test";
import { createGraphSettingsFileSync } from "../src/graphics/graph/graph-settings-file-sync.js";
import { captureWorkspaceConfiguration, createConfigurationDiagnostic, normalizeWorkspaceConfiguration } from "../src/settings/workspace-configuration.js";
import { createLocalConfiguration } from "../src/platform/local-configuration.js";

function storage(initial) {
  let value = structuredClone(initial);
  let revision = 1;
  return {
    read: async () => ({ settings: structuredClone(value), revision: String(revision) }),
    async write(request) {
      if (request.revision !== String(revision)) return { ...await this.read(), conflict: true };
      value = structuredClone(request.settings); revision++;
      return this.read();
    },
  };
}
function client(api, initial) {
  let value = initial;
  const sync = createGraphSettingsFileSync({ api, initial, normalize: structuredClone,
    validateSnapshot: (snapshot) => assert.equal(snapshot.settings.version, 1),
    isAtomicValue: (path) => path.length === 2 && path[0] === "profiles",
    onValue: (next) => { value = next; }, onStatus() {},
  });
  return { sync, get value() { return value; } };
}

test("independent preset additions and theme changes merge across browser conflicts", async () => {
  const initial = { version: 1, profiles: {}, theme: { id: "nexus" } };
  const api = storage(initial); const a = client(api, initial); const b = client(api, initial);
  await Promise.all([a.sync.refresh(), b.sync.refresh()]);
  a.sync.edit({ ...initial, profiles: { a: { label: "A", settings: { scale: 1 } } } });
  b.sync.edit({ ...initial, theme: { id: "stealth" }, profiles: { b: { label: "B", settings: { scale: 2 } } } });
  await Promise.all([a.sync.flush(), b.sync.flush()]);
  await a.sync.refresh();
  assert.deepEqual(Object.keys(a.value.profiles).sort(), ["a", "b"]);
  assert.equal(a.value.theme.id, "stealth");
});

test("deleting a profile preserves independently edited remote profiles", async () => {
  const initial = { version: 1, profiles: { a: { label: "A" }, b: { label: "B" } } };
  const api = storage(initial); const a = client(api, initial); const b = client(api, initial);
  await Promise.all([a.sync.refresh(), b.sync.refresh()]);
  a.sync.edit({ version: 1, profiles: { b: initial.profiles.b } });
  b.sync.edit({ version: 1, profiles: { ...initial.profiles, b: { label: "Edited B" } } });
  await b.sync.flush(); await a.sync.flush();
  assert.deepEqual(a.value.profiles, { b: { label: "Edited B" } });
});

test("a locally edited preset remains complete when a concurrent client deletes it", async () => {
  const initial = { version: 1, profiles: { a: { label: "A", settings: { scale: 1 } } } };
  const api = storage(initial); const a = client(api, initial); const b = client(api, initial);
  await Promise.all([a.sync.refresh(), b.sync.refresh()]);
  a.sync.edit({ version: 1, profiles: { a: { label: "A", settings: { scale: 2 } } } });
  b.sync.edit({ version: 1, profiles: {} });
  await b.sync.flush(); await a.sync.flush();
  assert.deepEqual(a.value.profiles.a, { label: "A", settings: { scale: 2 } });
});

test("workspace schema normalizes all owned preferences and removes unknown authority", () => {
  const initial = captureWorkspaceConfiguration();
  const normalized = normalizeWorkspaceConfiguration({ ...initial, language: "unknown", theme: { id: "evil", palette: { accent: "url(x)" } }, command: "run", profiles: {} });
  assert.equal(normalized.theme.id, "nexus");
  assert.equal(normalized.language, "system");
  assert.equal(normalized.command, undefined);
  assert.match(normalized.theme.palette.accent, /^#[0-9A-F]{6}$/u);
});

test("diagnostic copies only explicit non-sensitive runtime/build fields", () => {
  const diagnostic = createConfigurationDiagnostic({ kind: "windows", runtime: {
    version: "0.1.0+abc", executablePath: "C:\\Users\\Secret\\app.exe", username: "secret", startupCommand: "hidden",
  }, frontend: { revision: "abc", dirty: false, secret: "must not copy" } });
  const serialized = JSON.stringify(diagnostic);
  assert.equal(diagnostic.runtime.version, "0.1.0+abc");
  assert.ok(!/Secret|secret|must not copy|startupCommand|executablePath/u.test(serialized));
});

test("loopback configuration transport uses bounded fixed endpoint without a caller path", async () => {
  const calls = [];
  const api = createLocalConfiguration(async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({}) }; });
  await api.read(); await api.createSnapshot({ label: "approved" });
  assert.equal(calls[0].url, "/__jarvis/configuration");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(JSON.parse(calls[1].options.body).method, "configuration.snapshots.create");
});
