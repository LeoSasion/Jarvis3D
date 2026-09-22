import assert from "node:assert/strict";
import test from "node:test";
import { createFocusedRestingRoutePlan, createRestingRouteIndex } from "../src/graphics/graph/graph-focus-filament.js";
import { createFocusedSignalState, updateFocusedSignalGeometry, syncFocusedSignalOrigins, advanceFocusedSignals, endFocusedSignalSession } from "../src/graphics/graph/graph-focus-signals.js";
import { createSignalColorPalette } from "../src/graphics/graph/graph-signal-color.js";
import { createNodeActivationState, chargeSignalContacts } from "../src/graphics/graph/graph-node-activation.js";
import { shouldContinueGraphFrame } from "../src/graphics/graph/graph-frame-policy.js";

const edge = (source, target) => ({ id: `${source}-${target}`, source, target });
const palette = createSignalColorPalette("#ff6600");
const options = { palette, spacing: 1, headLength: 1, wakeLength: 1 };
const envelope = { chargeTime: 0.1, holdTime: 0.2, decayTime: 0.8 };

function fixture() {
  const nodes = ["a", "hub", "b", "c"].map((id) => ({ id }));
  const edges = [edge("a", "hub"), edge("b", "hub"), edge("hub", "c")];
  const relations = [edge("a", "b"), edge("a", "c"), edge("b", "c")];
  const index = createRestingRouteIndex(nodes, edges);
  const state = createFocusedSignalState(3, 2);
  const starts = new Float32Array([0, 0, 0, 50, 0, 0, 200, 0, 0, 150, 0, 0, 100, 0, 0, 100, 50, 0]);
  const ends = new Float32Array([50, 0, 0, 100, 0, 0, 150, 0, 0, 100, 0, 0, 100, 50, 0, 100, 100, 0]);
  updateFocusedSignalGeometry(state, starts, ends);
  const focus = (...origins) => syncFocusedSignalOrigins(state, createFocusedRestingRoutePlan(index, relations, origins));
  const advance = (frames = 1, settings = options, onTravel) => {
    for (let frame = 0; frame < frames; frame += 1) advanceFocusedSignals(state, 0.05, settings, onTravel);
  };
  return { state, focus, advance, starts, ends };
}

function entries(state, edgeIndex) {
  const data = state.texture.image.data;
  const result = [];
  let cursor = data[edgeIndex * 4];
  while (cursor > 0) {
    const offset = cursor * 4;
    result.push({ head: data[offset], length: data[offset + 1], color: [...data.slice(offset + 4, offset + 7)] });
    cursor = data[offset + 2];
    assert.ok(result.length <= state.packets.length, "texture lists must terminate without cycles");
  }
  return result;
}

test("A → B → C keeps every launched wave moving and emits only the new focus", () => {
  const { state, focus, advance } = fixture();
  focus("a");
  advance(3);
  const first = state.packets[0];
  const birthColor = [...first.color];
  const route = first.route;
  focus("b");
  advance();
  assert.equal(state.packets.length, 2);
  assert.equal(first.travel, 48);
  assert.equal(state.packets[1].travel, 12);
  focus("c");
  advance();
  assert.deepEqual(state.packets.map((packet) => packet.travel), [60, 24, 12]);
  assert.strictEqual(first.route, route);
  assert.deepEqual(first.color, birthColor);
  assert.deepEqual([...state.emitters.keys()], [3]);
  state.texture.dispose();
});

test("selected origin and an unchanged hover retain their emission phase", () => {
  const { state, focus, advance } = fixture();
  focus("a", "b");
  advance(10);
  const selected = state.packets[0];
  const remaining = state.emitters.get(0).remaining;
  focus("a", "c");
  advance();
  assert.equal(state.packets.filter((packet) => packet.origin === 0).length, 1);
  assert.equal(selected.travel, 132);
  assert.equal(state.emitters.get(0).remaining, remaining - 12);
  focus("a", "c");
  advance();
  assert.equal(state.packets.length, 3);
  focus("a", "a");
  assert.equal(state.emitters.size, 1);
  state.texture.dispose();
});

test("leaving focus drains the full wake, preserves arrivals and then releases frames", () => {
  const { state, focus, advance } = fixture();
  const nodes = createNodeActivationState(4, true);
  const onTravel = (packet, previous, next, speed) => {
    chargeSignalContacts(nodes, packet.route.contacts, previous, next, speed, 0, envelope, () => packet.color);
  };
  focus("a");
  nodes.time = 0.05;
  advance(1, options, onTravel);
  const color = [...state.packets[0].color];
  focus();
  for (let frame = 2; frame <= 20; frame += 1) {
    nodes.time = frame * 0.05;
    advance(1, options, onTravel);
  }
  assert.equal(state.packets.length, 1); // 240 of 200 + 42: wake still present.
  assert.equal(state.emitters.size, 0);
  assert.equal(shouldContinueGraphFrame({ routeSignalActive: true }), true);
  assert.ok(Math.abs(nodes.hits[1] - 100 / 240) < 1e-10);
  assert.ok(Math.abs(nodes.hits[2] - 200 / 240) < 1e-10);
  assert.deepEqual([...nodes.colors.slice(6, 9)], [...new Float32Array(color)]);
  advance();
  assert.equal(state.packets.length, 0);
  assert.deepEqual(entries(state, 1), []);
  assert.equal(shouldContinueGraphFrame({ routeSignalActive: false }), false);
  assert.equal(shouldContinueGraphFrame({ routeSignalActive: true, documentVisible: false }), false);
  assert.equal(shouldContinueGraphFrame({ routeSignalActive: true, reducedMotion: true }), false);
  state.texture.dispose();
});

test("exiting Explore clears live waves and re-entry cannot revive the previous session", () => {
  const { state, focus, advance } = fixture();
  focus("a");
  advance(10);
  const oldPacket = state.packets[0];
  const texture = state.texture;
  const version = texture.version;
  assert.ok(entries(state, 1).length > 0);

  endFocusedSignalSession(state);
  assert.equal(state.emitters.size, 0);
  assert.equal(state.packets.length, 0);
  assert.strictEqual(state.texture, texture, "reuse the existing GPU resource");
  assert.ok(texture.version > version, "upload the cleared history before the next render");
  assert.ok(texture.image.data.every((value) => value === 0));

  focus(); // Return to Explore with no hovered/selected origin.
  advance(120, options, () => assert.fail("expired waves must not cause delayed arrivals"));
  assert.equal(state.packets.length, 0);
  assert.deepEqual(entries(state, 1), []);

  focus("b");
  advance();
  assert.equal(state.packets.length, 1);
  assert.notStrictEqual(state.packets[0], oldPacket);
  assert.equal(state.packets[0].origin, 2);
  assert.equal(state.packets[0].travel, 12);
  state.texture.dispose();
});

test("shared curved segments carry independent forward/reverse waves beyond two origins", () => {
  const { state, focus, advance } = fixture();
  focus("a");
  advance(10); // A's head enters the reversed b → hub edge.
  focus("b");
  advance();
  focus("a");
  advance();
  focus("b");
  advance();
  const shared = entries(state, 1);
  assert.equal(shared.length, 3);
  assert.deepEqual(shared.map((entry) => entry.length), [100, 100, -100]);
  const aHead = shared[2];
  assert.equal(aHead.head - aHead.length * 0.44, 0); // Arc fraction at A's head.
  const original = state.packets[0];
  assert.deepEqual(aHead.color, [...new Float32Array(original.color)]);
  state.texture.dispose();
});

test("geometry updates and palette edits do not replace an in-flight birth or route", () => {
  const { state, focus, advance, starts, ends } = fixture();
  focus("a");
  advance(3);
  const packet = state.packets[0];
  const route = packet.route;
  const color = [...packet.color];
  updateFocusedSignalGeometry(state, starts, Float32Array.from(ends, (value) => value * 2));
  focus("b");
  advance(1, { ...options, palette: createSignalColorPalette("#00ff00") });
  assert.strictEqual(packet.route, route);
  assert.deepEqual(packet.color, color);
  assert.equal(packet.travel, 48);
  assert.notDeepEqual(state.packets[1].color, color);
  state.texture.dispose();
});

test("rapid re-entry grows GPU storage without evicting or replaying live packets", () => {
  const { state, focus } = fixture();
  const firstTexture = state.texture;
  for (let visit = 0; visit < 300; visit += 1) {
    focus(visit % 2 ? "b" : "a");
    advanceFocusedSignals(state, 0.001, options);
  }
  assert.equal(state.packets.length, 300);
  assert.notStrictEqual(state.texture, firstTexture);
  assert.ok(Math.abs(state.packets[0].travel - 72) < 1e-9);
  assert.equal(entries(state, 0).length, 150);
  assert.equal(entries(state, 1).length, 150);
  state.texture.dispose();
});

test("long-running emission stays bounded by route lifetime and keeps a precise birth phase", () => {
  const { state, focus, advance } = fixture();
  focus("a");
  advance(72_000, { ...options, spacing: 0.1 }); // One hour at 20 fps.
  assert.ok(state.packets.length <= 6);
  assert.ok(state.packets.every((packet) => packet.travel >= 0 && packet.travel <= 242));
  assert.equal(state.births.get(0), Math.ceil(72_000 * 12 / 43));
  state.texture.dispose();
});
