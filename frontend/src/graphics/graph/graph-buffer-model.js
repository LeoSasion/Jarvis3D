const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function hashText(hash, value) {
  const text = String(value ?? "");
  let next = hash;
  for (let index = 0; index < text.length; index += 1) {
    next ^= text.charCodeAt(index);
    next = Math.imul(next, 16_777_619);
  }
  return next >>> 0;
}

function initialPosition(node, index, dimension) {
  if (Number.isFinite(node.x) && Number.isFinite(node.y)) {
    return [node.x, node.y, dimension === 3 && Number.isFinite(node.z) ? node.z : 0];
  }
  const radius = 12 * Math.sqrt(index + 1);
  const angle = GOLDEN_ANGLE * index;
  return [
    Math.cos(angle) * radius,
    Math.sin(angle) * radius,
    dimension === 3 ? Math.sin(angle * 0.61) * radius * 0.28 : 0,
  ];
}

function nodePriority(node, degree = node.degree) {
  const kindBonus = node.kind === "home" || node.kind === "source"
    ? 1_000
    : node.kind === "moc" || node.kind === "group" ? 500 : 0;
  return kindBonus + (Number(degree) || 0) * 10 + (Number(node.weight) || 1);
}

function createDisjointSet(size) {
  const parents = Int32Array.from({ length: size }, (_, index) => index);
  const ranks = new Uint8Array(size);
  const find = (value) => {
    let root = value;
    while (parents[root] !== root) root = parents[root];
    let current = value;
    while (parents[current] !== current) {
      const parent = parents[current];
      parents[current] = root;
      current = parent;
    }
    return root;
  };
  return {
    union(left, right) {
      const leftRoot = find(left);
      const rightRoot = find(right);
      if (leftRoot === rightRoot) return false;
      if (ranks[leftRoot] < ranks[rightRoot]) {
        parents[leftRoot] = rightRoot;
      } else if (ranks[leftRoot] > ranks[rightRoot]) {
        parents[rightRoot] = leftRoot;
      } else {
        parents[rightRoot] = leftRoot;
        ranks[leftRoot] += 1;
      }
      return true;
    },
  };
}

function rankEdges(edges, hubMask) {
  return [...edges].sort((left, right) => {
    const leftHub = Number(Boolean(hubMask[left.sourceIndex] || hubMask[left.targetIndex]));
    const rightHub = Number(Boolean(hubMask[right.sourceIndex] || hubMask[right.targetIndex]));
    return rightHub - leftHub
      || (Number(right.weight) || 1) - (Number(left.weight) || 1)
      || String(left.id).localeCompare(String(right.id));
  });
}

function createSpanningForest(edges, nodeCount) {
  const disjointSet = createDisjointSet(nodeCount);
  return edges.filter((edge) => disjointSet.union(edge.sourceIndex, edge.targetIndex));
}

function takeUniqueEdges(groups, budget) {
  const limit = Math.max(0, Math.floor(budget));
  if (limit === 0) return [];
  const selected = [];
  const seen = new Set();
  for (const group of groups) {
    for (const edge of group) {
      if (seen.has(edge)) continue;
      seen.add(edge);
      selected.push(edge);
      if (selected.length >= limit) return selected;
    }
  }
  return selected;
}

export function createGraphTopologyModel(graph, options = {}) {
  const dimension = options.dimension === 3 ? 3 : 2;
  const labelBudget = Math.max(0, Math.floor(options.labelBudget ?? 14));
  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  const nodeIndex = new Map(nodes.map((node, index) => [node.id, index]));
  const incidentEdgesByNodeId = new Map(nodes.map((node) => [node.id, []]));
  const adjacentNodeSetsByNodeId = new Map(nodes.map((node) => [node.id, new Set()]));
  const initialPositions = new Float32Array(nodes.length * 3);
  const sizes = new Float32Array(nodes.length);
  const degrees = new Uint32Array(nodes.length);

  nodes.forEach((node, index) => {
    const position = initialPosition(node, index, dimension);
    initialPositions.set(position, index * 3);
  });

  const layoutEdges = [];
  edges.forEach((edge, index) => {
    const sourceIndex = nodeIndex.get(edge.source);
    const targetIndex = nodeIndex.get(edge.target);
    if (sourceIndex === undefined || targetIndex === undefined || sourceIndex === targetIndex) return;
    degrees[sourceIndex] += 1;
    degrees[targetIndex] += 1;
    const normalizedEdge = {
      id: edge.id ?? `${edge.source}:${edge.target}:${index}`,
      source: edge.source,
      target: edge.target,
      sourceIndex,
      targetIndex,
      weight: edge.weight,
      kind: edge.kind,
    };
    layoutEdges.push(normalizedEdge);
    incidentEdgesByNodeId.get(edge.source)?.push(normalizedEdge);
    incidentEdgesByNodeId.get(edge.target)?.push(normalizedEdge);
    adjacentNodeSetsByNodeId.get(edge.source)?.add(edge.target);
    adjacentNodeSetsByNodeId.get(edge.target)?.add(edge.source);
  });

  nodes.forEach((node, index) => {
    const degree = Math.max(degrees[index], Number(node.degree) || 0);
    degrees[index] = degree;
    sizes[index] = Math.min(
      9.2,
      3.72 + Math.sqrt(Math.max(1, degree + (Number(node.weight) || 1))) * 0.48,
    );
  });

  const rankedHubs = nodes
    .map((node, index) => ({ index, priority: nodePriority(node, degrees[index]) }))
    .sort((left, right) => right.priority - left.priority || left.index - right.index);
  const hubCount = nodes.length < 12 ? 0 : Math.min(48, Math.max(3, Math.ceil(nodes.length * 0.04)));
  const hubMask = new Uint8Array(nodes.length);
  rankedHubs.slice(0, hubCount).forEach(({ index }) => { hubMask[index] = 1; });
  nodes.forEach((node, index) => {
    if (["home", "source", "moc", "group"].includes(node.kind)) hubMask[index] = 1;
  });

  const rankedEdges = rankEdges(layoutEdges, hubMask);
  const spanningEdges = createSpanningForest(rankedEdges, nodes.length);
  const adjacentNodeIdsByNodeId = new Map(
    [...adjacentNodeSetsByNodeId].map(([nodeId, adjacent]) => [nodeId, [...adjacent]]),
  );

  let topologyHash = 2_166_136_261;
  nodes.forEach((node) => { topologyHash = hashText(topologyHash, node.id); });
  layoutEdges.forEach((edge) => {
    topologyHash = hashText(topologyHash, edge.source);
    topologyHash = hashText(topologyHash, edge.target);
  });

  const labelIndices = nodes
    .map((node, index) => ({
      index,
      priority: nodePriority(node, degrees[index]),
      title: node.title,
    }))
    .sort((left, right) => (
      right.priority - left.priority
      || String(left.title ?? "").localeCompare(String(right.title ?? ""))
    ))
    .slice(0, labelBudget)
    .map(({ index }) => index);

  return {
    dimension,
    nodes,
    nodeIndex,
    initialPositions,
    sizes,
    degrees,
    hubMask,
    layoutEdges,
    incidentEdgesByNodeId,
    adjacentNodeIdsByNodeId,
    rankedEdges,
    spanningEdges,
    labelIndices,
    topologyKey: topologyHash.toString(36),
  };
}

export function createGraphEdgeView(model, edgeBudget, selectedNodeId = null) {
  const budget = Math.min(
    model.layoutEdges.length,
    Math.max(0, Math.floor(edgeBudget ?? Number.MAX_SAFE_INTEGER)),
  );
  if (budget >= model.layoutEdges.length) return model.layoutEdges;
  const selectedEdges = selectedNodeId == null
    ? []
    : model.incidentEdgesByNodeId?.get(selectedNodeId) ?? [];
  return takeUniqueEdges(
    [selectedEdges, model.spanningEdges, model.rankedEdges],
    budget,
  );
}

export function createGraphFocusedEdgeView(
  model,
  edgeBudget,
  selectedNodeId = null,
  hoveredNodeId = null,
) {
  const budget = Math.min(
    model.layoutEdges.length,
    Math.max(0, Math.floor(edgeBudget ?? Number.MAX_SAFE_INTEGER)),
  );
  if (budget === 0 || (!selectedNodeId && !hoveredNodeId)) return [];
  const hoveredEdges = hoveredNodeId == null
    ? []
    : model.incidentEdgesByNodeId?.get(hoveredNodeId) ?? [];
  const selectedEdges = selectedNodeId == null
    ? []
    : model.incidentEdgesByNodeId?.get(selectedNodeId) ?? [];
  return takeUniqueEdges([hoveredEdges, selectedEdges], budget);
}

export function createGraphAdjacentNodeSet(
  model,
  selectedNodeId = null,
  hoveredNodeId = null,
) {
  const adjacent = new Set();
  for (const nodeId of [selectedNodeId, hoveredNodeId]) {
    if (!nodeId) continue;
    adjacent.add(nodeId);
    for (const adjacentNodeId of model.adjacentNodeIdsByNodeId?.get(nodeId) ?? []) {
      adjacent.add(adjacentNodeId);
    }
  }
  return adjacent;
}

export function createGraphLayoutEdgeView(model, edgeBudget) {
  const budget = Math.min(
    model.layoutEdges.length,
    Math.max(model.spanningEdges.length, Math.floor(edgeBudget ?? Number.MAX_SAFE_INTEGER)),
  );
  if (budget >= model.layoutEdges.length) return model.layoutEdges;
  return takeUniqueEdges([model.spanningEdges, model.rankedEdges], budget);
}

export function createGraphBufferModel(graph, options = {}) {
  const model = createGraphTopologyModel(graph, options);
  const edges = createGraphEdgeView(model, options.edgeBudget, options.selectedNodeId);
  return {
    ...model,
    edges,
    edgePairs: Int32Array.from(edges.flatMap((edge) => [edge.sourceIndex, edge.targetIndex])),
  };
}

export function createDeterministicStarField(count, radius = 520) {
  const positions = new Float32Array(Math.max(0, count) * 3);
  for (let index = 0; index < count; index += 1) {
    const unit = (index * 0.618033988749895) % 1;
    const angle = index * GOLDEN_ANGLE;
    const distance = radius * Math.sqrt(unit);
    positions[index * 3] = Math.cos(angle) * distance;
    positions[index * 3 + 1] = Math.sin(angle) * distance;
    positions[index * 3 + 2] = -24 - (index % 9) * 2;
  }
  return positions;
}
