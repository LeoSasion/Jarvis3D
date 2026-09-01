const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

function hashText(value, seed = 2_166_136_261) {
  let hash = seed >>> 0;
  for (const character of String(value ?? "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function unitHash(value) {
  let hash = Number(value) >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4_294_967_296;
}

function pairKey(left, right) {
  return left < right ? `${left}:${right}` : `${right}:${left}`;
}

function distanceSquared(positions, left, right) {
  const leftOffset = left * 3;
  const rightOffset = right * 3;
  const x = positions[leftOffset] - positions[rightOffset];
  const y = positions[leftOffset + 1] - positions[rightOffset + 1];
  const z = positions[leftOffset + 2] - positions[rightOffset + 2];
  return x * x + y * y + z * z;
}

function createShellEdgePairs(positions, nodeCount, edgeCount, seed) {
  const pairs = new Int32Array(Math.max(0, edgeCount) * 2);
  if (nodeCount < 2 || edgeCount <= 0) return pairs;

  const unique = new Set();
  let written = 0;

  if (nodeCount <= 512) {
    const nearest = Array.from({ length: nodeCount }, (_, source) => (
      Array.from({ length: nodeCount }, (__, target) => target)
        .filter((target) => target !== source)
        .sort((left, right) => (
          distanceSquared(positions, source, left)
          - distanceSquared(positions, source, right)
          || left - right
        ))
    ));
    const neighborBudget = Math.min(nodeCount - 1, 7);
    const localTarget = Math.min(edgeCount, Math.ceil(edgeCount * 0.82));
    for (let rank = 0; rank < neighborBudget && written < localTarget; rank += 1) {
      for (let sourceIndex = 0; sourceIndex < nodeCount && written < localTarget; sourceIndex += 1) {
        const source = (sourceIndex * 37 + seed) % nodeCount;
        const target = nearest[source][rank];
        const key = pairKey(source, target);
        if (unique.has(key)) continue;
        unique.add(key);
        pairs[written * 2] = source;
        pairs[written * 2 + 1] = target;
        written += 1;
      }
    }
    let bridgeAttempt = 0;
    const bridgeBudget = Math.max(edgeCount * 12, nodeCount * 4);
    while (written < edgeCount && bridgeAttempt < bridgeBudget) {
      const source = (bridgeAttempt * 53 + seed) % nodeCount;
      const lowerRank = Math.min(nodeCount - 2, Math.max(7, Math.floor(nodeCount * 0.1)));
      const upperRank = Math.min(
        nodeCount - 1,
        Math.max(lowerRank + 1, Math.floor(nodeCount * 0.3)),
      );
      const rank = lowerRank + Math.floor(
        unitHash(seed ^ (bridgeAttempt * 193)) * Math.max(1, upperRank - lowerRank),
      );
      const target = nearest[source][rank];
      const key = pairKey(source, target);
      bridgeAttempt += 1;
      if (source === target || unique.has(key)) continue;
      unique.add(key);
      pairs[written * 2] = source;
      pairs[written * 2 + 1] = target;
      written += 1;
    }
  } else {
    const root = Math.max(2, Math.sqrt(nodeCount));
    const steps = [0.72, 1.14, 1.62, 2.08]
      .map((ratio) => Math.min(nodeCount - 1, Math.max(2, Math.round(root * ratio))));
    let attempt = 0;
    const attemptBudget = Math.max(edgeCount * 24, nodeCount * 8);
    while (written < edgeCount && attempt < attemptBudget) {
      const source = (attempt * 37 + Math.floor(attempt / 5) + seed) % nodeCount;
      const baseStep = steps[attempt % steps.length];
      const jitter = Math.floor(unitHash(seed + attempt * 97) * 3);
      const direction = unitHash(seed ^ (attempt * 131)) > 0.48 ? 1 : -1;
      const target = (
        source + direction * Math.max(1, baseStep + jitter) + nodeCount * 2
      ) % nodeCount;
      const key = pairKey(source, target);
      attempt += 1;
      if (source === target || unique.has(key)) continue;
      unique.add(key);
      pairs[written * 2] = source;
      pairs[written * 2 + 1] = target;
      written += 1;
    }
  }

  for (; written < edgeCount; written += 1) {
    const source = written % nodeCount;
    pairs[written * 2] = source;
    pairs[written * 2 + 1] = (source + 1 + (written % Math.max(1, nodeCount - 1))) % nodeCount;
  }
  return pairs;
}

export function easeGraphOrbMorph(value) {
  const progress = clamp01(value);
  return progress * progress * progress * (
    progress * (progress * 6 - 15) + 10
  );
}

export function mixGraphOrbPositionBuffers(
  orbPositions,
  graphPositions,
  progress,
  target = new Float32Array(graphPositions?.length ?? 0),
) {
  if (!(orbPositions instanceof Float32Array)
    || !(graphPositions instanceof Float32Array)
    || orbPositions.length !== graphPositions.length
    || target.length !== graphPositions.length) {
    throw new TypeError("Graph orb position buffers must be equal-length Float32Array values.");
  }
  const eased = easeGraphOrbMorph(progress);
  for (let index = 0; index < graphPositions.length; index += 1) {
    target[index] = orbPositions[index]
      + (graphPositions[index] - orbPositions[index]) * eased;
  }
  return target;
}

export function createGraphOrbMorphModel(
  nodes = [],
  edgeCount = 0,
  { radius = 188, seed = 0x4a415256, shellEdgeCount = edgeCount } = {},
) {
  const nodeCount = Math.max(0, nodes.length);
  const safeEdgeCount = Math.max(0, Math.floor(Number(edgeCount) || 0));
  const safeShellEdgeCount = Math.max(
    safeEdgeCount,
    Math.floor(Number(shellEdgeCount) || safeEdgeCount),
  );
  const safeRadius = Math.min(360, Math.max(48, Number(radius) || 188));
  const positions = new Float32Array(nodeCount * 3);
  const phases = new Float32Array(nodeCount);
  const scales = new Float32Array(nodeCount);

  for (let index = 0; index < nodeCount; index += 1) {
    const identityHash = hashText(nodes[index]?.id ?? index, seed + index * 17);
    const vertical = 1 - ((index + 0.5) / Math.max(1, nodeCount)) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - vertical * vertical));
    const azimuth = index * GOLDEN_ANGLE + (unitHash(identityHash) - 0.5) * 0.34;
    const depthRandom = unitHash(identityHash ^ 0x9e3779b9);
    const radialScale = depthRandom > 0.86
      ? 0.68 + unitHash(identityHash ^ 0x85ebca6b) * 0.18
      : 0.93 + unitHash(identityHash ^ 0xc2b2ae35) * 0.085;
    const offset = index * 3;
    positions[offset] = Math.cos(azimuth) * ring * safeRadius * radialScale;
    positions[offset + 1] = vertical * safeRadius * radialScale;
    positions[offset + 2] = Math.sin(azimuth) * ring * safeRadius * radialScale;
    phases[index] = unitHash(identityHash ^ 0x27d4eb2f) * Math.PI * 2;
    scales[index] = 0.82 + unitHash(identityHash ^ 0x165667b1) * 0.54;
  }

  const shellEdgePairs = createShellEdgePairs(
    positions,
    nodeCount,
    safeShellEdgeCount,
    seed >>> 0,
  );
  const signalCount = Math.min(12, safeEdgeCount);
  const signalEdgeIndices = new Uint32Array(signalCount);
  for (let index = 0; index < signalCount; index += 1) {
    signalEdgeIndices[index] = Math.min(
      Math.max(0, safeEdgeCount - 1),
      Math.floor(((index + 0.36) / Math.max(1, signalCount)) * safeEdgeCount),
    );
  }

  return Object.freeze({
    nodeCount,
    phases,
    positions,
    radius: safeRadius,
    scales,
    shellEdgePairs,
    signalEdgeIndices,
  });
}

export function createGraphPlanarMorphModel(
  nodes = [],
  edgeCount = 0,
  { radius = 204, seed = 0x32444a56, shellEdgeCount = edgeCount } = {},
) {
  const nodeCount = Math.max(0, nodes.length);
  const safeEdgeCount = Math.max(0, Math.floor(Number(edgeCount) || 0));
  const safeShellEdgeCount = Math.max(
    safeEdgeCount,
    Math.floor(Number(shellEdgeCount) || safeEdgeCount),
  );
  const safeRadius = Math.min(360, Math.max(48, Number(radius) || 204));
  const positions = new Float32Array(nodeCount * 3);
  const phases = new Float32Array(nodeCount);
  const scales = new Float32Array(nodeCount);

  for (let index = 0; index < nodeCount; index += 1) {
    const identityHash = hashText(nodes[index]?.id ?? index, seed + index * 19);
    const radialProgress = Math.sqrt((index + 0.42) / Math.max(1, nodeCount));
    const phase = unitHash(identityHash ^ 0x27d4eb2f) * Math.PI * 2;
    const angle = index * GOLDEN_ANGLE + (unitHash(identityHash) - 0.5) * 0.52;
    const radialJitter = 0.88 + unitHash(identityHash ^ 0x9e3779b9) * 0.2;
    const organicWarp = 1 + Math.sin(angle * 3 + phase) * 0.035;
    const offset = index * 3;
    positions[offset] = Math.cos(angle)
      * safeRadius
      * 1.14
      * radialProgress
      * radialJitter
      * organicWarp;
    positions[offset + 1] = Math.sin(angle)
      * safeRadius
      * 0.72
      * radialProgress
      * radialJitter
      / organicWarp;
    positions[offset + 2] = 0;
    phases[index] = phase;
    scales[index] = 0.78 + unitHash(identityHash ^ 0x165667b1) * 0.5;
  }

  const shellEdgePairs = createShellEdgePairs(
    positions,
    nodeCount,
    safeShellEdgeCount,
    seed >>> 0,
  );
  const signalCount = Math.min(12, safeEdgeCount);
  const signalEdgeIndices = new Uint32Array(signalCount);
  for (let index = 0; index < signalCount; index += 1) {
    signalEdgeIndices[index] = Math.min(
      Math.max(0, safeEdgeCount - 1),
      Math.floor(((index + 0.44) / Math.max(1, signalCount)) * safeEdgeCount),
    );
  }

  return Object.freeze({
    nodeCount,
    phases,
    positions,
    radius: safeRadius,
    scales,
    shellEdgePairs,
    signalEdgeIndices,
  });
}
