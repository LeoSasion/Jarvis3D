const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const ORB_BUDGETS = Object.freeze({
  low: Object.freeze({
    nodeCount: 112,
    neighborCount: 4,
    bridgeCount: 12,
    ambientCount: 12,
    signalRouteCount: 6,
  }),
  balanced: Object.freeze({
    nodeCount: 136,
    neighborCount: 4,
    bridgeCount: 18,
    ambientCount: 18,
    signalRouteCount: 8,
  }),
  high: Object.freeze({
    nodeCount: 160,
    neighborCount: 4,
    bridgeCount: 22,
    ambientCount: 24,
    signalRouteCount: 10,
  }),
});

function clampInteger(value, minimum, maximum) {
  const number = Math.floor(Number(value));
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
}

function createSeededRandom(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function normalizeVector(x, y, z) {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function pairKey(left, right) {
  return left < right ? `${left}:${right}` : `${right}:${left}`;
}

function distanceSquared(positions, left, right) {
  const leftOffset = left * 3;
  const rightOffset = right * 3;
  const dx = positions[leftOffset] - positions[rightOffset];
  const dy = positions[leftOffset + 1] - positions[rightOffset + 1];
  const dz = positions[leftOffset + 2] - positions[rightOffset + 2];
  return (dx * dx) + (dy * dy) + (dz * dz);
}

function buildEdgePairs(positions, nodeCount, neighborCount, bridgeCount, random) {
  const edges = [];
  const keys = new Set();
  const degrees = new Uint16Array(nodeCount);

  function addEdge(left, right) {
    if (left === right) return false;
    const key = pairKey(left, right);
    if (keys.has(key)) return false;
    keys.add(key);
    edges.push([Math.min(left, right), Math.max(left, right)]);
    degrees[left] += 1;
    degrees[right] += 1;
    return true;
  }

  for (let source = 0; source < nodeCount; source += 1) {
    const candidates = [];
    for (let target = 0; target < nodeCount; target += 1) {
      if (source === target) continue;
      candidates.push({
        distance: distanceSquared(positions, source, target),
        index: target,
      });
    }
    candidates.sort((left, right) => left.distance - right.distance || left.index - right.index);
    const localCount = Math.min(
      candidates.length,
      neighborCount + (random() > 0.72 ? 1 : 0),
    );
    for (let rank = 0; rank < localCount; rank += 1) {
      addEdge(source, candidates[rank].index);
    }
  }

  let bridgesAdded = 0;
  let attempts = 0;
  const maximumAttempts = Math.max(32, bridgeCount * 18);
  while (bridgesAdded < bridgeCount && attempts < maximumAttempts) {
    attempts += 1;
    const source = Math.floor(random() * nodeCount);
    const candidates = [];
    for (let target = 0; target < nodeCount; target += 1) {
      if (source === target || keys.has(pairKey(source, target))) continue;
      candidates.push({
        distance: distanceSquared(positions, source, target),
        index: target,
      });
    }
    candidates.sort((left, right) => left.distance - right.distance || left.index - right.index);
    if (candidates.length < 8) continue;
    const lower = Math.max(5, Math.floor(candidates.length * 0.08));
    const upper = Math.max(lower + 1, Math.floor(candidates.length * 0.28));
    const selected = candidates[Math.min(
      candidates.length - 1,
      lower + Math.floor(random() * Math.max(1, upper - lower)),
    )];
    if (selected && addEdge(source, selected.index)) bridgesAdded += 1;
  }

  return { degrees, edges };
}

function createAmbientField(count, radius, random) {
  const positions = new Float32Array(count * 3);
  const scales = new Float32Array(count);
  const phases = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const azimuth = random() * Math.PI * 2;
    const z = (random() * 2) - 1;
    const ring = Math.sqrt(Math.max(0, 1 - (z * z)));
    const distance = radius * (1.18 + (random() ** 0.72) * 1.12);
    const offset = index * 3;
    positions[offset] = Math.cos(azimuth) * ring * distance;
    positions[offset + 1] = z * distance;
    positions[offset + 2] = Math.sin(azimuth) * ring * distance * 0.72;
    scales[index] = 0.48 + (random() ** 2.1) * 1.72;
    phases[index] = random() * Math.PI * 2;
  }
  return { phases, positions, scales };
}

function createSignalField(edges, positions, nodeCount, routeCount, random) {
  const adjacency = Array.from({ length: nodeCount }, () => []);
  edges.forEach(([left, right], edgeIndex) => {
    adjacency[left].push({ edgeIndex, target: right });
    adjacency[right].push({ edgeIndex, target: left });
  });
  adjacency.forEach((neighbors) => {
    neighbors.sort((left, right) => left.target - right.target);
  });

  const edgeSignalStrengths = new Float32Array(edges.length * 2);
  const edgeSignalTimes = new Float32Array(edges.length * 2);
  const nodeSignalStrengths = new Float32Array(nodeCount);
  const nodeSignalTimes = new Float32Array(nodeCount);
  const routes = [];
  const routeStarts = [];
  const signalPointDurations = [];
  const signalPointPositions = [];
  const signalPointStrengths = [];
  const signalPointTargets = [];
  const signalPointTimes = [];
  const usedEdges = new Set();
  const usedNodes = new Set();
  let nextStart = 1.1 + random() * 0.45;

  for (let routeIndex = 0; routeIndex < routeCount; routeIndex += 1) {
    let selectedRoute = null;
    const maximumAttempts = Math.max(32, nodeCount * 2);

    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      const start = Math.floor(random() * nodeCount);
      if (usedNodes.has(start) || adjacency[start].length < 2) continue;
      const desiredEdgeCount = 3 + Math.floor(random() * 3);
      const routeEdges = [];
      const routeNodes = [start];

      while (routeEdges.length < desiredEdgeCount) {
        const current = routeNodes[routeNodes.length - 1];
        const options = adjacency[current].filter(({ edgeIndex, target }) => (
          !usedEdges.has(edgeIndex)
          && !routeEdges.includes(edgeIndex)
          && !usedNodes.has(target)
          && !routeNodes.includes(target)
        ));
        if (options.length === 0) break;
        const selected = options[Math.floor(random() * options.length)];
        routeEdges.push(selected.edgeIndex);
        routeNodes.push(selected.target);
      }

      if (routeEdges.length >= 3) {
        selectedRoute = { edgeIndexes: routeEdges, nodes: routeNodes };
        break;
      }
    }

    if (!selectedRoute) continue;
    const stepDuration = 0.17 + random() * 0.055;
    const strength = 0.92 + random() * 0.16;
    const startTime = nextStart;

    selectedRoute.nodes.forEach((node, step) => {
      nodeSignalTimes[node] = startTime + step * stepDuration;
      nodeSignalStrengths[node] = strength * (
        step === selectedRoute.nodes.length - 1 ? 1.08 : 1
      );
      usedNodes.add(node);
    });
    selectedRoute.edgeIndexes.forEach((edgeIndex, step) => {
      const source = selectedRoute.nodes[step];
      const target = selectedRoute.nodes[step + 1];
      const sourceTime = startTime + step * stepDuration;
      const targetTime = sourceTime + stepDuration;
      const edgeOffset = edgeIndex * 2;
      const sourceOffset = edges[edgeIndex][0] === source ? edgeOffset : edgeOffset + 1;
      const targetOffset = sourceOffset === edgeOffset ? edgeOffset + 1 : edgeOffset;
      edgeSignalTimes[sourceOffset] = sourceTime;
      edgeSignalTimes[targetOffset] = targetTime;
      edgeSignalStrengths[edgeOffset] = strength;
      edgeSignalStrengths[edgeOffset + 1] = strength;
      usedEdges.add(edgeIndex);

      const sourcePositionOffset = source * 3;
      const targetPositionOffset = target * 3;
      signalPointPositions.push(
        positions[sourcePositionOffset],
        positions[sourcePositionOffset + 1],
        positions[sourcePositionOffset + 2],
      );
      signalPointTargets.push(
        positions[targetPositionOffset],
        positions[targetPositionOffset + 1],
        positions[targetPositionOffset + 2],
      );
      signalPointTimes.push(sourceTime);
      signalPointDurations.push(stepDuration);
      signalPointStrengths.push(strength);
    });

    routeStarts.push(startTime);
    routes.push(Object.freeze({
      edgeIndexes: Object.freeze([...selectedRoute.edgeIndexes]),
      nodes: Object.freeze([...selectedRoute.nodes]),
      startTime,
      stepDuration,
    }));
    nextStart += 2.2 + random() * 1.55;
  }

  const firstStart = routeStarts[0] ?? 0;
  const lastStart = routeStarts[routeStarts.length - 1] ?? 0;
  const wrapGap = 2.2 + random() * 1.55;

  return {
    edgeSignalStrengths,
    edgeSignalTimes,
    nodeSignalStrengths,
    nodeSignalTimes,
    routeStarts: new Float32Array(routeStarts),
    routes: Object.freeze(routes),
    signalPointDurations: new Float32Array(signalPointDurations),
    signalPointPositions: new Float32Array(signalPointPositions),
    signalPointStrengths: new Float32Array(signalPointStrengths),
    signalPointTargets: new Float32Array(signalPointTargets),
    signalPointTimes: new Float32Array(signalPointTimes),
    signalCycle: routeStarts.length > 0
      ? Math.max(8, lastStart + wrapGap - firstStart)
      : 8,
  };
}

export function selectNeuralOrbBudget(qualityId = "balanced") {
  return ORB_BUDGETS[qualityId] ?? ORB_BUDGETS.balanced;
}

export function createNeuralOrbTopology({
  ambientCount = ORB_BUDGETS.balanced.ambientCount,
  bridgeCount = ORB_BUDGETS.balanced.bridgeCount,
  neighborCount = ORB_BUDGETS.balanced.neighborCount,
  nodeCount = ORB_BUDGETS.balanced.nodeCount,
  radius = 188,
  seed = 0x4a415256,
  signalRouteCount = ORB_BUDGETS.balanced.signalRouteCount,
} = {}) {
  const safeNodeCount = clampInteger(nodeCount, 24, 256);
  const safeNeighborCount = clampInteger(neighborCount, 2, 7);
  const safeBridgeCount = clampInteger(bridgeCount, 0, safeNodeCount);
  const safeAmbientCount = clampInteger(ambientCount, 0, 256);
  const safeSignalRouteCount = clampInteger(signalRouteCount, 0, 18);
  const safeRadius = Math.min(360, Math.max(48, Number(radius) || 188));
  const random = createSeededRandom(seed);
  const positions = new Float32Array(safeNodeCount * 3);
  const nodeScales = new Float32Array(safeNodeCount);
  const nodePhases = new Float32Array(safeNodeCount);

  for (let index = 0; index < safeNodeCount; index += 1) {
    const y = 1 - ((index + 0.5) / safeNodeCount) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - (y * y)));
    const azimuth = (index * GOLDEN_ANGLE) + ((random() - 0.5) * 0.36);
    const baseX = Math.cos(azimuth) * ring;
    const baseZ = Math.sin(azimuth) * ring;
    const tangentJitter = 0.055;
    const [x, normalizedY, z] = normalizeVector(
      baseX + (random() - 0.5) * tangentJitter,
      y + (random() - 0.5) * tangentJitter,
      baseZ + (random() - 0.5) * tangentJitter,
    );
    const radialJitter = 0.94 + random() * 0.095;
    const offset = index * 3;
    positions[offset] = x * safeRadius * radialJitter;
    positions[offset + 1] = normalizedY * safeRadius * radialJitter;
    positions[offset + 2] = z * safeRadius * radialJitter;
    const hubGain = random() > 0.89 ? 0.74 + random() * 0.42 : 0;
    nodeScales[index] = 0.72 + (random() ** 1.45) * 0.88 + hubGain;
    nodePhases[index] = random() * Math.PI * 2;
  }

  const { degrees, edges } = buildEdgePairs(
    positions,
    safeNodeCount,
    safeNeighborCount,
    safeBridgeCount,
    random,
  );
  const edgePositions = new Float32Array(edges.length * 6);
  const edgePhases = new Float32Array(edges.length * 2);
  const edgeEnergy = new Float32Array(edges.length * 2);
  edges.forEach(([source, target], edgeIndex) => {
    const sourceOffset = source * 3;
    const targetOffset = target * 3;
    const edgeOffset = edgeIndex * 6;
    edgePositions.set(positions.subarray(sourceOffset, sourceOffset + 3), edgeOffset);
    edgePositions.set(positions.subarray(targetOffset, targetOffset + 3), edgeOffset + 3);
    const length = Math.sqrt(distanceSquared(positions, source, target));
    const energy = Math.max(0.46, Math.min(1, 1.12 - (length / (safeRadius * 1.6))));
    const phase = random() * Math.PI * 2;
    edgePhases[edgeIndex * 2] = phase;
    edgePhases[edgeIndex * 2 + 1] = phase + 0.36;
    edgeEnergy[edgeIndex * 2] = energy;
    edgeEnergy[edgeIndex * 2 + 1] = energy;
  });

  const ambient = createAmbientField(safeAmbientCount, safeRadius, random);
  const signals = createSignalField(
    edges,
    positions,
    safeNodeCount,
    safeSignalRouteCount,
    random,
  );
  return Object.freeze({
    ambientPhases: ambient.phases,
    ambientPositions: ambient.positions,
    ambientScales: ambient.scales,
    degrees,
    edgeEnergy,
    edgePairs: Object.freeze(edges.map((edge) => Object.freeze(edge))),
    edgePhases,
    edgePositions,
    edgeSignalStrengths: signals.edgeSignalStrengths,
    edgeSignalTimes: signals.edgeSignalTimes,
    nodePhases,
    nodeScales,
    nodeSignalStrengths: signals.nodeSignalStrengths,
    nodeSignalTimes: signals.nodeSignalTimes,
    positions,
    radius: safeRadius,
    signalCycle: signals.signalCycle,
    signalPointDurations: signals.signalPointDurations,
    signalPointPositions: signals.signalPointPositions,
    signalPointStrengths: signals.signalPointStrengths,
    signalPointTargets: signals.signalPointTargets,
    signalPointTimes: signals.signalPointTimes,
    signalRoutes: signals.routes,
    signalRouteStarts: signals.routeStarts,
  });
}
