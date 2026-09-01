import { useCallback, useEffect, useState } from "react";

export const TRANSIENT_PRESENCE_DURATION_MS = 180;

export function shouldReduceTransientMotion({
  motionPreference = "system",
  systemPrefersReduced = false,
} = {}) {
  return motionPreference === "reduced"
    || (motionPreference !== "full" && systemPrefersReduced);
}

export function getTransientMotionPreference() {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  return shouldReduceTransientMotion({
    motionPreference: document.documentElement.dataset.motion ?? "system",
    systemPrefersReduced: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  });
}

export function createTransientPresence(requestedValue = null) {
  const renderedValue = requestedValue ?? null;
  return Object.freeze({
    renderedValue,
    state: renderedValue === null ? null : "entering",
    generation: 0,
  });
}

export function reduceTransientPresence(current, action) {
  if (action.type === "request") {
    const renderedValue = action.value ?? null;
    if (renderedValue === null) {
      if (current.renderedValue === null || current.state === "closing") return current;
      return Object.freeze({
        renderedValue: current.renderedValue,
        state: "closing",
        generation: current.generation + 1,
      });
    }
    if (renderedValue === current.renderedValue && current.state !== "closing") return current;
    return Object.freeze({
      renderedValue,
      state: "entering",
      generation: current.generation + 1,
    });
  }

  if (action.type !== "complete" || action.generation !== current.generation) return current;
  if (current.state === "entering") {
    return Object.freeze({ ...current, state: "open" });
  }
  if (current.state === "closing") {
    return Object.freeze({
      renderedValue: null,
      state: null,
      generation: current.generation,
    });
  }
  return current;
}

export function useTransientPresence(requestedValue, {
  durationMs = TRANSIENT_PRESENCE_DURATION_MS,
  reducedMotion = getTransientMotionPreference(),
} = {}) {
  const normalizedRequest = requestedValue ?? null;
  const [presence, setPresence] = useState(() => createTransientPresence(normalizedRequest));

  useEffect(() => {
    setPresence((current) => {
      const next = reduceTransientPresence(current, {
        type: "request",
        value: normalizedRequest,
      });
      if (!reducedMotion || next.state === null || next.state === "open") return next;
      return next.state === "closing"
        ? Object.freeze({ renderedValue: null, state: null, generation: next.generation })
        : Object.freeze({ ...next, state: "open" });
    });
  }, [normalizedRequest, reducedMotion]);

  const complete = useCallback(() => {
    setPresence((current) => reduceTransientPresence(current, {
      type: "complete",
      generation: current.generation,
    }));
  }, []);

  useEffect(() => {
    if (reducedMotion || !["entering", "closing"].includes(presence.state)) return undefined;
    const generation = presence.generation;
    const timer = window.setTimeout(() => {
      setPresence((current) => reduceTransientPresence(current, {
        type: "complete",
        generation,
      }));
    }, durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs, presence.generation, presence.state, reducedMotion]);

  if (reducedMotion) {
    return {
      renderedValue: normalizedRequest,
      state: normalizedRequest === null ? null : "open",
      complete,
    };
  }

  if (normalizedRequest === null && presence.renderedValue !== null) {
    return {
      renderedValue: presence.renderedValue,
      state: "closing",
      complete,
    };
  }

  if (normalizedRequest !== null && (
    normalizedRequest !== presence.renderedValue || presence.state === "closing"
  )) {
    return {
      renderedValue: normalizedRequest,
      state: "entering",
      complete,
    };
  }

  return {
    renderedValue: presence.renderedValue,
    state: presence.state,
    complete,
  };
}
