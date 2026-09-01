import { resolveLanguagePreference } from "./language-system.js";

function toValidDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatValidDate(date, locale, options) {
  return new Intl.DateTimeFormat(locale, options).format(date);
}

export function formatDate(value, language, options = {}) {
  const date = toValidDate(value);
  if (!date) return "—";
  return formatValidDate(date, resolveLanguagePreference(language), {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...options,
  });
}

export function formatTime(value, language, options = {}) {
  const date = toValidDate(value);
  if (!date) return "—";
  return formatValidDate(date, resolveLanguagePreference(language), {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...options,
  });
}

export function formatDateTime(value, language, options = {}) {
  const date = toValidDate(value);
  if (!date) return "—";
  return formatValidDate(date, resolveLanguagePreference(language), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...options,
  });
}

export function formatClockPresentation(value, language) {
  const date = toValidDate(value);
  if (!date) return Object.freeze({ time: "—", shortDate: "—", longDate: "—" });
  const locale = resolveLanguagePreference(language);
  return Object.freeze({
    time: formatValidDate(date, locale, {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }),
    shortDate: formatValidDate(date, locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }),
    longDate: formatValidDate(date, locale, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  });
}

export function getCalendarWeekdayLabels(language) {
  const locale = resolveLanguagePreference(language);
  const formatter = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const monday = new Date(2024, 0, 1, 12);
  return Object.freeze(Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return formatter.format(date).toLocaleUpperCase(locale);
  }));
}
