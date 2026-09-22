import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./vector-shell.css";
import "./operator-workspace.css";
import "./shell-aesthetic.css";
import "./file-agent-workspace.css";
import "./desktop-tool-rail.css";
import "./motion.css";
import { installUiAudioBridge } from "./audio-system.js";
import { initializeLanguageSystem, translate } from "./i18n/language-system.js";
import { initializeInterfacePreferences } from "./interface-preferences.js";
import { initializeVisualTheme } from "./theme-system.js";
import { platform } from "./platform/index.js";
import { connectGraphVisualSettingsFile } from "./graphics/graph/graph-visual-settings.js";

initializeLanguageSystem();
initializeVisualTheme();
initializeInterfacePreferences();
installUiAudioBridge();

const surface = new URLSearchParams(window.location.search).get("surface") ?? "desktop";
document.documentElement.dataset.surface = surface;

const loadSurface = surface === "taskbar"
  ? import("./TaskbarSurface.jsx").then((module) => module.TaskbarSurface)
  : surface === "switcher"
    ? import("./WindowSwitcherSurface.jsx").then((module) => module.WindowSwitcherSurface)
    : surface === "orb"
      ? import("./NeuralOrbSurface.jsx").then((module) => module.NeuralOrbSurface)
      : import("./App.jsx").then((module) => module.App);

const visualSettingsReady = ["desktop", "orb"].includes(surface)
  ? connectGraphVisualSettingsFile(platform.graphVisualSettings)
  : Promise.resolve();

if (["desktop", "orb"].includes(surface) && platform.graphVisualSettings) {
  document.getElementById("root").textContent = translate("graphVisualSettings.storage.loading");
}

Promise.all([loadSurface, visualSettingsReady]).then(([Surface]) => {
  createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <Surface />
    </React.StrictMode>,
  );
  if (surface === "desktop") {
    void import("./visual-effects/mount-global-visual-effects.jsx")
      .then(({ mountGlobalVisualEffects }) => mountGlobalVisualEffects())
      .catch(() => {
        document.documentElement.dataset.visualEffectsRuntime = "unavailable";
        document.documentElement.dataset.visualEffectsRuntimeReason = "module-load";
        window.dispatchEvent(new CustomEvent("jarvis:visual-effects-runtime-fault", {
          detail: { reason: "module-load" },
        }));
      });
  }
}).catch((error) => {
  document.getElementById("root").textContent = translate("app.surfaceLoadFailed", {
    message: error.message,
  });
});
