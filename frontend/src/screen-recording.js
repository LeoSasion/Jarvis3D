export const SCREEN_RECORDING_BITRATE = 6_000_000;
// In-band H.264 parameter sets keep MP4 decodable when a captured tab/window
// changes resolution. Do not fall back to avc1, which freezes after a resize.
export const SCREEN_RECORDING_MIME_TYPES = Object.freeze([
  "video/mp4;codecs=avc3.420028",
  "video/mp4;codecs=avc3",
]);

export function selectRecordingMimeType(Recorder) {
  return SCREEN_RECORDING_MIME_TYPES.find((type) => Recorder?.isTypeSupported?.(type)) ?? null;
}

export function formatRecordingDuration(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const clock = [minutes % 60, seconds % 60].map((value) => String(value).padStart(2, "0")).join(":");
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${clock}` : clock;
}

export function recordingFileName(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `JARVIS-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `-${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}.mp4`;
}

export function downloadRecording(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Let the browser acquire the Blob before releasing its backing storage.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

// Own the complete capture lifecycle independently of React renders. The native
// display stream records the final browser composition, including DOM and Bloom.
export function createScreenRecorder({
  mediaDevices = globalThis.navigator?.mediaDevices,
  Recorder = globalThis.MediaRecorder,
  save = downloadRecording,
  now = Date.now,
  onStateChange = () => {},
  onComplete = () => {},
  onError = () => {},
  onCancel = () => {},
} = {}) {
  let session = null;
  let disposed = false;
  const publish = (status, startedAt = null) => {
    if (!disposed) onStateChange({ status, startedAt });
  };
  const release = (current) => {
    if (current.recorder) {
      current.recorder.ondataavailable = null;
      current.recorder.onstart = null;
      current.recorder.onstop = null;
      current.recorder.onerror = null;
    }
    for (const track of current.stream?.getTracks() ?? []) {
      track.removeEventListener("ended", stop);
      track.stop();
    }
  };

  async function finish(current) {
    if (session !== current || disposed || current.finishing) return;
    current.finishing = true;
    publish("stopping", current.startedAt);
    release(current);
    try {
      const blob = new Blob(current.chunks, { type: current.recorder.mimeType || current.mimeType });
      current.chunks.length = 0;
      if (!blob.size) throw new Error("empty-recording");
      const filename = recordingFileName(new Date(current.startedAt ?? now()));
      await save(blob, filename);
      if (!disposed) onComplete({ filename, size: blob.size, interrupted: Boolean(current.failure) });
    } catch (error) {
      if (!disposed) onError(error.message === "empty-recording" ? "empty" : "save-failed");
    } finally {
      if (session === current) session = null;
      publish("idle");
    }
  }

  function stop() {
    const current = session;
    if (!current?.recorder || current.finishing) return;
    publish("stopping", current.startedAt);
    // An ended track or encoder error may have already queued the final data
    // and stop events. Always let those events finish the file exactly once.
    if (current.recorder.state !== "inactive") current.recorder.stop();
  }

  async function start() {
    if (session || disposed) return;
    if (!mediaDevices?.getDisplayMedia || !Recorder) {
      onError("unavailable");
      return;
    }
    const mimeType = selectRecordingMimeType(Recorder);
    if (!mimeType) {
      onError("h264-unavailable");
      return;
    }
    const current = { mimeType, chunks: [], recorder: null, stream: null, startedAt: null };
    session = current;
    publish("requesting");
    try {
      // Call directly from the click so transient user activation is retained.
      current.stream = await mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser", frameRate: { ideal: 30, max: 30 },
          width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 } },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: "include",
        surfaceSwitching: "exclude",
        systemAudio: "exclude",
      });
      if (disposed || session !== current) {
        release(current);
        return;
      }
      const video = current.stream.getVideoTracks()[0];
      if (!video || video.readyState === "ended") throw new Error("capture-ended");
      video.contentHint = "motion";
      const recorder = new Recorder(current.stream, { mimeType, videoBitsPerSecond: SCREEN_RECORDING_BITRATE });
      current.recorder = recorder;
      recorder.ondataavailable = ({ data }) => {
        if (data?.size > 0) current.chunks.push(data);
      };
      recorder.onstart = () => {
        current.startedAt = now();
        publish("recording", current.startedAt);
      };
      recorder.onstop = () => { void finish(current); };
      recorder.onerror = (event) => {
        current.failure = event.error ?? new Error("encoder-failed");
        stop();
      };
      video.addEventListener("ended", stop, { once: true });
      recorder.start(1000);
    } catch (error) {
      release(current);
      if (session === current) session = null;
      publish("idle");
      if (disposed) return;
      if (error.name === "NotAllowedError" || error.name === "AbortError") onCancel();
      else onError(error.name === "NotSupportedError" ? "h264-unavailable" : "capture-failed");
    }
  }

  function dispose() {
    disposed = true;
    const current = session;
    session = null;
    if (!current) return;
    release(current);
    if (current.recorder && current.recorder.state !== "inactive") current.recorder.stop();
    current.chunks.length = 0;
  }

  return { start, stop, dispose };
}
