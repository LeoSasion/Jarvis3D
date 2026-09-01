import assert from "node:assert/strict";
import test from "node:test";
import { getGraphSourceDiagnostics } from "../src/graph/graph-source-diagnostics.js";

test("graph source diagnostics preserve the last valid graph while syncing", () => {
  const result = getGraphSourceDiagnostics({
    status: "ready",
    refreshing: true,
    graph: { available: true, stats: { nodeCount: 12, edgeCount: 24 } },
  });
  assert.equal(result.id, "syncing");
  assert.equal(Object.hasOwn(result, "title"), false);
  assert.equal(Object.hasOwn(result, "detail"), false);
});

test("graph source diagnostics retain only bounded external error text", () => {
  const result = getGraphSourceDiagnostics({
    error: { message: "Vault permission denied" },
  });
  assert.equal(result.id, "error");
  assert.equal(result.detail, "Vault permission denied");
  assert.equal(Object.hasOwn(result, "title"), false);

  const fallback = getGraphSourceDiagnostics({ error: {} });
  assert.equal(fallback.detail, null);
});

test("graph source diagnostics expose unresolved and skipped source counts", () => {
  const result = getGraphSourceDiagnostics({
    status: "ready",
    graph: {
      available: true,
      stats: { nodeCount: 12, edgeCount: 24, unresolvedLinkCount: 2, skippedFileCount: 1 },
    },
  });
  assert.equal(result.id, "attention");
  assert.deepEqual(result.counts, {
    files: 0,
    nodes: 12,
    edges: 24,
    unresolved: 2,
    skippedLinks: 0,
    skippedFiles: 1,
  });
});

test("graph source diagnostics never hide a bounded truncation", () => {
  const result = getGraphSourceDiagnostics({
    status: "ready",
    graph: { available: true, stats: { truncated: true } },
  });
  assert.equal(result.id, "truncated");
  assert.equal(result.severity, "warning");
});
