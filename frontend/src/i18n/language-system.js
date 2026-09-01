import { useSyncExternalStore } from "react";
import { TRANSLATION_DICTIONARIES } from "./translations.js";

const STORAGE_KEY = "jarvis.language-preference.v1";
const STORAGE_VERSION = 1;
const DEFAULT_RESOLVED_LANGUAGE = "en-US";
const listeners = new Set();
const translators = new Map();
let listeningWindow;

export const DEFAULT_LANGUAGE_PREFERENCE = "system";

export const LANGUAGE_OPTIONS = Object.freeze([
  Object.freeze({ value: "system", labelKey: "language.preference.system" }),
  Object.freeze({ value: "zh-CN", labelKey: "language.preference.zh-CN" }),
  Object.freeze({ value: "en-US", labelKey: "language.preference.en-US" }),
]);

const LANGUAGE_PREFERENCES = new Set(LANGUAGE_OPTIONS.map(({ value }) => value));

export function normalizeLanguagePreference(value) {
  return LANGUAGE_PREFERENCES.has(value)
    ? value
    : DEFAULT_LANGUAGE_PREFERENCE;
}

function getSystemLanguageCandidates() {
  try {
    const systemNavigator = typeof window !== "undefined"
      ? window.navigator
      : typeof navigator !== "undefined"
        ? navigator
        : undefined;
    const languages = Array.isArray(systemNavigator?.languages)
      ? systemNavigator.languages
      : [];
    return languages.length > 0
      ? languages
      : [systemNavigator?.language].filter(Boolean);
  } catch {
    return [];
  }
}

export function resolveSystemLanguage(languages = getSystemLanguageCandidates()) {
  const candidates = Array.isArray(languages) ? languages : [languages];
  for (const candidate of candidates) {
    const normalized = String(candidate ?? "").trim().replaceAll("_", "-").toLowerCase();
    if (normalized === "zh" || normalized.startsWith("zh-")) return "zh-CN";
    if (normalized === "en" || normalized.startsWith("en-")) return "en-US";
  }
  return DEFAULT_RESOLVED_LANGUAGE;
}

export function resolveLanguagePreference(preference, languages) {
  const normalized = normalizeLanguagePreference(preference);
  return resolveNormalizedLanguagePreference(normalized, languages);
}

function resolveNormalizedLanguagePreference(preference, languages) {
  return preference === DEFAULT_LANGUAGE_PREFERENCE
    ? resolveSystemLanguage(languages)
    : preference;
}

export function interpolateTranslation(template, params = {}) {
  const source = String(template ?? "");
  const values = params && typeof params === "object" ? params : {};
  return source.replace(/\{([\w.-]+)\}/gu, (placeholder, name) => (
    Object.prototype.hasOwnProperty.call(values, name)
      ? String(values[name] ?? "")
      : placeholder
  ));
}

function readStoredLanguagePreference() {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE_PREFERENCE;
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    return stored?.version === STORAGE_VERSION
      ? normalizeLanguagePreference(stored.language)
      : DEFAULT_LANGUAGE_PREFERENCE;
  } catch {
    return DEFAULT_LANGUAGE_PREFERENCE;
  }
}

function persistLanguagePreference(preference) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: STORAGE_VERSION,
      language: preference,
    }));
  } catch {
    // The selected language remains active for the current session.
  }
}

function getTranslator(language) {
  if (!translators.has(language)) {
    translators.set(language, (key, params) => translate(key, params, language));
  }
  return translators.get(language);
}

function createSnapshot(preference, language) {
  return Object.freeze({
    preference,
    language,
    t: getTranslator(language),
  });
}

let languageSnapshot = createSnapshot(
  DEFAULT_LANGUAGE_PREFERENCE,
  resolveLanguagePreference(DEFAULT_LANGUAGE_PREFERENCE),
);

const serverLanguageSnapshot = createSnapshot(
  DEFAULT_LANGUAGE_PREFERENCE,
  DEFAULT_RESOLVED_LANGUAGE,
);

function applyDocumentLanguage() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = languageSnapshot.language;
}

function emitLanguageChange() {
  listeners.forEach((listener) => listener());
}

function commitLanguage(preference, { persist = false } = {}) {
  const normalizedPreference = normalizeLanguagePreference(preference);
  const resolvedLanguage = resolveNormalizedLanguagePreference(normalizedPreference);
  const changed = normalizedPreference !== languageSnapshot.preference ||
    resolvedLanguage !== languageSnapshot.language;
  if (persist) persistLanguagePreference(normalizedPreference);
  if (changed) {
    languageSnapshot = createSnapshot(normalizedPreference, resolvedLanguage);
  }
  applyDocumentLanguage();
  if (changed) emitLanguageChange();
  return languageSnapshot;
}

function handleSystemLanguageChange() {
  if (languageSnapshot.preference !== "system") return;
  commitLanguage(DEFAULT_LANGUAGE_PREFERENCE);
}

function handleLanguageStorageChange(event) {
  if (event.key !== null && event.key !== STORAGE_KEY) return;
  commitLanguage(readStoredLanguagePreference());
}

function ensureGlobalListeners() {
  if (typeof window === "undefined" || listeningWindow === window) return;
  if (listeningWindow) {
    listeningWindow.removeEventListener("languagechange", handleSystemLanguageChange);
    listeningWindow.removeEventListener("storage", handleLanguageStorageChange);
  }
  listeningWindow = window;
  listeningWindow.addEventListener("languagechange", handleSystemLanguageChange);
  listeningWindow.addEventListener("storage", handleLanguageStorageChange);
}

function detachGlobalListeners() {
  if (!listeningWindow) return;
  listeningWindow.removeEventListener("languagechange", handleSystemLanguageChange);
  listeningWindow.removeEventListener("storage", handleLanguageStorageChange);
  listeningWindow = undefined;
}

if (import.meta.hot) {
  import.meta.hot.dispose(detachGlobalListeners);
}

export function initializeLanguageSystem() {
  const currentWindow = typeof window === "undefined" ? undefined : window;
  if (listeningWindow !== currentWindow) {
    commitLanguage(readStoredLanguagePreference());
  } else {
    applyDocumentLanguage();
  }
  ensureGlobalListeners();
  return languageSnapshot;
}

export function getLanguageSnapshot() {
  return languageSnapshot;
}

export function subscribeLanguage(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setLanguagePreference(value) {
  return commitLanguage(value, { persist: true });
}

export function translate(key, params, language = languageSnapshot.language) {
  const resolvedLanguage = resolveLanguagePreference(language);
  const dictionary = TRANSLATION_DICTIONARIES[resolvedLanguage] ??
    TRANSLATION_DICTIONARIES[DEFAULT_RESOLVED_LANGUAGE];
  const template = dictionary[key] ??
    TRANSLATION_DICTIONARIES[DEFAULT_RESOLVED_LANGUAGE][key] ??
    String(key ?? "");
  return interpolateTranslation(template, params);
}

export function useLanguage() {
  return useSyncExternalStore(
    subscribeLanguage,
    getLanguageSnapshot,
    () => serverLanguageSnapshot,
  );
}
