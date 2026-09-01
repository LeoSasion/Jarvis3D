import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LANGUAGE_PREFERENCE,
  getLanguageSnapshot,
  initializeLanguageSystem,
  interpolateTranslation,
  LANGUAGE_OPTIONS,
  normalizeLanguagePreference,
  resolveLanguagePreference,
  resolveSystemLanguage,
  setLanguagePreference,
  subscribeLanguage,
  translate,
} from "../src/i18n/language-system.js";
import { TRANSLATION_DICTIONARIES } from "../src/i18n/translations.js";

test("language preferences accept only system, Simplified Chinese, and English", () => {
  assert.equal(normalizeLanguagePreference("system"), "system");
  assert.equal(normalizeLanguagePreference("zh-CN"), "zh-CN");
  assert.equal(normalizeLanguagePreference("en-US"), "en-US");
  assert.equal(normalizeLanguagePreference({ language: "en-US" }), DEFAULT_LANGUAGE_PREFERENCE);
  assert.equal(normalizeLanguagePreference("fr-FR"), DEFAULT_LANGUAGE_PREFERENCE);
  assert.equal(normalizeLanguagePreference(null), DEFAULT_LANGUAGE_PREFERENCE);
});

test("system language resolution maps supported locale families to product locales", () => {
  assert.equal(resolveSystemLanguage(["zh-Hans-CN"]), "zh-CN");
  assert.equal(resolveSystemLanguage("zh_TW"), "zh-CN");
  assert.equal(resolveSystemLanguage(["fr-FR", "en-GB"]), "en-US");
  assert.equal(resolveSystemLanguage(["de-DE", "fr-FR"]), "en-US");
  assert.equal(resolveLanguagePreference("zh-CN", ["en-US"]), "zh-CN");
  assert.equal(resolveLanguagePreference("system", ["zh-SG"]), "zh-CN");
});

test("translation interpolation preserves missing tokens and accepts zero values", () => {
  assert.equal(
    interpolateTranslation("{count} of {total}: {missing}", { count: 0, total: 3 }),
    "0 of 3: {missing}",
  );
  assert.equal(translate("settings.language.title", undefined, "zh-CN"), "语言");
  assert.equal(
    translate("settings.language.current", { language: "English" }, "en-US"),
    "Display language: English",
  );
  assert.equal(translate("missing.translation.key", undefined, "zh-CN"), "missing.translation.key");
});

test("dynamic graph group keys resolve singular, plural, and match labels", () => {
  const itemKey = (count) => `graph.workspace.group.items.${count === 1 ? "one" : "other"}`;

  assert.equal(translate(itemKey(1), { count: 1 }, "en-US"), "1 ITEM");
  assert.equal(translate(itemKey(2), { count: 2 }, "en-US"), "2 ITEMS");
  assert.equal(translate(itemKey(2), { count: 2 }, "zh-CN"), "2 项");
  assert.equal(
    translate("graph.workspace.group.matches", { visible: 3, total: 8 }, "zh-CN"),
    "3/8 匹配",
  );
});

test("graph camera accessibility guidance is localized", () => {
  assert.match(
    translate("graph.camera.controls.aria", undefined, "en-US"),
    /Graph camera controls/u,
  );
  assert.match(
    translate("graph.camera.controls.aria", undefined, "zh-CN"),
    /图谱相机控制/u,
  );
});

test("Chinese and English dictionaries expose the same semantic keys", () => {
  assert.deepEqual(
    Object.keys(TRANSLATION_DICTIONARIES["zh-CN"]).toSorted(),
    Object.keys(TRANSLATION_DICTIONARIES["en-US"]).toSorted(),
  );
});

test("language options are the catalog contract for supported interface languages", () => {
  assert.deepEqual(
    LANGUAGE_OPTIONS.map(({ value }) => value),
    ["system", "zh-CN", "en-US"],
  );
  assert.deepEqual(
    LANGUAGE_OPTIONS.slice(1).map(({ value }) => value).toSorted(),
    Object.keys(TRANSLATION_DICTIONARIES).toSorted(),
  );
});

test("language runtime persists a minimal preference and synchronizes system and storage changes", () => {
  const storedValues = new Map();
  const handlers = new Map();
  const addCounts = new Map();
  let storageWrites = 0;
  let storageReads = 0;
  global.window = {
    navigator: { languages: ["zh-CN"], language: "zh-CN" },
    localStorage: {
      getItem: (key) => {
        storageReads += 1;
        return storedValues.get(key) ?? null;
      },
      setItem: (key, value) => {
        storageWrites += 1;
        storedValues.set(key, value);
      },
    },
    addEventListener: (name, handler) => {
      addCounts.set(name, (addCounts.get(name) ?? 0) + 1);
      handlers.set(name, handler);
    },
    removeEventListener: (name) => handlers.delete(name),
  };
  global.document = { documentElement: { lang: "" } };

  initializeLanguageSystem();
  initializeLanguageSystem();
  assert.equal(storageReads, 1);
  assert.equal(addCounts.get("languagechange"), 1);
  assert.equal(getLanguageSnapshot().preference, "system");
  assert.equal(getLanguageSnapshot().language, "zh-CN");
  assert.equal(global.document.documentElement.lang, "zh-CN");

  let notifications = 0;
  const unsubscribe = subscribeLanguage(() => {
    notifications += 1;
  });
  setLanguagePreference("en-US");
  assert.deepEqual(
    JSON.parse(storedValues.get("jarvis.language-preference.v1")),
    { version: 1, language: "en-US" },
  );
  assert.equal(global.document.documentElement.lang, "en-US");

  global.window.navigator.languages = ["zh-CN"];
  handlers.get("languagechange")();
  assert.equal(getLanguageSnapshot().language, "en-US");

  storedValues.set("jarvis.language-preference.v1", JSON.stringify({
    version: 1,
    language: "zh-CN",
  }));
  handlers.get("storage")({ key: "another.preference" });
  assert.equal(getLanguageSnapshot().preference, "en-US");

  handlers.get("storage")({ key: "jarvis.language-preference.v1" });
  assert.equal(getLanguageSnapshot().preference, "zh-CN");
  assert.equal(storageWrites, 1);

  storedValues.delete("jarvis.language-preference.v1");
  handlers.get("storage")({ key: null });
  assert.equal(getLanguageSnapshot().preference, "system");
  assert.equal(getLanguageSnapshot().language, "zh-CN");

  setLanguagePreference(DEFAULT_LANGUAGE_PREFERENCE);
  assert.deepEqual(
    JSON.parse(storedValues.get("jarvis.language-preference.v1")),
    { version: 1, language: "system" },
  );

  global.window.navigator.languages = ["en-US"];
  handlers.get("languagechange")();
  assert.equal(getLanguageSnapshot().language, "en-US");
  assert.equal(notifications, 4);
  unsubscribe();

  delete global.window;
  delete global.document;
});

test("unavailable storage fails safely while document language still updates", () => {
  const handlers = new Map();
  global.window = {
    navigator: { languages: ["en-US"] },
    localStorage: {
      getItem: () => {
        throw new Error("storage disabled");
      },
      setItem: () => {
        throw new Error("storage disabled");
      },
    },
    addEventListener: (name, handler) => handlers.set(name, handler),
    removeEventListener: (name) => handlers.delete(name),
  };
  global.document = { documentElement: { lang: "" } };

  assert.doesNotThrow(() => initializeLanguageSystem());
  assert.doesNotThrow(() => setLanguagePreference("zh-CN"));
  assert.equal(global.document.documentElement.lang, "zh-CN");

  delete global.window;
  delete global.document;
});
