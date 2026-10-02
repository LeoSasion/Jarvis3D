import { createGraphSettingsFileSync } from "../graphics/graph/graph-settings-file-sync.js";
import {
  flushGraphVisualSettingsPersistence, getGraphVisualSettingsPersistenceState,
  retryGraphVisualSettingsPersistence,
} from "../graphics/graph/graph-visual-settings.js";
import {
  getCustomVisualPaletteSnapshot, getVisualThemeSnapshot, normalizeCustomVisualPalette,
  replaceVisualThemePreferences, subscribeVisualTheme,
} from "../theme-system.js";
import {
  getInterfacePreferencesSnapshot, normalizeInterfacePreferences,
  setInterfacePreferences, subscribeInterfacePreferences,
} from "../interface-preferences.js";
import {
  getGraphVisualProfileLibrarySnapshot, normalizeGraphVisualProfile,
  replaceGraphVisualProfileLibrary, subscribeGraphVisualProfileLibrary,
} from "../graph/graph-visual-profile-library.js";
import { getLanguageSnapshot, normalizeLanguagePreference, setLanguagePreference, subscribeLanguage } from "../i18n/language-system.js";
import { getUiAudioSnapshot, replaceUiAudioPreferences, subscribeUiAudio } from "../audio-system.js";
import { getVisualEffectsSnapshot, normalizeVisualEffects, replaceVisualEffects, subscribeVisualEffects } from "../visual-effects/visual-effects-system.js";
import { setConfigurationFileConnected } from "./configuration-authority.js";

const listeners = new Set();
let state = Object.freeze({ status: "browser", error: null, revision: null, savedAtUtc: null, source: null, graph: null });
let sync;
let api;
let applying = false;
let timer;
let cleanup;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const emit = (update) => {
  const next = { ...state, ...update };
  if (equal(next, state)) return;
  state = Object.freeze(next);
  listeners.forEach((listener) => listener());
};

export function normalizeWorkspaceConfiguration(value) {
  const profiles = Object.values(value?.profiles ?? {})
    .map(normalizeGraphVisualProfile).filter((profile) => profile &&
      !["__proto__", "prototype", "constructor"].includes(profile.id))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12);
  return {
    version: 1,
    theme: { id: ["nexus", "stealth", "clarity", "custom"].includes(value?.theme?.id) ? value.theme.id : "nexus",
      palette: normalizeCustomVisualPalette(value?.theme?.palette) },
    interface: normalizeInterfacePreferences(value?.interface),
    profiles: Object.fromEntries(profiles.map((profile) => [profile.id, profile])),
    language: normalizeLanguagePreference(value?.language),
    audio: { enabled: value?.audio?.enabled === true,
      volume: Math.max(0, Math.min(1, Number.isFinite(value?.audio?.volume) ? value.audio.volume : 0.14)) },
    effects: normalizeVisualEffects(value?.effects),
  };
}

export function captureWorkspaceConfiguration() {
  return normalizeWorkspaceConfiguration({
    theme: { id: getVisualThemeSnapshot(), palette: getCustomVisualPaletteSnapshot() },
    interface: getInterfacePreferencesSnapshot(),
    profiles: Object.fromEntries(getGraphVisualProfileLibrarySnapshot().profiles.map((profile) => [profile.id, profile])),
    language: getLanguageSnapshot().preference, audio: getUiAudioSnapshot(), effects: getVisualEffectsSnapshot(),
  });
}

function apply(value) {
  applying = true;
  try {
    const current = captureWorkspaceConfiguration();
    if (!equal(current.theme, value.theme)) replaceVisualThemePreferences(value.theme);
    if (!equal(current.interface, value.interface)) setInterfacePreferences(value.interface);
    if (!equal(current.profiles, value.profiles)) replaceGraphVisualProfileLibrary(Object.values(value.profiles));
    if (current.language !== value.language) setLanguagePreference(value.language);
    if (!equal(current.audio, value.audio)) replaceUiAudioPreferences(value.audio);
    if (!equal(current.effects, value.effects)) replaceVisualEffects(value.effects);
  } finally { applying = false; }
}

export const getWorkspaceConfigurationSnapshot = () => state;
export function subscribeWorkspaceConfiguration(listener) { listeners.add(listener); return () => listeners.delete(listener); }

export function observeGraphConfigurationApi(graphApi) {
  if (!graphApi) return graphApi;
  const observe = async (promise) => {
    const value = await promise;
    emit({ graph: { revision: value.revision, savedAtUtc: value.savedAtUtc ?? null, source: value.source ?? "graph-visual-settings.json" } });
    return value;
  };
  return { read: () => observe(graphApi.read()), write: (params) => observe(graphApi.write(params)) };
}

export async function connectWorkspaceConfiguration(configurationApi, { readOnly = false } = {}) {
  if (!configurationApi || sync || typeof window === "undefined") return;
  api = configurationApi;
  setConfigurationFileConnected(true);
  emit({ status: "loading" });
  sync = createGraphSettingsFileSync({
    api: readOnly ? { read: api.read, write: async () => { throw new Error("CONFIGURATION_NOT_READY"); } } : api,
    initial: captureWorkspaceConfiguration(), normalize: normalizeWorkspaceConfiguration,
    isAtomicValue: (path) => path.length === 2 && path[0] === "profiles",
    validateSnapshot(snapshot) {
      if (typeof snapshot?.revision !== "string" || snapshot.settings?.version !== 1)
        throw new Error("INVALID_LOCAL_CONFIGURATION");
    },
    onSnapshot(snapshot) { emit({ revision: snapshot.revision, savedAtUtc: snapshot.savedAtUtc ?? null, source: snapshot.source ?? "workspace-preferences.json" }); },
    onValue: apply, onStatus: (status, error) => emit({ status, error }),
  });
  const onEdit = () => {
    if (applying || readOnly) return;
    sync.edit(captureWorkspaceConfiguration());
    globalThis.clearTimeout(timer);
    timer = globalThis.setTimeout(() => { timer = null; void sync?.flush(); }, 200);
  };
  const unsubscribe = [subscribeVisualTheme, subscribeInterfacePreferences, subscribeGraphVisualProfileLibrary,
    subscribeLanguage, subscribeUiAudio, subscribeVisualEffects].map((subscribe) => subscribe(onEdit));
  const refresh = () => { if (document.visibilityState !== "hidden") void sync?.refresh(); };
  const hide = () => { if (document.visibilityState === "hidden") void sync?.flush(); else refresh(); };
  const interval = window.setInterval(refresh, 1500);
  window.addEventListener("focus", refresh);
  window.addEventListener("pagehide", hide);
  document.addEventListener("visibilitychange", hide);
  cleanup = () => {
    unsubscribe.forEach((unsubscribeOne) => unsubscribeOne());
    window.clearInterval(interval); globalThis.clearTimeout(timer);
    window.removeEventListener("focus", refresh); window.removeEventListener("pagehide", hide);
    document.removeEventListener("visibilitychange", hide); sync?.dispose(); sync = null; api = null;
    setConfigurationFileConnected(false);
  };
  await sync.refresh();
}

export async function flushWorkspaceConfiguration() {
  globalThis.clearTimeout(timer); timer = null;
  if (!sync) {
    if (getGraphVisualProfileLibrarySnapshot().error) throw new Error("BROWSER_CONFIGURATION_SAVE_FAILED");
    return;
  }
  await sync.flush();
  if (state.status !== "saved") throw new Error("LOCAL_CONFIGURATION_SAVE_FAILED");
}

export async function retryWorkspaceConfiguration() {
  await sync?.refresh();
  if (sync && state.status !== "saved") throw new Error("LOCAL_CONFIGURATION_SAVE_FAILED");
}

async function flushAll() {
  if (!api) throw new Error("LOCAL_CONFIGURATION_UNAVAILABLE");
  await Promise.all([flushWorkspaceConfiguration(), flushGraphVisualSettingsPersistence()]);
  if (getGraphVisualSettingsPersistenceState() !== "saved") throw new Error("GRAPH_CONFIGURATION_SAVE_FAILED");
}

export const listConfigurationSnapshots = () => api?.listSnapshots() ?? Promise.resolve([]);
export async function createConfigurationSnapshot(label) {
  await flushAll();
  return api.createSnapshot({ label });
}
export async function deleteConfigurationSnapshot(id) {
  if (!api) throw new Error("LOCAL_CONFIGURATION_UNAVAILABLE");
  return api.deleteSnapshot({ id });
}
export async function restoreConfigurationSnapshot(id) {
  await flushAll();
  const result = await api.restoreSnapshot({ id, graphRevision: state.graph?.revision, preferencesRevision: state.revision });
  await Promise.all([sync.refresh(), retryGraphVisualSettingsPersistence()]);
  if (result.conflict) throw new Error("CONFIGURATION_CHANGED_BEFORE_RESTORE");
  if (state.status !== "saved" || getGraphVisualSettingsPersistenceState() !== "saved")
    throw new Error("CONFIGURATION_RESTORED_REFRESH_FAILED");
}

export function createConfigurationDiagnostic({ runtime = null, kind = "browser", frontend = frontendBuild } = {}) {
  // Deliberate allowlist: no absolute paths, vault names, settings values, accounts or prompts.
  return {
    product: "JARVIS", frontend: { version: frontend.version, revision: frontend.revision,
      dirty: frontend.dirty, builtAtUtc: frontend.builtAtUtc }, runtime: {
      kind, version: kind === "windows" ? runtime?.version ?? "unavailable" : "browser-preview",
      buildConfiguration: kind === "windows" ? runtime?.buildConfiguration ?? null : null,
      webView2Version: kind === "windows" ? runtime?.webView2Version ?? null : null,
    },
    configuration: {
      status: state.status, source: state.source ?? "browser-local", revision: state.revision,
      savedAtUtc: state.savedAtUtc, graph: state.graph,
      graphSaveState: getGraphVisualSettingsPersistenceState(),
      profileCount: getGraphVisualProfileLibrarySnapshot().profiles.length,
    },
  };
}

export const frontendBuild = Object.freeze(import.meta.env?.JARVIS_BUILD ?? { version: "development", revision: "unknown", dirty: null, builtAtUtc: null });
if (import.meta.hot) import.meta.hot.dispose(() => cleanup?.());
