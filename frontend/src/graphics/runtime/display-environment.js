function addMediaListener(mediaQuery, listener) {
  if (!mediaQuery) return () => {};
  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  }
  mediaQuery.addListener?.(listener);
  return () => mediaQuery.removeListener?.(listener);
}

export function readGraphicsDisplayEnvironment() {
  const hasWindow = typeof window !== "undefined";
  const forcedColors = hasWindow
    && typeof window.matchMedia === "function"
    && window.matchMedia("(forced-colors: active)").matches;
  return Object.freeze({
    devicePixelRatio: hasWindow ? Number(window.devicePixelRatio) || 1 : 1,
    forcedColors,
  });
}

export function subscribeGraphicsDisplayEnvironment(onChange) {
  if (typeof window === "undefined") return () => {};
  let removeDprListener = () => {};
  const forcedColorsQuery = typeof window.matchMedia === "function"
    ? window.matchMedia("(forced-colors: active)")
    : null;

  const bindDprListener = () => {
    removeDprListener();
    if (typeof window.matchMedia !== "function") return;
    const currentDpr = Number(window.devicePixelRatio) || 1;
    const dprQuery = window.matchMedia(`(resolution: ${currentDpr}dppx)`);
    removeDprListener = addMediaListener(dprQuery, handleDprChange);
  };
  const handleEnvironmentChange = () => onChange();
  const handleDprChange = () => {
    bindDprListener();
    onChange();
  };

  bindDprListener();
  const removeForcedColorsListener = addMediaListener(forcedColorsQuery, handleEnvironmentChange);
  window.addEventListener("resize", handleEnvironmentChange, { passive: true });
  window.visualViewport?.addEventListener("resize", handleEnvironmentChange, { passive: true });

  return () => {
    removeDprListener();
    removeForcedColorsListener();
    window.removeEventListener("resize", handleEnvironmentChange);
    window.visualViewport?.removeEventListener("resize", handleEnvironmentChange);
  };
}
