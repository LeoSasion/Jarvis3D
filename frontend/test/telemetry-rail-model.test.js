import assert from "node:assert/strict";
import test from "node:test";
import {
  getCompactTelemetrySummary,
  getTelemetryPriorityPresentation,
  getTelemetryRailMode,
} from "../src/telemetry-rail-model.js";

test("compact telemetry is reserved for a truthful nominal state", () => {
  const nominal = getTelemetryPriorityPresentation({ events: [] });
  assert.equal(nominal.kind, "nominal");
  assert.equal(getTelemetryRailMode({ compact: true, priorityKind: nominal.kind }), "compact-nominal");

  for (const state of [
    getTelemetryPriorityPresentation({ feedLoading: true }),
    getTelemetryPriorityPresentation({ feedError: new Error("offline") }),
    getTelemetryPriorityPresentation({ events: [{ severity: "warning", title: "Check" }] }),
    getTelemetryPriorityPresentation({ events: [{ severity: "error", title: "Failed" }] }),
  ]) {
    assert.equal(getTelemetryRailMode({ compact: true, priorityKind: state.kind }), "full");
  }
});

test("loading and disconnected feeds stay non-nominal even with cached events", () => {
  const cachedEvents = [{ severity: "ok", title: "Previous snapshot" }];
  const connecting = getTelemetryPriorityPresentation({
    events: cachedEvents,
    feedLoading: true,
  });
  assert.equal(connecting.kind, "connecting");
  assert.equal(connecting.cachedEventCount, 1);
  assert.equal(Object.hasOwn(connecting, "title"), false);
  assert.equal(Object.hasOwn(connecting, "detail"), false);

  const disconnected = getTelemetryPriorityPresentation({
    events: cachedEvents,
    feedError: "bridge offline",
  });
  assert.equal(disconnected.kind, "warning");
  assert.equal(disconnected.meta, "bridge offline");
  assert.equal(Object.hasOwn(disconnected, "title"), false);
});

test("compact telemetry exposes CPU and memory in its accessible summary", () => {
  const summary = getCompactTelemetrySummary([
    { id: "cpu", value: "18%" },
    { id: "memory", value: "42%" },
  ]);
  assert.equal(summary.cpu, "18%");
  assert.equal(summary.memory, "42%");
  assert.equal(Object.hasOwn(summary, "label"), false);
});
