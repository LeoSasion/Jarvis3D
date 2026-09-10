import { normalizeGraphFxProfiles } from "./graph-fx-profile.js";

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function freezeSection(value) {
  return Object.freeze({ ...value });
}

function endpointId(endpoint) {
  return typeof endpoint === "object" && endpoint !== null ? endpoint.id : endpoint;
}

function compareStableIds(left, right) {
  const leftId = String(left);
  const rightId = String(right);
  if (leftId < rightId) return -1;
  if (leftId > rightId) return 1;
  return 0;
}

export function createGraphNodeBudgetView(graph = {}, maxCount = 4096, {
  hoveredNodeId = null,
  pinnedNodeIds = [],
  selectedNodeId = null,
} = {}) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const boundedMaxCount = Math.round(clamp(maxCount, 32, 4096, 4096));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const degreeById = new Map(nodes.map((node) => [node.id, 0]));

  edges.forEach((edge) => {
    const source = endpointId(edge.source);
    const target = endpointId(edge.target);
    if (!nodeById.has(source) || !nodeById.has(target)) return;
    degreeById.set(source, (degreeById.get(source) ?? 0) + 1);
    if (target !== source) degreeById.set(target, (degreeById.get(target) ?? 0) + 1);
  });

  const pinned = new Set(pinnedNodeIds ?? []);
  nodes.forEach((node) => {
    if (node.pinned === true) pinned.add(node.id);
  });
  const priority = (node) => {
    if (node.id === selectedNodeId) return 3;
    if (node.id === hoveredNodeId) return 2;
    if (pinned.has(node.id)) return 1;
    return 0;
  };
  const selectedIds = new Set([...nodes]
    .sort((left, right) => (
      priority(right) - priority(left)
      || (degreeById.get(right.id) ?? 0) - (degreeById.get(left.id) ?? 0)
      || compareStableIds(left.id, right.id)
    ))
    .slice(0, boundedMaxCount)
    .map((node) => node.id));
  const visibleNodes = nodes.filter((node) => selectedIds.has(node.id));
  const visibleEdges = edges.filter((edge) => (
    selectedIds.has(endpointId(edge.source)) && selectedIds.has(endpointId(edge.target))
  ));

  return Object.freeze({
    ...graph,
    nodes: Object.freeze(visibleNodes),
    edges: Object.freeze(visibleEdges),
    nodeBudget: freezeSection({
      maxCount: boundedMaxCount,
      requested: nodes.length,
      count: visibleNodes.length,
    }),
  });
}

export function createGraphRenderPlan(settings, quality, environment = {}, graph = {}) {
  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  const requestedNodes = graph?.nodeBudget?.requested ?? nodes.length;
  const maximumNodes = Math.round(clamp(settings?.node?.maxCount, 32, 4096, 4096));
  const nodeCount = Math.min(nodes.length, maximumNodes);
  const requestedLabels = Math.round(clamp(settings?.labels?.count, 0, 64, 24));
  const requestedStars = Math.round(clamp(settings?.scene?.stars, 0, 480, 260));
  const labelCount = Math.min(requestedLabels, quality.labelBudget, nodes.length);
  const edgeCount = Math.min(edges.length, quality.edgeBudget);
  const layoutEdgeTarget = Math.min(
    edges.length,
    quality.layoutEdgeBudget ?? quality.edgeBudget,
  );
  const connectivityFloor = Math.min(edges.length, Math.max(0, nodes.length - 1));
  const layoutEdgeCount = Math.max(layoutEdgeTarget, connectivityFloor);
  const starCount = Math.min(requestedStars, quality.starBudget);
  const profileBloom = settings?.profiles?.[`${settings?.view?.dimension ?? 3}d`]?.postFx?.bloom;
  const bloomMode = profileBloom ? "profile" : settings?.scene?.bloom ?? "auto";
  const bloomRequested = profileBloom?.enabled ?? (bloomMode === "on" || (bloomMode === "auto" && quality.bloom));
  const bloom = bloomRequested
    && (profileBloom || quality.bloom && environment.reducedMotion !== true)
    && environment.forcedColors !== true;

  const constraints = [];
  if (requestedNodes > nodeCount) constraints.push(`NODES ${requestedNodes}→${nodeCount}`);
  if (requestedLabels > labelCount) constraints.push(`LABELS ${requestedLabels}→${labelCount}`);
  if (edges.length > edgeCount) constraints.push(`EDGES ${edges.length}→${edgeCount}`);
  if (edges.length > layoutEdgeCount) {
    constraints.push(`LAYOUT EDGES ${edges.length}→${layoutEdgeCount}`);
  }
  if (layoutEdgeCount > layoutEdgeTarget) {
    constraints.push(`LAYOUT CONNECTIVITY ${layoutEdgeTarget}→${layoutEdgeCount}`);
  }
  if (requestedStars > starCount) constraints.push(`STARS ${requestedStars}→${starCount}`);
  if (bloomRequested && !bloom) constraints.push("BLOOM→OFF");

  return Object.freeze({
    quality,
    sharedStyle: settings?.sharedStyle === true,
    idleShape: settings?.idleShape,
    nodes: freezeSection({
      count: nodeCount,
      requested: requestedNodes,
      maxCount: maximumNodes,
      scale: clamp(settings?.node?.scale, 0.75, 2.5, 1.25),
      opacity: clamp(settings?.node?.opacity, 0.5, 1, 1),
      hubScale: clamp(settings?.node?.hubScale, 1, 2.4, 1.55),
      baseColor: settings?.node?.baseColor ?? "#f5f1e9",
      hubColor: settings?.node?.hubColor ?? "#d8b99d",
      activeColor: settings?.node?.activeColor ?? "#ff6b2b",
      groupColor: settings?.node?.groupColor ?? "#f0c6ad",
    }),
    edges: freezeSection({
      color: settings?.edge?.color ?? "#77736c",
      opacity: clamp(settings?.edge?.opacity, 0.05, 0.55, 0.2),
      count: edgeCount,
      requested: edges.length,
    }),
    labels: freezeSection({
      count: labelCount,
      requested: requestedLabels,
      fontSize: clamp(settings?.labels?.fontSize, 8, 14, 10),
      opacity: clamp(settings?.labels?.opacity, 0.35, 1, 1),
    }),
    layout: freezeSection({
      mode: settings?.layout?.mode === "neuron" ? "neuron" : "force",
      depth: clamp(settings?.layout?.depth, 0.2, 2, 1),
      branchSpread: clamp(settings?.layout?.branchSpread, 0.15, 1, 0.48),
      weave: clamp(settings?.layout?.weave, 0, 1.5, 0.8),
      crossLinks: clamp(settings?.layout?.crossLinks, 0, 1, 0.3),
      depthContrast: clamp(settings?.layout?.depthContrast, 0, 1, 0.7),
      repulsion: clamp(settings?.layout?.repulsion, 0.5, 2, 1),
      linkDistance: clamp(settings?.layout?.linkDistance, 0.6, 2, 1),
      linkStrength: clamp(settings?.layout?.linkStrength, 0.5, 1.5, 1),
      collision: clamp(settings?.layout?.collision, 0.5, 1.5, 1),
      center: clamp(settings?.layout?.center, 0, 0.12, 0.06),
      edgeBudget: layoutEdgeCount,
      targetEdgeBudget: layoutEdgeTarget,
      tickBudget: Math.round(clamp(quality.layoutTickBudget, 48, 240, 144)),
      nodeScale: clamp(settings?.node?.scale, 0.75, 2.5, 1.25),
      hubScale: clamp(settings?.node?.hubScale, 1, 2.4, 1.55),
    }),
    profiles: normalizeGraphFxProfiles(settings?.profiles),
    scene: freezeSection({
      starCount,
      requestedStars,
      bloom,
      bloomMode,
      bloomIntensity: clamp(settings?.scene?.bloomIntensity, 0.25, 0.85, 0.62),
    }),
    constraints: Object.freeze(constraints),
  });
}

export function applyGraphRuntimeQuality(renderPlan, quality, graph = {}) {
  if (!renderPlan || !quality) return renderPlan;
  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  const edgeCount = Math.min(
    edges.length,
    renderPlan.edges.count,
    Math.max(0, Math.floor(quality.edgeBudget ?? renderPlan.edges.count)),
  );
  const labelCount = Math.min(
    nodes.length,
    renderPlan.labels.count,
    Math.max(0, Math.floor(quality.labelBudget ?? renderPlan.labels.count)),
  );
  const layoutTarget = Math.min(
    edges.length,
    renderPlan.layout.edgeBudget,
    Math.max(0, Math.floor(
      quality.layoutEdgeBudget ?? quality.edgeBudget ?? renderPlan.layout.edgeBudget,
    )),
  );
  const connectivityFloor = Math.min(edges.length, Math.max(0, nodes.length - 1));
  const layoutEdgeBudget = Math.min(
    renderPlan.layout.edgeBudget,
    Math.max(layoutTarget, connectivityFloor),
  );
  const layoutTickBudget = Math.min(
    renderPlan.layout.tickBudget,
    Math.max(24, Math.floor(quality.layoutTickBudget ?? renderPlan.layout.tickBudget)),
  );
  const starCount = Math.min(
    renderPlan.scene.starCount,
    Math.max(0, Math.floor(quality.starBudget ?? renderPlan.scene.starCount)),
  );
  const bloom = Boolean(renderPlan.scene.bloom
    && (renderPlan.scene.bloomMode === "profile" || quality.bloom !== false));

  if (renderPlan.quality === quality
    && renderPlan.edges.count === edgeCount
    && renderPlan.labels.count === labelCount
    && renderPlan.layout.edgeBudget === layoutEdgeBudget
    && renderPlan.layout.tickBudget === layoutTickBudget
    && renderPlan.scene.starCount === starCount
    && renderPlan.scene.bloom === bloom) return renderPlan;

  return Object.freeze({
    ...renderPlan,
    quality,
    edges: freezeSection({ ...renderPlan.edges, count: edgeCount }),
    labels: freezeSection({ ...renderPlan.labels, count: labelCount }),
    layout: freezeSection({
      ...renderPlan.layout,
      edgeBudget: layoutEdgeBudget,
      targetEdgeBudget: layoutTarget,
      tickBudget: layoutTickBudget,
    }),
    scene: freezeSection({ ...renderPlan.scene, bloom, starCount }),
  });
}
