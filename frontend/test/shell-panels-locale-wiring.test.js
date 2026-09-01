import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shellPanelsSource = await readFile(
  new URL("../src/components/ShellPanels.jsx", import.meta.url),
  "utf8",
);

function getFunctionSource(name, nextName) {
  const start = shellPanelsSource.indexOf(`function ${name}`);
  const end = shellPanelsSource.indexOf(`function ${nextName}`, start);
  assert.ok(start >= 0 && end > start, `${name} must remain inspectable`);
  return shellPanelsSource.slice(start, end);
}

const quickSettingsSource = getFunctionSource(
  "QuickSettingsPanel",
  "NotificationsPanel",
);
const dateTimeSource = getFunctionSource("DateTimePanel", "SessionControlPanel");

test("Quick Settings localizes product copy while preserving platform data", () => {
  assert.match(quickSettingsSource, /const \{ t \} = useLanguage\(\)/u);
  assert.match(quickSettingsSource, /quickSettings\.accessibility\.dialog/u);
  assert.match(quickSettingsSource, /quickSettings\.header\.title/u);
  assert.match(quickSettingsSource, /quickSettings\.header\.eyebrow/u);
  assert.match(quickSettingsSource, /quickSettings\.network\.online/u);
  assert.match(quickSettingsSource, /quickSettings\.power\.batteryCharging/u);
  assert.match(quickSettingsSource, /quickSettings\.audio\.outputVolume/u);
  assert.match(quickSettingsSource, /quickSettings\.audio\.volumePercent/u);
  assert.match(quickSettingsSource, /quickSettings\.audio\.action\.mute/u);
  assert.match(quickSettingsSource, /quickSettings\.audio\.action\.unmute/u);
  assert.match(quickSettingsSource, /quickSettings\.control\.\$\{id\}/u);
  assert.match(quickSettingsSource, /quickSettings\.action\.openControl/u);
  assert.match(quickSettingsSource, /quickSettings\.sessionUptime/u);
  assert.match(quickSettingsSource, /network\.interfaceName/u);
  assert.match(quickSettingsSource, /network\.interfaceType/u);
  assert.match(quickSettingsSource, /audio\.deviceLabel/u);
  assert.match(quickSettingsSource, /formatUptime\(system\.status\.uptimeSeconds\)/u);
  assert.doesNotMatch(quickSettingsSource, /aria-label="Quick settings"/u);
});

test("Date & Time derives every calendar presentation from the resolved language", () => {
  assert.match(shellPanelsSource, /formatClockPresentation,/u);
  assert.match(shellPanelsSource, /formatDate,/u);
  assert.match(shellPanelsSource, /formatTime,/u);
  assert.match(shellPanelsSource, /getCalendarWeekdayLabels,/u);
  assert.match(dateTimeSource, /const \{ language, t \} = useLanguage\(\)/u);
  assert.match(
    dateTimeSource,
    /formatClockPresentation\(clock\.dateTime, language\)/u,
  );
  assert.match(dateTimeSource, /locale: language/u);
  assert.match(dateTimeSource, /getCalendarWeekdayLabels\(language\)/u);
  assert.match(dateTimeSource, /formatDate\(selectedDate, language/u);
  assert.match(dateTimeSource, /formatTime\(item\.timestamp, language\)/u);
  assert.match(dateTimeSource, /dateTime\.calendar\.cellEvent\.one/u);
  assert.match(dateTimeSource, /dateTime\.calendar\.cellEvent\.other/u);
  assert.match(dateTimeSource, /dateTime\.agenda\.empty\.title/u);
  assert.match(dateTimeSource, /dateTime\.action\.openWindowsSettings/u);
  assert.doesNotMatch(dateTimeSource, /CALENDAR_WEEKDAYS/u);
  assert.doesNotMatch(dateTimeSource, /toLocaleDateString\("en-US"/u);
  assert.doesNotMatch(dateTimeSource, /clock\.longDate/u);
  assert.doesNotMatch(dateTimeSource, /toLocaleTimeString/u);
});
