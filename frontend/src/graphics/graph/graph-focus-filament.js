export function getFocusedFilamentGain(elapsed, reducedMotion = false, { boost = 0.3, amplitude = 0.55, period = 2.8 } = {}) {
  const wave = reducedMotion ? 0 : 0.5 - 0.5 * Math.cos(elapsed * Math.PI * 2 / period);
  return 1 + boost + amplitude * wave;
}

export const FOCUSED_SIGNAL_SPEED = 240;
export const FOCUSED_SIGNAL_SPACING = 430;

// The retained Explore packets and idle walks share this model-space head/wake shape.
export const FOCUSED_SIGNAL_SHADER = `
  uniform float lineSignalTravel;
  uniform float lineSignalHeadLength;
  uniform float lineSignalWakeLength;
  varying vec2 energyLineSignalDistance;
  varying float energyLineSignalSize;

  vec2 focusedSignalAge(float age) {
    if (age < 0.0) return vec2(0.0);
    float headAge = age / (lineSignalHeadLength * energyLineSignalSize);
    float wakeAge = age / max(0.001, lineSignalWakeLength * energyLineSignalSize);
    float head = smoothstep(0.0, 2.0, headAge) * (1.0 - smoothstep(3.0, 9.0, headAge));
    float wake = smoothstep(0.0, 5.0, wakeAge) * pow(1.0 - smoothstep(5.0, 42.0, wakeAge), 2.0)
      * step(0.001, lineSignalWakeLength);
    return vec2(head, wake);
  }

  vec2 focusedSignal(float distanceFromOrigin) {
    if (distanceFromOrigin < 0.0 || lineSignalTravel < distanceFromOrigin) return vec2(0.0);
    return focusedSignalAge(lineSignalTravel - distanceFromOrigin);
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

export function writeFocusedRouteMask(target, routeEdges, segments, enabled) {
  target.fill(0);
  if (!enabled) return;
  for (const edgeIndex of routeEdges) {
    target.fill(1, edgeIndex * segments, (edgeIndex + 1) * segments);
  }
}
