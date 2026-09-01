import assert from "node:assert/strict";
import test from "node:test";
import {
  createLinkedSystemRailState,
  getLinkedAgentStatusPresentation,
  getLinkedSystemRailPresentation,
  getNewLinkedSystemRailAttention,
  isLinkedAgentAttention,
  setLinkedSystemRailExpanded,
  syncLinkedSystemRailState,
} from "../src/linked-system-rail-model.js";

test("nominal linked system rail starts collapsed without inventing attention", () => {
  const presentation = getLinkedSystemRailPresentation({
    feed: { items: [], unreadCount: 3 },
    agentState: { status: "idle" },
  });

  assert.equal(presentation.level, "nominal");
  assert.equal(presentation.attentionCount, 0);
  assert.equal(presentation.priorityTitle, null);
  assert.equal(presentation.priorityTitleKey, "linkedSystem.priority.nominal");
  assert.equal(createLinkedSystemRailState(presentation).expanded, false);
});

test("warning and error events produce stable truthful attention keys", () => {
  const warning = { id: "network", severity: "warning", title: "Network offline", timestamp: "1" };
  const error = { id: "audio", severity: "error", title: "Audio failed", timestamp: "2" };
  const presentation = getLinkedSystemRailPresentation({ feed: { items: [warning, error] } });

  assert.equal(presentation.level, "error");
  assert.equal(presentation.attentionCount, 2);
  assert.equal(presentation.priorityItem, error);
  assert.equal(createLinkedSystemRailState(presentation).expanded, true);
  assert.deepEqual(
    getNewLinkedSystemRailAttention([presentation.attentionKeys[0]], presentation.attentionKeys),
    [presentation.attentionKeys[1]],
  );
});

test("a manually collapsed rail stays collapsed for the same event", () => {
  const presentation = getLinkedSystemRailPresentation({
    feed: { items: [{ id: "network", severity: "warning", title: "Network offline" }] },
  });
  const collapsed = setLinkedSystemRailExpanded(
    createLinkedSystemRailState(presentation),
    false,
  );

  assert.equal(collapsed.expanded, false);
  assert.equal(collapsed.lastChangeReason, "user");
  assert.deepEqual(
    getNewLinkedSystemRailAttention(
      collapsed.observedAttentionKeys,
      presentation.attentionKeys,
    ),
    [],
  );
});

test("severity escalation and a reappearing event count as new attention", () => {
  const warning = getLinkedSystemRailPresentation({
    feed: { items: [{ id: "network", severity: "warning", title: "Network offline" }] },
  });
  const error = getLinkedSystemRailPresentation({
    feed: { items: [{ id: "network", severity: "error", title: "Network offline" }] },
  });

  assert.equal(getNewLinkedSystemRailAttention(warning.attentionKeys, error.attentionKeys).length, 1);
  assert.equal(getNewLinkedSystemRailAttention([], warning.attentionKeys).length, 1);
  const collapsedWarning = setLinkedSystemRailExpanded(
    createLinkedSystemRailState(warning),
    false,
  );
  const escalated = syncLinkedSystemRailState(collapsedWarning, error);
  assert.equal(escalated.expanded, true);
  assert.equal(escalated.lastChangeReason, "new-attention");
});

test("reported feed and agent failures are surfaced without synthetic telemetry values", () => {
  const presentation = getLinkedSystemRailPresentation({
    feed: { items: [], error: new Error("bridge offline") },
    agentState: {
      status: "error",
      error: { code: "PROVIDER_EXITED", message: "provider exited" },
    },
  });

  assert.equal(presentation.level, "error");
  assert.equal(presentation.attentionCount, 2);
  assert.match(presentation.priorityDetail, /bridge offline/u);
  assert.doesNotMatch(presentation.attentionKeys.join("\n"), /\[object Object\]/u);

  const agentOnly = getLinkedSystemRailPresentation({
    agentState: {
      status: "error",
      error: { code: "PROVIDER_EXITED", message: "provider exited" },
    },
  });
  assert.equal(agentOnly.priorityDetail, "provider exited");
});

test("agent health failures stay attention even when runtime status says ready", () => {
  const unhealthyStates = [
    { status: "ready", error: { message: "provider handshake failed" } },
    { status: "ready", health: { status: "degraded", healthy: true } },
    { status: "ready", health: { status: "unavailable", healthy: true } },
    { status: "ready", health: { status: "ready", healthy: false } },
  ];

  for (const agentState of unhealthyStates) {
    assert.equal(isLinkedAgentAttention(agentState), true);
    const presentation = getLinkedSystemRailPresentation({ agentState });
    assert.equal(presentation.level, "error");
    assert.equal(presentation.attentionCount, 1);
    assert.equal(presentation.priorityTitle, null);
    assert.equal(presentation.priorityTitleKey, "linkedSystem.priority.agentAttention");
  }
});

test("degraded chat providers remain retryable without claiming readiness", () => {
  const state = {
    available: true,
    connected: true,
    status: "ready",
    error: { message: "provider exited" },
    health: { status: "degraded", healthy: false },
  };

  assert.deepEqual(getLinkedAgentStatusPresentation(state, true), {
    hasAttention: true,
    agentLabel: "ATTENTION",
    commandBusLabel: "RETRY",
    dataAccessLabel: "DEGRADED",
  });
  assert.deepEqual(getLinkedAgentStatusPresentation(state, false), {
    hasAttention: true,
    agentLabel: "ATTENTION",
    commandBusLabel: "DEGRADED",
    dataAccessLabel: "DEGRADED",
  });
});

test("healthy agent status presentation keeps normal operational labels", () => {
  assert.deepEqual(getLinkedAgentStatusPresentation({
    available: true,
    connected: true,
    status: "ready",
    health: { status: "connected", healthy: true },
  }, true), {
    hasAttention: false,
    agentLabel: "CONNECTED",
    commandBusLabel: "READY",
    dataAccessLabel: "CHAT ONLY",
  });
});
