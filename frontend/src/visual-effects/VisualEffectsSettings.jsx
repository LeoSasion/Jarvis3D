import { useSyncExternalStore } from "react";
import { useLanguage } from "../i18n/language-system.js";
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
  Object.freeze({ id: "economy" }),
  Object.freeze({ id: "balanced" }),
]);

const runtimeReasonKeys = Object.freeze({
  disabled: "visualEffects.runtime.disabled",
  "forced-colors": "visualEffects.runtime.forcedColors",
  hidden: "visualEffects.runtime.hidden",
  "module-load": "visualEffects.runtime.moduleLoad",
  "no-active-effects": "visualEffects.runtime.noActiveEffects",
  "recovery-override": "visualEffects.runtime.recoveryOverride",
  "runtime-fault": "visualEffects.runtime.fault",
  "surface-policy": "visualEffects.runtime.surfacePolicy",
});

function getRuntimeStatusCode(preferences, runtime, t) {
  if (!preferences.enabled) return t("visualEffects.status.off");
  if (runtime.status === "active") {
    return t(runtime.layerCount === 1
      ? "visualEffects.status.active.one"
      : "visualEffects.status.active.other", { count: runtime.layerCount });
  }
  if (runtime.status === "unavailable") return t("visualEffects.status.unavailable");
  if (runtime.status === "bypassed") return t("visualEffects.status.bypassed");
  return t("visualEffects.status.starting");
}

function getRuntimeStatusDetail(preferences, runtime, t) {
  if (!preferences.enabled) return t("visualEffects.runtime.disabled");
  if (runtime.status === "active") {
    return t(runtime.layerCount === 1
      ? "visualEffects.runtime.active.one"
      : "visualEffects.runtime.active.other", { count: runtime.layerCount });
  }
  const reasonKey = runtimeReasonKeys[runtime.reason];
  return reasonKey
    ? t(reasonKey)
    : t("visualEffects.runtime.inactiveFallback");
}

export function VisualEffectsSettings({ onToast }) {
  const { t } = useLanguage();
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
  const runtimeStatusCode = getRuntimeStatusCode(preferences, runtime, t);
  const runtimeStatusDetail = getRuntimeStatusDetail(preferences, runtime, t);

  const toggleMaster = () => {
    const next = setVisualEffectsEnabled(!preferences.enabled);
    onToast?.(t(next.enabled
      ? "visualEffects.toast.enabled"
      : "visualEffects.toast.disabled"));
  };

  return (
    <div className="visual-effects-settings interface-option-group">
      <header>
        <span>
          <strong>{t("visualEffects.title")}</strong>
          <small>{t("visualEffects.subtitle")}</small>
        </span>
        <code aria-live="polite">{runtimeStatusCode}</code>
      </header>

      <div className="visual-effects-master-row">
        <span>
          <strong>{t("visualEffects.master.title")}</strong>
          <small>{t("visualEffects.master.detail")}</small>
        </span>
        <button
          type="button"
          className={`runtime-switch ${preferences.enabled ? "is-on" : ""}`}
          role="switch"
          aria-checked={preferences.enabled}
          onClick={toggleMaster}
        >
          <span />
          <strong>{preferences.enabled ? t("common.state.on") : t("common.state.off")}</strong>
        </button>
      </div>

      <div
        className="interface-option-grid visual-effects-preset-grid"
        role="radiogroup"
        aria-label={t("visualEffects.preset.aria")}
      >
        {visualEffectsPresets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={preset.id === presetId}
            className={preset.id === presetId ? "is-selected" : ""}
            onClick={() => {
              setVisualEffectsPreset(preset.id);
              onToast?.(t("visualEffects.toast.preset", {
                preset: t(preset.labelKey),
              }));
            }}
          >
            <strong>{t(preset.labelKey)}</strong>
            <small>{t(preset.detailKey)}</small>
          </button>
        ))}
      </div>

      <div className="visual-effect-switch-grid" aria-label={t("visualEffects.effects.aria")}>
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
              <span>
                <strong>{t(effect.labelKey)}</strong>
                <small>{t(effect.detailKey)}</small>
              </span>
              <code>{active ? t("common.state.on") : t("common.state.off")}</code>
            </button>
          );
        })}
      </div>

      <div className="visual-effects-cadence">
        <header>
          <span>
            <strong>{t("visualEffects.cadence.title")}</strong>
            <small>{t("visualEffects.cadence.detail")}</small>
          </span>
          <code>{preferences.cadence.toUpperCase()}</code>
        </header>
        <div
          className="interface-option-grid"
          role="radiogroup"
          aria-label={t("visualEffects.cadence.aria")}
        >
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
              <strong>{t(`visualEffects.cadence.${option.id}.label`)}</strong>
              <small>{t(`visualEffects.cadence.${option.id}.detail`)}</small>
            </button>
          ))}
        </div>
      </div>

      <p className="visual-effects-safety-note">
        {t("visualEffects.safety.primary")}
        {t("visualEffects.safety.accessibility")}
        <span>{t("visualEffects.safety.effectiveState", { detail: runtimeStatusDetail })}</span>
      </p>
    </div>
  );
}
