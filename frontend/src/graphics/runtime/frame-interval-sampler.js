const MIN_IDLE_GAP_MS = 250;

function readPositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function createFrameIntervalSamplerState() {
  return {
    continuousLongGap: false,
    intervalCount: 0,
    longGapCandidateMs: 0,
    maxFrameIntervalMs: 0,
  };
}

export function resetFrameIntervalSampler(state) {
  state.continuousLongGap = false;
  state.intervalCount = 0;
  state.longGapCandidateMs = 0;
  state.maxFrameIntervalMs = 0;
}

function accumulateFrameInterval(state, frameIntervalMs, sampleInterval) {
  state.intervalCount += 1;
  state.maxFrameIntervalMs = Math.max(state.maxFrameIntervalMs, frameIntervalMs);
  if (state.intervalCount < sampleInterval) return null;

  const sample = state.maxFrameIntervalMs;
  state.intervalCount = 0;
  state.maxFrameIntervalMs = 0;
  return sample;
}

export function readFrameIntervalSample(state, {
  deltaMs,
  sampleInterval,
  slowFrameMs,
}) {
  const frameIntervalMs = readPositiveNumber(deltaMs, 0);
  const boundedSampleInterval = Math.max(1, Math.floor(readPositiveNumber(sampleInterval, 1)));
  const idleGapMs = Math.max(
    MIN_IDLE_GAP_MS,
    readPositiveNumber(slowFrameMs, 28) * 8,
  );

  if (frameIntervalMs === 0) {
    resetFrameIntervalSampler(state);
    return null;
  }

  if (frameIntervalMs > idleGapMs) {
    // A demand-driven canvas resumes with one large delta after sitting still.
    // A second consecutive large delta proves that rendering is continuously slow.
    if (state.continuousLongGap) {
      return accumulateFrameInterval(state, frameIntervalMs, boundedSampleInterval);
    }
    if (state.longGapCandidateMs > 0) {
      const candidate = state.longGapCandidateMs;
      state.longGapCandidateMs = 0;
      state.continuousLongGap = true;
      const candidateSample = accumulateFrameInterval(
        state,
        candidate,
        boundedSampleInterval,
      );
      const currentSample = accumulateFrameInterval(
        state,
        frameIntervalMs,
        boundedSampleInterval,
      );
      return candidateSample ?? currentSample;
    }
    resetFrameIntervalSampler(state);
    state.longGapCandidateMs = frameIntervalMs;
    return null;
  }

  state.continuousLongGap = false;
  state.longGapCandidateMs = 0;
  return accumulateFrameInterval(state, frameIntervalMs, boundedSampleInterval);
}

export const frameIntervalSamplingPolicy = Object.freeze({
  minimumIdleGapMs: MIN_IDLE_GAP_MS,
});
