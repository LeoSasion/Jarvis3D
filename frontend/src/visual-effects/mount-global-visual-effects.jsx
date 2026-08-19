import { Component } from "react";
import { createRoot } from "react-dom/client";
import { GlobalVisualEffects } from "./GlobalVisualEffects.jsx";
import { markVisualEffectsRuntimeUnavailable } from "./visual-effects-runtime-state.js";
import { initializeVisualEffects } from "./visual-effects-system.js";

const HOST_ID = "jarvis-visual-effects-root";
let effectsRoot = null;

class VisualEffectsErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    markVisualEffectsRuntimeUnavailable("runtime-fault");
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function mountGlobalVisualEffects() {
  initializeVisualEffects();
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("aria-hidden", "true");
    host.style.pointerEvents = "none";
    document.body.append(host);
  }

  effectsRoot ??= createRoot(host);
  effectsRoot.render(
    <VisualEffectsErrorBoundary>
      <GlobalVisualEffects />
    </VisualEffectsErrorBoundary>,
  );
}
