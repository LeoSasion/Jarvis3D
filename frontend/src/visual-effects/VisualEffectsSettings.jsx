import { useSyncExternalStore } from "react";
import {
  getVisualEffectsPresetId,
  getVisualEffectsSnapshot,
  setVisualEffectEnabled,
  setVisualEffectsCadence,
  setVisualEffectsEnabled,
  setVisualEffectsPreset,
  subscribeVisualEffects,
  visualEffectDefinitions,
  visualEffectsPresets,
} from "./visual-effects-system.js";
import {
  getVisualEffectsRuntimeSnapshot,
  subscribeVisualEffectsRuntime,
} from "./visual-effects-runtime-state.js";
import "./visual-effects-settings.css";

const cadenceOptions = Object.freeze([
  Object.freeze({ id: "economy", label: "ECONOMY", detail: "12 FPS grain cadence" }),
  Object.freeze({ id: "balanced", label: "BALANCED", detail: "24 FPS grain cadence" }),
]);

const runtimeReasonCopy = Object.freeze({
  disabled: "The desktop overlay is fully unmounted.",
  "forced-colors": "Windows forced-color mode bypasses decorative effects.",
  hidden: "The hidden renderer has released its effect layers.",
  "module-load": "The optional overlay module did not load; the functional UI is unaffected.",
  "no-active-effects": "No individual effect is selected.",
  "recovery-override": "The fx=off recovery override is active.",
  "runtime-fault": "The optional overlay stopped after a runtime fault; the functional UI is unaffected.",
  "surface-policy": "This renderer is excluded by the current surface policy.",
});

function getRuntimeStatusCode(preferences, runtime) {
  if (!preferences.enabled) return "OFF · 0 LAYERS";
  if (runtime.status === "active") {
    return `CSS OVERLAY · ${runtime.layerCount} LAYER${runtime.layerCount === 1 ? "" : "S"}`;
  }
  if (runtime.status === "unavailable") return "UNAVAILABLE · 0 LAYERS";
  if (runtime.status === "bypassed") return "BYPASSED · 0 LAYERS";
  return "STARTING · 0 LAYERS";
}

function getRuntimeStatusDetail(preferences, runtime) {
  if (!preferences.enabled) return runtimeReasonCopy.disabled;
  if (runtime.status === "active") {
    return `${runtime.layerCount} independently mounted overlay layer${runtime.layerCount === 1 ? " is" : "s are"} active.`;
  }
  return runtimeReasonCopy[runtime.reason]
    ?? "The optional overlay is not currently active; the functional UI remains available.";
}

export function VisualEffectsSettings({ onToast }) {
  const preferences = useSyncExternalStore(
    subscribeVisualEffects,
    getVisualEffectsSnapshot,
    getVisualEffectsSnapshot,
  );
  const runtime = useSyncExternalStore(
    subscribeVisualEffectsRuntime,
    getVisualEffectsRuntimeSnapshot,
    getVisualEffectsRuntimeSnapshot,
  );
  const presetId = getVisualEffectsPresetId(preferences);
  const runtimeStatusCode = getRuntimeStatusCode(preferences, runtime);
  const runtimeStatusDetail = getRuntimeStatusDetail(preferences, runtime);

  const toggleMaster = () => {
    const next = setVisualEffectsEnabled(!preferences.enabled);
    onToast?.(`Visual effects ${next.enabled ? "enabled" : "disabled"}`);
  };

  return (
    <div className="visual-effects-settings interface-option-group">
      <header>
        <span>
          <strong>DESKTOP SCREEN EFFECTS</strong>
          <small>DESKTOP-WIDE OVERLAY · FUNCTIONAL UI ISOLATED</small>
        </span>
        <code aria-live="polite">{runtimeStatusCode}</code>
      </header>

      <div className="visual-effects-master-row">
        <span>
          <strong>SCREEN OVERLAY</strong>
          <small>Turning this off unmounts every effect layer.</small>
        </span>
        <button
          type="button"
          className={`runtime-switch ${preferences.enabled ? "is-on" : ""}`}
          role="switch"
          aria-checked={preferences.enabled}
          onClick={toggleMaster}
        >
          <span />
          <strong>{preferences.enabled ? "ON" : "OFF"}</strong>
        </button>
      </div>

      <div className="interface-option-grid visual-effects-preset-grid" role="radiogroup" aria-label="Visual effects preset">
        {visualEffectsPresets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={preset.id === presetId}
            className={preset.id === presetId ? "is-selected" : ""}
            onClick={() => {
              setVisualEffectsPreset(preset.id);
              onToast?.(`Visual effects preset: ${preset.label}`);
            }}
          >
            <strong>{preset.label}</strong>
            <small>{preset.detail}</small>
          </button>
        ))}
      </div>

      <div className="visual-effect-switch-grid" aria-label="Individual visual effects">
        {visualEffectDefinitions.map((effect) => {
          const active = preferences.effects[effect.id];
          return (
            <button
              key={effect.id}
              type="button"
              role="switch"
              aria-checked={active}
              disabled={!preferences.enabled}
              className={active ? "is-selected" : ""}
              onClick={() => setVisualEffectEnabled(effect.id, !active)}
            >
              <span><strong>{effect.label}</strong><small>{effect.detail}</small></span>
              <code>{active ? "ON" : "OFF"}</code>
            </button>
          );
        })}
      </div>

      <div className="visual-effects-cadence">
        <header>
          <span><strong>FX CADENCE</strong><small>APPLIES ONLY TO ANIMATED GRAIN</small></span>
          <code>{preferences.cadence.toUpperCase()}</code>
        </header>
        <div className="interface-option-grid" role="radiogroup" aria-label="Visual effects cadence">
          {cadenceOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={option.id === preferences.cadence}
              className={option.id === preferences.cadence ? "is-selected" : ""}
              disabled={!preferences.enabled || !preferences.effects.grain}
              onClick={() => setVisualEffectsCadence(option.id)}
            >
              <strong>{option.label}</strong>
              <small>{option.detail}</small>
            </button>
          ))}
        </div>
      </div>

      <p className="visual-effects-safety-note">
        Desktop overlay only. It never filters, captures, or receives input from the functional UI.
        Reduced motion keeps grain static; forced-color mode bypasses the overlay.
        <span>Effective state: {runtimeStatusDetail}</span>
      </p>
    </div>
  );
}
