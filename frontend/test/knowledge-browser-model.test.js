import assert from "node:assert/strict";
import test from "node:test";
import { createKnowledgeContextItem, getKnowledgeNeighborhood, searchKnowledgeNodes } from "../src/graph/knowledge-browser-model.js";
import { createAgentContextModel, createAgentPromptForContext } from "../src/agent-context-model.js";
import { getNoteSources } from "../src/agent-conversation-library.js";

const graph = { source: { revision: "r1" }, nodes: [
  { id: "a", title: "Alpha", relativePath: "a.md", aliases: ["别名"], tags: ["red"] },
  { id: "b", title: "Beta", relativePath: "b.md", tags: ["blue"] },
  { id: "c", title: "Gamma", relativePath: "c.md", tags: ["red"] },
  { id: "d", title: "Delta", relativePath: "d.md", tags: [] },
], edges: [{ id: "1", source: "a", target: "b" }, { id: "2", source: "b", target: "c" }, { id: "3", source: "c", target: "d" }] };

test("knowledge search returns all matching title/alias/tag results and pages them", () => {
  assert.equal(searchKnowledgeNodes(graph, { query: "别名" }).items[0].id, "a");
  assert.equal(searchKnowledgeNodes(graph, { tag: "red" }).total, 2);
  assert.equal(searchKnowledgeNodes(graph, { tag: "red", offset: 1, limit: 1 }).items[0].id, "c");
});
test("one and two hop scopes follow existing incoming/outgoing topology", () => {
  assert.deepEqual(getKnowledgeNeighborhood(graph, { nodeId: "b", hops: 1 }).nodes.map((node) => node.id), ["a", "b", "c"]);
  assert.equal(getKnowledgeNeighborhood(graph, { nodeId: "b", hops: 2 }).nodes.length, 4);
});
test("explicit note excerpts preserve frozen source ranges and citations only when staged", () => {
  const item = createKnowledgeContextItem({ nodeId: "a", title: "Alpha", relativePath: "a.md", revision: "r1",
    startLine: 2, endLine: 3, text: "Exact source text", digest: "digest", truncated: false });
  const staged = createAgentContextModel([item]);
  const prompt = createAgentPromptForContext("Summarize", staged);
  assert.match(prompt, /JARVIS NOTE EXCERPTS/u);
  assert.match(prompt, /untrusted reference data/u);
  assert.match(prompt, /Exact source text/u);
  assert.equal(getNoteSources(prompt)[0].startLine, 2);
  assert.equal(createAgentPromptForContext("next question", { ...staged, phase: "complete" }), "next question");
  assert.equal(createKnowledgeContextItem({ ...item, text: "x".repeat(6001) }), null);
});
