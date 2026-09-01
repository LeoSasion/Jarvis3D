import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/components/ShellPanels.jsx", import.meta.url),
  "utf8",
);

function getFunctionSource(name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start);
  assert.ok(start >= 0 && end > start, `${name} must remain inspectable`);
  return source.slice(start, end);
}

const runtimeSettingsSource = getFunctionSource(
  "RuntimeSettingsPanel",
  "TaskbarModeSettings",
);
const interfacePreferencesSource = getFunctionSource(
  "InterfacePreferences",
  "WindowAppearanceSettings",
);

test("runtime settings title, navigation, and General page use the language runtime", () => {
  assert.match(runtimeSettingsSource, /const \{ t \} = useLanguage\(\)/u);
  assert.match(source, /labelKey: "settings\.navigation\.general"/u);
  assert.match(runtimeSettingsSource, /t\(section\.labelKey\)/u);
  for (const key of [
    "settings.accessibility.dialog",
    "settings.header.eyebrow",
    "settings.title",
    "settings.navigation.aria",
    "settings.general.accessibility.section",
    "settings.general.startup.title",
    "settings.general.recovery.description",
  ]) {
    assert.ok(runtimeSettingsSource.includes(`"${key}"`), `missing ${key}`);
  }
  assert.match(runtimeSettingsSource, /closeLabel=\{t\("common\.action\.close"\)\}/u);
});

test("General page preserves runtime identities, paths, and native failures", () => {
  assert.match(runtimeSettingsSource, /runtime\?\.productName/u);
  assert.match(runtimeSettingsSource, /runtime\?\.version/u);
  assert.match(runtimeSettingsSource, /runtime\?\.buildConfiguration/u);
  assert.match(runtimeSettingsSource, /runtime\?\.installationMode/u);
  assert.match(runtimeSettingsSource, /runtime\?\.webView2Version/u);
  assert.match(runtimeSettingsSource, /setError\(nextError\.message\)/u);
});

test("interface appearance controls and toasts use semantic language keys", () => {
  assert.match(interfacePreferencesSource, /const language = useLanguage\(\)/u);
  for (const key of [
    "settings.appearance.title",
    "settings.interface.palette.title",
    "settings.motion.title",
    "settings.emission.title",
    "settings.interface.effects.loading",
    "settings.interface.audio.title",
    "settings.interface.audio.volumeAria",
    "settings.interface.reset.title",
    "settings.interface.toast.themeChanged",
    "settings.interface.toast.resetComplete",
  ]) {
    assert.ok(interfacePreferencesSource.includes(`"${key}"`), `missing ${key}`);
  }
  assert.match(source, /labelKey: "settings\.interface\.motion\.option\.system\.label"/u);
  assert.match(source, /interfacePaletteFieldLabelKeys/u);
  assert.match(source, /interfaceContrastCheckLabelKeys/u);
});

test("language selection and technical theme data remain stable", () => {
  assert.match(interfacePreferencesSource, /LANGUAGE_OPTIONS\.map\(\(option, index\)/u);
  assert.match(interfacePreferencesSource, /setLanguagePreference\(option\.value\)/u);
  assert.match(interfacePreferencesSource, /key=\{theme\.id\}/u);
  assert.match(interfacePreferencesSource, /setVisualTheme\(theme\.id\)/u);
  assert.match(interfacePreferencesSource, /theme\.label/u);
  assert.match(interfacePreferencesSource, /theme\.description/u);
  assert.match(interfacePreferencesSource, /accept="application\/json,\.json"/u);
  assert.match(interfacePreferencesSource, /link\.download = "jarvis-theme\.json"/u);
});
