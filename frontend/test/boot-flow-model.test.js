import assert from "node:assert/strict";
import test from "node:test";
import { getDegradedBootCheckIds } from "../src/boot-checks.js";
import { shouldRememberFirstRunGuide, shouldShowFirstRunGuide } from "../src/boot-flow-model.js";

test("preview checks never claim a native failure while native failures remain traceable", () => {
  const checks = [
    { id: "runtime", validate: (value) => Boolean(value?.ready) },
    { id: "terminal", validate: (value) => Boolean(value?.ready) },
  ];
  const results = [
    { status: "fulfilled", value: { ready: false } },
    { status: "rejected", reason: new Error("ConPTY unavailable") },
  ];

  assert.deepEqual(getDegradedBootCheckIds(checks, results, false), []);
  assert.deepEqual(getDegradedBootCheckIds(checks, results, true), ["runtime", "terminal"]);
});

test("first-run guide is remembered only after the guide was actually shown", () => {
  assert.equal(shouldShowFirstRunGuide({ isNative: true, reviewOnly: false, guideSeen: false }), true);
  assert.equal(shouldShowFirstRunGuide({ isNative: false, reviewOnly: false, guideSeen: false }), false);
  assert.equal(shouldShowFirstRunGuide({ isNative: true, reviewOnly: true, guideSeen: false }), false);
  assert.equal(shouldShowFirstRunGuide({ isNative: true, reviewOnly: false, guideSeen: true }), false);
  assert.equal(shouldRememberFirstRunGuide(null), false);
  assert.equal(shouldRememberFirstRunGuide(0), true);
  assert.equal(shouldRememberFirstRunGuide(2), true);
});
