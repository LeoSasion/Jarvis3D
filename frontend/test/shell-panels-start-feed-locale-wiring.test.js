import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

const startSource = getSourceBetween(
  "function getApplicationSourceLabel",
  "function QuickSettingsPanel",
);
const notificationsSource = getSourceBetween(
  "function NotificationsPanel",
  "function DateTimePanel",
);

test("Start localizes menu chrome without translating app, window, or query data", () => {
  assert.match(startSource, /const \{ language, t \} = useLanguage\(\)/u);
  assert.match(startSource, /start\.accessibility\.dialog/u);
  assert.match(startSource, /start\.header\.title/u);
  assert.match(startSource, /start\.search\.placeholder/u);
  assert.match(startSource, /start\.view\.accessibility\.label/u);
  assert.match(startSource, /start\.catalog\.indexed/u);
  assert.match(startSource, /start\.action\.pinApplication/u);
  assert.match(startSource, /start\.action\.unpinApplication/u);
  assert.match(startSource, /start\.applicationCategory\.pinned/u);
  assert.match(startSource, /start\.empty\.noMatches/u);
  assert.match(startSource, /start\.count\.window\.one/u);
  assert.match(startSource, /start\.count\.window\.other/u);
  assert.match(startSource, /start\.footer\.sessionControls/u);
  assert.match(startSource, /formatFeedTime\(applicationCatalog\.indexedAtUtc, language\)/u);
  assert.match(startSource, /<strong>\{application\.label\}<\/strong>/u);
  assert.match(startSource, /selected\.title \|\| group\.process/u);
  assert.match(startSource, /value=\{query\}/u);
  assert.match(startSource, /application\.category/u);
  assert.match(startSource, /system\.status\.machineName/u);
  assert.doesNotMatch(startSource, /aria-label="JARVIS Start"/u);
  assert.doesNotMatch(startSource, /placeholder="Search all apps/u);
});

test("System Feed localizes controls while preserving feed and Host payloads", () => {
  assert.match(
    notificationsSource,
    /const \{ language, t \} = useLanguage\(\)/u,
  );
  assert.match(notificationsSource, /notifications\.accessibility\.dialog/u);
  assert.match(notificationsSource, /notifications\.history\.available/u);
  assert.match(notificationsSource, /notifications\.filter\.\$\{id\}/u);
  assert.match(notificationsSource, /notifications\.search\.placeholder/u);
  assert.match(notificationsSource, /notifications\.summary\.filtered/u);
  assert.match(notificationsSource, /feedSummary\.total === 1 \? "one" : "other"/u);
  assert.match(notificationsSource, /notifications\.footer\.visibleUnread\.\$\{/u);
  assert.match(notificationsSource, /notifications\.empty\.filter/u);
  assert.match(notificationsSource, /notifications\.action\.markAllRead/u);
  assert.match(notificationsSource, /formatFeedTime\(item\.timestamp, language\)/u);
  assert.match(notificationsSource, /<strong>\{item\.title\}<\/strong>/u);
  assert.match(notificationsSource, /<small>\{item\.detail\}<\/small>/u);
  assert.match(notificationsSource, /notificationHistory\.reason/u);
  assert.match(notificationsSource, /notificationHistory\.accessStatus/u);
  assert.match(notificationsSource, /\{feed\.error\}/u);
  assert.match(notificationsSource, /value=\{feedQuery\}/u);
  assert.match(notificationsSource, /aria-keyshortcuts=\{`Control\+\$\{index \+ 1\}`\}/u);
  assert.match(notificationsSource, /title=\{`Ctrl\+\$\{index \+ 1\}`\}/u);
  assert.doesNotMatch(notificationsSource, /aria-label="JARVIS system feed"/u);
  assert.doesNotMatch(notificationsSource, />MARK ALL READ</u);
});
