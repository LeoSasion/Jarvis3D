// Node energy follows arrivals on the same model-space routes as the ribbons.
// Filaments only need energy; cells also remember the latest arriving packet's RGB.
export function createNodeActivationState(count, trackColor = false) {
  return {
    time: 0,
    hits: new Float64Array(count).fill(-Infinity),
    starts: new Float32Array(count),
    levels: new Float32Array(count),
    colors: trackColor ? new Float32Array(count * 3).fill(1) : null,
    colorChanged: false,
    active: false,
    changed: false,
  };
}

export function sampleNodeActivation(age, start, { chargeTime, holdTime, decayTime }) {
  if (age < 0 || !Number.isFinite(age)) return 0;
  if (age < chargeTime) {
    const remaining = 1 - age / chargeTime;
    return 1 - (1 - start) * remaining * remaining * remaining;
  }
  const decayAge = age - chargeTime - holdTime;
  if (decayAge <= 0) return 1;
  const remaining = Math.max(0, 1 - decayAge / decayTime);
  return remaining * remaining;
}

export function touchNodeActivation(state, node, time, options, color) {
  if (node < 0 || node >= state.levels.length || time < state.hits[node]) return;
  state.starts[node] = sampleNodeActivation(time - state.hits[node], state.starts[node], options);
  state.hits[node] = time;
  if (state.colors && color) {
    for (let axis = 0; axis < 3; axis += 1) {
      const offset = node * 3 + axis;
      const previous = state.colors[offset];
      state.colors[offset] = color[axis];
      state.colorChanged ||= previous !== state.colors[offset];
    }
  }
}

// Test the whole travelled interval, so a short head cannot skip a small node
// between frames. A periodic clock may wrap later, after these contacts are read.
export function chargeSignalContacts(state, contacts, previous, next, speed, period, options, resolveColor) {
  if (next <= previous || speed <= 0) return;
  for (const contact of contacts) {
    let arrival = contact.distance;
    if (arrival > next) continue;
    const pulse = period > 0 ? Math.floor((next - arrival) / period) : 0;
    arrival += pulse * period;
    if (arrival <= previous && !(previous === 0 && arrival === 0)) continue;
    touchNodeActivation(state, contact.node, state.time - (next - arrival) / speed, options,
      contact.color ?? resolveColor?.(contact, pulse));
  }
}

export function updateNodeActivation(state, options, enabled = true) {
  state.active = false;
  state.changed = state.colorChanged;
  state.colorChanged = false;
  for (let node = 0; node < state.levels.length; node += 1) {
    const age = state.time - state.hits[node];
    const level = enabled ? sampleNodeActivation(age, state.starts[node], options) : 0;
    if (!enabled || age >= options.chargeTime + options.holdTime + options.decayTime) state.hits[node] = -Infinity;
    const previous = state.levels[node];
    state.levels[node] = level;
    state.changed ||= previous !== state.levels[node];
    state.active ||= Number.isFinite(state.hits[node]);
  }
  return state.active;
}
