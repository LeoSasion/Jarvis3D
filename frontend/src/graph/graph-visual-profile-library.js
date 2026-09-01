import { normalizeGraphVisualSettings } from "../graphics/graph/graph-visual-settings.js";

const STORAGE_KEY = "jarvis.graph-visual-profiles.v1";
const DOCUMENT_VERSION = 1;
const MAX_PROFILES = 12;
const MAX_LABEL_LENGTH = 40;
const MAX_SCOPE_LENGTH = 160;
const listeners = new Set();
let sequence = 0;

function boundedText(value, maximumLength, fallback = "") {
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/gu, "").trim();
  return (text || fallback).slice(0, maximumLength);
}

function timestamp(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function createProfileId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `graph-profile-${uuid}`;
  sequence += 1;
  return `graph-profile-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

function normalizeProfile(value, index = 0) {
  if (!value || typeof value !== "object") return null;
  const label = boundedText(value.label, MAX_LABEL_LENGTH);
  if (!label) return null;
  return Object.freeze({
    id: boundedText(value.id, 96, `imported-${index}`),
    label,
    scope: boundedText(value.scope, MAX_SCOPE_LENGTH, "global"),
    createdAt: timestamp(value.createdAt),
    updatedAt: timestamp(value.updatedAt ?? value.createdAt),
    settings: normalizeGraphVisualSettings(value.settings),
  });
}

export function normalizeGraphVisualProfileDocument(value) {
  if (!value || typeof value !== "object" || value.version !== DOCUMENT_VERSION) {
    throw new TypeError("Unsupported graph visual profile document.");
  }
  const source = Array.isArray(value.profiles)
    ? value.profiles
    : value.profile
      ? [value.profile]
      : [];
  const seen = new Set();
  const profiles = [];
  for (const [index, candidate] of source.entries()) {
    const profile = normalizeProfile(candidate, index);
    if (!profile || seen.has(profile.id)) continue;
    seen.add(profile.id);
    profiles.push(profile);
    if (profiles.length >= MAX_PROFILES) break;
  }
  if (profiles.length === 0) throw new TypeError("Graph visual profile document is empty.");
  return Object.freeze({ version: DOCUMENT_VERSION, profiles: Object.freeze(profiles) });
}

export function serializeGraphVisualProfileDocument(profiles) {
  const normalized = normalizeGraphVisualProfileDocument({
    version: DOCUMENT_VERSION,
    profiles,
  });
  return JSON.stringify(normalized, null, 2);
}

function emptySnapshot(error = null) {
  return Object.freeze({ profiles: Object.freeze([]), error });
}

function readSnapshot() {
  if (typeof window === "undefined") return emptySnapshot();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptySnapshot();
    const documentValue = normalizeGraphVisualProfileDocument(JSON.parse(raw));
    return Object.freeze({ profiles: documentValue.profiles, error: null });
  } catch (error) {
    return emptySnapshot(String(error?.message ?? "Graph profile storage is unavailable."));
  }
}

let snapshot = readSnapshot();

function commitProfiles(profiles) {
  const next = Object.freeze({ profiles: Object.freeze(profiles.slice(0, MAX_PROFILES)), error: null });
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: DOCUMENT_VERSION,
        profiles: next.profiles,
      }));
    } catch (error) {
      snapshot = Object.freeze({ ...next, error: String(error?.message ?? "Profile storage failed.") });
      listeners.forEach((listener) => listener());
      return snapshot;
    }
  }
  snapshot = next;
  listeners.forEach((listener) => listener());
  return snapshot;
}

export function getGraphVisualProfileLibrarySnapshot() {
  return snapshot;
}

export function subscribeGraphVisualProfileLibrary(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function saveGraphVisualProfile(label, settings, scope = "global") {
  const now = new Date().toISOString();
  const normalizedLabel = boundedText(label, MAX_LABEL_LENGTH);
  if (!normalizedLabel) throw new TypeError("Profile name is required.");
  const normalizedScope = boundedText(scope, MAX_SCOPE_LENGTH, "global");
  const existing = snapshot.profiles.find((profile) => (
    profile.scope === normalizedScope
      && profile.label.localeCompare(normalizedLabel, undefined, { sensitivity: "accent" }) === 0
  ));
  const profile = normalizeProfile({
    id: existing?.id ?? createProfileId(),
    label: normalizedLabel,
    scope: normalizedScope,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    settings,
  });
  const remaining = snapshot.profiles.filter((candidate) => candidate.id !== profile.id);
  commitProfiles([profile, ...remaining]);
  return profile;
}

export function deleteGraphVisualProfile(profileId) {
  const next = snapshot.profiles.filter((profile) => profile.id !== profileId);
  if (next.length === snapshot.profiles.length) return snapshot;
  return commitProfiles(next);
}

export function importGraphVisualProfileDocument(serialized, scope = null) {
  const documentValue = normalizeGraphVisualProfileDocument(JSON.parse(String(serialized ?? "")));
  const imported = documentValue.profiles.map((profile) => normalizeProfile({
    ...profile,
    id: createProfileId(),
    scope: scope ? boundedText(scope, MAX_SCOPE_LENGTH, "global") : profile.scope,
    updatedAt: new Date().toISOString(),
  }));
  const existing = snapshot.profiles.filter((candidate) => (
    !imported.some((profile) => profile.scope === candidate.scope && profile.label === candidate.label)
  ));
  commitProfiles([...imported, ...existing]);
  return imported;
}

export const graphVisualProfileLibraryPolicy = Object.freeze({
  storageKey: STORAGE_KEY,
  version: DOCUMENT_VERSION,
  maximumProfiles: MAX_PROFILES,
  maximumLabelLength: MAX_LABEL_LENGTH,
});
