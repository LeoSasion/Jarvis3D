import assert from "node:assert/strict";
import test from "node:test";
import {
  graphSourceLimits,
  isRenderableGraphSource,
  normalizeGraphSource,
} from "../src/graph/graph-source-model.js";

test("graph source normalization keeps bounded metadata and valid relations", () => {
  const graph = normalizeGraphSource({
    SchemaVersion: 1,
    Source: { Kind: "obsidian", Name: "Vault", Simulation: false },
    Nodes: [
      { Id: "知识库/甲.md", Title: "甲", Tags: ["#主题", "主题"], Weight: 3 },
      { Id: "知识库/乙.md", Title: "乙", Resolved: false },
    ],
    Edges: [
      {
        Source: "知识库/甲.md",
        Target: "知识库/乙.md",
        Kind: "wikilink",
        Syntax: "wikilink",
        DisplayText: "乙节点",
        RelationType: "共同概念",
        RelationValues: ["版型", "面料"],
        OccurrenceCount: 2,
      },
      { Source: "知识库/甲.md", Target: "missing", Kind: "wikilink" },
    ],
  });

  assert.equal(graph.source.kind, "obsidian");
  assert.equal(graph.source.name, "Vault");
  assert.deepEqual(graph.nodes[0].tags, ["主题"]);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].relationType, "共同概念");
  assert.deepEqual(graph.edges[0].relationValues, ["版型", "面料"]);
  assert.equal(graph.edges[0].occurrenceCount, 2);
  assert.equal(graph.stats.unresolvedNodeCount, 1);
  assert.equal(isRenderableGraphSource(graph), true);
});

test("graph source normalization enforces renderer budgets", () => {
  const nodes = Array.from({ length: graphSourceLimits.nodes + 12 }, (_, index) => ({
    id: `node-${index}`,
    title: `Node ${index}`,
  }));
  const graph = normalizeGraphSource({ nodes, edges: [] });

  assert.equal(graph.nodes.length, graphSourceLimits.nodes);
  assert.equal(graph.stats.truncated, true);
});

test("graph source normalization rejects duplicate node identities", () => {
  const graph = normalizeGraphSource({
    nodes: [
      { id: "知识库/甲.md", title: "甲" },
      { id: "知识库/甲.md", title: "重复甲" },
      { id: "知识库/乙.md", title: "乙" },
    ],
    edges: [{ source: "知识库/甲.md", target: "知识库/乙.md" }],
  });

  assert.deepEqual(graph.nodes.map((node) => node.title), ["甲", "乙"]);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.stats.truncated, false);
});

test("graph source normalization preserves distinct relation types between the same nodes", () => {
  const graph = normalizeGraphSource({
    nodes: [
      { id: "知识库/甲.md", title: "甲" },
      { id: "知识库/乙.md", title: "乙" },
    ],
    edges: [
      {
        source: "知识库/甲.md",
        target: "知识库/乙.md",
        kind: "property",
        fragmentKind: "frontmatter",
        fragment: "关系",
        relationType: "上游",
      },
      {
        source: "知识库/甲.md",
        target: "知识库/乙.md",
        kind: "property",
        fragmentKind: "frontmatter",
        fragment: "关系",
        relationType: "依赖",
      },
    ],
  });

  assert.deepEqual(graph.edges.map((edge) => edge.relationType), ["上游", "依赖"]);
});

test("an empty but available Vault remains connected without claiming renderable nodes", () => {
  const graph = normalizeGraphSource({
    available: true,
    source: { kind: "obsidian-vault", name: "Empty Vault", revision: "empty" },
    nodes: [],
    edges: [],
  });
  assert.equal(graph.available, true);
  assert.equal(isRenderableGraphSource(graph), false);
});
