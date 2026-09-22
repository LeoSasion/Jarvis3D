import { useEffect, useRef, useState } from "react";
import { RecordRegular, StopRegular } from "@fluentui/react-icons";
import { useLanguage } from "../i18n/language-system.js";
import { createScreenRecorder, formatRecordingDuration } from "../screen-recording.js";

const ERROR_KEYS = Object.freeze({
  unavailable: "recording.error.unavailable",
  "h264-unavailable": "recording.error.h264",
  "capture-failed": "recording.error.capture",
  empty: "recording.error.empty",
  "save-failed": "recording.error.save",
});

export function ScreenRecordingButton({ onFeedback }) {
  const { t } = useLanguage();
  const [recording, setRecording] = useState({ status: "idle", startedAt: null });
  const [elapsed, setElapsed] = useState(0);
  const controllerRef = useRef(null);
  const feedbackRef = useRef({ onFeedback, t });
  feedbackRef.current = { onFeedback, t };
  const active = recording.status === "recording";
  const busy = recording.status === "requesting" || recording.status === "stopping";

  useEffect(() => {
    const feedback = (key, severity, parameters, detail) => {
      const current = feedbackRef.current;
      current.onFeedback?.({ title: current.t(key, parameters), severity, source: "shell", detail });
    };
    const controller = createScreenRecorder({
      onStateChange: setRecording,
      onComplete: ({ filename, interrupted }) => feedback(
        interrupted ? "recording.interrupted" : "recording.downloadStarted",
        interrupted ? "warning" : "ok", undefined, filename),
      onError: (code) => feedback(ERROR_KEYS[code] ?? "recording.error.capture", "error"),
      onCancel: () => feedback("recording.cancelled", "info"),
    });
    controllerRef.current = controller;
    return () => controller.dispose();
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    const tick = () => setElapsed(Date.now() - recording.startedAt);
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [active, recording.startedAt]);

  useEffect(() => {
    if (recording.status === "idle") return undefined;
    const preventLosingRecording = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventLosingRecording);
    return () => window.removeEventListener("beforeunload", preventLosingRecording);
  }, [recording.status]);

  const label = t(active ? "recording.stop" : recording.status === "requesting"
    ? "recording.requesting" : recording.status === "stopping" ? "recording.saving" : "recording.start");

  return (
    <button
      type="button"
      className={`topbar__record${active ? " is-recording" : ""}`}
      onClick={() => { if (active) controllerRef.current?.stop(); else void controllerRef.current?.start(); }}
      disabled={busy}
      aria-label={label}
      aria-pressed={active}
      aria-busy={busy}
      title={active ? t("recording.stopHint") : t("recording.startHint")}
    >
      {active ? <StopRegular aria-hidden="true" /> : <RecordRegular aria-hidden="true" />}
      <span>{label}</span>
      {active ? <time aria-hidden="true">{formatRecordingDuration(elapsed)}</time> : null}
    </button>
  );
}
