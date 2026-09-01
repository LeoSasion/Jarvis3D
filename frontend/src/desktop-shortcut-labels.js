const DESKTOP_SHORTCUT_LABEL_KEYS = Object.freeze({
  code: "desktop.shortcut.code",
  documents: "desktop.shortcut.documents",
  downloads: "desktop.shortcut.downloads",
  notes: "desktop.shortcut.notes",
  pc: "desktop.shortcut.thisPc",
  recycle: "desktop.shortcut.recycleBin",
  settings: "desktop.shortcut.settings",
  terminal: "desktop.shortcut.terminal",
});

export function getDesktopShortcutLabelKey(shortcutId) {
  return DESKTOP_SHORTCUT_LABEL_KEYS[shortcutId] ?? null;
}

export const DESKTOP_SHORTCUT_IDS = Object.freeze(
  Object.keys(DESKTOP_SHORTCUT_LABEL_KEYS),
);
