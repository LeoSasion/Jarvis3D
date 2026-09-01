import {
  assembleGraphSource,
  graphSourceLimits,
  normalizeGraphSource,
} from "./graph-source-model.js";

const DEFAULT_NODE_CHUNK_SIZE = 384;
const DEFAULT_EDGE_CHUNK_SIZE = 1_200;
const MAX_CHUNK_REQUESTS = graphSourceLimits.nodes + graphSourceLimits.edges;
const MAX_STALE_RETRIES = 2;

function read(value, camelKey, pascalKey) {
  return value?.[camelKey] ?? value?.[pascalKey];
}

function boundedCount(value, fallback = 0) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : fallback;
}

function boundedChunkSize(value, fallback, maximum) {
  const size = boundedCount(value, fallback);
  return Math.max(1, Math.min(maximum, size || fallback));
}

function graphRevision(value) {
  const source = read(value, "source", "Source") ?? {};
  return String(
    read(value, "revision", "Revision")
      ?? read(source, "revision", "Revision")
      ?? "",
  ).trim();
}

function manifestCounts(manifest) {
  const stats = read(manifest, "stats", "Stats") ?? {};
  return {
    nodes: Math.min(graphSourceLimits.nodes, boundedCount(
      read(manifest, "nodeCount", "NodeCount") ?? read(stats, "nodeCount", "NodeCount"),
    )),
    edges: Math.min(graphSourceLimits.edges, boundedCount(
      read(manifest, "edgeCount", "EdgeCount") ?? read(stats, "edgeCount", "EdgeCount"),
    )),
  };
}

function chunkLists(chunk) {
  const nodes = read(chunk, "nodes", "Nodes");
  const edges = read(chunk, "edges", "Edges");
  return {
    nodes: Array.isArray(nodes) ? nodes : [],
    edges: Array.isArray(edges) ? edges : [],
  };
}

function nextOffset(chunk, kind, current, received) {
  const camelKey = kind === "node" ? "nextNodeOffset" : "nextEdgeOffset";
  const pascalKey = kind === "node" ? "NextNodeOffset" : "NextEdgeOffset";
  const explicit = Number(read(chunk, camelKey, pascalKey));
  return Number.isFinite(explicit) && explicit >= current
    ? Math.floor(explicit)
    : current + received;
}

function createLoaderError(code, message) {
  const error = new Error(message);
  error.name = "KnowledgeGraphLoadError";
  error.code = code;
  return error;
}

function isRevisionStale(error) {
  return error?.code === "GRAPH_REVISION_STALE";
}

function isLegacyBridge(error) {
  return ["METHOD_NOT_FOUND", "UNKNOWN_METHOD", "NOT_SUPPORTED", "UNKNOWN_REQUEST"]
    .includes(error?.code);
}

function canReuseGraphPayload(previousGraph, revision, counts) {
  if (!previousGraph?.available || !revision) return false;
  return previousGraph.source?.revision === revision
    && previousGraph.stats?.indexedNodeCount === counts.nodes
    && previousGraph.stats?.indexedEdgeCount === counts.edges;
}

function graphMetadataSignature(graph) {
  return JSON.stringify({
    schemaVersion: graph.schemaVersion,
    available: graph.available,
    source: graph.source,
    stats: graph.stats,
  });
}

const manifestStatFields = Object.freeze([
  ["discoveredFileCount", "discoveredFileCount", "DiscoveredFileCount"],
  ["parsedLinkCount", "parsedLinkCount", "ParsedLinkCount"],
  ["resolvedLinkCount", "resolvedLinkCount", "ResolvedLinkCount"],
  ["unresolvedLinkCount", "unresolvedLinkCount", "UnresolvedLinkCount"],
  ["skippedLinkCount", "skippedLinkCount", "SkippedLinkCount"],
  ["skippedFileCount", "skippedFileCount", "SkippedFileCount"],
  ["skippedDirectoryCount", "skippedDirectoryCount", "SkippedDirectoryCount"],
  ["incremental", "incremental", "Incremental"],
  ["reusedFileCount", "reusedFileCount", "ReusedFileCount"],
  ["truncated", "truncated", "Truncated"],
]);

function mergeManifestWithReusedPayload(previousGraph, manifest) {
  const manifestGraph = normalizeGraphSource(assembleGraphSource(manifest));
  const rawStats = read(manifest, "stats", "Stats") ?? {};
  const nextStats = {
    ...previousGraph.stats,
    indexedNodeCount: manifestGraph.stats.indexedNodeCount,
    indexedEdgeCount: manifestGraph.stats.indexedEdgeCount,
    nodeCount: previousGraph.nodes.length,
    edgeCount: previousGraph.edges.length,
  };
  for (const [normalizedKey, camelKey, pascalKey] of manifestStatFields) {
    if (read(rawStats, camelKey, pascalKey) !== undefined) {
      nextStats[normalizedKey] = manifestGraph.stats[normalizedKey];
    }
  }
  const nextGraph = {
    ...manifestGraph,
    nodes: previousGraph.nodes,
    edges: previousGraph.edges,
    stats: nextStats,
  };
  return graphMetadataSignature(nextGraph) === graphMetadataSignature(previousGraph)
    ? previousGraph
    : nextGraph;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error("Knowledge graph loading was superseded.");
  error.name = "AbortError";
  error.code = "ABORTED";
  throw error;
}

async function loadChunkedSource(api, options = {}) {
  throwIfAborted(options.signal);
  const manifest = await api.getDefaultManifest(
    options.forceRefresh ? { force: true } : {},
  );
  throwIfAborted(options.signal);
  const available = Boolean(read(manifest, "available", "Available"));
  const counts = manifestCounts(manifest);
  if (!available || (counts.nodes === 0 && counts.edges === 0)) {
    return normalizeGraphSource(assembleGraphSource(manifest));
  }

  const revision = graphRevision(manifest);
  if (!revision) {
    throw createLoaderError("GRAPH_MANIFEST_INVALID", "Graph manifest did not include a revision.");
  }
  if (canReuseGraphPayload(options.previousGraph, revision, counts)) {
    return mergeManifestWithReusedPayload(options.previousGraph, manifest);
  }
  const nodeLimit = boundedChunkSize(
    read(manifest, "nodeChunkSize", "NodeChunkSize"),
    DEFAULT_NODE_CHUNK_SIZE,
    1_024,
  );
  const edgeLimit = boundedChunkSize(
    read(manifest, "edgeChunkSize", "EdgeChunkSize"),
    DEFAULT_EDGE_CHUNK_SIZE,
    4_096,
  );
  const chunks = [];
  let nodeOffset = 0;
  let edgeOffset = 0;

  while (nodeOffset < counts.nodes || edgeOffset < counts.edges) {
    throwIfAborted(options.signal);
    if (chunks.length >= MAX_CHUNK_REQUESTS) {
      throw createLoaderError("GRAPH_CHUNK_LIMIT", "Graph source required too many chunks.");
    }
    const chunk = await api.getDefaultChunk({
      revision,
      nodeOffset,
      nodeLimit: nodeOffset < counts.nodes ? nodeLimit : 0,
      edgeOffset,
      edgeLimit: edgeOffset < counts.edges ? edgeLimit : 0,
    });
    throwIfAborted(options.signal);
    const chunkRevision = graphRevision(chunk);
    if (chunkRevision && chunkRevision !== revision) {
      throw createLoaderError("GRAPH_REVISION_STALE", "Graph changed while it was loading.");
    }
    const lists = chunkLists(chunk);
    const nextNodeOffset = nextOffset(chunk, "node", nodeOffset, lists.nodes.length);
    const nextEdgeOffset = nextOffset(chunk, "edge", edgeOffset, lists.edges.length);
    if (nextNodeOffset === nodeOffset && nodeOffset < counts.nodes) {
      throw createLoaderError("GRAPH_CHUNK_INCOMPLETE", "Graph node chunk did not make progress.");
    }
    if (nextEdgeOffset === edgeOffset && edgeOffset < counts.edges) {
      throw createLoaderError("GRAPH_CHUNK_INCOMPLETE", "Graph relation chunk did not make progress.");
    }
    chunks.push(chunk);
    nodeOffset = Math.min(counts.nodes, nextNodeOffset);
    edgeOffset = Math.min(counts.edges, nextEdgeOffset);
  }

  return normalizeGraphSource(assembleGraphSource(manifest, chunks));
}

export async function loadDefaultKnowledgeGraph(platform, options = {}) {
  const api = platform?.knowledgeGraph;
  if (!api) throw createLoaderError("GRAPH_API_UNAVAILABLE", "Knowledge graph API is unavailable.");
  if (typeof api.getDefaultManifest !== "function" || typeof api.getDefaultChunk !== "function") {
    return normalizeGraphSource(await api.getDefaultSource());
  }

  const retryLimit = Math.min(
    MAX_STALE_RETRIES,
    boundedCount(options.staleRetries, MAX_STALE_RETRIES),
  );
  for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
    try {
      return await loadChunkedSource(api, options);
    } catch (error) {
      if (isLegacyBridge(error) && typeof api.getDefaultSource === "function") {
        return normalizeGraphSource(await api.getDefaultSource());
      }
      if (!isRevisionStale(error) || attempt >= retryLimit) throw error;
    }
  }
  throw createLoaderError("GRAPH_LOAD_FAILED", "Knowledge graph could not be loaded.");
}

export const defaultKnowledgeGraphLoaderPolicy = Object.freeze({
  nodeChunkSize: DEFAULT_NODE_CHUNK_SIZE,
  edgeChunkSize: DEFAULT_EDGE_CHUNK_SIZE,
  maximumChunks: MAX_CHUNK_REQUESTS,
  staleRetries: MAX_STALE_RETRIES,
});
