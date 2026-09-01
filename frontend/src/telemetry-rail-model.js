export function getTelemetryPriorityPresentation({ events = [], feedError = null, feedLoading = false } = {}) {
  const connecting = Boolean(feedLoading);
  const priorityEvent = events.find((item) => item.severity === "error" || item.severity === "warning")
    ?? events[0]
    ?? null;
  const hasWarning = Boolean(feedError)
    || events.some((item) => item.severity === "warning" || item.severity === "error");

  if (feedError) {
    return {
      kind: "warning",
      className: "has-warning",
      meta: feedError?.message ?? String(feedError),
    };
  }
  if (connecting) {
    return {
      kind: "connecting",
      className: "is-connecting",
      cachedEventCount: events.length,
    };
  }
  return {
    kind: hasWarning ? "warning" : "nominal",
    className: hasWarning ? "has-warning" : "is-nominal",
    detail: priorityEvent?.title ?? null,
    meta: priorityEvent?.detail || null,
  };
}

export function getTelemetryRailMode({ compact = false, priorityKind = "nominal" } = {}) {
  return compact && priorityKind === "nominal" ? "compact-nominal" : "full";
}

export function getCompactTelemetrySummary(resources = []) {
  const findValue = (id, fallback) => resources.find((resource) => resource.id === id)?.value ?? fallback;
  return {
    cpu: findValue("cpu", "—"),
    memory: findValue("memory", "—"),
  };
}
