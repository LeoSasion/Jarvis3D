import { createNeuronFilamentWeights, writeNeuronRibbonTangents } from "./graph-neuron-filament.js";

const TAU = Math.PI * 2;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const hash = (value) => {
  let seed = 2166136261;
  for (const character of String(value)) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  return (seed >>> 0) / 4294967296;
};
const normalize = (v) => { const length = Math.hypot(...v) || 1; return v.map((x) => x / length); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// Idle connections are decorative. Every position still belongs to exactly one
// source note; this model never supplies edges to Explore or relation lookup.
export function createNeuronSphereModel(nodes, { radius = 265, branchSpread = 1, density = 1.2, shellRatio = 0.92, degrees = [], edgeCount = 12 } = {}) {
  const count = nodes.length;
  const hubCount = Math.min(count, Math.max(1, Math.min(18, Math.round(Math.sqrt(count) / 2.1))));
  const ordered = nodes.map((_, index) => index).sort((a, b) =>
    (degrees[b] ?? 0) - (degrees[a] ?? 0) || String(nodes[a].id).localeCompare(String(nodes[b].id)));
  const roots = ordered.slice(0, hubCount);
  const members = roots.map((root) => [root]);
  ordered.slice(hubCount).sort((a, b) => hash(nodes[a].id) - hash(nodes[b].id)).forEach((index, rank) => members[rank % hubCount].push(index));
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const scales = new Float32Array(count);
  const cluster = new Int32Array(count);
  const rootMask = new Uint8Array(count);
  const parents = new Int32Array(count).fill(-1);
  let shellNodeCount = 0;
  const edges = [];
  const directions = roots.map((_, group) => {
    const y = 1 - (group + 0.5) / hubCount * 2;
    const ring = Math.sqrt(1 - y * y);
    return [Math.cos(group * GOLDEN + 0.4) * ring, y, Math.sin(group * GOLDEN + 0.4) * ring];
  });
  const coverage = Math.sqrt(4 * Math.PI / Math.max(1, hubCount)) * 0.9 * branchSpread;
  members.forEach((indices, group) => {
    const normal = directions[group];
    const u = normalize(cross(Math.abs(normal[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], normal));
    const v = cross(normal, u);
    const local = [];
    const phase = hash(nodes[indices[0]].id) * TAU;
    const arms = 6 + Math.floor(hash(`${nodes[indices[0]].id}:arms`) * 3);
    indices.forEach((index, rank) => {
      cluster[index] = group;
      phases[index] = hash(nodes[index].id) * TAU;
      rootMask[index] = Number(rank === 0);
      if (rank === 0) local.push({ x: 0, y: 0, angle: phase, depth: 0 });
      else {
        const parentRank = rank <= arms ? 0 : 1 + Math.floor((rank - arms - 1) / 3);
        const parent = local[parentRank];
        parents[index] = indices[parentRank];
        const depth = parent.depth + 1;
        const angle = rank <= arms ? phase + (rank - 1) / arms * TAU + (hash(nodes[index].id) - 0.5) * 0.4
          : parent.angle + ((rank - arms - 1) % 3 - 1) * 0.6 + (hash(nodes[index].id) - 0.5) * 0.65;
        const distance = coverage * (rank <= arms ? 0.26 : 0.29 / Math.pow(1.27, depth - 1))
          * (0.75 + hash(`${nodes[index].id}:length`) * 0.5);
        local.push({ x: parent.x + Math.cos(angle) * distance, y: parent.y + Math.sin(angle) * distance, angle, depth });
        edges.push({ sourceIndex: indices[parentRank], targetIndex: index, surface: true, strength: depth === 1 ? 1 : 0.58 });
      }
      const point = local[rank];
      const spread = Math.hypot(point.x, point.y);
      const tangentScale = spread > 0 ? Math.sin(spread) / spread : 1;
      const radial = Math.cos(spread);
      const onShell = rank === 0 || hash(`${nodes[index].id}:shell`) < shellRatio;
      shellNodeCount += Number(onShell);
      const depth = onShell ? 0.975 + hash(`${index}:depth`) * 0.04 : 0.65 + hash(`${index}:depth`) * 0.2;
      for (let axis = 0; axis < 3; axis += 1) positions[index * 3 + axis] = radius * depth
        * (normal[axis] * radial + (u[axis] * point.x + v[axis] * point.y) * tangentScale);
      scales[index] = rank === 0 ? 3 : 0.4 + hash(`${index}:size`) * 0.22;
    });
  });
  const pairs = new Set(edges.map((edge) => [edge.sourceIndex, edge.targetIndex].sort((a, b) => a - b).join(":")));
  const add = (a, b, surface) => {
    const key = [a, b].sort((x, y) => x - y).join(":");
    if (a === undefined || b === undefined || a === b || pairs.has(key)) return;
    pairs.add(key); edges.push({ sourceIndex: a, targetIndex: b, surface, strength: 0.65 });
  };
  roots.forEach((root, group) => {
    const neighbors = roots.map((_, i) => i).filter((i) => i !== group).sort((a, b) => {
      const distance = (i) => directions[i].reduce((sum, x, axis) => sum + (x - directions[group][axis]) ** 2, 0);
      return distance(a) - distance(b);
    });
    for (const neighbor of neighbors.slice(0, Math.max(1, Math.round(density * 2)))) add(root, roots[neighbor], true);
    if (density >= 0.5) add(root, roots[neighbors[Math.min(neighbors.length - 1, Math.floor(hubCount * 0.55))]], false);
  });
  return { nodeCount: count, shellNodeCount, radius, positions, phases, scales, roots, rootMask, parents, cluster, edges,
    shellEdgePairs: Int32Array.from(edges.flatMap((edge) => [edge.sourceIndex, edge.targetIndex])),
    signalEdgeIndices: Uint32Array.from({ length: Math.min(12, edgeCount) }, (_, i) => Math.min(edgeCount - 1, Math.floor((i + 0.35) / 12 * edgeCount))) };
}

export function createNeuronSphereCurves(model, segments = 24, weave = 0.8) {
  const starts = new Float32Array(model.edges.length * segments * 3);
  const ends = new Float32Array(starts.length);
  const strengths = new Float32Array(model.edges.length * segments);
  const widths = new Float32Array(strengths.length);
  model.edges.forEach((edge, index) => {
    const a = Array.from(model.positions.slice(edge.sourceIndex * 3, edge.sourceIndex * 3 + 3));
    const b = Array.from(model.positions.slice(edge.targetIndex * 3, edge.targetIndex * 3 + 3));
    const side = normalize(cross(a, b));
    const distance = Math.hypot(...a.map((x, axis) => x - b[axis]));
    const curvature = (hash(`${edge.sourceIndex}:${edge.targetIndex}`) - 0.5) * distance * 0.6 * weave;
    const point = (t) => {
      const bend = Math.sin(Math.PI * t) * curvature + Math.sin(3 * Math.PI * t) * distance * 0.025 * weave;
      let xyz = a.map((x, axis) => x * (1 - t) + b[axis] * t + side[axis] * bend);
      if (edge.surface) {
        const targetRadius = Math.hypot(...a) * (1 - t) + Math.hypot(...b) * t;
        const length = Math.hypot(...xyz) || 1;
        xyz = xyz.map((x) => x * targetRadius / length);
      }
      return xyz;
    };
    let previous = a;
    for (let segment = 0; segment < segments; segment += 1) {
      const next = segment === segments - 1 ? b : point((segment + 1) / segments);
      const slot = index * segments + segment;
      starts.set(previous, slot * 3); ends.set(next, slot * 3);
      strengths[slot] = edge.strength; widths[slot] = 0.85 + edge.strength * 0.45;
      previous = next;
    }
  });
  const tangentStarts = new Float32Array(starts.length);
  const tangentEnds = new Float32Array(starts.length);
  writeNeuronRibbonTangents(starts, ends, segments, tangentStarts, tangentEnds);
  return { starts, ends, strengths, widths, segments, tangentStarts, tangentEnds,
    filamentWeights: createNeuronFilamentWeights(model.nodeCount, model, model.edges, segments) };
}
