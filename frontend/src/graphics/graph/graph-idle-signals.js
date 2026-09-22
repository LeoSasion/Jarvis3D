import { FOCUSED_SIGNAL_SPEED } from "./graph-focus-filament.js";
import { createSignalColorPalette, sampleSignalBirthColor, signalBirthSample } from "./graph-signal-color.js";

// Fixed-time emission batches share the existing ribbon buffer. In-flight
// walks finish independently; later batches use only currently free curves.
export function createIdleSignalState(model, curves, seed = 1) {
  const adjacency = Array.from({ length: model.nodeCount }, () => []);
  const lengths = model.edges.map((edge, index) => {
    adjacency[edge.sourceIndex].push({ edge: index, node: edge.targetIndex, forward: true });
    adjacency[edge.targetIndex].push({ edge: index, node: edge.sourceIndex, forward: false });
    const cumulative = new Float64Array(curves.segments + 1);
    for (let segment = 0; segment < curves.segments; segment += 1) {
      const offset = (index * curves.segments + segment) * 3;
      cumulative[segment + 1] = cumulative[segment] + Math.hypot(
        curves.ends[offset] - curves.starts[offset],
        curves.ends[offset + 1] - curves.starts[offset + 1],
        curves.ends[offset + 2] - curves.starts[offset + 2],
      );
    }
    return cumulative;
  });
  let randomSeed = (seed >>> 0) || 1;
  const state = {
    adjacency, lengths, segments: curves.segments,
    origins: adjacency.flatMap((neighbors, index) => neighbors.length ? [index] : []),
    distances: new Float32Array(model.edges.length * curves.segments * 4).fill(-1),
    sizes: new Float32Array(model.edges.length * curves.segments).fill(1),
    appearances: new Float32Array(model.edges.length * curves.segments * 4),
    colorSeed: seed,
    palette: createSignalColorPalette("white"),
    options: { count: 48, sizeVariation: 0.3, launchSpread: 0.5, batchInterval: 3, speed: 1, hops: 10, headLength: 1, wakeLength: 1 },
    travel: 0, endTravel: 0, time: 0, nextBatchAt: 0, batch: 0,
    routes: [], contacts: [], occupied: new Set(),
    random: () => {
      randomSeed ^= randomSeed << 13;
      randomSeed ^= randomSeed >>> 17;
      randomSeed ^= randomSeed << 5;
      return (randomSeed >>> 0) / 4294967296;
    },
  };
  writeNextIdleSignalRoutes(state);
  return state;
}

export function writeNextIdleSignalRoutes(state) {
  state.distances.fill(-1);
  state.sizes.fill(1);
  state.appearances.fill(0);
  state.routes = [];
  state.contacts = [];
  state.travel = 0;
  state.endTravel = 0;
  state.time = 0;
  state.batch = 0;
  state.nextBatchAt = state.options.batchInterval ?? 3;
  state.occupied.clear();
  appendIdleSignalBatch(state, 0, 0);
  refreshIdleContacts(state);
}

function appendIdleSignalBatch(state, batchTravel, batchTime) {
  const { count, hops, headLength, wakeLength, sizeVariation = 0.3,
    launchSpread = 0.5, batchInterval = 3, speed = 1 } = state.options;
  const occupied = state.occupied;
  const batch = state.batch++;
  for (let slot = 0; slot < count && state.origins.length; slot += 1) {
    const availableOrigins = state.origins.filter((node) => state.adjacency[node].some((next) => !occupied.has(next.edge)));
    if (!availableOrigins.length) break;
    let current = availableOrigins[Math.floor(state.random() * availableOrigins.length)];
    const visited = new Set([current]);
    const steps = [];
    // A batch emits at most count packets during [0, interval × spread].
    // Zero spread is synchronized; 100% uses the whole interval.
    const launchDelay = state.random() * batchInterval * launchSpread;
    const delay = batchTravel + launchDelay * FOCUSED_SIGNAL_SPEED * speed;
    let distance = delay;
    const stepsToTake = Math.max(2, Math.ceil(hops * (0.4 + state.random() * 0.6)));
    // One seeded size follows the whole walk, including reversed edges and hubs.
    const size = 1 + (state.random() * 2 - 1) * sizeVariation;
    const color = sampleSignalBirthColor(state.palette, signalBirthSample(state.colorSeed, batch, slot));
    for (let hop = 0; hop < stepsToTake; hop += 1) {
      const choices = state.adjacency[current].filter((next) => !occupied.has(next.edge) && !visited.has(next.node));
      if (!choices.length) break;
      const next = choices[Math.floor(state.random() * choices.length)];
      const cumulative = state.lengths[next.edge];
      const total = cumulative[state.segments];
      for (let segment = 0; segment < state.segments; segment += 1) {
        const offset = (next.edge * state.segments + segment) * 4;
        state.distances[offset] = distance + (next.forward ? cumulative[segment] : total - cumulative[segment]);
        state.distances[offset + 1] = distance + (next.forward ? cumulative[segment + 1] : total - cumulative[segment + 1]);
        state.sizes[next.edge * state.segments + segment] = size;
        state.appearances.set(color, offset);
        state.appearances[offset + 3] = size;
      }
      steps.push({ ...next, parent: current, distance: distance + total });
      occupied.add(next.edge);
      visited.add(next.node);
      distance += total;
      current = next.node;
    }
    if (steps.length) {
      const endTravel = distance + Math.max(9 * headLength, 42 * wakeLength) * size;
      state.routes.push({ delay, steps, size, color, endTravel, batch, launchAt: batchTime + launchDelay });
    }
  }
}

function refreshIdleContacts(state) {
  state.contacts = [];
  state.endTravel = state.travel;
  for (const route of state.routes) {
    state.contacts.push({ node: route.steps[0].parent, distance: route.delay, color: route.color });
    for (const step of route.steps) state.contacts.push({ node: step.node, distance: step.distance, color: route.color });
    state.endTravel = Math.max(state.endTravel, route.endTravel);
  }
}

export function advanceIdleSignals(state, delta, speed = 1) {
  if (!state.origins.length || state.options.count === 0) return false;
  const elapsed = Math.min(0.05, Math.max(0, delta));
  state.time += elapsed;
  state.travel += elapsed * FOCUSED_SIGNAL_SPEED * speed;
  let changed = false;
  for (let index = state.routes.length - 1; index >= 0; index -= 1) {
    const route = state.routes[index];
    if (state.travel < route.endTravel) continue;
    for (const step of route.steps) {
      state.occupied.delete(step.edge);
      state.distances.fill(-1, step.edge * state.segments * 4, (step.edge + 1) * state.segments * 4);
      state.sizes.fill(1, step.edge * state.segments, (step.edge + 1) * state.segments);
      state.appearances.fill(0, step.edge * state.segments * 4, (step.edge + 1) * state.segments * 4);
    }
    state.routes.splice(index, 1);
    changed = true;
  }
  while (state.time + 1e-9 >= state.nextBatchAt) {
    const batchTravel = state.travel - Math.max(0, state.time - state.nextBatchAt) * FOCUSED_SIGNAL_SPEED * speed;
    appendIdleSignalBatch(state, batchTravel, state.nextBatchAt);
    state.nextBatchAt += state.options.batchInterval ?? 3;
    changed = true;
  }
  // Bound GPU float coordinates without restarting packets or their schedule.
  if (state.travel >= 65_536) {
    // Keep the current front and its wake positive: negative shader distances
    // denote inactive curves, so rebasing all the way to zero would clip them.
    const shift = 32_768;
    state.travel -= shift;
    for (let index = 0; index < state.distances.length; index += 1) {
      if (state.distances[index] >= 0) state.distances[index] -= shift;
    }
    for (const route of state.routes) {
      route.delay -= shift;
      route.endTravel -= shift;
      for (const step of route.steps) step.distance -= shift;
    }
    changed = true;
  }
  if (changed) refreshIdleContacts(state);
  return changed;
}
