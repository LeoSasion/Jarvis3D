import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { TRANSLATION_DICTIONARIES } from "../src/i18n/translations.js";

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

const runtimeSource = getFunctionSource("RuntimeSettingsPanel", "NativeIntegrationSettings");
const integrationSource = getFunctionSource("NativeIntegrationSettings", "TaskbarModeSettings");
const taskbarSource = getFunctionSource("TaskbarModeSettings", "InterfacePreferences");
const windowsSource = getFunctionSource("WindowAppearanceSettings", "ShellPanelLayer");

const dynamicSettingsKeys = Object.freeze([
  ...["general", "taskbar", "windows", "interface", "graph", "integration", "help", "recovery"]
    .map((id) => `settings.navigation.${id}`),
  ...["native", "hybrid", "full"].flatMap((id) => [
    `settings.taskbar.option.${id}.label`,
    `settings.taskbar.option.${id}.description`,
  ]),
  ...["off", "conservative", "enhanced", "immersive"].flatMap((id) => [
    `settings.windows.appearance.option.${id}.label`,
    `settings.windows.appearance.option.${id}.tag`,
    `settings.windows.appearance.option.${id}.description`,
  ]),
  ...[
    "automatic",
    "fullscreen",
    "integrityOrAccess",
    "jarvisHost",
    "noCompatibleWindow",
    "nonApplicationWindow",
    "noStandardCaption",
    "systemProtected",
    "systemWindowClass",
    "userAllow",
    "userDeny",
    "windowCloaked",
  ].map((id) => `settings.windows.compatibility.reason.${id}`),
  ...[
    "applying",
    "armed",
    "blocked",
    "idle",
    "localOnly",
    "none",
    "notInspected",
    "offline",
    "pending",
    "ready",
    "saving",
    "verified",
  ].map((id) => `settings.windows.state.${id}`),
  ...["applying", "localOnly", "none", "notInspected", "preview", "saving"]
    .map((id) => `settings.taskbar.state.${id}`),
  "settings.taskbar.feedback.preview",
  "settings.taskbar.feedback.transaction",
  "settings.windows.rules.action.allow",
  "settings.windows.rules.action.allowed",
  "settings.windows.rules.action.blocked",
  "settings.windows.rules.action.deny",
]);

test("remaining Runtime settings help, recovery, and graph fallback use semantic keys", () => {
  for (const key of [
    "settings.graph.visuals.loading",
    "settings.graph.visuals.unavailable",
    "settings.helpEntry.aria",
    "settings.helpEntry.description",
    "settings.recovery.aria",
    "settings.recovery.diagnosticsAria",
    "settings.recovery.description",
    "settings.footer.nativeHost",
  ]) {
    assert.ok(runtimeSource.includes(`"${key}"`), `missing ${key}`);
  }
  assert.match(runtimeSource, /runtime\?\.executablePath/u);
  assert.match(runtimeSource, /diagnostics\.checks\.map/u);
  assert.match(runtimeSource, /\{check\.label\}/u);
  assert.match(runtimeSource, /\{check\.detail\}/u);
  assert.match(runtimeSource, /\{error\}/u);
});

test("Runtime settings expose one keyboard-navigable master-detail section at a time", () => {
  assert.match(runtimeSource, /className="runtime-settings-workspace"/u);
  assert.match(runtimeSource, /id="runtime-settings-detail"/u);
  assert.match(runtimeSource, /aria-labelledby=\{`settings-nav-\$\{activeSection\}`\}/u);
  assert.match(runtimeSource, /activeSection === "settings-general"/u);
  assert.match(runtimeSource, /activeSection === "settings-graph"/u);
  assert.match(runtimeSource, /activeSection === "settings-recovery"/u);
  assert.match(runtimeSource, /handleSettingsNavigationKeyDown/u);
  assert.doesNotMatch(runtimeSource, /scrollIntoView/u);
  assert.doesNotMatch(runtimeSource, /handleSettingsScroll/u);
});

test("Native integration localizes chrome without translating Host topology or errors", () => {
  assert.match(integrationSource, /const \{ t \} = useLanguage\(\)/u);
  for (const key of [
    "settings.integration.aria",
    "settings.integration.notifications.title",
    "settings.integration.notifications.requestAccess",
    "settings.integration.displays.title",
    "settings.integration.displays.count",
  ]) {
    assert.ok(integrationSource.includes(`"${key}"`), `missing ${key}`);
  }
  assert.match(integrationSource, /notifications\.reason/u);
  assert.match(integrationSource, /notifications\.accessStatus/u);
  assert.match(integrationSource, /displays\.desktopSurfacePolicy/u);
  assert.match(integrationSource, /monitor\.deviceName/u);
  assert.match(integrationSource, /\{displays\.error\}/u);
  assert.match(integrationSource, /message: nextError\.message/u);
});

test("Taskbar settings localize options, telemetry, feedback, and transition toasts", () => {
  assert.match(taskbarSource, /const \{ t \} = useLanguage\(\)/u);
  assert.match(source, /labelKey: "settings\.taskbar\.option\.native\.label"/u);
  assert.match(taskbarSource, /t\(option\.labelKey\)/u);
  assert.match(taskbarSource, /settings\.taskbar\.toast\.previewSaved/u);
  assert.match(taskbarSource, /toast\.kind === "preview-saved"/u);
  assert.match(taskbarSource, /mode: toast\.mode/u);
  assert.match(taskbarSource, /settings\.taskbar\.state\.notInspected/u);
  assert.match(taskbarSource, /reason: state\.transitionReason/u);
  assert.match(taskbarSource, /\{state\.fallbackReason\}/u);
  assert.match(taskbarSource, /state\.error\.message/u);
  assert.doesNotMatch(taskbarSource, />任务栏接管模式</u);
});

test("Window appearance localizes controls and known reasons while preserving process data", () => {
  assert.match(windowsSource, /const \{ t \} = useLanguage\(\)/u);
  assert.match(source, /labelKey: "settings\.windows\.appearance\.option\.off\.label"/u);
  assert.match(source, /const windowCompatibilityReasonKeys/u);
  for (const key of [
    "settings.windows.appearance.title",
    "settings.windows.guards.aria",
    "settings.windows.rules.invalidProcess",
    "settings.windows.rules.removeAria",
    "settings.windows.compatibility.title",
    "settings.windows.safety.native",
    "settings.windows.feedback.fallback",
  ]) {
    assert.ok(windowsSource.includes(`"${key}"`), `missing ${key}`);
  }
  assert.match(windowsSource, /\{rule\.processName\}\.exe/u);
  assert.match(windowsSource, /\{entry\.processName\}\.exe/u);
  assert.match(windowsSource, /reason: appearance\.fallbackReason/u);
  assert.match(windowsSource, /\{appearance\.error\}/u);
  assert.match(windowsSource, /placeholder="notepad\.exe"/u);
  assert.doesNotMatch(windowsSource, />EVENTS NOT INSPECTED</u);
});

test("every dynamic settings option, reason, and state key exists in both catalogs", () => {
  for (const key of dynamicSettingsKeys) {
    assert.ok(source.includes(`"${key}"`), `unused dynamic key ${key}`);
    for (const language of ["en-US", "zh-CN"]) {
      assert.ok(
        Object.hasOwn(TRANSLATION_DICTIONARIES[language], key),
        `${language} is missing ${key}`,
      );
    }
  }
});
