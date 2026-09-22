import { createNodeActivationState, touchNodeActivation } from "./graph-node-activation.js";

// Sample the existing ribbon joins, rather than heating every branch attached
// to a charged hub. Two floats per segment share the node charge/decay envelope.
export function createFilamentActivationState(segmentCount) {
  return { ...createNodeActivationState(segmentCount * 2), contacts: [] };
}

export function writeFilamentActivationContacts(state, distances) {
  state.contacts.length = 0;
  for (let segment = 0; segment < distances.length / 4; segment += 1) {
    for (let channel = 0; channel < 2; channel += 1) {
      for (let end = 0; end < 2; end += 1) {
        const distance = distances[segment * 4 + channel * 2 + end];
        if (distance >= 0) state.contacts.push({ node: segment * 2 + end, distance });
      }
    }
  }
  // Keep existing energy when focus or idle walks change; old trails still fade.
}

// Background particles use eased curve progress rather than arc distance.
// Invert that same easing to timestamp each join at its actual crossing.
export function chargeBackgroundFilament(state, edge, segments, previous, next, speed, options) {
  if (previous < 0 || speed <= 0) return;
  const travel = next < previous ? next + 1 : next;
  for (let join = 0; join <= segments; join += 1) {
    const progress = 0.5 - Math.sin(Math.asin(1 - 2 * join / segments) / 3);
    const arrival = progress + Math.floor(travel - progress);
    if (arrival <= previous || arrival > travel) continue;
    const time = state.time - (travel - arrival) / speed;
    const offset = edge * segments * 2;
    if (join > 0) touchNodeActivation(state, offset + join * 2 - 1, time, options);
    if (join < segments) touchNodeActivation(state, offset + join * 2, time, options);
  }
}
