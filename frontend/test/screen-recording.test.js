import assert from "node:assert/strict";
import test from "node:test";
import {
  createScreenRecorder, formatRecordingDuration, recordingFileName,
  SCREEN_RECORDING_BITRATE, selectRecordingMimeType,
} from "../src/screen-recording.js";
import { TRANSLATION_DICTIONARIES } from "../src/i18n/translations.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));

function fixture({ captureError, constructorError, startError, supported = true, deferredCapture, saveError } = {}) {
  const tracks = [new EventTarget()];
  Object.assign(tracks[0], { readyState: "live", stopped: 0,
    stop() { this.stopped += 1; this.readyState = "ended"; } });
  const stream = { getTracks: () => tracks, getVideoTracks: () => tracks };
  const requests = [];
  const instances = [];
  class Recorder {
    static isTypeSupported(type) { return supported && type === "video/mp4;codecs=avc3.420028"; }
    constructor(input, options) {
      if (constructorError) throw constructorError;
      this.stream = input;
      this.options = options;
      this.mimeType = options.mimeType;
      this.state = "inactive";
      this.stops = 0;
      instances.push(this);
    }
    start(timeslice) {
      if (startError) throw startError;
      this.timeslice = timeslice;
      this.state = "recording";
      queueMicrotask(() => this.onstart?.());
    }
    data(text) { this.ondataavailable?.({ data: new Blob([text]) }); }
    stop() {
      this.state = "inactive";
      this.stops += 1;
      queueMicrotask(() => {
        this.data("final");
        this.onstop?.();
      });
    }
  }
  const states = [];
  const saved = [];
  const completed = [];
  const errors = [];
  const cancelled = [];
  const controller = createScreenRecorder({
    Recorder,
    mediaDevices: { getDisplayMedia(options) {
      requests.push(options);
      if (captureError) return Promise.reject(captureError);
      return deferredCapture ?? Promise.resolve(stream);
    } },
    now: () => new Date(2026, 8, 23, 12, 30, 5).getTime(),
    onStateChange: (state) => states.push(state),
    save: (blob, filename) => { if (saveError) throw saveError; saved.push({ blob, filename }); },
    onComplete: (result) => completed.push(result),
    onError: (error) => errors.push(error),
    onCancel: () => cancelled.push(true),
  });
  return { controller, tracks, stream, requests, instances, states, saved, completed, errors, cancelled };
}

test("recording uses native display capture and explicit H.264 MP4 at 6 Mbps", async () => {
  const f = fixture();
  const pending = f.controller.start();
  assert.equal(f.requests.length, 1, "capture is requested synchronously within user activation");
  await f.controller.start();
  assert.equal(f.requests.length, 1, "double clicks cannot open two capture pickers");
  await pending;
  assert.equal(f.requests[0].audio, false);
  assert.equal(f.requests[0].preferCurrentTab, true);
  assert.equal(f.requests[0].video.frameRate.max, 30);
  assert.equal(f.instances[0].stream, f.stream);
  assert.equal(f.instances[0].options.videoBitsPerSecond, SCREEN_RECORDING_BITRATE);
  assert.equal(f.instances[0].options.videoBitsPerSecond, 6_000_000);
  assert.equal(f.instances[0].options.mimeType, "video/mp4;codecs=avc3.420028");
  assert.equal(f.states.at(-1).status, "recording");
  f.controller.dispose();
});

test("stop downloads every chunk including the asynchronous final chunk exactly once", async () => {
  const f = fixture();
  await f.controller.start();
  f.instances[0].data("first");
  f.instances[0].data("");
  f.controller.stop();
  f.controller.stop();
  assert.equal(f.states.at(-1).status, "stopping");
  assert.equal(f.saved.length, 0);
  await flush();
  assert.equal(f.instances[0].stops, 1);
  assert.equal(f.saved.length, 1);
  assert.equal(await f.saved[0].blob.text(), "firstfinal");
  assert.match(f.saved[0].blob.type, /video\/mp4;codecs=avc3/u);
  assert.equal(f.saved[0].filename, "JARVIS-2026-09-23-12-30-05.mp4");
  assert.equal(f.tracks[0].stopped, 1);
  assert.equal(f.completed[0].interrupted, false);
  assert.equal(f.states.at(-1).status, "idle");
  assert.deepEqual(f.errors, []);
});

test("the browser's stop-sharing control also finalizes and downloads the recording", async () => {
  const f = fixture();
  await f.controller.start();
  f.tracks[0].dispatchEvent(new Event("ended"));
  await flush();
  assert.equal(f.saved.length, 1);
  assert.equal(f.tracks[0].stopped, 1);
  assert.equal(f.states.at(-1).status, "idle");
});

test("capture cancellation returns to idle without creating an empty download", async () => {
  const f = fixture({ captureError: new DOMException("cancelled", "NotAllowedError") });
  await f.controller.start();
  assert.equal(f.states.at(-1).status, "idle");
  assert.equal(f.cancelled.length, 1);
  assert.equal(f.saved.length, 0);
  assert.deepEqual(f.errors, []);
  await f.controller.start();
  assert.equal(f.requests.length, 2, "cancelled recording can be retried");
});

test("unsupported H.264 fails before screen capture and never silently falls back to WebM", async () => {
  const f = fixture({ supported: false });
  await f.controller.start();
  assert.deepEqual(f.errors, ["h264-unavailable"]);
  assert.equal(f.requests.length, 0);
  assert.equal(selectRecordingMimeType({ isTypeSupported: (type) => type.startsWith("video/webm") }), null);
  assert.equal(selectRecordingMimeType(undefined), null);
});

test("H.264 negotiation requires in-band parameter sets for capture resolution changes", () => {
  assert.equal(selectRecordingMimeType({ isTypeSupported: () => true }), "video/mp4;codecs=avc3.420028");
  assert.equal(selectRecordingMimeType({ isTypeSupported: (type) => type === "video/mp4;codecs=avc3" }),
    "video/mp4;codecs=avc3");
  assert.equal(selectRecordingMimeType({ isTypeSupported: (type) => type.includes("avc1") }), null,
    "avc1-only encoders must not create files that freeze when the source resizes");
});

test("encoder construction and startup failures release all captured tracks", async () => {
  for (const options of [
    { constructorError: new DOMException("unsupported", "NotSupportedError") },
    { startError: new Error("could not start encoder") },
  ]) {
    const f = fixture(options);
    await f.controller.start();
    assert.equal(f.tracks[0].stopped, 1);
    assert.equal(f.states.at(-1).status, "idle");
    assert.equal(f.errors.length, 1);
    assert.equal(f.saved.length, 0);
  }
});

test("unmount during the picker stops a late stream without starting recording", async () => {
  let resolve;
  const f = fixture({ deferredCapture: new Promise((done) => { resolve = done; }) });
  const pending = f.controller.start();
  f.controller.dispose();
  resolve(f.stream);
  await pending;
  assert.equal(f.tracks[0].stopped, 1);
  assert.equal(f.instances.length, 0);
  assert.equal(f.saved.length, 0);
});

test("unmount releases an active recorder without callbacks or stray downloads", async () => {
  const f = fixture();
  await f.controller.start();
  const stateCount = f.states.length;
  f.controller.dispose();
  await flush();
  assert.equal(f.tracks[0].stopped, 1);
  assert.equal(f.instances[0].stops, 1);
  assert.equal(f.saved.length, 0);
  assert.equal(f.states.length, stateCount);
});

test("encoder errors preserve captured data and report interruption after finalization", async () => {
  const f = fixture();
  await f.controller.start();
  f.instances[0].data("captured");
  f.instances[0].onerror({ error: new Error("encoder interrupted") });
  await flush();
  assert.equal(await f.saved[0].blob.text(), "capturedfinal");
  assert.equal(f.completed[0].interrupted, true);
  assert.equal(f.tracks[0].stopped, 1);
});

test("empty recordings and download failures report errors instead of success", async () => {
  const empty = fixture();
  await empty.controller.start();
  empty.instances[0].state = "inactive";
  empty.instances[0].onstop();
  await flush();
  assert.deepEqual(empty.errors, ["empty"]);
  assert.equal(empty.saved.length, 0);
  const failed = fixture({ saveError: new Error("download failed") });
  await failed.controller.start();
  failed.controller.stop();
  await flush();
  assert.deepEqual(failed.errors, ["save-failed"]);
  assert.equal(failed.completed.length, 0);
  assert.equal(failed.tracks[0].stopped, 1);
});

test("consecutive recordings do not mix chunks or retain an old capture", async () => {
  const f = fixture();
  await f.controller.start();
  f.instances[0].data("old");
  f.controller.stop();
  await flush();
  f.tracks[0].readyState = "live";
  await f.controller.start();
  f.instances[1].data("new");
  f.controller.stop();
  await flush();
  assert.equal(await f.saved[0].blob.text(), "oldfinal");
  assert.equal(await f.saved[1].blob.text(), "newfinal");
});

test("recording labels, duration and filenames cover both interface languages", () => {
  assert.equal(formatRecordingDuration(0), "00:00");
  assert.equal(formatRecordingDuration(61_000), "01:01");
  assert.equal(formatRecordingDuration(3_661_000), "1:01:01");
  assert.match(recordingFileName(new Date(2026, 0, 2, 3, 4, 5)), /^JARVIS-2026-01-02-03-04-05\.mp4$/u);
  const keys = Object.keys(TRANSLATION_DICTIONARIES["en-US"]).filter((key) => key.startsWith("recording."));
  assert.ok(keys.length >= 14);
  for (const dictionary of Object.values(TRANSLATION_DICTIONARIES)) {
    for (const key of keys) assert.ok(dictionary[key], key);
  }
});
