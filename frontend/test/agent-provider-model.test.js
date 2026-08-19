import assert from "node:assert/strict";
import test from "node:test";
import {
  getCommandBusPresentation,
  getAgentLauncherStatus,
  getAgentProviderLabel,
  hasAgentProviderFault,
} from "../src/agent-provider-model.js";

test("agent provider is secondary, bounded, and provider-neutral", () => {
  assert.equal(getAgentProviderLabel({ available: false, provider: "pi" }), "NO PROVIDER");
  assert.equal(getAgentProviderLabel({ available: true, provider: "pi" }), "PI");
  assert.equal(getAgentProviderLabel({ available: true, provider: "browser-preview" }), "PREVIEW");
  assert.equal(getAgentProviderLabel({ available: true, provider: "Claude Desktop Adapter" }), "CLAUDE DESKTOP ADAPTER");
  assert.equal(getAgentProviderLabel({
    available: true,
    provider: "pi",
    providerId: "pi",
    providerLabel: "Pi Agent Runtime",
  }), "PI AGENT RUNTIME");
  assert.equal(getAgentProviderLabel({
    available: true,
    providerId: "custom-provider",
  }), "CUSTOM-PROVIDER");
});

test("agent launcher status follows runtime and window truth", () => {
  assert.equal(getAgentLauncherStatus({ available: false }), "OFFLINE");
  assert.equal(getAgentLauncherStatus({ available: true, error: { code: "FAULT" } }), "ATTENTION");
  assert.equal(getAgentLauncherStatus({ available: true, status: "running" }), "PROCESSING");
  assert.equal(getAgentLauncherStatus({ available: true }, { active: true }), "ACTIVE");
  assert.equal(getAgentLauncherStatus({ available: true }, { open: true }), "READY");
  assert.equal(getAgentLauncherStatus({ available: true }), "OPEN");
});

test("provider health truth takes priority over ready runtime copy", () => {
  const unhealthyStates = [
    { available: true, status: "ready", error: { message: "failed" } },
    { available: true, status: "ready", health: { status: "degraded", healthy: true } },
    { available: true, status: "ready", health: { status: "unavailable", healthy: true } },
    { available: true, status: "ready", health: { status: "ready", healthy: false } },
  ];

  for (const state of unhealthyStates) {
    assert.equal(hasAgentProviderFault(state), true);
    assert.equal(getAgentLauncherStatus(state, { open: true }), "ATTENTION");
    assert.equal(getCommandBusPresentation(state).agentProviderStatus, "AGENT DEGRADED");
  }
});

test("local command readiness is independent from Agent provider state", () => {
  const offline = getCommandBusPresentation({ available: false, status: "unavailable" });
  assert.equal(offline.localCommandLabel, "LOCAL COMMANDS READY");
  assert.equal(offline.agentProviderStatus, "AGENT OFFLINE");

  const running = getCommandBusPresentation({ available: true, status: "running" });
  assert.equal(running.localCommandLabel, "LOCAL COMMANDS READY");
  assert.equal(running.agentProviderStatus, "AGENT ACTIVE");
});
