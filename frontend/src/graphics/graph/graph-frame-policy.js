export function isGraphSignalLayerActive({
  signalCount,
  signalEnabled,
  signalPositionLength,
}) {
  const positions = Math.max(0, Math.floor(Number(signalPositionLength) || 0));
  if (positions < 3) return false;
  return Boolean(signalEnabled) && Number(signalCount) > 0;
}

export function shouldContinueGraphFrame({
  dimensionChanged = false,
  documentVisible = true,
  focusedFilamentActive = false,
  nodeActivationActive = false,
  idlePresentation = false,
  presentationChanged = false,
  reducedMotion = false,
  signalLayerActive = false,
} = {}) {
  if (reducedMotion || !documentVisible) return false;
  return Boolean(
    signalLayerActive
      || focusedFilamentActive
      || nodeActivationActive
      || presentationChanged
      || dimensionChanged
      || idlePresentation,
  );
}
