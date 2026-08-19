import assert from "node:assert/strict";
import test from "node:test";
import {
  clampKnowledgeGraphZoom,
  createKnowledgeGraphModel,
  getKnowledgeGraphNodeContextItem,
  getKnowledgeGraphPresentation,
  getKnowledgeGraphWheelZoomDelta,
  MAX_KNOWLEDGE_GRAPH_ENTRIES,
  normalizeKnowledgeGraphSource,
  normalizeKnowledgeGraphState,
} from "../src/knowledge-graph-model.js";

const source = {
  currentPath: "C:\\Work\\JARVIS",
  entries: [
    { path: "C:\\Work\\JARVIS\\frontend", name: "frontend", kind: "folder", typeLabel: "Folder", isDirectory: true },
    { path: "C:\\Work\\JARVIS\\App.jsx", name: "App.jsx", kind: "code", typeLabel: "JSX", sizeBytes: 4200 },
    { path: "C:\\Work\\JARVIS\\README.md", name: "README.md", kind: "document", typeLabel: "Markdown", sizeBytes: 1200 },
  ],
};

test("knowledge graph remains disconnected without a verified source", () => {
  assert.deepEqual(normalizeKnowledgeGraphState({ connected: true, sourceCount: 0, relationCount: 120 }), {
    connected: false,
    sourceCount: 0,
    relationCount: 0,
    simulation: false,
    provenance: null,
  });
  const presentation = getKnowledgeGraphPresentation(null);
  assert.equal(presentation.status, "disconnected");
  assert.equal(presentation.title, "SOURCE DISCONNECTED");
  assert.match(presentation.announcement, /No verified knowledge source is connected/u);
  assert.deepEqual(presentation.actions.map((action) => action.id), [
    "search-local",
    "open-files",
    "desktop-only",
  ]);
  assert.equal(presentation.actions.some((action) => /agent|connected/iu.test(`${action.label} ${action.detail}`)), false);
});

test("knowledge graph exposes counts only after a verified connection", () => {
  const presentation = getKnowledgeGraphPresentation({
    connected: true,
    sourceCount: 2,
    relationCount: 48,
  });
  assert.equal(presentation.status, "connected");
  assert.equal(presentation.sourceCount, 2);
  assert.equal(presentation.relationCount, 48);
  assert.match(presentation.detail, /2 SOURCES \/ 48 RELATIONS/u);
  assert.deepEqual(presentation.actions, []);
});

test("knowledge graph builds deterministic relations from an Explorer metadata snapshot", () => {
  const graph = createKnowledgeGraphModel(source, {
    selectedPaths: ["c:\\work\\jarvis\\APP.JSX"],
  });

  assert.equal(graph.connected, true);
  assert.equal(graph.sourceCount, 1);
  assert.equal(graph.visibleEntryCount, 3);
  assert.equal(graph.nodes.filter((node) => node.kind === "source").length, 1);
  assert.equal(graph.nodes.filter((node) => node.kind === "group").length, 3);
  assert.equal(graph.edges.length, 6);
  assert.equal(graph.nodes.find((node) => node.name === "App.jsx").selected, true);
  assert.equal(graph.nodes.find((node) => node.name === "App.jsx").label, "App.jsx");
  assert.ok(["left", "right"].includes(graph.nodes.find((node) => node.name === "App.jsx").labelSide));
  assert.equal(graph.nodes.some((node) => node.label === "ENTITIES"), false);
});

test("knowledge graph filtering and group collapse keep only truthful visible nodes", () => {
  const unfiltered = createKnowledgeGraphModel(source);
  const codeGroup = unfiltered.nodes.find((node) => node.groupKind === "code");
  const collapsed = createKnowledgeGraphModel(source, { collapsedIds: [codeGroup.id] });
  const filtered = createKnowledgeGraphModel(source, { query: "readme" });

  assert.equal(collapsed.nodes.some((node) => node.name === "App.jsx"), false);
  assert.equal(collapsed.nodes.find((node) => node.id === codeGroup.id).expanded, false);
  assert.deepEqual(filtered.nodes.filter((node) => node.kind === "entry").map((node) => node.name), ["README.md"]);
  assert.deepEqual(filtered.nodes.filter((node) => node.kind === "group").map((node) => node.groupKind), ["document"]);
});

test("search temporarily expands a previously collapsed group with a real match", () => {
  const unfiltered = createKnowledgeGraphModel(source);
  const codeGroup = unfiltered.nodes.find((node) => node.groupKind === "code");
  const filtered = createKnowledgeGraphModel(source, {
    query: "app",
    collapsedIds: [codeGroup.id],
  });

  assert.equal(filtered.nodes.find((node) => node.id === codeGroup.id).expanded, true);
  assert.equal(filtered.nodes.some((node) => node.name === "App.jsx"), true);
  assert.equal(filtered.visibleEntryCount, 1);
});

test("simulated Explorer provenance remains explicit in graph presentation", () => {
  const previewSource = {
    ...source,
    simulation: true,
    provenance: {
      kind: "browser-preview",
      dataClass: "simulated-fixture",
      simulated: true,
      nativeHostConnected: false,
    },
  };
  const normalized = normalizeKnowledgeGraphSource(previewSource);
  const presentation = getKnowledgeGraphPresentation(previewSource);

  assert.equal(normalized.simulation, true);
  assert.equal(normalized.provenance.kind, "browser-preview");
  assert.equal(presentation.meta, "SIMULATED EXPLORER FIXTURE");
  assert.match(presentation.announcement, /simulated Explorer preview source/u);
  assert.doesNotMatch(presentation.announcement, /verified source/iu);
});

test("knowledge graph bounds source data and preserves the omitted count", () => {
  const entries = Array.from({ length: MAX_KNOWLEDGE_GRAPH_ENTRIES + 8 }, (_, index) => ({
    path: `C:\\Data\\entry-${index}.txt`,
    name: `entry-${index}.txt`,
    kind: "document",
  }));
  entries.push({ ...entries[0] });
  const normalized = normalizeKnowledgeGraphSource({ currentPath: "C:\\Data", entries });

  assert.equal(normalized.entries.length, MAX_KNOWLEDGE_GRAPH_ENTRIES);
  assert.equal(normalized.totalEntryCount, MAX_KNOWLEDGE_GRAPH_ENTRIES + 8);
  assert.equal(normalized.truncatedCount, 8);
});

test("only actionable source and entry nodes can become metadata-only Agent context", () => {
  const graph = createKnowledgeGraphModel(source);
  const group = graph.nodes.find((node) => node.kind === "group");
  const entry = graph.nodes.find((node) => node.name === "App.jsx");
  const contextItem = getKnowledgeGraphNodeContextItem(entry);

  assert.equal(getKnowledgeGraphNodeContextItem(group), null);
  assert.equal(contextItem.path, "C:\\Work\\JARVIS\\App.jsx");
  assert.equal(contextItem.name, "App.jsx");
  assert.equal(contextItem.sizeBytes, 4200);
  assert.equal("content" in contextItem, false);
});

test("graph zoom clamps invalid and extreme values", () => {
  assert.equal(clampKnowledgeGraphZoom(Number.NaN), 1);
  assert.equal(clampKnowledgeGraphZoom(0.1), 0.72);
  assert.equal(clampKnowledgeGraphZoom(4), 2.2);
  assert.equal(clampKnowledgeGraphZoom(1.4), 1.4);
});

test("graph wheel zoom is proportional across mouse and trackpad delta modes", () => {
  assert.equal(getKnowledgeGraphWheelZoomDelta(Number.NaN), 0);
  assert.equal(getKnowledgeGraphWheelZoomDelta(1), -0.0012);
  assert.equal(getKnowledgeGraphWheelZoomDelta(-1), 0.0012);
  assert.equal(getKnowledgeGraphWheelZoomDelta(3, 1), -0.0576);
  assert.equal(getKnowledgeGraphWheelZoomDelta(1, 2), -0.16);
  assert.equal(getKnowledgeGraphWheelZoomDelta(10_000), -0.16);
});
