export function isGraphSignalLayerActive({
  dimension,
  signalCount,
  signalEnabled,
  signalPositionLength,
}) {
  const positions = Math.max(0, Math.floor(Number(signalPositionLength) || 0));
  if (positions < 3) return false;
  if (dimension !== 3) return true;
  return Boolean(signalEnabled) && Number(signalCount) > 0;
}

export function shouldContinueGraphFrame({
  dimensionChanged = false,
  documentVisible = true,
  idlePresentation = false,
  presentationChanged = false,
  reducedMotion = false,
  signalLayerActive = false,
} = {}) {
  if (reducedMotion || !documentVisible) return false;
  return Boolean(
    signalLayerActive
      || presentationChanged
      || dimensionChanged
      || idlePresentation,
  );
}
