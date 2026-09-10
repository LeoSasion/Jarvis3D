import assert from "node:assert/strict";
import test from "node:test";
import {
  applyGraphRuntimeQuality,
  createGraphNodeBudgetView,
  createGraphRenderPlan,
} from "../src/graphics/graph/graph-render-policy.js";
import { withGraphFxProfileSetting } from "../src/graphics/graph/graph-fx-profile.js";
import { DEFAULT_GRAPH_VISUAL_SETTINGS } from "../src/graphics/graph/graph-visual-settings.js";
import { graphicsQualityProfiles } from "../src/graphics/graphics-runtime-policy.js";

const graph = {
  nodes: Array.from({ length: 80 }, (_, index) => ({ id: `n-${index}` })),
  edges: Array.from({ length: 9_000 }, (_, index) => ({ id: `e-${index}` })),
};

test("graph render plan caps requested detail without mutating visual intent", () => {
  const plan = createGraphRenderPlan(
    DEFAULT_GRAPH_VISUAL_SETTINGS,
    graphicsQualityProfiles.low,
    {},
    graph,
  );

  assert.equal(plan.labels.requested, 24);
  assert.equal(plan.labels.count, 12);
  assert.equal(plan.edges.count, 4_000);
  assert.equal(plan.layout.edgeBudget, 4_500);
  assert.equal(plan.layout.tickBudget, 96);
  assert.equal(plan.scene.starCount, 100);
  assert.equal(plan.scene.bloom, true);
  assert.equal(plan.scene.bloomMode, "profile");
  assert.equal(plan.profiles["3d"].edge.halo.enabled, true);
  assert.equal(Object.isFrozen(plan.profiles["3d"].edge.halo), true);
  assert.ok(plan.constraints.includes("LABELS 24→12"));
  assert.equal(DEFAULT_GRAPH_VISUAL_SETTINGS.labels.count, 24);
});

test("render plans retain independent 2D and 3D FX profiles", () => {
  const profiles = withGraphFxProfileSetting(
    withGraphFxProfileSetting(
      DEFAULT_GRAPH_VISUAL_SETTINGS.profiles,
      "2d",
      "edge.halo.opacity",
      0.12,
    ),
    "3d",
    "edge.halo.opacity",
    0.72,
  );
  const plan = createGraphRenderPlan(
    { ...DEFAULT_GRAPH_VISUAL_SETTINGS, profiles },
    graphicsQualityProfiles.high,
    {},
    graph,
  );

  assert.equal(plan.profiles["2d"].edge.halo.opacity, 0.12);
  assert.equal(plan.profiles["2d"].edge.halo.enabled, false);
  assert.equal(plan.profiles["3d"].edge.halo.opacity, 0.72);
  assert.equal(plan.profiles["3d"].edge.halo.enabled, true);
  assert.notDeepEqual(plan.profiles["2d"], plan.profiles["3d"]);
});

test("high quality keeps bounded custom appearance and the single bloom plan", () => {
  const plan = createGraphRenderPlan(
    {
      ...DEFAULT_GRAPH_VISUAL_SETTINGS,
      node: { ...DEFAULT_GRAPH_VISUAL_SETTINGS.node, scale: 1.8 },
      edge: { ...DEFAULT_GRAPH_VISUAL_SETTINGS.edge, opacity: 0.12 },
      scene: { ...DEFAULT_GRAPH_VISUAL_SETTINGS.scene, bloom: "on", stars: 420 },
    },
    graphicsQualityProfiles.high,
    {},
    graph,
  );

  assert.equal(plan.nodes.scale, 1.8);
  assert.equal(plan.layout.nodeScale, 1.8);
  assert.equal(plan.edges.opacity, 0.12);
  assert.equal(plan.scene.bloom, true);
  assert.equal(plan.scene.starCount, 420);
});

test("layout diagnostics report the connectivity floor instead of a false hard cap", () => {
  const largeGraph = {
    nodes: Array.from({ length: 5_002 }, (_, index) => ({ id: `n-${index}` })),
    edges: Array.from({ length: 9_000 }, (_, index) => ({ id: `e-${index}` })),
  };
  const plan = createGraphRenderPlan(
    DEFAULT_GRAPH_VISUAL_SETTINGS,
    graphicsQualityProfiles.low,
    {},
    largeGraph,
  );

  assert.equal(plan.layout.targetEdgeBudget, 4_500);
  assert.equal(plan.layout.edgeBudget, 5_001);
  assert.ok(plan.constraints.includes("LAYOUT EDGES 9000→5001"));
  assert.ok(plan.constraints.includes("LAYOUT CONNECTIVITY 4500→5001"));
});

test("effective runtime quality lowers every scene workload budget", () => {
  const requested = createGraphRenderPlan(
    {
      ...DEFAULT_GRAPH_VISUAL_SETTINGS,
      labels: { ...DEFAULT_GRAPH_VISUAL_SETTINGS.labels, count: 48 },
      scene: { ...DEFAULT_GRAPH_VISUAL_SETTINGS.scene, stars: 480 },
    },
    graphicsQualityProfiles.high,
    {},
    graph,
  );
  const effective = applyGraphRuntimeQuality(
    requested,
    graphicsQualityProfiles.low,
    graph,
  );

  assert.equal(effective.quality.id, "low");
  assert.equal(effective.labels.count, 12);
  assert.equal(effective.edges.count, 4_000);
  assert.equal(effective.layout.edgeBudget, 4_500);
  assert.equal(effective.layout.tickBudget, 96);
  assert.equal(effective.scene.starCount, 180);
  assert.equal(effective.scene.bloom, true); // Explicit profile Bloom uses quality-bounded mip levels.
  assert.equal(effective.profiles, requested.profiles);
  assert.equal(effective.profiles["3d"].edge.halo.enabled, true);
});

test("node budget views are deterministic, degree-aware, and keep priority nodes", () => {
  const nodes = Array.from({ length: 48 }, (_, index) => ({
    id: `n-${String(index).padStart(2, "0")}`,
    pinned: index === 47,
  }));
  const edges = [
    ...Array.from({ length: 40 }, (_, index) => ({
      id: `hub-${index}`,
      source: "n-00",
      target: `n-${String(index + 1).padStart(2, "0")}`,
    })),
    { id: "selected-edge", source: "n-45", target: "n-46" },
  ];
  const source = { nodes, edges, source: { name: "budget-test" } };
  const options = { hoveredNodeId: "n-46", selectedNodeId: "n-45" };
  const first = createGraphNodeBudgetView(source, 32, options);
  const second = createGraphNodeBudgetView(source, 32, options);
  const ids = first.nodes.map((node) => node.id);

  assert.deepEqual(first.nodes.map((node) => node.id), second.nodes.map((node) => node.id));
  assert.deepEqual(first.edges.map((edge) => edge.id), second.edges.map((edge) => edge.id));
  assert.equal(first.nodes.length, 32);
  assert.ok(ids.includes("n-00"));
  assert.ok(ids.includes("n-45"));
  assert.ok(ids.includes("n-46"));
  assert.ok(ids.includes("n-47"));
  assert.ok(first.edges.every((edge) => (
    ids.includes(edge.source) && ids.includes(edge.target)
  )));
});

test("node budget filtering removes relations with missing endpoints and reports NODES", () => {
  const source = {
    nodes: Array.from({ length: 40 }, (_, index) => ({ id: `node-${index}` })),
    edges: Array.from({ length: 39 }, (_, index) => ({
      id: `edge-${index}`,
      source: "node-0",
      target: `node-${index + 1}`,
    })),
  };
  const budget = createGraphNodeBudgetView(source, 32);
  const plan = createGraphRenderPlan(
    {
      ...DEFAULT_GRAPH_VISUAL_SETTINGS,
      node: { ...DEFAULT_GRAPH_VISUAL_SETTINGS.node, maxCount: 32 },
    },
    graphicsQualityProfiles.high,
    {},
    budget,
  );
  const visibleIds = new Set(budget.nodes.map((node) => node.id));

  assert.equal(budget.nodeBudget.requested, 40);
  assert.equal(budget.nodeBudget.count, 32);
  assert.ok(budget.edges.every((edge) => (
    visibleIds.has(edge.source) && visibleIds.has(edge.target)
  )));
  assert.equal(plan.nodes.count, 32);
  assert.ok(plan.constraints.includes("NODES 40→32"));
});
