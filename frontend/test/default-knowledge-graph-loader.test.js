import assert from "node:assert/strict";
import test from "node:test";
import { loadDefaultKnowledgeGraph } from "../src/graph/default-knowledge-graph-loader.js";

function createChunkedPlatform({ staleOnce = false } = {}) {
  const nodes = Array.from({ length: 5 }, (_, index) => ({
    id: `note-${index}.md`,
    title: `Note ${index}`,
  }));
  const edges = nodes.slice(1).map((node, index) => ({
    id: `edge-${index}`,
    source: nodes[index].id,
    target: node.id,
  }));
  let revision = "revision-a";
  let stale = staleOnce;
  let manifestCalls = 0;
  let chunkCalls = 0;
  const manifestRequests = [];
  return {
    get manifestCalls() { return manifestCalls; },
    get chunkCalls() { return chunkCalls; },
    get manifestRequests() { return manifestRequests; },
    platform: {
      knowledgeGraph: {
        async getDefaultManifest(request = {}) {
          manifestCalls += 1;
          manifestRequests.push(request);
          return {
            available: true,
            revision,
            nodeCount: nodes.length,
            edgeCount: edges.length,
            nodeChunkSize: 2,
            edgeChunkSize: 2,
            source: { name: "Vault", revision },
            stats: { nodeCount: nodes.length, edgeCount: edges.length },
          };
        },
        async getDefaultChunk(request) {
          chunkCalls += 1;
          if (stale) {
            stale = false;
            revision = "revision-b";
            const error = new Error("stale");
            error.code = "GRAPH_REVISION_STALE";
            throw error;
          }
          const chunkNodes = request.nodeLimit > 0
            ? nodes.slice(request.nodeOffset, request.nodeOffset + request.nodeLimit)
            : [];
          const chunkEdges = request.edgeLimit > 0
            ? edges.slice(request.edgeOffset, request.edgeOffset + request.edgeLimit)
            : [];
          return {
            revision,
            nodes: chunkNodes,
            edges: chunkEdges,
            nextNodeOffset: request.nodeOffset + chunkNodes.length,
            nextEdgeOffset: request.edgeOffset + chunkEdges.length,
          };
        },
      },
    },
  };
}

test("loads a revision-stable graph through bounded chunks", async () => {
  const fixture = createChunkedPlatform();
  const graph = await loadDefaultKnowledgeGraph(fixture.platform);
  assert.equal(graph.nodes.length, 5);
  assert.equal(graph.edges.length, 4);
  assert.equal(graph.source.revision, "revision-a");
});

test("restarts a chunked load when the manifest revision becomes stale", async () => {
  const fixture = createChunkedPlatform({ staleOnce: true });
  const graph = await loadDefaultKnowledgeGraph(fixture.platform);
  assert.equal(graph.source.revision, "revision-b");
  assert.equal(fixture.manifestCalls, 2);
});

test("reuses an unchanged revision without transferring graph chunks", async () => {
  const fixture = createChunkedPlatform();
  const previousGraph = await loadDefaultKnowledgeGraph(fixture.platform);
  const transferredChunks = fixture.chunkCalls;
  const graph = await loadDefaultKnowledgeGraph(fixture.platform, { previousGraph });
  assert.equal(graph, previousGraph);
  assert.equal(fixture.chunkCalls, transferredChunks);
});

test("refreshes Vault metadata even when the graph payload revision is unchanged", async () => {
  const fixture = createChunkedPlatform();
  const previousGraph = await loadDefaultKnowledgeGraph(fixture.platform);
  const transferredChunks = fixture.chunkCalls;
  const originalManifest = fixture.platform.knowledgeGraph.getDefaultManifest;
  fixture.platform.knowledgeGraph.getDefaultManifest = async (request) => {
    const manifest = await originalManifest(request);
    return {
      ...manifest,
      source: { ...manifest.source, name: "Copied Vault" },
      stats: { ...manifest.stats, skippedFileCount: 2 },
    };
  };

  const graph = await loadDefaultKnowledgeGraph(fixture.platform, { previousGraph });
  assert.notEqual(graph, previousGraph);
  assert.equal(graph.nodes, previousGraph.nodes);
  assert.equal(graph.edges, previousGraph.edges);
  assert.equal(graph.source.name, "Copied Vault");
  assert.equal(graph.stats.skippedFileCount, 2);
  assert.equal(fixture.chunkCalls, transferredChunks);
});

test("forwards an explicit rescan only to the manifest boundary", async () => {
  const fixture = createChunkedPlatform();
  const previousGraph = await loadDefaultKnowledgeGraph(fixture.platform);
  const graph = await loadDefaultKnowledgeGraph(fixture.platform, {
    previousGraph,
    forceRefresh: true,
  });
  assert.deepEqual(graph.nodes, previousGraph.nodes);
  assert.deepEqual(fixture.manifestRequests.at(-1), { force: true });
});

test("an aborted graph load stops before requesting another chunk", async () => {
  const fixture = createChunkedPlatform();
  const abortController = new AbortController();
  const originalChunk = fixture.platform.knowledgeGraph.getDefaultChunk;
  fixture.platform.knowledgeGraph.getDefaultChunk = async (request) => {
    const result = await originalChunk(request);
    abortController.abort();
    return result;
  };

  await assert.rejects(
    loadDefaultKnowledgeGraph(fixture.platform, { signal: abortController.signal }),
    (error) => error.name === "AbortError",
  );
  assert.equal(fixture.chunkCalls, 1);
});

test("falls back to the legacy source method when chunking is unavailable", async () => {
  const graph = await loadDefaultKnowledgeGraph({
    knowledgeGraph: {
      async getDefaultSource() {
        return { nodes: [{ id: "home.md", title: "Home" }], edges: [] };
      },
    },
  });
  assert.equal(graph.nodes[0].title, "Home");
});
