// A deterministic, planar layout and edge bundling treatment for source-backed
// graphs. Routing forks are geometry only: they never create nodes or relations.
const TAU = Math.PI * 2;
export const NEURON_EDGE_SEGMENTS = 24;

function hash(value) {
  let result = 2166136261;
  for (const character of String(value)) {
    result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  }
  return (result >>> 0) / 4294967296;
}

function compareId(left, right) {
  return String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0;
}

export function createNeuronStructure(nodes, edges) {
  const indexById = new Map(nodes.map((node, index) => [node.id, index]));
  const adjacent = nodes.map(() => new Set());
  for (const edge of edges) {
    const source = indexById.get(edge.source);
    const target = indexById.get(edge.target);
    if (source === undefined || target === undefined || source === target) continue;
    adjacent[source].add(target);
    adjacent[target].add(source);
  }
  const rank = (index) => adjacent[index].size
    + (["moc", "group"].includes(nodes[index].kind)
      || /(?:^|\/)00-MOC[-.]/i.test(nodes[index].relativePath ?? "") ? nodes.length : 0);
  const ranked = nodes.map((_, index) => index).sort((a, b) => (
    rank(b) - rank(a) || compareId(nodes[a].id, nodes[b].id)
  ));
  const preferred = ranked.filter((index) => ["moc", "group"].includes(nodes[index].kind));
  const count = Math.min(nodes.length, 7, Math.max(
    1, Math.min(preferred.length, 7), Math.round(Math.sqrt(nodes.length) / 6),
  ));
  const groupCounts = new Map();
  nodes.forEach((node) => groupCounts.set(node.group, (groupCounts.get(node.group) ?? 0) + 1));
  const categories = nodes.map((node) => {
    const folders = String(node.relativePath ?? "").split("/").slice(0, -1);
    // A vault often puts nearly every note under one umbrella directory.
    // Use its next source-owned folder level instead of creating one giant cell.
    return (groupCounts.get(node.group) ?? 0) > nodes.length * 0.5 && folders.length > 1
      ? folders.slice(0, 2).join("/") : node.group || folders.join("/");
  });
  const byCategory = new Map();
  ranked.forEach((index) => {
    const category = categories[index];
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(index);
  });
  const roots = [...byCategory.values()]
    .filter((members) => members.length >= Math.max(2, nodes.length * 0.006))
    .sort((a, b) => b.length - a.length || rank(b[0]) - rank(a[0]))
    .slice(0, count)
    .map((members) => members[0]);
  for (const index of ranked) {
    if (roots.length >= count) break;
    if (!roots.includes(index)) roots.push(index);
  }
  const cluster = new Int32Array(nodes.length).fill(-1);
  const queue = [...roots];
  roots.forEach((index, group) => { cluster[index] = group; });
  // Multi-source breadth-first assignment follows actual connectivity.
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    const neighbors = [...adjacent[index]].sort((a, b) => compareId(nodes[a].id, nodes[b].id));
    for (const neighbor of neighbors) {
      if (cluster[neighbor] !== -1) continue;
      cluster[neighbor] = cluster[index];
      queue.push(neighbor);
    }
  }
  nodes.forEach((node, index) => {
    if (roots.includes(index)) return;
    const matchingRoots = roots.filter((root) => categories[index] && categories[root] === categories[index]);
    const category = matchingRoots.length === 1 ? roots.indexOf(matchingRoots[0]) : -1;
    if (category >= 0) cluster[index] = category;
    // Disconnected notes remain disconnected; this assigns a position only.
    else if (cluster[index] < 0) cluster[index] = Math.floor(hash(node.id) * Math.max(1, roots.length));
  });
  const members = roots.map(() => []);
  ranked.forEach((index) => members[cluster[index]]?.push(index));
  const rootMask = new Uint8Array(nodes.length);
  roots.forEach((index) => { rootMask[index] = 1; });
  const children = nodes.map(() => []);
  const parents = new Int32Array(nodes.length).fill(-1);
  const visited = new Uint8Array(nodes.length);
  const satellites = roots.map(() => []);
  const orderedNeighbors = adjacent.map((neighbors) => [...neighbors].sort((a, b) => (
    rank(b) - rank(a) || compareId(nodes[a].id, nodes[b].id)
  )));
  roots.forEach((root, group) => {
    const frontier = [root];
    visited[root] = 1;
    const attach = (source, capacity) => {
      let added = 0;
      for (const target of orderedNeighbors[source]) {
        if (added >= capacity) break;
        if (visited[target] || cluster[target] !== group) continue;
        parents[target] = source;
        children[source].push(target);
        visited[target] = 1;
        frontier.push(target);
        added += 1;
      }
      return added;
    };
    let cursor = 0;
    while (true) {
      while (cursor < frontier.length) {
        const source = frontier[cursor++];
        attach(source, source === root ? 9 : 3);
      }
      // A star or sparse component may need extra branches from visited notes.
      let attached = 0;
      for (const source of [...frontier]) attached += attach(source, source === root ? 9 : 3);
      if (attached) continue;
      const isolated = members[group].find((index) => !visited[index]);
      if (isolated === undefined) break;
      visited[isolated] = 1;
      satellites[group].push(isolated);
      frontier.push(isolated);
    }
  });
  const normalizedEdges = edges.flatMap((edge) => {
    const sourceIndex = indexById.get(edge.source);
    const targetIndex = indexById.get(edge.target);
    return sourceIndex === undefined || targetIndex === undefined || sourceIndex === targetIndex
      ? [] : [{ ...edge, sourceIndex, targetIndex }];
  });
  const forestParents = nodes.map((_, index) => index);
  const find = (index) => {
    while (forestParents[index] !== index) {
      forestParents[index] = forestParents[forestParents[index]];
      index = forestParents[index];
    }
    return index;
  };
  const isBranch = (edge) => parents[edge.sourceIndex] === edge.targetIndex
    || parents[edge.targetIndex] === edge.sourceIndex;
  const orderedEdges = normalizedEdges.sort((a, b) => (
    Number(isBranch(b)) - Number(isBranch(a))
    || Number(rootMask[b.sourceIndex] || rootMask[b.targetIndex]) - Number(rootMask[a.sourceIndex] || rootMask[a.targetIndex])
    || compareId(a.id ?? `${a.source}:${a.target}`, b.id ?? `${b.source}:${b.target}`)
  ));
  const forestEdges = orderedEdges.filter((edge) => {
    const a = find(edge.sourceIndex);
    const b = find(edge.targetIndex);
    if (a === b) return false;
    forestParents[a] = b;
    return true;
  });
  return { roots, rootMask, cluster, members, parents, children, satellites, forestEdges };
}

export function createNeuronPositions(nodes, structure, settings = {}) {
  const positions = new Float32Array(nodes.length * 3);
  const separation = Math.min(2, Math.max(0.5, settings.repulsion ?? 1));
  const branchScale = Math.min(2, Math.max(0.6, settings.linkDistance ?? 1));
  const anchors = [[-215, 128], [223, 138], [300, -72], [80, -208], [-300, -143]];
  const total = structure.roots.length;
  structure.roots.forEach((root, clusterIndex) => {
    const members = structure.members[clusterIndex].filter((index) => index !== root);
    const angle = TAU * clusterIndex / total + 0.48;
    const center = total === 1 ? [0, 0]
      : total <= 5 ? anchors[clusterIndex]
        : [Math.cos(angle) * 345, Math.sin(angle) * 225];
    const cx = center[0] * separation;
    const cy = center[1] * separation;
    positions.set([cx, cy, 0], root * 3);
    const phase = hash(nodes[root].id) * TAU;
    const branches = structure.children[root];
    const density = Math.max(0.8, Math.min(1.15, Math.sqrt(members.length / 100)));
    const pending = branches.map((index, branch) => ({
      index, x: cx, y: cy, direction: phase + branch * TAU / branches.length, depth: 0,
    }));
    structure.satellites[clusterIndex].forEach((index, satellite) => {
      pending.push({ index, x: cx, y: cy, direction: phase + satellite * 2.39996, depth: 0 });
    });
    // Iterative traversal also handles long chains without overflowing the stack.
    for (let cursor = 0; cursor < pending.length; cursor += 1) {
      const { index, x, y, direction, depth } = pending[cursor];
      const jitter = hash(nodes[index].id);
      const length = (depth === 0 ? 34 : Math.max(5, 34 / Math.pow(1.16, depth)))
        * (0.68 + jitter * 0.68) * branchScale * density;
      const bend = (jitter - 0.5) * 0.38;
      const nx = x + Math.cos(direction + bend) * length;
      const ny = y + Math.sin(direction + bend) * length;
      positions.set([nx, ny, 0], index * 3);
      const next = structure.children[index];
      const spread = 0.42 + hash(`${nodes[index].id}:fork`) * 0.55;
      next.forEach((child, order) => pending.push({
        index: child, x: nx, y: ny, depth: depth + 1,
        direction: direction + (next.length === 1 ? 0 : order / (next.length - 1) - 0.5) * spread,
      }));
    }
    const extent = Math.max(1, ...members.map((index) => Math.hypot(
      positions[index * 3] - cx, positions[index * 3 + 1] - cy,
    )));
    const maximum = (100 + Math.sqrt(members.length) * 3.2) * branchScale;
    const scale = Math.min(1, maximum / extent);
    members.forEach((index) => {
      positions[index * 3] = cx + (positions[index * 3] - cx) * scale;
      positions[index * 3 + 1] = cy + (positions[index * 3 + 1] - cy) * scale;
    });
  });
  return positions;
}

export function createNeuronEdgeView(model, budget) {
  return model.neuron.forestEdges.slice(0, Math.max(0, budget));
}

// Cubic routes have exact source endpoints. Quantized radial tangents bundle
// hub links into dendrites; cross-cluster axons use long, gentle bends.
export function writeNeuronCurve(output, offset, positions, edge, structure, segments = NEURON_EDGE_SEGMENTS, curvature = 1) {
  const a = edge.sourceIndex * 3;
  const b = edge.targetIndex * 3;
  const ax = positions[a];
  const ay = positions[a + 1];
  const bx = positions[b];
  const by = positions[b + 1];
  const dx = bx - ax;
  const dy = by - ay;
  const distance = Math.hypot(dx, dy);
  const sourceCluster = structure.cluster[edge.sourceIndex];
  const targetCluster = structure.cluster[edge.targetIndex];
  let c1x = ax + dx / 3;
  let c1y = ay + dy / 3;
  let c2x = ax + dx * 2 / 3;
  let c2y = ay + dy * 2 / 3;
  if (sourceCluster !== targetCluster) {
    const bend = (hash(edge.id ?? `${edge.source}:${edge.target}`) > 0.5 ? 1 : -1) * 0.17;
    c1x += (dx * 0.14 - dy * bend) * curvature;
    c1y += (-dy * 0.08 + dx * bend) * curvature;
    c2x += (-dx * 0.14 + dy * bend * 0.6) * curvature;
    c2y += (dy * 0.08 - dx * bend * 0.6) * curvature;
  } else {
    const sourceRoot = structure.rootMask[edge.sourceIndex];
    const targetRoot = structure.rootMask[edge.targetIndex];
    const root = structure.roots[sourceCluster] * 3;
    const phase = hash(`${sourceCluster}:branch`) * TAU;
    const tangent = (x, y) => {
      const angle = Math.atan2(y - positions[root + 1], x - positions[root]);
      return Math.round((angle - phase) / (TAU / 9)) * TAU / 9 + phase;
    };
    if (sourceRoot || targetRoot) {
      const angle = tangent(sourceRoot ? bx : ax, sourceRoot ? by : ay);
      const tx = Math.cos(angle) * distance;
      const ty = Math.sin(angle) * distance;
      if (sourceRoot) {
        c1x += (ax + tx * 0.56 - c1x) * curvature;
        c1y += (ay + ty * 0.56 - c1y) * curvature;
        c2x += (ax + tx * 0.72 - c2x) * curvature;
        c2y += (ay + ty * 0.72 - c2y) * curvature;
      } else {
        c2x += (bx + tx * 0.56 - c2x) * curvature;
        c2y += (by + ty * 0.56 - c2y) * curvature;
        c1x += (bx + tx * 0.72 - c1x) * curvature;
        c1y += (by + ty * 0.72 - c1y) * curvature;
      }
    } else {
      const bend = (hash(edge.id) - 0.5) * 0.45 * curvature;
      c1x -= dy * bend;
      c1y += dx * bend;
      c2x -= dy * bend;
      c2y += dx * bend;
    }
  }
  let px = ax;
  let py = ay;
  for (let segment = 0; segment < segments; segment += 1) {
    const t = (segment + 1) / segments;
    const u = 1 - t;
    const x = u ** 3 * ax + 3 * u ** 2 * t * c1x + 3 * u * t ** 2 * c2x + t ** 3 * bx;
    const y = u ** 3 * ay + 3 * u ** 2 * t * c1y + 3 * u * t ** 2 * c2y + t ** 3 * by;
    const cursor = offset + segment * 6;
    output[cursor] = px;
    output[cursor + 1] = py;
    output[cursor + 2] = -0.5;
    output[cursor + 3] = x;
    output[cursor + 4] = y;
    output[cursor + 5] = -0.5;
    px = x;
    py = y;
  }
}
