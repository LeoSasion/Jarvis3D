export function graphWheelPixels(deltaY, deltaMode = 0, height = 800) {
  if (!Number.isFinite(deltaY)) return 0;
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? height : 1);
  return Math.max(-240, Math.min(240, pixels));
}

export function graphWheelZoom(zoom, pixels) {
  return Math.max(0.1, Math.min(8, zoom * Math.exp(-pixels * 0.002)));
}

export function graphWheelDepth(distance, pixels) {
  return Math.max(80, Math.min(3200, distance * Math.exp(pixels * 0.002)));
}
