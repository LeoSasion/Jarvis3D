import { DataTexture, FloatType, RGBAFormat } from "three";
import { FOCUSED_SIGNAL_SPEED, FOCUSED_SIGNAL_SPACING } from "./graph-focus-filament.js";
import { sampleFocusedSignalColor } from "./graph-signal-color.js";

// Focus owns emission, not the lifetime of an already launched wave. Each wave
// keeps a route snapshot and birth color until its last head/wake has arrived.
export function createFocusedSignalState(edgeCount, segments) {
  const state = {
    edgeCount, segments, emitters: new Map(), births: new Map(), packets: [],
    lengths: [], geometryRevision: 0,
    distances: new Float32Array(edgeCount * segments * 4),
    texture: null,
  };
  reserveTexture(state, edgeCount + 1);
  return state;
}

function reserveTexture(state, texels) {
  if (state.texture && state.texture.image.data.length >= texels * 4) return;
  const width = 256;
  const height = 2 ** Math.ceil(Math.log2(Math.max(1, Math.ceil(texels / width))));
  state.texture?.dispose();
  state.texture = new DataTexture(new Float32Array(width * height * 4), width, height, RGBAFormat, FloatType);
  state.texture.needsUpdate = true;
}

export function updateFocusedSignalGeometry(state, starts, ends) {
  state.lengths = Array.from({ length: state.edgeCount }, (_, edge) => {
    const cumulative = new Float64Array(state.segments + 1);
    for (let segment = 0; segment < state.segments; segment += 1) {
      const offset = (edge * state.segments + segment) * 3;
      cumulative[segment + 1] = cumulative[segment] + Math.hypot(
        ends[offset] - starts[offset], ends[offset + 1] - starts[offset + 1], ends[offset + 2] - starts[offset + 2],
      );
    }
    const total = cumulative[state.segments];
    for (let segment = 0; segment < state.segments; segment += 1) {
      const offset = (edge * state.segments + segment) * 4;
      state.distances[offset] = total > 0 ? cumulative[segment] / total : 0;
      state.distances[offset + 1] = total > 0 ? cumulative[segment + 1] / total : 0;
      state.distances[offset + 2] = edge;
      state.distances[offset + 3] = edge;
    }
    return cumulative;
  });
  state.geometryRevision += 1;
}

export function syncFocusedSignalOrigins(state, plan) {
  const origins = new Set(plan.trees.map((tree) => tree.origin));
  for (const origin of state.emitters.keys()) {
    if (!origins.has(origin)) state.emitters.delete(origin);
  }
  for (const tree of plan.trees) {
    const emitter = state.emitters.get(tree.origin);
    if (emitter) {
      if (emitter.tree !== tree) emitter.route = null;
      emitter.tree = tree;
    } else {
      state.emitters.set(tree.origin, { tree, remaining: 0, route: null });
    }
  }
}

// Leaving Explore ends the session; an empty hover only stops future emissions.
export function endFocusedSignalSession(state) {
  state.emitters.clear();
  state.packets.length = 0;
  state.texture.image.data.fill(0);
  state.texture.needsUpdate = true;
}

function snapshotRoute(state, tree) {
  const distances = new Map([[tree.origin, 0]]);
  const contacts = [{ node: tree.origin, distance: 0 }];
  const filamentContacts = [];
  const steps = [];
  let maximum = 0;
  for (const step of tree.steps) {
    const cumulative = state.lengths[step.edge];
    const total = cumulative?.[state.segments] ?? 0;
    const distance = distances.get(step.parent);
    if (distance === undefined || total <= 0) continue;
    distances.set(step.node, distance + total);
    contacts.push({ node: step.node, distance: distance + total });
    maximum = Math.max(maximum, distance + total);
    steps.push({ edge: step.edge, forward: step.forward, distance, total });
    for (let segment = 0; segment < state.segments; segment += 1) {
      for (let end = 0; end < 2; end += 1) {
        filamentContacts.push({
          node: (step.edge * state.segments + segment) * 2 + end,
          distance: distance + (step.forward ? cumulative[segment + end] : total - cumulative[segment + end]),
        });
      }
    }
  }
  return { steps, contacts, filamentContacts, maximum };
}

export function advanceFocusedSignals(state, delta, options, onTravel) {
  const { speed = 1, spacing = 1, headLength = 1, wakeLength = 1, palette } = options;
  const movement = Math.min(0.05, Math.max(0, delta)) * FOCUSED_SIGNAL_SPEED * speed;
  if (movement <= 0) return;
  for (const [origin, emitter] of state.emitters) {
    if (!emitter.route || emitter.geometryRevision !== state.geometryRevision) {
      emitter.route = snapshotRoute(state, emitter.tree);
      emitter.geometryRevision = state.geometryRevision;
    }
    if (!emitter.route.steps.length) continue;
    while (emitter.remaining < movement) {
      const birth = state.births.get(origin) ?? 0;
      state.births.set(origin, birth + 1);
      state.packets.push({ origin, birth, route: emitter.route,
        travel: -emitter.remaining, color: sampleFocusedSignalColor(palette, origin, birth) });
      emitter.remaining += Math.max(1, FOCUSED_SIGNAL_SPACING * spacing);
    }
    emitter.remaining -= movement;
  }
  const tail = Math.max(9 * headLength, 42 * wakeLength);
  let retained = 0;
  for (const packet of state.packets) {
    const previous = packet.travel;
    packet.travel += movement;
    onTravel?.(packet, previous, packet.travel, FOCUSED_SIGNAL_SPEED * speed);
    if (packet.travel <= packet.route.maximum + tail) state.packets[retained++] = packet;
  }
  state.packets.length = retained;
  writeFocusedSignalTexture(state, tail);
}

// Sparse per-edge lists allow old and new waves (including opposite directions)
// to coexist on the same resting ribbon, without another geometry or draw pass.
// Only steps currently touched by a head/wake are uploaded. Capacity grows instead
// of evicting live packets during rapid pointer movement.
export function writeFocusedSignalTexture(state, tail) {
  let count = 0;
  for (const packet of state.packets) {
    for (const step of packet.route.steps) {
      if (packet.travel >= step.distance && packet.travel <= step.distance + step.total + tail) count += 1;
    }
  }
  reserveTexture(state, state.edgeCount + 1 + count * 2);
  const data = state.texture.image.data;
  data.fill(0, 0, state.edgeCount * 4);
  let cursor = state.edgeCount + 1; // Zero is the end-of-list sentinel.
  for (const packet of state.packets) {
    for (const step of packet.route.steps) {
      if (packet.travel < step.distance || packet.travel > step.distance + step.total + tail) continue;
      const offset = cursor * 4;
      data[offset] = packet.travel - step.distance - (step.forward ? 0 : step.total);
      data[offset + 1] = step.forward ? step.total : -step.total;
      data[offset + 2] = data[step.edge * 4];
      data.set(packet.color, offset + 4);
      data[step.edge * 4] = cursor;
      cursor += 2;
    }
  }
  state.texture.needsUpdate = true;
}

export const FOCUSED_SIGNAL_HISTORY_SHADER = `
  uniform float lineSignalHistoryEnabled;
  uniform sampler2D lineSignalHistory;
  uniform vec2 lineSignalHistorySize;

  vec4 focusedHistoryTexel(float index) {
    int width = int(lineSignalHistorySize.x);
    int address = int(floor(index + 0.5));
    return texelFetch(lineSignalHistory, ivec2(address % width, address / width), 0);
  }

  vec2 focusedHistoryPacket(out vec3 color) {
    vec2 packet = vec2(0.0);
    color = vec3(0.0);
    float cursor = focusedHistoryTexel(energyLineSignalDistance.y).x;
    while (cursor > 0.0) {
      vec4 entry = focusedHistoryTexel(cursor);
      vec2 candidate = focusedSignalAge(entry.x - entry.y * energyLineSignalDistance.x);
      if (dot(candidate, vec2(7.0, 1.7)) > dot(packet, vec2(7.0, 1.7))) {
        packet = candidate;
        color = focusedHistoryTexel(cursor + 1.0).rgb;
      }
      cursor = entry.z;
    }
    return packet;
  }
`;
