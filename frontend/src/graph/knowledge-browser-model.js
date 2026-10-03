import { MAX_AGENT_CONTENT_CHARACTERS } from "../agent-context-model.js";

export const KNOWLEDGE_PAGE_SIZE = 40;

export function getKnowledgeSearchKey(revision, query, tag, offset) {
  return JSON.stringify([revision, query, tag, offset]);
}

export function reconcileKnowledgeDraft(currentDraft, previousSuggestion, nextSuggestion) {
  const current = typeof currentDraft === "string" ? currentDraft : "";
  return current.trim() && current !== previousSuggestion ? current : nextSuggestion;
}

export function isKnowledgeBasketItemStale(item, revision) {
  return Boolean(item?.excerpt?.revision && revision && item.excerpt.revision !== revision);
}

export function searchKnowledgeNodes(graph, { query = "", tag = "", offset = 0, limit = KNOWLEDGE_PAGE_SIZE } = {}) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const items = (graph?.nodes ?? []).filter((node) => {
    const tags = node.tags ?? [];
    const text = [node.title, node.relativePath, ...(node.aliases ?? []), ...tags].join(" ").toLocaleLowerCase();
    return (!tag || tags.some((value) => value.toLocaleLowerCase() === tag.toLocaleLowerCase()))
      && words.every((word) => text.includes(word));
  }).sort((a, b) => Number(b.title?.toLocaleLowerCase() === query.toLocaleLowerCase())
    - Number(a.title?.toLocaleLowerCase() === query.toLocaleLowerCase()) || a.title.localeCompare(b.title));
  return {
    revision: graph.source.revision, items: items.slice(offset, offset + limit), total: items.length, offset,
    nextOffset: Math.min(items.length, offset + limit),
    truncated: Boolean(graph.stats?.truncated),
    tags: [...new Set(graph.nodes.flatMap((node) => node.tags ?? []))].sort().slice(0, 256),
  };
}

export function getKnowledgeNeighborhood(graph, { nodeId, hops = 1 }) {
  const selected = new Set([nodeId]);
  let frontier = new Set(selected);
  let truncated = false;
  for (let hop = 0; hop < Math.min(2, Math.max(1, hops)); hop += 1) {
    const next = new Set();
    for (const edge of graph.edges) {
      const other = frontier.has(edge.source) ? edge.target : frontier.has(edge.target) ? edge.source : null;
      if (!other || selected.has(other)) continue;
      if (selected.size >= 512) { truncated = true; continue; }
      next.add(other);
      selected.add(other);
    }
    frontier = next;
  }
  const edges = graph.edges.filter((edge) => selected.has(edge.source) && selected.has(edge.target));
  return {
    revision: graph.source.revision, nodes: graph.nodes.filter((node) => selected.has(node.id)),
    edges: edges.slice(0, 2048), truncated: truncated || edges.length > 2048, hops,
  };
}

export function createKnowledgeContextItem(excerpt) {
  if (!excerpt || typeof excerpt.text !== "string" || excerpt.text.length > MAX_AGENT_CONTENT_CHARACTERS
    || !excerpt.nodeId || !excerpt.relativePath || !excerpt.revision || !excerpt.digest) return null;
  return {
    id: excerpt.nodeId, path: excerpt.relativePath, name: excerpt.title, kind: "note", typeLabel: "Markdown",
    isDirectory: false, isLinked: true, capturedAt: excerpt.capturedAt ?? new Date().toISOString(),
    excerpt: {
      text: excerpt.text, startLine: excerpt.startLine, endLine: excerpt.endLine,
      revision: excerpt.revision, digest: excerpt.digest, truncated: Boolean(excerpt.truncated),
    },
  };
}

export function createNeighborhoodScene(graph, neighborhood) {
  return {
    ...graph, nodes: neighborhood.nodes, edges: neighborhood.edges,
    source: { ...graph.source, revision: `${neighborhood.revision}:local:${neighborhood.hops}:${neighborhood.nodes[0]?.id ?? ""}` },
    stats: { ...graph.stats, nodeCount: neighborhood.nodes.length, edgeCount: neighborhood.edges.length, truncated: neighborhood.truncated },
  };
}
