const HELP_SECTIONS = [
  {
    id: "start",
    entries: [
      { command: "CTRL SPACE" },
      { command: "START" },
      { command: "DESKTOP" },
    ],
  },
  {
    id: "files",
    entries: [
      { command: "ENTER / F2 / F5" },
      { command: "CTRL C / X / V" },
      { command: "CTRL SHIFT N" },
      { command: "ALT ENTER / DELETE" },
    ],
  },
  {
    id: "linked",
    entries: [
      { command: "ALT F8" },
      { command: "CTRL ALT ← / →" },
      { command: "METADATA ONLY" },
    ],
  },
  {
    id: "windows",
    entries: [
      { command: "ALT F4" },
      { command: "ALT F9 / F10" },
      { command: "CTRL SHIFT Q" },
    ],
  },
  {
    id: "recovery",
    entries: [
      { command: "SESSION CONTROL" },
      { command: "RECOVERY CHECK" },
    ],
  },
];

export const helpCenterSections = Object.freeze(HELP_SECTIONS.map((section) => Object.freeze({
  ...section,
  entries: Object.freeze(section.entries.map((entry) => Object.freeze(entry))),
})));
