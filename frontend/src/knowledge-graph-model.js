const MAX_GRAPH_COUNT = 100_000;
export const MAX_KNOWLEDGE_GRAPH_ENTRIES = 42;
export const KNOWLEDGE_GRAPH_MIN_ZOOM = 0.72;
export const KNOWLEDGE_GRAPH_MAX_ZOOM = 2.2;

export const DISCONNECTED_GRAPH_ACTIONS = Object.freeze([
  Object.freeze({ id: "search-local", label: "SEARCH LOCAL", detail: "Find apps, files, and active windows" }),
  Object.freeze({ id: "open-files", label: "OPEN FILES", detail: "Choose a verified local source" }),
  Object.freeze({ id: "desktop-only", label: "DESKTOP ONLY", detail: "Keep the graph quiet for this session" }),
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
  Object.freeze({ id: "folder", label: "FOLDERS", kinds: new Set(["folder"]) }),
  Object.freeze({ id: "code", label: "CODE", kinds: new Set(["code"]) }),
  Object.freeze({ id: "document", label: "DOCUMENTS", kinds: new Set(["document", "pdf", "presentation", "spreadsheet"]) }),
  Object.freeze({ id: "media", label: "MEDIA", kinds: new Set(["audio", "image", "video"]) }),
  Object.freeze({ id: "archive", label: "ARCHIVE", kinds: new Set(["archive"]) }),
  Object.freeze({ id: "other", label: "OTHER", kinds: new Set() }),
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
    meta: `${source.totalEntryCount} ITEMS`,
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
      label: definition.label,
      meta: query && matches.length !== entries.length
        ? `${matches.length}/${entries.length} MATCH`
        : `${entries.length} ITEM${entries.length === 1 ? "" : "S"}`,
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
      title: "SOURCE DISCONNECTED",
      detail: "Connect a verified local source to activate relations.",
      meta: "ENTITY / RELATION / SOURCE",
      announcement: "Local knowledge graph structure preview. No verified knowledge source is connected.",
      actions: DISCONNECTED_GRAPH_ACTIONS,
    };
  }

  if (state.simulation) {
    return {
      ...state,
      status: "connected",
      title: "PREVIEW GRAPH ACTIVE",
      detail: `${state.sourceCount} SOURCE${state.sourceCount === 1 ? "" : "S"} / ${state.relationCount} RELATIONS`,
      meta: "SIMULATED EXPLORER FIXTURE",
      announcement: "Local knowledge graph connected to a simulated Explorer preview source.",
      actions: [],
    };
  }

  return {
    ...state,
    status: "connected",
    title: "LOCAL INDEX ACTIVE",
    detail: `${state.sourceCount} SOURCE${state.sourceCount === 1 ? "" : "S"} / ${state.relationCount} RELATIONS`,
    meta: "VERIFIED LOCAL GRAPH",
    announcement: `Local knowledge graph connected to ${state.sourceCount} verified source${state.sourceCount === 1 ? "" : "s"}.`,
    actions: [],
  };
}
