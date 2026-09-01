import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceWindowSwitcherState,
  getVisibleWindowSwitcherEntries,
  getWindowSwitcherSelectionScrollTop,
  getWindowInitials,
  normalizeWindowSwitcherState,
  WINDOW_SWITCHER_VISIBLE_LIMIT,
} from "../src/window-switcher-model.js";

function createWindows(count) {
  return Array.from({ length: count }, (_, index) => ({
    WindowId: `0x${index + 1}`,
    Title: `Window ${index + 1}`,
    ProcessName: `App ${index + 1}`,
    Minimized: index === 2,
  }));
}

test("normalizes host casing and wraps selected indexes", () => {
  const state = normalizeWindowSwitcherState({
    Windows: createWindows(3),
    SelectedIndex: 4,
    Reverse: true,
  });

  assert.equal(state.windows.length, 3);
  assert.equal(state.windows[2].windowId, "0x3");
  assert.equal(state.windows[2].minimized, true);
  assert.equal(state.selectedIndex, 1);
  assert.equal(state.reverse, true);
});

test("preserves stable internal window identity without localizing model titles", () => {
  const state = normalizeWindowSwitcherState({
    Windows: [{
      WindowId: "jarvis:inspector",
      InternalWindowId: "inspector",
      Title: "System Inspector",
      ProcessName: "jarvis-inspector",
    }],
  });

  assert.equal(state.windows[0].internalWindowId, "inspector");
  assert.equal(state.windows[0].title, "System Inspector");
});

test("advances in both directions with wrapping", () => {
  const initial = normalizeWindowSwitcherState({
    windows: createWindows(3),
    selectedIndex: 0,
  });

  assert.equal(advanceWindowSwitcherState(initial, false).selectedIndex, 1);
  assert.equal(advanceWindowSwitcherState(initial, true).selectedIndex, 2);
});

test("visible entries keep the selected window centered in a bounded rail", () => {
  const state = normalizeWindowSwitcherState({
    windows: createWindows(12),
    selectedIndex: 10,
  });
  const entries = getVisibleWindowSwitcherEntries(state);

  assert.equal(entries.length, WINDOW_SWITCHER_VISIBLE_LIMIT);
  assert.equal(entries.filter((entry) => entry.selected).length, 1);
  assert.equal(entries[Math.floor(entries.length / 2)].index, 10);
});

test("selected cards scroll into view inside compact native HUD heights", () => {
  const shared = {
    scrollHeight: 540,
    scrollTop: 0,
    selectedTop: 284,
    selectedHeight: 128,
  };

  assert.equal(getWindowSwitcherSelectionScrollTop({
    ...shared,
    viewportHeight: 156,
  }), 256);
  assert.equal(getWindowSwitcherSelectionScrollTop({
    ...shared,
    viewportHeight: 246,
  }), 166);
  assert.equal(getWindowSwitcherSelectionScrollTop({
    viewportHeight: 156,
    scrollHeight: 540,
    scrollTop: 256,
    selectedTop: 284,
    selectedHeight: 128,
  }), 256);
  assert.equal(getWindowSwitcherSelectionScrollTop({
    viewportHeight: 156,
    scrollHeight: 540,
    scrollTop: 256,
    selectedTop: 64,
    selectedHeight: 128,
  }), 64);
});

test("initials remain useful for one-word and multi-word process names", () => {
  assert.equal(getWindowInitials("msedge"), "MS");
  assert.equal(getWindowInitials("Visual Studio Code"), "VS");
  assert.equal(getWindowInitials(""), "UI");
});
