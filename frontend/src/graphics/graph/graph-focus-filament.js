export function getFocusedFilamentGain(elapsed, reducedMotion = false, { boost = 0.3, amplitude = 0.55, period = 2.8 } = {}) {
  const wave = reducedMotion ? 0 : 0.5 - 0.5 * Math.cos(elapsed * Math.PI * 2 / period);
  return 1 + boost + amplitude * wave;
}

export const FOCUSED_SIGNAL_SPEED = 240;
export const FOCUSED_SIGNAL_SPACING = 430;

export function advanceFocusedSignalTravel(current, delta, maximumDistance, speed = 1, spacing = FOCUSED_SIGNAL_SPACING) {
  const next = current + Math.min(0.05, Math.max(0, delta)) * FOCUSED_SIGNAL_SPEED * speed;
  // Keep GPU float precision after hours of selection. Only wrap behind the
  // furthest destination, by full packet intervals, preserving the initial front.
  const loopBase = Math.ceil(maximumDistance / spacing) * spacing;
  return next >= loopBase + spacing
    ? loopBase + (next - loopBase) % spacing : next;
}

// A compact bright head and an orange wake, measured along the model-space
// route. The initial front must arrive before periodic signals can appear.
export const FOCUSED_SIGNAL_SHADER = `
  uniform float lineSignalTravel;
  uniform float lineSignalPeriod;
  uniform float lineSignalHeadLength;
  uniform float lineSignalWakeLength;
  varying vec2 energyLineSignalDistance;
  varying float energyLineSignalSize;

  vec2 focusedSignal(float distanceFromOrigin) {
    if (distanceFromOrigin < 0.0 || lineSignalTravel < distanceFromOrigin) return vec2(0.0);
    float age = lineSignalTravel - distanceFromOrigin;
    if (lineSignalPeriod > 0.0) age = mod(age, lineSignalPeriod);
    float headAge = age / (lineSignalHeadLength * energyLineSignalSize);
    float wakeAge = age / max(0.001, lineSignalWakeLength * energyLineSignalSize);
    float head = smoothstep(0.0, 2.0, headAge) * (1.0 - smoothstep(3.0, 9.0, headAge));
    float wake = smoothstep(0.0, 5.0, wakeAge) * pow(1.0 - smoothstep(5.0, 42.0, wakeAge), 2.0)
      * step(0.001, lineSignalWakeLength);
    return vec2(head, wake);
  }
`;

// Index only the routes already visible at rest. Source relations identify
// destinations; they must never introduce a new shortcut into this network.
export function createRestingRouteIndex(nodes, edges) {
  const adjacency = nodes.map(() => []);
  const nodeIndex = new Map(nodes.map((node, index) => [node.id, index]));
  edges.forEach((edge, edgeIndex) => {
    const source = nodeIndex.get(edge.source);
    const target = nodeIndex.get(edge.target);
    if (source === undefined || target === undefined || source === target) return;
    adjacency[source].push({ node: target, edge: edgeIndex, forward: true });
    adjacency[target].push({ node: source, edge: edgeIndex, forward: false });
  });
  for (const neighbors of adjacency) {
    neighbors.sort((left, right) => {
      const a = `${nodes[left.node].id}\u0000${edges[left.edge].id}`;
      const b = `${nodes[right.node].id}\u0000${edges[right.edge].id}`;
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }
  return { adjacency, nodeIndex };
}

export function createFocusedRestingRoutePlan(index, relations, activeNodeIds) {
  const routeEdges = new Set();
  const trees = [];
  for (const nodeId of new Set(activeNodeIds)) {
    const origin = index.nodeIndex.get(nodeId);
    if (origin === undefined) continue;
    const targets = new Set();
    for (const relation of relations) {
      const peer = relation.source === nodeId ? relation.target
        : relation.target === nodeId ? relation.source : null;
      const target = index.nodeIndex.get(peer);
      if (target !== undefined && target !== origin) targets.add(target);
    }
    if (!targets.size) continue;
    const remaining = new Set(targets);
    const parents = new Int32Array(index.adjacency.length).fill(-1);
    const parentEdges = new Int32Array(parents.length).fill(-1);
    const directions = new Uint8Array(parents.length);
    parents[origin] = origin;
    const queue = [origin];
    // One breadth-first traversal per active node, with deterministic ties.
    for (let cursor = 0; cursor < queue.length && remaining.size; cursor += 1) {
      const current = queue[cursor];
      for (const next of index.adjacency[current]) {
        if (parents[next.node] !== -1) continue;
        parents[next.node] = current;
        parentEdges[next.node] = next.edge;
        directions[next.node] = Number(next.forward);
        remaining.delete(next.node);
        queue.push(next.node);
      }
    }
    const visited = new Uint8Array(parents.length);
    for (const target of targets) {
      if (parents[target] === -1) continue; // No visible route: no invented bridge.
      let current = target;
      while (current !== origin && !visited[current]) {
        visited[current] = 1;
        routeEdges.add(parentEdges[current]);
        current = parents[current];
      }
    }
    // Preserve breadth-first order so a parent's cumulative travel distance is
    // available before its children. Shared branches appear only once per root.
    const steps = queue.filter((node) => visited[node]).map((node) => ({
      node, parent: parents[node], edge: parentEdges[node], forward: Boolean(directions[node]),
    }));
    if (steps.length) trees.push({ origin, steps });
  }
  return { edges: routeEdges, trees };
}

export function findFocusedRestingRoutes(index, relations, activeNodeIds) {
  return createFocusedRestingRoutePlan(index, relations, activeNodeIds).edges;
}

// Two channels support simultaneous selected and hovered origins, including
// opposite travel on a shared edge. Geometry is the same resting ribbon buffer.
export function writeFocusedSignalDistances(target, plan, segments, starts, ends, contacts = []) {
  target.fill(-1);
  contacts.length = 0;
  let maximumDistance = 0;
  const lengths = new Map();
  for (const edge of plan.edges) {
    const cumulative = new Float64Array(segments + 1);
    for (let segment = 0; segment < segments; segment += 1) {
      const offset = (edge * segments + segment) * 3;
      cumulative[segment + 1] = cumulative[segment] + Math.hypot(
        ends[offset] - starts[offset],
        ends[offset + 1] - starts[offset + 1],
        ends[offset + 2] - starts[offset + 2],
      );
    }
    lengths.set(edge, cumulative);
  }
  plan.trees.slice(0, 2).forEach((tree, channel) => {
    const distances = new Map([[tree.origin, 0]]);
    contacts.push({ node: tree.origin, distance: 0, origin: tree.origin });
    for (const step of tree.steps) {
      const cumulative = lengths.get(step.edge);
      const total = cumulative[segments];
      const originDistance = distances.get(step.parent);
      distances.set(step.node, originDistance + total);
      contacts.push({ node: step.node, distance: originDistance + total, origin: tree.origin });
      maximumDistance = Math.max(maximumDistance, originDistance + total);
      for (let segment = 0; segment < segments; segment += 1) {
        const offset = (step.edge * segments + segment) * 4 + channel * 2;
        target[offset] = originDistance + (step.forward ? cumulative[segment] : total - cumulative[segment]);
        target[offset + 1] = originDistance + (step.forward ? cumulative[segment + 1] : total - cumulative[segment + 1]);
      }
    }
  });
  return maximumDistance;
}

export function writeFocusedRouteMask(target, routeEdges, segments, enabled) {
  target.fill(0);
  if (!enabled) return;
  for (const edgeIndex of routeEdges) {
    target.fill(1, edgeIndex * segments, (edgeIndex + 1) * segments);
  }
}
