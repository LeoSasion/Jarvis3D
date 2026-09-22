import { Color, SRGBColorSpace } from "three";

// An idle shape does not change the independent Explore layout's material.
export function usesGraphCellMaterial(neuronMode, neuronSphere, presentationProgress) {
  return neuronMode || (neuronSphere && presentationProgress < 0.5);
}

function cellIdentityHash(value) {
  let hash = 2_166_136_261;
  for (const character of String(value)) {
    hash = Math.imul(hash ^ character.codePointAt(0), 16_777_619);
  }
  return (hash >>> 0) / 4_294_967_296;
}

// Build once per source/theme change. Cluster roots come from the existing
// source-backed grouping; no random work or color conversion runs per frame.
export function createGraphCellVariations(model, themeColor, { size = 0.25, hue = 1 } = {}) {
  const keys = model.nodes.map((node, index) => {
    const root = model.neuron?.roots[model.neuron.cluster[index]];
    return root !== undefined
      ? model.nodes[root].id
      : node.group || [...(node.tags ?? [])].sort()[0] || node.kind || "note";
  });
  const groups = new Map([...new Set(keys)].sort().map((key, index) => [key, index % 3]));
  const hsl = new Color(themeColor).getHSL({}, SRGBColorSpace);
  const colors = [0, -1, 1].map((step) => (
    // Midpoint of the original ±9° spread and the overly narrow ±1.8° pass.
    new Color().setHSL(hsl.h + step * 0.015 * hue,
      hsl.s * (1 - Math.abs(step) * (step < 0 ? 0.04 : 0.08) * hue),
      hsl.l * (1 + step * 0.05 * hue), SRGBColorSpace)
  ));
  const variations = new Float32Array(model.nodes.length * 4);
  model.nodes.forEach((node, index) => {
    colors[groups.get(keys[index])].toArray(variations, index * 4);
    variations[index * 4 + 3] = 1 - size + cellIdentityHash(`${node.id}:cell-size`) * size * 2;
  });
  return variations;
}

export function createGraphCellRoles(model, idleRootMask = model.hubMask) {
  const roles = new Float32Array(model.nodes.length * 2);
  model.nodes.forEach((_, index) => {
    roles[index * 2] = Number(Boolean(model.hubMask[index]));
    roles[index * 2 + 1] = Number(Boolean(idleRootMask[index]));
  });
  return roles;
}

export function writeGraphCellHighlights(target, nodes, activeNodeIds, interactive, directNodeIds = activeNodeIds) {
  nodes.forEach((node, index) => {
    target[index] = interactive && activeNodeIds.has(node.id)
      ? directNodeIds.has(node.id) ? 1 : 0.45 : 0;
  });
}
