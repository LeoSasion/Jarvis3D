import assert from "node:assert/strict";
import test from "node:test";
import {
  formatClockPresentation,
  formatDate,
  formatDateTime,
  formatTime,
  getCalendarWeekdayLabels,
} from "../src/i18n/locale-format.js";

const timestamp = new Date(2026, 6, 20, 22, 47, 0);

test("clock presentation follows Chinese and English interface formats", () => {
  const chinese = formatClockPresentation(timestamp, "zh-CN");
  const english = formatClockPresentation(timestamp, "en-US");

  assert.equal(chinese.time, "22:47");
  assert.equal(english.time, "22:47");
  assert.equal(chinese.time, formatTime(timestamp, "zh-CN"));
  assert.equal(english.time, formatTime(timestamp, "en-US"));
  assert.match(chinese.longDate, /2026/u);
  assert.match(chinese.longDate, /星期|周/u);
  assert.match(english.longDate, /Monday/u);
  assert.notEqual(chinese.shortDate, english.shortDate);
});

test("date helpers fail closed and use the requested language", () => {
  assert.equal(formatDate("invalid", "zh-CN"), "—");
  assert.equal(formatTime("invalid", "en-US"), "—");
  assert.equal(formatDateTime("invalid", "zh-CN"), "—");
  assert.match(formatDate(timestamp, "zh-CN", { month: "long" }), /7/u);
  assert.match(formatDateTime(timestamp, "en-US"), /2026/u);
});

test("calendar weekday labels remain Monday-first in both languages", () => {
  const chinese = getCalendarWeekdayLabels("zh-CN");
  const english = getCalendarWeekdayLabels("en-US");

  assert.equal(chinese.length, 7);
  assert.equal(english.length, 7);
  assert.match(chinese[0], /一/u);
  assert.match(english[0], /MON/u);
});
