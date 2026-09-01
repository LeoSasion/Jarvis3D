export function getLayoutChunkMessageType({
  emitIntermediate = true,
  settled = false,
} = {}) {
  return settled || emitIntermediate ? "positions" : "progress";
}
