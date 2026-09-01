function finiteCount(value) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

export function getGraphSourceDiagnostics(state = {}) {
  const graph = state.graph;
  const stats = graph?.stats ?? {};
  const counts = Object.freeze({
    files: finiteCount(stats.discoveredFileCount),
    nodes: finiteCount(stats.indexedNodeCount ?? stats.nodeCount),
    edges: finiteCount(stats.indexedEdgeCount ?? stats.edgeCount),
    unresolved: finiteCount(stats.unresolvedLinkCount),
    skippedLinks: finiteCount(stats.skippedLinkCount),
    skippedFiles: finiteCount(stats.skippedFileCount),
  });

  if (state.error && !graph) {
    const errorMessage = String(state.error?.message ?? "").trim();
    return Object.freeze({
      id: "error",
      severity: "error",
      detail: errorMessage ? errorMessage.slice(0, 240) : null,
      counts,
      lastUpdatedAt: state.lastUpdatedAt ?? null,
    });
  }
  if (state.status === "loading") {
    return Object.freeze({
      id: "loading",
      severity: "status",
      counts,
      lastUpdatedAt: state.lastUpdatedAt ?? null,
    });
  }
  if (!graph?.available) {
    return Object.freeze({
      id: "unavailable",
      severity: "warning",
      counts,
      lastUpdatedAt: state.lastUpdatedAt ?? null,
    });
  }
  if (state.refreshing) {
    return Object.freeze({
      id: "syncing",
      severity: "status",
      counts,
      lastUpdatedAt: state.lastUpdatedAt ?? null,
    });
  }
  if (["stale", "degraded"].includes(graph.source?.status)) {
    return Object.freeze({
      id: "stale",
      severity: "warning",
      counts,
      lastUpdatedAt: state.lastUpdatedAt ?? null,
    });
  }
  if (stats.truncated) {
    return Object.freeze({
      id: "truncated",
      severity: "warning",
      counts,
      lastUpdatedAt: state.lastUpdatedAt ?? null,
    });
  }
  if (counts.unresolved + counts.skippedLinks + counts.skippedFiles > 0) {
    return Object.freeze({
      id: "attention",
      severity: "warning",
      counts,
      lastUpdatedAt: state.lastUpdatedAt ?? null,
    });
  }
  return Object.freeze({
    id: "ready",
    severity: "success",
    counts,
    lastUpdatedAt: state.lastUpdatedAt ?? null,
  });
}
