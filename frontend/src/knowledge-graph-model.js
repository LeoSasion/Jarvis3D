const MAX_GRAPH_COUNT = 100_000;
export const MAX_KNOWLEDGE_GRAPH_ENTRIES = 42;
export const KNOWLEDGE_GRAPH_MIN_ZOOM = 0.1;
export const KNOWLEDGE_GRAPH_MAX_ZOOM = 8;

export const DISCONNECTED_GRAPH_ACTIONS = Object.freeze([
  Object.freeze({ id: "search-local" }),
  Object.freeze({ id: "open-files" }),
  Object.freeze({ id: "desktop-only" }),
]);

const GROUP_LAYOUT = Object.freeze([
  Object.freeze({ x: 184, y: 142 }),
  Object.freeze({ x: 500, y: 104 }),
  Object.freeze({ x: 816, y: 164 }),
  Object.freeze({ x: 812, y: 446 }),
  Object.freeze({ x: 500, y: 520 }),
  Object.freeze({ x: 178, y: 438 }),
]);

const KIND_GROUPS = Object.freeze([
  Object.freeze({ id: "folder", labelKey: "graph.workspace.group.folder", kinds: new Set(["folder"]) }),
  Object.freeze({ id: "code", labelKey: "graph.workspace.group.code", kinds: new Set(["code"]) }),
  Object.freeze({ id: "document", labelKey: "graph.workspace.group.document", kinds: new Set(["document", "pdf", "presentation", "spreadsheet"]) }),
  Object.freeze({ id: "media", labelKey: "graph.workspace.group.media", kinds: new Set(["audio", "image", "video"]) }),
  Object.freeze({ id: "archive", labelKey: "graph.workspace.group.archive", kinds: new Set(["archive"]) }),
  Object.freeze({ id: "other", labelKey: "graph.workspace.group.other", kinds: new Set() }),
]);

function text(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function normalizeCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(MAX_GRAPH_COUNT, Math.round(parsed));
}

function normalizePathKey(path) {
  return text(path).replace(/[\\/]+$/u, "").toLocaleLowerCase();
}

function fileNameFromPath(path) {
  const normalized = text(path).replace(/[\\/]+$/u, "");
  return normalized.split(/[\\/]/u).at(-1) || normalized || "LOCAL SOURCE";
}

function normalizeSize(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeModified(value) {
  if (value === null || value === undefined || value === "") return null;
  return value instanceof Date && !Number.isNaN(value.getTime())
    ? value.toISOString()
    : String(value);
}

function normalizeProvenance(rawProvenance) {
  if (!rawProvenance || typeof rawProvenance !== "object") return null;
  return Object.freeze({
    kind: text(rawProvenance.kind ?? rawProvenance.Kind),
    dataClass: text(rawProvenance.dataClass ?? rawProvenance.DataClass),
    simulated: Boolean(rawProvenance.simulated ?? rawProvenance.Simulated),
    nativeHostConnected: Boolean(
      rawProvenance.nativeHostConnected ?? rawProvenance.NativeHostConnected,
    ),
  });
}

function normalizeEntry(entry) {
  const path = text(entry?.path ?? entry?.Path);
  if (!path) return null;
  const isDirectory = Boolean(entry?.isDirectory ?? entry?.IsDirectory);
  return Object.freeze({
    id: path,
    path,
    name: text(entry?.name ?? entry?.Name, fileNameFromPath(path)),
    kind: text(entry?.kind ?? entry?.Kind, isDirectory ? "folder" : "file").toLocaleLowerCase(),
    typeLabel: text(entry?.typeLabel ?? entry?.TypeLabel, isDirectory ? "Folder" : "File"),
    sizeBytes: normalizeSize(entry?.sizeBytes ?? entry?.SizeBytes),
    modified: normalizeModified(entry?.modified ?? entry?.Modified),
    isDirectory,
    isLinked: Boolean(entry?.isLinked ?? entry?.IsLinked),
  });
}

export function normalizeKnowledgeGraphSource(rawSource = null) {
  const currentPath = text(rawSource?.currentPath ?? rawSource?.CurrentPath);
  const provenance = normalizeProvenance(rawSource?.provenance ?? rawSource?.Provenance);
  const simulation = Boolean(
    rawSource?.simulation ?? rawSource?.Simulation ?? provenance?.simulated,
  );
  if (!currentPath) {
    return Object.freeze({
      connected: false,
      key: "",
      currentPath: "",
      sourceName: "",
      entries: Object.freeze([]),
      totalEntryCount: 0,
      truncatedCount: 0,
      simulation,
      provenance,
    });
  }

  const normalizedEntries = [];
  const seenPaths = new Set();
  const candidates = rawSource?.entries ?? rawSource?.Entries ?? [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const entry = normalizeEntry(candidate);
    if (!entry) continue;
    const key = normalizePathKey(entry.path);
    if (!key || seenPaths.has(key)) continue;
    seenPaths.add(key);
    normalizedEntries.push(entry);
  }

  const totalEntryCount = normalizedEntries.length;
  const entries = Object.freeze(normalizedEntries.slice(0, MAX_KNOWLEDGE_GRAPH_ENTRIES));
  return Object.freeze({
    connected: true,
    key: normalizePathKey(currentPath),
    currentPath,
    sourceName: fileNameFromPath(currentPath),
    entries,
    totalEntryCount,
    truncatedCount: Math.max(0, totalEntryCount - entries.length),
    simulation,
    provenance,
  });
}

function getGroupForKind(kind) {
  return KIND_GROUPS.find((group) => group.kinds.has(kind)) ?? KIND_GROUPS.at(-1);
}

function stablePathHash(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function graphNodeId(prefix, value) {
  const key = normalizePathKey(value);
  const slug = fileNameFromPath(key).replace(/[^a-z0-9._-]+/giu, "-").slice(0, 32) || prefix;
  return `${prefix}:${slug}:${stablePathHash(key)}`;
}

function normalizeNodeOffsets(offsets) {
  return offsets && typeof offsets === "object" ? offsets : {};
}

function normalizeQuery(value) {
  return text(value).toLocaleLowerCase();
}

function layoutEntry(groupPosition, index, count) {
  const safeCount = Math.max(1, count);
  const angle = ((Math.PI * 2) / safeCount) * index - Math.PI / 2;
  const ring = 72 + Math.floor(index / 10) * 30;
  return {
    x: Math.round(groupPosition.x + Math.cos(angle) * ring),
    y: Math.round(groupPosition.y + Math.sin(angle) * ring * 0.72),
  };
}

function withOffset(position, id, offsets) {
  const offset = offsets[id];
  if (!offset || !Number.isFinite(offset.x) || !Number.isFinite(offset.y)) return position;
  return {
    x: Math.max(28, Math.min(972, position.x + offset.x)),
    y: Math.max(32, Math.min(588, position.y + offset.y)),
  };
}

export function createKnowledgeGraphModel(rawSource, options = {}) {
  const source = normalizeKnowledgeGraphSource(rawSource);
  if (!source.connected) {
    return Object.freeze({
      source,
      connected: false,
      nodes: Object.freeze([]),
      edges: Object.freeze([]),
      sourceCount: 0,
      relationCount: 0,
      visibleEntryCount: 0,
      query: normalizeQuery(options.query),
    });
  }

  const query = normalizeQuery(options.query);
  const collapsedIds = new Set(Array.isArray(options.collapsedIds) ? options.collapsedIds : []);
  const selectedPaths = new Set(
    (Array.isArray(options.selectedPaths) ? options.selectedPaths : [])
      .map(normalizePathKey)
      .filter(Boolean),
  );
  const offsets = normalizeNodeOffsets(options.nodeOffsets);
  const groupedEntries = new Map(KIND_GROUPS.map((group) => [group.id, []]));
  for (const entry of source.entries) {
    groupedEntries.get(getGroupForKind(entry.kind).id).push(entry);
  }

  const sourceId = graphNodeId("source", source.currentPath);
  const sourcePosition = withOffset({ x: 500, y: 310 }, sourceId, offsets);
  const nodes = [{
    id: sourceId,
    kind: "source",
    label: source.sourceName,
    metaKey: "graph.workspace.source.items",
    metaValues: Object.freeze({ count: source.totalEntryCount }),
    count: source.totalEntryCount,
    path: source.currentPath,
    name: source.sourceName,
    typeLabel: "Folder",
    isDirectory: true,
    actionable: true,
    selected: false,
    x: sourcePosition.x,
    y: sourcePosition.y,
  }];
  const edges = [];
  let visibleEntryCount = 0;

  KIND_GROUPS.forEach((definition, groupIndex) => {
    const entries = groupedEntries.get(definition.id);
    if (!entries.length) return;
    const matches = query
      ? entries.filter((entry) => `${entry.name} ${entry.typeLabel} ${entry.path}`.toLocaleLowerCase().includes(query))
      : entries;
    if (query && matches.length === 0) return;

    const groupId = `${sourceId}:group:${definition.id}`;
    const groupPosition = withOffset(GROUP_LAYOUT[groupIndex], groupId, offsets);
    // A search result must remain discoverable even when its group was collapsed
    // before the query began. Clearing the query restores the user's collapse state.
    const collapsed = !query && collapsedIds.has(groupId);
    nodes.push({
      id: groupId,
      kind: "group",
      groupKind: definition.id,
      labelKey: definition.labelKey,
      metaKey: query && matches.length !== entries.length
        ? "graph.workspace.group.matches"
        : entries.length === 1
          ? "graph.workspace.group.items.one"
          : "graph.workspace.group.items.other",
      metaValues: Object.freeze(query && matches.length !== entries.length
        ? { visible: matches.length, total: entries.length }
        : { count: entries.length }),
      count: entries.length,
      actionable: false,
      expanded: !collapsed,
      selected: false,
      x: groupPosition.x,
      y: groupPosition.y,
    });
    edges.push({ id: `${sourceId}->${groupId}`, from: sourceId, to: groupId, kind: "contains" });
    if (collapsed) return;

    matches.forEach((entry, entryIndex) => {
      const entryId = graphNodeId("entry", entry.path);
      const entryPosition = withOffset(layoutEntry(groupPosition, entryIndex, matches.length), entryId, offsets);
      nodes.push({
        ...entry,
        id: entryId,
        kind: "entry",
        graphKind: entry.kind,
        label: entry.name,
        meta: entry.typeLabel,
        actionable: true,
        selected: selectedPaths.has(normalizePathKey(entry.path)),
        labelSide: entryPosition.x < groupPosition.x ? "left" : "right",
        x: entryPosition.x,
        y: entryPosition.y,
      });
      edges.push({ id: `${groupId}->${entryId}`, from: groupId, to: entryId, kind: "indexes" });
      visibleEntryCount += 1;
    });
  });

  return Object.freeze({
    source,
    connected: true,
    nodes: Object.freeze(nodes.map((node) => Object.freeze(node))),
    edges: Object.freeze(edges.map((edge) => Object.freeze(edge))),
    sourceCount: 1,
    relationCount: edges.length,
    visibleEntryCount,
    query,
  });
}

export function getKnowledgeGraphNodeContextItem(node) {
  if (!node?.actionable || !text(node.path)) return null;
  return Object.freeze({
    id: text(node.path),
    path: text(node.path),
    name: text(node.name ?? node.label, fileNameFromPath(node.path)),
    kind: text(node.graphKind ?? node.kind, node.isDirectory ? "folder" : "file"),
    typeLabel: text(node.typeLabel ?? node.meta, node.isDirectory ? "Folder" : "File"),
    sizeBytes: normalizeSize(node.sizeBytes),
    modified: normalizeModified(node.modified),
    isDirectory: Boolean(node.isDirectory),
    isLinked: Boolean(node.isLinked),
  });
}

export function getKnowledgeGraphNodeConnections(graph, nodeId) {
  if (!graph || !nodeId || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return Object.freeze([]);
  }
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  if (!nodeById.has(nodeId)) return Object.freeze([]);

  const connections = [];
  for (const edge of graph.edges) {
    const outgoing = edge.from === nodeId;
    const incoming = edge.to === nodeId;
    if (!outgoing && !incoming) continue;
    const adjacentNode = nodeById.get(outgoing ? edge.to : edge.from);
    if (!adjacentNode) continue;
    connections.push(Object.freeze({
      id: edge.id,
      kind: text(edge.kind, "relates"),
      direction: outgoing ? "outgoing" : "incoming",
      node: adjacentNode,
    }));
  }
  return Object.freeze(connections);
}

export function getKnowledgeGraphNavigationIndex(currentIndex, key, itemCount) {
  const count = Number.isFinite(itemCount) ? Math.max(0, Math.floor(itemCount)) : 0;
  if (count === 0) return -1;
  const current = Number.isFinite(currentIndex)
    ? Math.min(count - 1, Math.max(0, Math.floor(currentIndex)))
    : 0;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowRight" || key === "ArrowDown") return Math.min(count - 1, current + 1);
  if (key === "ArrowLeft" || key === "ArrowUp") return Math.max(0, current - 1);
  return -1;
}

export function clampKnowledgeGraphZoom(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(KNOWLEDGE_GRAPH_MAX_ZOOM, Math.max(KNOWLEDGE_GRAPH_MIN_ZOOM, parsed));
}

export function getKnowledgeGraphWheelZoomDelta(deltaY, deltaMode = 0) {
  const numericDelta = Number(deltaY);
  if (!Number.isFinite(numericDelta) || numericDelta === 0) return 0;
  const pixelMultiplier = Number(deltaMode) === 1
    ? 16
    : Number(deltaMode) === 2 ? 620 : 1;
  const scaledDelta = -numericDelta * pixelMultiplier * 0.0012;
  return Math.max(-0.16, Math.min(0.16, scaledDelta));
}

export function normalizeKnowledgeGraphState(rawState = {}) {
  if (rawState?.currentPath || rawState?.CurrentPath) {
    const graph = createKnowledgeGraphModel(rawState);
    return {
      connected: graph.connected,
      sourceCount: graph.sourceCount,
      relationCount: graph.relationCount,
      simulation: graph.source.simulation,
      provenance: graph.source.provenance,
    };
  }

  const candidate = rawState ?? {};
  const sourceCount = normalizeCount(candidate.sourceCount);
  const relationCount = normalizeCount(candidate.relationCount);
  const connected = candidate.connected === true && sourceCount > 0;
  const provenance = normalizeProvenance(candidate.provenance ?? candidate.Provenance);
  const simulation = Boolean(
    candidate.simulation ?? candidate.Simulation ?? provenance?.simulated,
  );

  return {
    connected,
    sourceCount: connected ? sourceCount : 0,
    relationCount: connected ? relationCount : 0,
    simulation,
    provenance,
  };
}

export function getKnowledgeGraphPresentation(rawState) {
  const state = normalizeKnowledgeGraphState(rawState);
  if (!state.connected) {
    return {
      ...state,
      status: "disconnected",
      actions: DISCONNECTED_GRAPH_ACTIONS,
    };
  }

  return {
    ...state,
    status: "connected",
    actions: [],
  };
}
