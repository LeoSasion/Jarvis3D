export function shouldApplyGraphCameraCommand(command, consumedId, dimension, layoutReady) {
  if (!command || (command.dimension !== undefined && command.dimension !== dimension)) return false;
  if (consumedId !== null && command.id <= consumedId) return false;
  return command.type !== "focus-node" || layoutReady;
}

export function consumePendingGraphFocus(command, consumedId, dimension) {
  if (!command || command.type !== "focus-node"
    || (command.dimension !== undefined && command.dimension !== dimension)
    || (consumedId !== null && command.id <= consumedId)) return consumedId;
  return command.id;
}
