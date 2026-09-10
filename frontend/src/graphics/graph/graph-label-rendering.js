// Labels share the graph renderer, but never enter its Bloom/tone-mapping pass.
export const GRAPH_LABEL_LAYER = 1;

export function renderGraphLabels(renderer, scene, camera) {
  const mask = camera.layers.mask;
  const autoClear = renderer.autoClear;
  try {
    camera.layers.set(GRAPH_LABEL_LAYER);
    renderer.autoClear = false;
    renderer.render(scene, camera);
  } finally {
    camera.layers.mask = mask;
    renderer.autoClear = autoClear;
  }
}
