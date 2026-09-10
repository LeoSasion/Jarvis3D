// Spatial neuron geometry. Every point is a source note and every displayed
// relation comes from the source graph; Bézier control points are only routing.
const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export const NEURON_SPATIAL_DEFAULTS = Object.freeze({
  depth: 1, branchSpread: 0.48, weave: 0.8, crossLinks: 0.3, depthContrast: 0.7,
});

function hash(value) {
  let result = 2166136261;
  for (const character of String(value)) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return (result >>> 0) / 4294967296;
}

function bounded(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function normalize(x, y, z) {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function basis(direction) {
  const [x, y, z] = direction;
  const side = Math.abs(z) < 0.9 ? normalize(-y, x, 0) : normalize(0, -z, y);
  return [side, [y * side[2] - z * side[1], z * side[0] - x * side[2], x * side[1] - y * side[0]]];
}

export function createSpatialNeuronPositions(nodes, structure, settings = {}) {
  const positions = new Float32Array(nodes.length * 3);
  const separation = bounded(settings.repulsion, 0.5, 2, 1.15);
  const branchScale = bounded(settings.linkDistance, 0.6, 2, 1.2);
  const depthScale = bounded(settings.depth, 0.2, 2, 1);
  const branchSpread = bounded(settings.branchSpread, 0.15, 1, 0.48);
  const anchors = [
    [-205, -92, 60], [-200, 135, -55], [220, -5, 5],
    [230, 165, -200], [165, -175, -115], [18, 185, -95], [-10, -190, 35],
  ];
  structure.roots.forEach((root, group) => {
    const members = structure.members[group];
    const center = structure.roots.length === 1 ? [0, 0, 0] : anchors[group % anchors.length];
    const origin = center.map((value, axis) => value * separation * (axis === 2 ? depthScale : 1));
    positions.set(origin, root * 3);
    const phase = hash(nodes[root].id) * TAU;
    const primary = [...structure.children[root], ...structure.satellites[group]];
    const pending = primary.map((index, order) => {
      // A rotated Fibonacci sphere gives each primary branch a different plane,
      // including branches approaching and receding from the initial camera.
      const vertical = 1 - 2 * (order + 0.5) / primary.length;
      const radial = Math.sqrt(Math.max(0, 1 - vertical * vertical));
      const angle = phase + order * GOLDEN_ANGLE;
      const tilt = 0.45 + hash(`${nodes[root].id}:tilt`) * 0.8;
      const x = Math.cos(angle) * radial;
      const z = Math.sin(angle) * radial;
      return {
        index, origin: [0, 0, 0], depth: 0,
        direction: [x, vertical * Math.cos(tilt) - z * Math.sin(tilt), vertical * Math.sin(tilt) + z * Math.cos(tilt)],
      };
    });
    const local = new Map([[root, [0, 0, 0]]]);
    for (let cursor = 0; cursor < pending.length; cursor += 1) {
      const branch = pending[cursor];
      const seed = hash(nodes[branch.index].id);
      const length = Math.max(4, 30 / Math.pow(1.12, branch.depth)) * (0.8 + seed * 0.5) * branchScale;
      const point = branch.origin.map((value, axis) => value + branch.direction[axis] * length);
      local.set(branch.index, point);
      const next = structure.children[branch.index];
      const [side, up] = basis(branch.direction);
      next.forEach((index, order) => {
        const angle = order * TAU / next.length + seed * TAU + branch.depth * GOLDEN_ANGLE;
        const spread = next.length > 1 ? branchSpread : branchSpread * 0.27;
        const direction = branch.direction.map((value, axis) => value
          + spread * (Math.cos(angle) * side[axis] + Math.sin(angle) * up[axis]));
        pending.push({ index, origin: point, direction: normalize(...direction), depth: branch.depth + 1 });
      });
    }
    let extent = 1;
    for (const point of local.values()) extent = Math.max(extent, Math.hypot(...point));
    const limit = (92 + Math.sqrt(members.length) * 2.6) * branchScale;
    const scale = Math.min(1, limit / extent);
    for (const [index, point] of local) {
      positions.set(point.map((value, axis) => origin[axis]
        + value * scale * (axis === 2 ? depthScale : axis === 1 ? 0.88 : 1)), index * 3);
    }
  });
  return positions;
}

const pairKey = (edge) => [edge.source, edge.target].sort().join("\u0000");

// A spanning skeleton preserves connectivity. A bounded second pass adds local
// loops and a few inter-cluster axons without flooding the view with hub edges.
export function createSpatialNeuronEdgeView(model, budget, amount = 0.3) {
  const limit = Math.max(0, Math.floor(budget));
  const selected = model.neuron.forestEdges.slice(0, limit);
  const density = bounded(amount, 0, 1, 0.3);
  const extraLimit = Math.min(limit, selected.length + Math.round(model.nodes.length * density * 0.45));
  if (selected.length >= extraLimit) return selected;
  const seen = new Set(selected.map(pairKey));
  const extraDegree = new Uint8Array(model.nodes.length);
  const pairCounts = new Map();
  const positions = createSpatialNeuronPositions(model.nodes, model.neuron);
  const distance = (edge) => Math.hypot(
    positions[edge.sourceIndex * 3] - positions[edge.targetIndex * 3],
    positions[edge.sourceIndex * 3 + 1] - positions[edge.targetIndex * 3 + 1],
    positions[edge.sourceIndex * 3 + 2] - positions[edge.targetIndex * 3 + 2],
  );
  const candidates = model.layoutEdges.filter((edge) => !seen.has(pairKey(edge))).sort((a, b) => {
    const aHub = Number(Boolean(model.neuron.rootMask[a.sourceIndex] || model.neuron.rootMask[a.targetIndex]));
    const bHub = Number(Boolean(model.neuron.rootMask[b.sourceIndex] || model.neuron.rootMask[b.targetIndex]));
    return aHub - bHub || distance(a) - distance(b) || hash(a.id) - hash(b.id) || String(a.id).localeCompare(String(b.id));
  });
  for (const edge of candidates) {
    const a = edge.sourceIndex;
    const b = edge.targetIndex;
    if (extraDegree[a] >= 2 || extraDegree[b] >= 2 || seen.has(pairKey(edge))) continue;
    const ga = model.neuron.cluster[a];
    const gb = model.neuron.cluster[b];
    const groupPair = ga < gb ? `${ga}:${gb}` : `${gb}:${ga}`;
    if (ga !== gb && (pairCounts.get(groupPair) ?? 0) >= Math.ceil(density * 3)) continue;
    selected.push(edge);
    seen.add(pairKey(edge));
    extraDegree[a] += 1;
    extraDegree[b] += 1;
    if (ga !== gb) pairCounts.set(groupPair, (pairCounts.get(groupPair) ?? 0) + 1);
    if (selected.length >= extraLimit) break;
  }
  return selected;
}

// Curves bend in a 3D frame perpendicular to their chord, with deterministic
// routing lanes. Endpoints retain their exact Z, including focused relations.
export function writeSpatialNeuronCurve(output, offset, positions, edge, structure, segments = 24, weave = 0.8) {
  const a = edge.sourceIndex * 3;
  const b = edge.targetIndex * 3;
  const start = [positions[a], positions[a + 1], positions[a + 2]];
  const end = [positions[b], positions[b + 1], positions[b + 2]];
  const delta = end.map((value, axis) => value - start[axis]);
  const length = Math.hypot(...delta);
  const cross = structure.cluster[edge.sourceIndex] !== structure.cluster[edge.targetIndex];
  const [side, up] = basis(normalize(...delta));
  const phase = hash(edge.id ?? pairKey(edge)) * TAU;
  const amount = bounded(weave, 0, 1.5, 0.8);
  const bend = Math.min(cross ? 160 : 36, length * (cross ? 0.22 : 0.18)) * amount;
  const controls = [1 / 3, 2 / 3].map((t, control) => start.map((value, axis) => value + delta[axis] * t
    + bend * (side[axis] * Math.cos(phase + control * 0.8) + up[axis] * Math.sin(phase + control * 0.8))));
  // Quantized spatial tangents let high-degree root links share short axon
  // trunks before fanning out. They are routes, not invented intermediate notes.
  if (!cross && (structure.rootMask[edge.sourceIndex] || structure.rootMask[edge.targetIndex])) {
    const sourceRoot = Boolean(structure.rootMask[edge.sourceIndex]);
    const root = sourceRoot ? start : end;
    const other = sourceRoot ? end : start;
    const dx = other[0] - root[0];
    const dy = other[1] - root[1];
    const dz = other[2] - root[2];
    const azimuth = Math.round(Math.atan2(dy, dx) / (TAU / 9)) * TAU / 9;
    const elevation = Math.round(Math.atan2(dz, Math.hypot(dx, dy)) / 0.65) * 0.65;
    const tangent = [Math.cos(azimuth) * Math.cos(elevation), Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation)];
    const control = sourceRoot ? 0 : 1;
    controls[control] = controls[control].map((value, axis) => value
      + (root[axis] + tangent[axis] * length * 0.58 - value) * Math.min(1, amount));
  }
  let previous = start;
  for (let segment = 0; segment < segments; segment += 1) {
    const t = (segment + 1) / segments;
    const u = 1 - t;
    const point = start.map((value, axis) => u ** 3 * value + 3 * u ** 2 * t * controls[0][axis]
      + 3 * u * t ** 2 * controls[1][axis] + t ** 3 * end[axis]);
    output.set(previous, offset + segment * 6);
    output.set(point, offset + segment * 6 + 3);
    previous = point;
  }
}
