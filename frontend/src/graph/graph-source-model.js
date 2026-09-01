const MAX_GRAPH_NODES = 4_096;
const MAX_GRAPH_EDGES = 32_768;
const MAX_NODE_TAGS = 64;

function read(value, camelKey, pascalKey) {
  return value?.[camelKey] ?? value?.[pascalKey];
}

function boundedText(value, maximumLength, fallback = "") {
  const text = String(value ?? "").trim();
  return (text || fallback).slice(0, maximumLength);
}

function boundedCount(value, fallback = 0) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : fallback;
}

function normalizeTags(rawTags) {
  const source = Array.isArray(rawTags)
    ? rawTags
    : typeof rawTags === "string"
      ? rawTags.split(/[\s,]+/u)
      : [];
  return [...new Set(source
    .map((tag) => boundedText(tag, 80).replace(/^#/u, ""))
    .filter(Boolean))]
    .slice(0, MAX_NODE_TAGS);
}

function normalizeValues(rawValues, maximumValues = 32) {
  const source = Array.isArray(rawValues) ? rawValues : [];
  return [...new Set(source
    .map((value) => boundedText(value, 160))
    .filter(Boolean))]
    .slice(0, maximumValues);
}

function normalizeNode(rawNode, index) {
  const id = boundedText(read(rawNode, "id", "Id"), 512, `node-${index}`);
  const relativePath = boundedText(
    read(rawNode, "relativePath", "RelativePath") ?? read(rawNode, "path", "Path"),
    1_024,
  );
  const title = boundedText(
    read(rawNode, "title", "Title")
      ?? read(rawNode, "label", "Label")
      ?? read(rawNode, "name", "Name"),
    160,
    relativePath || id,
  );
  const aliases = normalizeTags(read(rawNode, "aliases", "Aliases"));
  const degree = Number(read(rawNode, "degree", "Degree"));
  const weight = Number(read(rawNode, "weight", "Weight"));
  const x = Number(read(rawNode, "x", "X"));
  const y = Number(read(rawNode, "y", "Y"));
  const z = Number(read(rawNode, "z", "Z"));

  return {
    id,
    title,
    relativePath,
    kind: boundedText(read(rawNode, "kind", "Kind"), 64, "note").toLowerCase(),
    group: boundedText(read(rawNode, "group", "Group"), 120),
    tags: normalizeTags(read(rawNode, "tags", "Tags")),
    aliases,
    resolved: read(rawNode, "resolved", "Resolved") !== false,
    degree: Number.isFinite(degree) ? Math.max(0, degree) : 0,
    weight: Number.isFinite(weight) ? Math.max(0.1, weight) : 1,
    x: Number.isFinite(x) ? x : null,
    y: Number.isFinite(y) ? y : null,
    z: Number.isFinite(z) ? z : null,
  };
}

function normalizeEdge(rawEdge, index, nodeIds) {
  const source = boundedText(
    read(rawEdge, "source", "Source") ?? read(rawEdge, "from", "From"),
    512,
  );
  const target = boundedText(
    read(rawEdge, "target", "Target") ?? read(rawEdge, "to", "To"),
    512,
  );
  if (!source || !target || source === target || !nodeIds.has(source) || !nodeIds.has(target)) {
    return null;
  }
  const kind = boundedText(read(rawEdge, "kind", "Kind"), 64, "link").toLowerCase();
  const weight = Number(read(rawEdge, "weight", "Weight"));
  const occurrenceCount = Number(read(rawEdge, "occurrenceCount", "OccurrenceCount"));
  return {
    id: boundedText(
      read(rawEdge, "id", "Id"),
      1_024,
      `${source}\u001f${target}\u001f${kind}\u001f${index}`,
    ),
    source,
    target,
    kind,
    syntax: boundedText(read(rawEdge, "syntax", "Syntax"), 32),
    fragmentKind: boundedText(read(rawEdge, "fragmentKind", "FragmentKind"), 32),
    fragment: boundedText(read(rawEdge, "fragment", "Fragment"), 512),
    displayText: boundedText(read(rawEdge, "displayText", "DisplayText"), 256),
    relationType: boundedText(read(rawEdge, "relationType", "RelationType"), 80),
    relationValues: normalizeValues(read(rawEdge, "relationValues", "RelationValues")),
    occurrenceCount: Number.isFinite(occurrenceCount)
      ? Math.max(1, Math.min(1_024, Math.floor(occurrenceCount)))
      : 1,
    weight: Number.isFinite(weight) ? Math.max(0.1, weight) : 1,
  };
}

export function normalizeGraphSource(rawSource = null) {
  const sourceObject = rawSource && typeof rawSource === "object" ? rawSource : {};
  const rawNodes = read(sourceObject, "nodes", "Nodes");
  const rawNodeList = Array.isArray(rawNodes) ? rawNodes : [];
  const nodeKeys = new Set();
  const nodes = [];
  rawNodeList.slice(0, MAX_GRAPH_NODES).forEach((rawNode, index) => {
    const node = normalizeNode(rawNode, index);
    if (nodeKeys.has(node.id)) return;
    nodeKeys.add(node.id);
    nodes.push(node);
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const rawEdges = read(sourceObject, "edges", "Edges");
  const edgeKeys = new Set();
  const edges = [];

  for (const [index, rawEdge] of (Array.isArray(rawEdges) ? rawEdges : []).entries()) {
    if (edges.length >= MAX_GRAPH_EDGES) break;
    const edge = normalizeEdge(rawEdge, index, nodeIds);
    if (!edge) continue;
    const key = [
      edge.source,
      edge.target,
      edge.kind,
      edge.fragmentKind,
      edge.fragment,
      edge.relationType,
    ].join("\u001f");
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push(edge);
  }

  const sourceMetadata = read(sourceObject, "source", "Source") ?? {};
  const statsMetadata = read(sourceObject, "stats", "Stats") ?? {};
  const available = Boolean(
    read(sourceObject, "available", "Available") ?? nodes.length > 0,
  );

  return {
    schemaVersion: Number(read(sourceObject, "schemaVersion", "SchemaVersion")) || 1,
    available,
    source: {
      kind: boundedText(read(sourceMetadata, "kind", "Kind"), 64, "graph"),
      name: boundedText(read(sourceMetadata, "name", "Name"), 160, "LOCAL KNOWLEDGE GRAPH"),
      resolution: boundedText(read(sourceMetadata, "resolution", "Resolution"), 80),
      status: boundedText(
        read(sourceMetadata, "status", "Status")
          ?? read(sourceObject, "status", "Status"),
        32,
      ).toLowerCase(),
      simulation: Boolean(
        read(sourceMetadata, "simulation", "Simulation")
          ?? read(sourceObject, "simulation", "Simulation"),
      ),
      revision: boundedText(read(sourceMetadata, "revision", "Revision"), 160),
      updatedAtUtc: boundedText(
        read(sourceMetadata, "updatedAtUtc", "UpdatedAtUtc")
          ?? read(sourceObject, "generatedAtUtc", "GeneratedAtUtc"),
        64,
      ),
    },
    nodes,
    edges,
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      indexedNodeCount: boundedCount(
        read(statsMetadata, "nodeCount", "NodeCount") ?? rawNodeList.length,
      ),
      indexedEdgeCount: boundedCount(
        read(statsMetadata, "edgeCount", "EdgeCount")
          ?? (Array.isArray(rawEdges) ? rawEdges.length : 0),
      ),
      discoveredFileCount: boundedCount(
        read(statsMetadata, "discoveredFileCount", "DiscoveredFileCount") ?? rawNodeList.length,
      ),
      parsedLinkCount: boundedCount(read(statsMetadata, "parsedLinkCount", "ParsedLinkCount")),
      resolvedLinkCount: boundedCount(read(statsMetadata, "resolvedLinkCount", "ResolvedLinkCount")),
      unresolvedLinkCount: boundedCount(read(statsMetadata, "unresolvedLinkCount", "UnresolvedLinkCount")),
      skippedLinkCount: boundedCount(read(statsMetadata, "skippedLinkCount", "SkippedLinkCount")),
      skippedFileCount: boundedCount(read(statsMetadata, "skippedFileCount", "SkippedFileCount")),
      skippedDirectoryCount: boundedCount(
        read(statsMetadata, "skippedDirectoryCount", "SkippedDirectoryCount"),
      ),
      incremental: Boolean(read(statsMetadata, "incremental", "Incremental")),
      reusedFileCount: boundedCount(
        read(statsMetadata, "reusedFileCount", "ReusedFileCount"),
      ),
      resolvedEdgeCount: Number(
        read(statsMetadata, "resolvedEdgeCount", "ResolvedEdgeCount") ?? edges.length,
      ),
      unresolvedNodeCount: nodes.filter((node) => !node.resolved).length,
      truncated: Boolean(read(statsMetadata, "truncated", "Truncated"))
        || rawNodeList.length > MAX_GRAPH_NODES
        || (Array.isArray(rawEdges) && rawEdges.length > MAX_GRAPH_EDGES),
    },
  };
}

export function assembleGraphSource(manifest = null, chunks = []) {
  const manifestObject = manifest && typeof manifest === "object" ? manifest : {};
  const sourceMetadata = read(manifestObject, "source", "Source") ?? {};
  const nodes = [];
  const edges = [];
  for (const chunk of Array.isArray(chunks) ? chunks : []) {
    const chunkNodes = read(chunk, "nodes", "Nodes");
    const chunkEdges = read(chunk, "edges", "Edges");
    if (Array.isArray(chunkNodes)) nodes.push(...chunkNodes);
    if (Array.isArray(chunkEdges)) edges.push(...chunkEdges);
  }
  return {
    schemaVersion: read(manifestObject, "schemaVersion", "SchemaVersion") ?? 1,
    available: read(manifestObject, "available", "Available"),
    source: {
      ...sourceMetadata,
      revision: read(sourceMetadata, "revision", "Revision")
        ?? read(manifestObject, "revision", "Revision"),
      updatedAtUtc: read(sourceMetadata, "updatedAtUtc", "UpdatedAtUtc")
        ?? read(manifestObject, "updatedAtUtc", "UpdatedAtUtc"),
      status: read(sourceMetadata, "status", "Status")
        ?? read(manifestObject, "status", "Status"),
    },
    stats: read(manifestObject, "stats", "Stats"),
    nodes,
    edges,
  };
}

export function isRenderableGraphSource(source) {
  return Boolean(source?.available && source.nodes?.length > 0);
}

export const graphSourceLimits = Object.freeze({
  nodes: MAX_GRAPH_NODES,
  edges: MAX_GRAPH_EDGES,
});
