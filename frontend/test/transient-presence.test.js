import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createTransientPresence,
  reduceTransientPresence,
  shouldReduceTransientMotion,
} from "../src/transient-presence.js";

const appSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const shellPanelsSource = readFileSync(
  new URL("../src/components/ShellPanels.jsx", import.meta.url),
  "utf8",
);
const commandOverlaySource = readFileSync(
  new URL("../src/components/CommandOverlay.jsx", import.meta.url),
  "utf8",
);

test("transient presence preserves a closing surface until its transition completes", () => {
  let presence = createTransientPresence("start");
  presence = reduceTransientPresence(presence, { type: "complete", generation: 0 });
  assert.equal(presence.state, "open");

  presence = reduceTransientPresence(presence, { type: "request", value: null });
  const closingGeneration = presence.generation;
  assert.deepEqual(
    { renderedValue: presence.renderedValue, state: presence.state },
    { renderedValue: "start", state: "closing" },
  );

  presence = reduceTransientPresence(presence, {
    type: "complete",
    generation: closingGeneration,
  });
  assert.deepEqual(
    { renderedValue: presence.renderedValue, state: presence.state },
    { renderedValue: null, state: null },
  );
});

test("a stale close completion cannot clear a rapidly reopened or switched surface", () => {
  let presence = reduceTransientPresence(createTransientPresence("start"), {
    type: "complete",
    generation: 0,
  });
  presence = reduceTransientPresence(presence, { type: "request", value: null });
  const staleGeneration = presence.generation;
  presence = reduceTransientPresence(presence, { type: "request", value: "settings" });

  assert.deepEqual(
    { renderedValue: presence.renderedValue, state: presence.state },
    { renderedValue: "settings", state: "entering" },
  );
  assert.equal(
    reduceTransientPresence(presence, { type: "complete", generation: staleGeneration }),
    presence,
  );
});

test("motion policy honors explicit reduced and full preferences", () => {
  assert.equal(shouldReduceTransientMotion({ motionPreference: "reduced" }), true);
  assert.equal(shouldReduceTransientMotion({
    motionPreference: "system",
    systemPrefersReduced: true,
  }), true);
  assert.equal(shouldReduceTransientMotion({
    motionPreference: "full",
    systemPrefersReduced: true,
  }), false);
});

test("shell menus keep their click catcher while closing and disable hidden controls", () => {
  assert.match(appSource, /shellPanelPresence\.renderedValue \? \(/u);
  assert.match(appSource, /commandPresence\.renderedValue \? \(/u);
  assert.match(appSource, /useReducedMotion\(\)/u);
  assert.match(appSource, /useTransientPresence\(shellPanel, \{ reducedMotion \}\)/u);
  assert.match(shellPanelsSource, /useDialogFocusTrap\(panelRef, interactive/u);
  assert.match(shellPanelsSource, /aria-hidden=\{closing \? "true" : undefined\}/u);
  assert.match(shellPanelsSource, /inert=\{closing \? true : undefined\}/u);
  assert.match(shellPanelsSource, /event\.target === event\.currentTarget/u);
  assert.match(commandOverlaySource, /useDialogFocusTrap\(dialogRef, interactive/u);
  assert.match(commandOverlaySource, /inert=\{closing \? true : undefined\}/u);
  assert.match(commandOverlaySource, /event\.target === event\.currentTarget/u);
});
