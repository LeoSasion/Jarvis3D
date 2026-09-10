import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  forceZ,
} from "d3-force-3d";
import Graph from "graphology";
import { createNeuronPositions, createNeuronStructure } from "../graph/graph-neuron-model.js";
import { createSpatialNeuronPositions } from "../graph/graph-neuron-spatial-model.js";
import { getLayoutChunkMessageType } from "./layout-worker-policy.js";

const CHUNK_TICKS = 12;
const DEFAULT_TICKS = 180;
let activeJob = null;

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function normalizeForceSettings(value = {}) {
  return {
    repulsion: clamp(value.repulsion, 0.5, 2, 1),
    linkDistance: clamp(value.linkDistance, 0.6, 2, 1),
    linkStrength: clamp(value.linkStrength, 0.5, 1.5, 1),
    collision: clamp(value.collision, 0.5, 1.5, 1),
    center: clamp(value.center, 0, 0.12, 0.06),
  };
}

function buildTopology(nodes, edges) {
  const topology = new Graph({
    type: "undirected",
    multi: true,
    allowSelfLoops: false,
  });
  nodes.forEach((node) => {
    if (!topology.hasNode(node.id)) topology.addNode(node.id);
  });
  edges.forEach((edge, index) => {
    if (!topology.hasNode(edge.source) || !topology.hasNode(edge.target)) return;
    try {
      topology.addUndirectedEdgeWithKey(`edge-${index}`, edge.source, edge.target);
    } catch {
      // Invalid duplicate or self-loop edges are ignored by the layout topology.
    }
  });
  return topology;
}

function collectPositions(nodes, dimension) {
  const positions = new Float32Array(nodes.length * 3);
  nodes.forEach((node, index) => {
    positions[index * 3] = Number.isFinite(node.x) ? node.x : 0;
    positions[index * 3 + 1] = Number.isFinite(node.y) ? node.y : 0;
    positions[index * 3 + 2] = dimension === 3 && Number.isFinite(node.z) ? node.z : 0;
  });
  return positions;
}

function postLayoutFrame(job, settled) {
  const positions = collectPositions(job.nodes, job.dimension);
  self.postMessage({
    type: "positions",
    revision: job.revision,
    iteration: job.iteration,
    settled,
    positions,
  }, [positions.buffer]);
}

function postLayoutProgress(job) {
  self.postMessage({
    type: "progress",
    revision: job.revision,
    iteration: job.iteration,
  });
}

function runChunk(job) {
  if (activeJob !== job) return;
  const stopAt = Math.min(job.iteration + CHUNK_TICKS, job.tickBudget);
  while (job.iteration < stopAt) {
    job.simulation.tick();
    job.iteration += 1;
  }

  const settled = job.iteration >= job.tickBudget || job.simulation.alpha() < 0.012;
  const messageType = getLayoutChunkMessageType({
    emitIntermediate: job.emitIntermediate,
    settled,
  });
  if (messageType === "positions") postLayoutFrame(job, settled);
  else postLayoutProgress(job);
  if (settled) {
    job.simulation.stop();
    if (activeJob === job) activeJob = null;
    return;
  }
  setTimeout(() => runChunk(job), 0);
}

function startLayout(message) {
  activeJob?.simulation.stop();
  activeJob = null;
  const dimension = message.dimension === 3 ? 3 : 2;
  if (message.force?.mode === "neuron") {
    const structure = message.neuronStructure ?? createNeuronStructure(message.nodes, message.edges);
    const positions = dimension === 3
      ? createSpatialNeuronPositions(message.nodes, structure, message.force)
      : createNeuronPositions(message.nodes, structure, message.force);
    self.postMessage({
      type: "positions", revision: message.revision, iteration: 1, settled: true, positions,
    }, [positions.buffer]);
    return;
  }
  const forceSettings = normalizeForceSettings(message.force);
  const topology = buildTopology(message.nodes, message.edges);
  const nodes = message.nodes.map((node, index) => ({
    id: node.id,
    weight: Number(node.weight) || 1,
    degree: topology.hasNode(node.id) ? topology.degree(node.id) : 0,
    radius: clamp(node.radius, 2, 72, 4),
    x: Number.isFinite(node.x) ? node.x : Math.cos(index * 2.399963) * Math.sqrt(index + 1) * 12,
    y: Number.isFinite(node.y) ? node.y : Math.sin(index * 2.399963) * Math.sqrt(index + 1) * 12,
    z: dimension === 3 && Number.isFinite(node.z) ? node.z : 0,
  }));
  const links = message.edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    weight: Number(edge.weight) || 1,
  }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const validLinks = links.filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target));
  const simulation = forceSimulation(nodes, dimension)
    .alpha(1)
    .alphaMin(0.01)
    .alphaDecay(0.028)
    .velocityDecay(0.34)
    .force("center", forceCenter(0, 0, 0).strength(forceSettings.center))
    .force("x", forceX(0).strength(forceSettings.center * 0.2))
    .force("y", forceY(0).strength(forceSettings.center * 0.2))
    .force("charge", forceManyBody()
      .strength((node) => (-18 - Math.min(42, node.degree * 1.7)) * forceSettings.repulsion)
      .distanceMin(3)
      .distanceMax(360)
      .theta(0.92))
    .force("collision", forceCollide()
      .radius((node) => Math.max(
        node.radius + 1.2,
        (3.5 + Math.sqrt(node.weight + node.degree) * 0.75)
          * forceSettings.collision,
      ))
      .strength(0.72)
      .iterations(1));

  if (dimension === 3) {
    simulation.force("z", forceZ(0).strength(0.006));
  }
  if (validLinks.length > 0) {
    simulation.force("link", forceLink(validLinks)
      .id((node) => node.id)
      .distance((edge) => (
        24 + Math.min(32, 12 / Math.max(0.5, edge.weight))
      ) * forceSettings.linkDistance)
      .strength((edge) => (
        Math.min(0.48, 0.12 + edge.weight * 0.06) * forceSettings.linkStrength
      ))
      .iterations(1));
  }
  simulation.stop();

  const job = {
    revision: String(message.revision ?? "layout"),
    dimension,
    nodes,
    simulation,
    iteration: 0,
    tickBudget: Math.max(24, Math.min(360, Number(message.tickBudget) || DEFAULT_TICKS)),
    emitIntermediate: message.emitIntermediate !== false,
  };
  activeJob = job;
  if (job.emitIntermediate) postLayoutFrame(job, false);
  setTimeout(() => runChunk(job), 0);
}

self.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || typeof message !== "object") return;
  if (message.type === "stop") {
    activeJob?.simulation.stop();
    activeJob = null;
    return;
  }
  if (message.type === "layout" && Array.isArray(message.nodes) && Array.isArray(message.edges)) {
    try {
      startLayout(message);
    } catch (error) {
      activeJob?.simulation?.stop();
      activeJob = null;
      self.postMessage({
        type: "error",
        revision: String(message.revision ?? "layout"),
        message: String(error?.message ?? "Layout failed").slice(0, 240),
      });
    }
  }
});
