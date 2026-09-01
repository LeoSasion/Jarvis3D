import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { helpCenterSections } from "../src/help-center-model.js";
import { TRANSLATION_DICTIONARIES } from "../src/i18n/translations.js";

const shellPanelsSource = await readFile(
  new URL("../src/components/ShellPanels.jsx", import.meta.url),
  "utf8",
);

function getSourceBetween(startMarker, endMarker) {
  const start = shellPanelsSource.indexOf(startMarker);
  const end = shellPanelsSource.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${startMarker} must remain inspectable`);
  return shellPanelsSource.slice(start, end);
}

const sessionSource = getSourceBetween(
  "function localizeSessionAction",
  "function HelpCenterPanel",
);
const helpSource = getSourceBetween(
  "function localizeHelpSections",
  "const runtimeSettingsSections",
);

test("Session controls localize fixed actions and confirmation chrome", () => {
  assert.match(sessionSource, /const \{ t \} = useLanguage\(\)/u);
  assert.match(sessionSource, /SESSION_ACTION_TRANSLATION_IDS\[action\.id\]/u);
  assert.match(sessionSource, /session\.accessibility\.dialog/u);
  assert.match(sessionSource, /session\.status\.windowsReady/u);
  assert.match(sessionSource, /session\.actions\.accessibility\.label/u);
  assert.match(sessionSource, /session\.action\.badge\.safeExit/u);
  assert.match(sessionSource, /session\.confirmation\.singleUseCapability/u);
  assert.match(sessionSource, /session\.confirmation\.confirmAction/u);
  assert.match(sessionSource, /session\.footer\.restoreWindows/u);
  assert.match(sessionSource, /shortcut: "CTRL\+SHIFT\+Q"/u);
  assert.match(sessionSource, /setError\(nextError\.message\)/u);
  assert.match(sessionSource, /onToast\(result\.message \?\?/u);
  assert.doesNotMatch(sessionSource, /aria-label="Session controls"/u);
  assert.doesNotMatch(sessionSource, />CANCEL</u);
});

test("Help localizes searchable guidance while preserving commands and user input", () => {
  assert.match(helpSource, /const \{ t \} = useLanguage\(\)/u);
  assert.match(helpSource, /help\.section\.\$\{section\.id\}\.label/u);
  assert.match(helpSource, /help\.section\.\$\{section\.id\}\.entry\.\$\{index\}\.detail/u);
  assert.match(helpSource, /filterLocalizedHelpSections\(localizedSections, query\)/u);
  assert.match(helpSource, /help\.accessibility\.dialog/u);
  assert.match(helpSource, /data-smoke-id="help-center"/u);
  assert.match(helpSource, /help\.search\.placeholder/u);
  assert.match(helpSource, /help\.categories\.accessibility\.label/u);
  assert.match(helpSource, /help\.empty\.search/u);
  assert.match(helpSource, /help\.footer\.recovery/u);
  assert.match(helpSource, /help\.action\.sessionControl/u);
  assert.match(helpSource, /<dt>\{entry\.command\}<\/dt>/u);
  assert.match(helpSource, /value=\{query\}/u);
  assert.doesNotMatch(helpSource, /placeholder="Search tasks/u);
  assert.doesNotMatch(helpSource, /No help entry matches/u);
});

test("dynamic Session and Help keys exist in both language catalogs", () => {
  const sessionKeys = [
    "session.status.windowsReady",
    "session.status.recoveryOnly",
    "session.status.checking",
    "session.status.guarded",
    "session.status.limited",
    "session.action.badge.safeExit",
    "session.action.badge.system",
    "session.action.badge.session",
    ...["exitJarvis", "lock", "signOut", "restart", "shutDown"]
      .flatMap((action) => ["label", "detail", "consequence"]
        .map((field) => `session.action.${action}.${field}`)),
  ];
  const helpKeys = helpCenterSections.flatMap((section) => [
    `help.section.${section.id}.label`,
    `help.section.${section.id}.title`,
    `help.section.${section.id}.summary`,
    ...section.entries.map((entry, index) => (
      `help.section.${section.id}.entry.${index}.detail`
    )),
  ]);

  for (const language of ["en-US", "zh-CN"]) {
    const dictionary = TRANSLATION_DICTIONARIES[language];
    const missing = [...sessionKeys, ...helpKeys]
      .filter((key) => !Object.hasOwn(dictionary, key));
    assert.deepEqual(missing, [], `${language} must include every generated key`);
  }
});
