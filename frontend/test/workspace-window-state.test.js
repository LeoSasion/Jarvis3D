import assert from "node:assert/strict";
import test from "node:test";
import {
  WORKSPACE_LAYOUT_VERSION,
  constrainWindowBounds,
  createWorkspaceWindowState,
  getDefaultWindowBounds,
  getWorkspaceTaskbarWindows,
  moveWorkspaceWindowBounds,
  serializeWorkspaceLayout,
  workspaceWindowReducer,
} from "../src/workspace-window-state.js";

const viewport = {
  width: 1920,
  height: 1080,
  top: 78,
  right: 12,
  bottom: 86,
  left: 12,
};

function reduce(state, type, id, extra = {}) {
  return workspaceWindowReducer(state, { type, id, ...extra });
}

test("opening windows activates them and advances the shared z-order", () => {
  let state = createWorkspaceWindowState(viewport);
  state = reduce(state, "OPEN", "explorer");
  const explorerZ = state.windows.explorer.zIndex;
  state = reduce(state, "OPEN", "terminal");

  assert.equal(state.activeId, "terminal");
  assert.equal(state.windows.terminal.open, true);
  assert.ok(state.windows.terminal.zIndex > explorerZ);

  state = reduce(state, "ACTIVATE", "explorer");
  assert.equal(state.activeId, "explorer");
  assert.ok(state.windows.explorer.zIndex > state.windows.terminal.zIndex);
});

test("minimizing or closing the active window activates the highest visible window", () => {
  let state = createWorkspaceWindowState(viewport);
  state = reduce(state, "OPEN", "explorer");
  state = reduce(state, "OPEN", "terminal");
  state = reduce(state, "OPEN", "inspector");

  state = reduce(state, "MINIMIZE", "inspector");
  assert.equal(state.activeId, "terminal");
  assert.equal(state.windows.inspector.open, true);
  assert.equal(state.windows.inspector.minimized, true);

  state = reduce(state, "CLOSE", "terminal");
  assert.equal(state.activeId, "explorer");
  assert.equal(state.windows.terminal.open, false);
});

test("taskbar toggle follows Windows restore and minimize behavior", () => {
  let state = createWorkspaceWindowState(viewport);
  state = reduce(state, "TASKBAR_TOGGLE", "explorer");
  assert.equal(state.windows.explorer.open, true);
  assert.equal(state.windows.explorer.minimized, false);

  state = reduce(state, "TASKBAR_TOGGLE", "explorer");
  assert.equal(state.windows.explorer.minimized, true);
  assert.equal(state.activeId, null);

  state = reduce(state, "TASKBAR_TOGGLE", "explorer");
  assert.equal(state.windows.explorer.minimized, false);
  assert.equal(state.activeId, "explorer");
});

test("maximize preserves a restorable bound and reflow constrains both layouts", () => {
  let state = createWorkspaceWindowState(viewport);
  state = reduce(state, "OPEN", "terminal");
  const original = state.windows.terminal.bounds;
  state = reduce(state, "TOGGLE_MAXIMIZE", "terminal");

  assert.equal(state.windows.terminal.maximized, true);
  assert.deepEqual(state.windows.terminal.restoreBounds, original);

  state = workspaceWindowReducer(state, {
    type: "REFLOW",
    viewport: { ...viewport, width: 1366, height: 768 },
  });
  state = reduce(state, "TOGGLE_MAXIMIZE", "terminal");

  assert.equal(state.windows.terminal.maximized, false);
  assert.ok(state.windows.terminal.bounds.x >= 12);
  assert.ok(state.windows.terminal.bounds.y >= 78);
  assert.ok(state.windows.terminal.bounds.x + state.windows.terminal.bounds.width <= 1354);
  assert.ok(state.windows.terminal.bounds.y + state.windows.terminal.bounds.height <= 682);
});

test("bounds reject non-finite and off-screen persisted values", () => {
  const bounds = constrainWindowBounds("inspector", {
    x: -99999,
    y: Number.NaN,
    width: Number.POSITIVE_INFINITY,
    height: 10,
  }, viewport);

  assert.equal(bounds.x, 12);
  assert.ok(bounds.y >= 78);
  assert.ok(bounds.width >= 600);
  assert.ok(bounds.height >= 420);
  assert.ok(bounds.x + bounds.width <= 1908);
});

test("keyboard movement remains inside the current viewport and layout reset persists defaults", () => {
  let state = createWorkspaceWindowState(viewport);
  state = reduce(state, "OPEN", "agent");
  const original = state.windows.agent.bounds;
  state = reduce(state, "COMMIT_BOUNDS", "agent", {
    bounds: moveWorkspaceWindowBounds("agent", original, 32, -12, viewport),
  });
  assert.notDeepEqual(state.windows.agent.bounds, original);
  state = reduce(state, "TOGGLE_MAXIMIZE", "agent");
  state = reduce(state, "RESET_LAYOUT");

  assert.equal(state.windows.agent.open, true);
  assert.equal(state.activeId, "agent");
  assert.equal(state.windows.agent.maximized, false);
  assert.equal(state.windows.agent.restoreBounds, null);
  assert.deepEqual(state.windows.agent.bounds, getDefaultWindowBounds("agent", viewport));
  assert.deepEqual(serializeWorkspaceLayout(state).windows.agent.bounds, original);

  const clipped = moveWorkspaceWindowBounds("agent", original, -100000, 100000, viewport);
  assert.equal(clipped.x, viewport.left);
  assert.equal(clipped.y + clipped.height, viewport.height - viewport.bottom);
});

test("knowledge handoff keeps the source panel visible without moving a custom Agent layout", () => {
  const sourceViewport = { width: 1280, height: 720, top: 48, right: 0, bottom: 56, left: 0 };
  let state = createWorkspaceWindowState(sourceViewport);
  state = reduce(state, "OPEN_FROM_KNOWLEDGE");
  const placed = state.windows.agent.bounds;
  assert.equal(state.activeId, "agent");
  assert.ok(placed.x >= 24 + 330 + 24);
  assert.ok(placed.x + placed.width <= sourceViewport.width - 24);

  state = reduce(state, "REFLOW", "agent", { viewport: { ...sourceViewport, width: 980 } });
  state = reduce(state, "REFLOW", "agent", { viewport: sourceViewport });
  assert.deepEqual(state.windows.agent.bounds, placed);
  assert.equal(serializeWorkspaceLayout(state).windows.agent.autoPlacement, "knowledge");
  const restored = createWorkspaceWindowState(sourceViewport, serializeWorkspaceLayout(state));
  assert.equal(restored.windows.agent.knowledgePlaced, true);

  const narrow = { ...sourceViewport, width: 980 };
  const tall = { ...sourceViewport, width: 1324, height: 1244 };
  state = reduce(state, "REFLOW", "agent", { viewport: tall });
  const tallBounds = state.windows.agent.bounds;
  state = reduce(state, "REFLOW", "agent", { viewport: narrow });
  state = reduce(state, "REFLOW", "agent", { viewport: tall });
  assert.deepEqual(state.windows.agent.bounds, tallBounds);
  state = reduce(state, "REFLOW", "agent", { viewport: sourceViewport });

  state = reduce(state, "CLOSE", "agent");
  state = reduce(state, "OPEN_FROM_KNOWLEDGE");
  assert.deepEqual(state.windows.agent.bounds, placed);

  const custom = { ...placed, x: 420 };
  state = reduce(state, "COMMIT_BOUNDS", "agent", { bounds: custom });
  state = reduce(state, "OPEN_FROM_KNOWLEDGE");
  assert.deepEqual(state.windows.agent.bounds, custom);
  assert.equal("autoPlacement" in serializeWorkspaceLayout(state).windows.agent, false);

  const narrowState = reduce(createWorkspaceWindowState(narrow), "OPEN_FROM_KNOWLEDGE");
  assert.deepEqual(narrowState.windows.agent.bounds, getDefaultWindowBounds("agent", narrow));
});

test("ordinary viewport reflow does not place Agent beside Knowledge", () => {
  const sourceViewport = { width: 1280, height: 720, top: 48, right: 0, bottom: 56, left: 0 };
  let state = createWorkspaceWindowState(sourceViewport);
  state = reduce(state, "OPEN", "agent");
  const original = state.windows.agent.bounds;

  state = reduce(state, "REFLOW", "agent", { viewport: sourceViewport });
  assert.deepEqual(state.windows.agent.bounds, original);
  assert.equal(state.windows.agent.knowledgePlaced, false);

  state = reduce(state, "REFLOW", "agent", { viewport: { ...sourceViewport, width: 1360 } });
  state = reduce(state, "REFLOW", "agent", { viewport: sourceViewport });
  assert.deepEqual(state.windows.agent.bounds, original);
  assert.equal("autoPlacement" in serializeWorkspaceLayout(state).windows.agent, false);

  state = reduce(state, "REFLOW", "agent", { viewport: { ...sourceViewport, width: 980 } });
  assert.equal(state.windows.agent.bounds.x, 238);
  assert.equal(state.windows.agent.knowledgePlaced, false);
});

test("layout persistence excludes open state and rejects stale versions", () => {
  let state = createWorkspaceWindowState(viewport);
  state = reduce(state, "OPEN", "explorer");
  state = reduce(state, "TOGGLE_MAXIMIZE", "explorer");
  const serialized = serializeWorkspaceLayout(state);

  assert.equal(serialized.version, WORKSPACE_LAYOUT_VERSION);
  assert.equal("open" in serialized.windows.explorer, false);
  assert.equal("minimized" in serialized.windows.explorer, false);

  const restored = createWorkspaceWindowState(viewport, serialized);
  assert.equal(restored.windows.explorer.open, false);
  assert.equal(restored.windows.explorer.maximized, true);

  const stale = createWorkspaceWindowState(viewport, {
    ...serialized,
    version: WORKSPACE_LAYOUT_VERSION + 1,
    windows: {
      explorer: {
        bounds: { x: 9999, y: 9999, width: 1, height: 1 },
        maximized: true,
      },
    },
  });
  assert.equal(stale.windows.explorer.maximized, false);
});

test("taskbar snapshots expose only open internal windows", () => {
  let state = createWorkspaceWindowState(viewport);
  state = reduce(state, "OPEN", "explorer");
  state = reduce(state, "OPEN", "inspector");
  state = reduce(state, "MINIMIZE", "inspector");
  const windows = getWorkspaceTaskbarWindows(state);

  assert.deepEqual(windows.map((windowState) => windowState.internalWindowId), [
    "explorer",
    "inspector",
  ]);
  assert.equal(windows[0].active, true);
  assert.equal(windows[1].minimized, true);
});
