// One radius value belongs to each source node. Adjacent tree links therefore
// share their end width, regardless of the direction of a note's actual link.
export function createNeuronFilamentWeights(nodeCount, structure, edges, segments) {
  const radii = new Float32Array(nodeCount);
  const depths = new Int32Array(nodeCount).fill(-1);
  const children = Array.from({ length: nodeCount }, () => []);
  const roots = new Set(structure?.roots ?? []);
  const parents = structure?.parents ?? [];
  const queue = [];
  for (let index = 0; index < nodeCount; index += 1) {
    const parent = parents[index];
    if (parent >= 0 && parent < nodeCount && parent !== index) children[parent].push(index);
    else { depths[index] = roots.has(index) ? 0 : 3; queue.push(index); }
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    // A terminal branch must finish fine even when its real source relation
    // connects directly to a soma rather than traversing several branch nodes.
    radii[index] = children[index].length || roots.has(index)
      ? Math.max(0.025, Math.pow(0.5, depths[index])) : 0.025;
    for (const child of children[index]) {
      if (depths[child] >= 0) continue;
      depths[child] = depths[index] + 1;
      queue.push(child);
    }
  }
  const weights = new Float32Array(edges.length * segments * 2);
  edges.forEach((edge, index) => {
    const a = radii[edge.sourceIndex] ?? 0.025;
    const b = radii[edge.targetIndex] ?? 0.025;
    const branch = parents[edge.sourceIndex] === edge.targetIndex || parents[edge.targetIndex] === edge.sourceIndex;
    const sample = (t) => (a * (1 - t) + b * t)
      // Long axons flare near their somas but stay fine through the interior.
      * (branch ? 1 : 0.18 + 0.82 * Math.pow(Math.abs(t * 2 - 1), 3));
    let previous = sample(0);
    for (let segment = 0; segment < segments; segment += 1) {
      const next = sample((segment + 1) / segments);
      const slot = (index * segments + segment) * 2;
      weights[slot] = previous; weights[slot + 1] = next;
      previous = next;
    }
  });
  return weights;
}

// Neighboring segments share the same tangent at their common point. This
// closes ribbon seams without tube rings, extra triangles or another draw pass.
export function writeNeuronRibbonTangents(starts, ends, segments, tangentStarts, tangentEnds) {
  for (let index = 0; index < starts.length / 3; index += 1) {
    const segment = index % segments;
    const offset = index * 3;
    for (let axis = 0; axis < 3; axis += 1) {
      const previous = starts[offset + axis - (segment > 0 ? 3 : 0)];
      const next = ends[offset + axis + (segment < segments - 1 ? 3 : 0)];
      tangentStarts[offset + axis] = ends[offset + axis] - previous;
      tangentEnds[offset + axis] = next - starts[offset + axis];
    }
  }
}
