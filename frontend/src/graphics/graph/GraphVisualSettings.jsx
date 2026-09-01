import {
  ArrowResetRegular,
  DismissRegular,
  EyeOffRegular,
  EyeRegular,
} from "@fluentui/react-icons";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { useReducedMotion } from "../../hooks/useReducedMotion.js";
import { useLanguage } from "../../i18n/language-system.js";
import {
  getGraphThemePalette,
  getVisualThemeSnapshot,
  getVisualThemeVersionSnapshot,
  subscribeVisualTheme,
} from "../../theme-system.js";
import {
  readGraphicsEnvironment,
  selectGraphicsQualityProfile,
} from "../graphics-runtime-policy.js";
import {
  getGraphicsDiagnosticsSnapshot,
  subscribeGraphicsDiagnostics,
} from "../runtime/graphics-diagnostics-store.js";
import { getGraphLabelContrastReport } from "./graph-theme-palette.js";
import {
  getGraphFxSettingRange,
  getGraphFxSettingValue,
} from "./graph-fx-profile.js";
import {
  getGraphVisualPresetId,
  getGraphVisualSettingsSnapshot,
  graphVisualPresets,
  graphVisualSettingRanges,
  initializeGraphVisualSettings,
  resetGraphVisualSettings,
  resetGraphVisualProfile,
  resolveGraphVisualColors,
  setGraphVisualPreset,
  setGraphVisualProfileSetting,
  setGraphVisualSetting,
  subscribeGraphVisualSettings,
} from "./graph-visual-settings.js";
import "./graph-visual-settings.css";

const bloomOptions = Object.freeze([
  Object.freeze({ id: "auto", labelKey: "graphVisualSettings.option.auto" }),
  Object.freeze({ id: "off", labelKey: "common.state.off" }),
  Object.freeze({ id: "on", labelKey: "common.state.on" }),
]);
const qualityOptions = Object.freeze([
  Object.freeze({ id: "auto", labelKey: "graphVisualSettings.option.auto" }),
  Object.freeze({ id: "low", labelKey: "graphVisualSettings.option.quality.low" }),
  Object.freeze({ id: "balanced", labelKey: "graphVisualSettings.option.quality.balanced" }),
  Object.freeze({ id: "high", labelKey: "graphVisualSettings.option.quality.high" }),
]);
const dimensionOptions = Object.freeze([
  Object.freeze({ id: 2, label: "2D" }),
  Object.freeze({ id: 3, label: "3D" }),
]);
const visibilityOptions = Object.freeze([
  Object.freeze({ id: true, labelKey: "graphVisualSettings.option.show" }),
  Object.freeze({ id: false, labelKey: "common.state.off" }),
]);
const presetDetailKeys = Object.freeze({
  obsidian: "graphVisualSettings.preset.obsidian.detail",
  nebula: "graphVisualSettings.preset.nebula.detail",
  blueprint: "graphVisualSettings.preset.blueprint.detail",
  minimal: "graphVisualSettings.preset.minimal.detail",
  performance: "graphVisualSettings.preset.performance.detail",
});
function useMobileSettingsDrawer() {
  const [mobile, setMobile] = useState(
    () => typeof matchMedia !== "undefined" && matchMedia("(max-width: 640px)").matches,
  );
  useEffect(() => {
    if (typeof matchMedia === "undefined") return undefined;
    const query = matchMedia("(max-width: 640px)");
    const update = () => setMobile(query.matches);
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return mobile;
}

function formatValue(value, format) {
  if (format === "percent") return `${Math.round(value * 100)}%`;
  if (format === "count") return String(Math.round(value));
  if (format === "pixels") return `${Math.round(value)} PX`;
  if (format === "strength") return `${Number(value).toFixed(2)}×`;
  return Number(value).toFixed(2);
}

function technicalLabel(t, label) {
  return t("graphVisualSettings.control.technicalLabel", { label });
}

function RangeControl({
  section,
  setting,
  label,
  detail,
  value,
  format,
  disabled = false,
  onValueChange,
  range: providedRange,
}) {
  const range = providedRange ?? graphVisualSettingRanges[section][setting];
  const inputId = useId();
  const detailId = `${inputId}-detail`;
  const outputId = `${inputId}-output`;
  const formattedValue = formatValue(value, format);
  return (
    <div className={`graph-visual-settings__range ${disabled ? "is-disabled" : ""}`}>
      <span>
        <label htmlFor={inputId}><strong>{label}</strong></label>
        <small id={detailId}>{detail}</small>
      </span>
      <output id={outputId} htmlFor={inputId} aria-hidden="true">{formattedValue}</output>
      <input
        id={inputId}
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        aria-describedby={detailId}
        aria-valuetext={formattedValue}
        disabled={disabled}
        onChange={(event) => {
          const nextValue = Number(event.currentTarget.value);
          if (onValueChange) onValueChange(nextValue);
          else setGraphVisualSetting(section, setting, nextValue);
        }}
      />
    </div>
  );
}

function GraphFxRangeControl({
  profileId,
  profile,
  path,
  label,
  detail,
  format,
  disabled = false,
}) {
  return (
    <RangeControl
      label={label}
      detail={detail}
      disabled={disabled}
      format={format}
      range={getGraphFxSettingRange(profileId, path)}
      value={getGraphFxSettingValue(profile, path)}
      onValueChange={(value) => setGraphVisualProfileSetting(profileId, path, value)}
    />
  );
}

function ColorControl({
  section,
  setting,
  label,
  value,
  effectiveValue,
  themeDriven,
  t,
}) {
  const displayedValue = effectiveValue ?? value;
  return (
    <label className="graph-visual-settings__color">
      <span>
        <strong>{label}</strong>
        <small>
          {themeDriven
            ? t("graphVisualSettings.palette.themeToken")
            : t("graphVisualSettings.palette.customToken")}
        </small>
      </span>
      <code>{displayedValue}</code>
      <input
        type="color"
        value={displayedValue}
        onChange={(event) => setGraphVisualSetting(section, setting, event.currentTarget.value)}
      />
    </label>
  );
}

function getRadioTabIndex(value, options, index) {
  const selectedIndex = options.findIndex((option) => option.id === value);
  return index === (selectedIndex < 0 ? 0 : selectedIndex) ? 0 : -1;
}

function handleRadioNavigation(event, options, currentIndex, onChange) {
  let nextIndex = -1;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    nextIndex = (currentIndex + 1) % options.length;
  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    nextIndex = (currentIndex - 1 + options.length) % options.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = options.length - 1;
  }
  if (nextIndex < 0) return;
  event.preventDefault();
  const buttons = event.currentTarget.parentElement?.querySelectorAll('[role="radio"]');
  buttons?.[nextIndex]?.focus();
  onChange(options[nextIndex].id);
}

function ChoiceGroup({ label, value, options, onChange, t }) {
  return (
    <fieldset className="graph-visual-settings__choices">
      <legend>{label}</legend>
      <div role="radiogroup" aria-label={label}>
        {options.map((option, index) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={value === option.id}
            tabIndex={getRadioTabIndex(value, options, index)}
            className={value === option.id ? "is-selected" : ""}
            onClick={() => onChange(option.id)}
            onKeyDown={(event) => handleRadioNavigation(event, options, index, onChange)}
          >
            {option.labelKey ? t(option.labelKey) : option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function SettingsGroup({ title, meta, children, open = false }) {
  return (
    <details className="graph-visual-settings__group" open={open}>
      <summary><strong>{title}</strong><code>{meta}</code></summary>
      <div>{children}</div>
    </details>
  );
}

function FxCategory({ title, meta, children, open = false }) {
  return (
    <details className="graph-visual-settings__fx-category" open={open}>
      <summary><strong>{title}</strong><code>{meta}</code></summary>
      <div>{children}</div>
    </details>
  );
}

function FxLayerToggle({ profileId, path, label, enabled, t }) {
  const stateLabel = t(enabled ? "common.state.on" : "common.state.off");
  return (
    <button
      type="button"
      aria-label={t("graphVisualSettings.layer.toggleAria", {
        label,
        state: stateLabel,
      })}
      aria-pressed={enabled}
      className={enabled ? "is-enabled" : ""}
      onClick={() => setGraphVisualProfileSetting(profileId, path, !enabled)}
    >
      <strong>{label}</strong>
      <span>
        {enabled ? <EyeRegular /> : <EyeOffRegular />}
        <code>{stateLabel}</code>
      </span>
    </button>
  );
}

export function GraphVisualSettings({
  embedded = false,
  onClose,
  onToast,
  returnFocusRef,
}) {
  const { t } = useLanguage();
  const panelRef = useRef(null);
  const closeButtonRef = useRef(null);
  const settings = useSyncExternalStore(
    subscribeGraphVisualSettings,
    getGraphVisualSettingsSnapshot,
    getGraphVisualSettingsSnapshot,
  );
  const themeVersion = useSyncExternalStore(
    subscribeVisualTheme,
    getVisualThemeVersionSnapshot,
    getVisualThemeVersionSnapshot,
  );
  const themeId = getVisualThemeSnapshot();
  const runtimeDiagnostics = useSyncExternalStore(
    subscribeGraphicsDiagnostics,
    getGraphicsDiagnosticsSnapshot,
    getGraphicsDiagnosticsSnapshot,
  );
  const reducedMotion = useReducedMotion();
  const mobileDrawer = useMobileSettingsDrawer();
  const presetId = getGraphVisualPresetId(settings);
  const profile3d = settings.profiles["3d"];
  const environment = useMemo(
    () => readGraphicsEnvironment(reducedMotion),
    [reducedMotion],
  );
  const quality = useMemo(() => selectGraphicsQualityProfile(
    environment,
    settings.performance.quality,
  ), [environment, settings.performance.quality]);
  const themePalette = useMemo(() => getGraphThemePalette(), [themeVersion]);
  const resolvedColors = useMemo(
    () => resolveGraphVisualColors(settings, themePalette),
    [settings, themePalette],
  );
  const labelContrast = useMemo(
    () => getGraphLabelContrastReport(resolvedColors, {
      background: themePalette.background,
      opacity: settings.labels.opacity,
      includeActive: true,
    }),
    [resolvedColors, settings.labels.opacity, themePalette.background],
  );
  const bloomRequested = settings.scene.bloom === "on"
    || (settings.scene.bloom === "auto" && quality.bloom);
  const effectiveBloom = bloomRequested
    && quality.bloom
    && !environment.reducedMotion
    && !environment.forcedColors;
  const runtimeConstraints = useMemo(() => {
    if (environment.forcedColors) return ["FORCED COLORS → DOM FALLBACK"];
    const constraints = [];
    if (settings.labels.count > quality.labelBudget) {
      constraints.push(`LABELS ${settings.labels.count}→${quality.labelBudget}`);
    }
    if (settings.scene.stars > quality.starBudget) {
      constraints.push(`STARS ${settings.scene.stars}→${quality.starBudget}`);
    }
    if (bloomRequested && !effectiveBloom) constraints.push("BLOOM→OFF");
    return constraints;
  }, [
    bloomRequested,
    effectiveBloom,
    environment.forcedColors,
    quality.labelBudget,
    quality.starBudget,
    settings.labels.count,
    settings.scene.stars,
  ]);

  useEffect(() => {
    initializeGraphVisualSettings();
  }, []);

  useEffect(() => {
    if (embedded) return undefined;
    const activeElement = typeof document === "undefined" ? null : document.activeElement;
    const fallbackReturnTarget = typeof HTMLElement !== "undefined"
      && activeElement instanceof HTMLElement
      ? activeElement
      : null;
    const focusTarget = closeButtonRef.current ?? panelRef.current;
    focusTarget?.focus({ preventScroll: true });

    return () => {
      const returnTarget = returnFocusRef?.current ?? fallbackReturnTarget;
      if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
    };
  }, [embedded, mobileDrawer, returnFocusRef]);

  useEffect(() => {
    if (!onClose) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (!mobileDrawer || event.key !== "Tab") return;
      const focusable = [...(panelRef.current?.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
      ) ?? [])];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileDrawer, onClose]);

  const choosePreset = (preset) => {
    setGraphVisualPreset(preset.id);
    onToast?.(t("graphVisualSettings.toast.presetSelected", {
      profile: preset.label,
    }));
  };

  const reset = () => {
    resetGraphVisualSettings();
    onToast?.(t("graphVisualSettings.toast.resetNebula"));
  };

  const resetProfile3d = () => {
    resetGraphVisualProfile("3d");
    onToast?.(t("graphVisualSettings.toast.reset3dProfile"));
  };

  const panel = (
    <section
      ref={panelRef}
      id={embedded ? "graph-visual-settings-embedded" : "graph-visual-settings-panel"}
      className={`graph-visual-settings ${embedded ? "is-embedded" : "is-overlay"}`}
      role={embedded ? undefined : "dialog"}
      aria-modal={!embedded && mobileDrawer ? "true" : undefined}
      aria-labelledby={embedded ? "graph-visual-settings-title-embedded" : "graph-visual-settings-title"}
      tabIndex={embedded || onClose ? undefined : -1}
    >
      <header className="graph-visual-settings__header">
        <span>
          <small>{t("graphVisualSettings.header.runtimeSummary")}</small>
          <strong id={embedded ? "graph-visual-settings-title-embedded" : "graph-visual-settings-title"}>
            {t("graphVisualSettings.title")}
          </strong>
        </span>
        <code>{presetId.toUpperCase()} · {quality.id.toUpperCase()}</code>
        {onClose ? (
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={t("graphVisualSettings.action.closeAria")}
          >
            <DismissRegular />
          </button>
        ) : null}
      </header>

      <div
        className="graph-visual-settings__presets"
        role="radiogroup"
        aria-label={t("graphVisualSettings.preset.aria")}
      >
        {graphVisualPresets.map((preset, index) => (
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={preset.id === presetId}
            tabIndex={getRadioTabIndex(presetId, graphVisualPresets, index)}
            className={preset.id === presetId ? "is-selected" : ""}
            onClick={() => choosePreset(preset)}
            onKeyDown={(event) => handleRadioNavigation(
              event,
              graphVisualPresets,
              index,
              (id) => choosePreset(graphVisualPresets.find((candidate) => candidate.id === id)),
            )}
          >
            <strong>{preset.label}</strong>
            <small>
              {presetDetailKeys[preset.id]
                ? t(presetDetailKeys[preset.id])
                : preset.detail}
            </small>
          </button>
        ))}
      </div>

      <SettingsGroup
        title={t("graphVisualSettings.section.profile3d")}
        meta={t("graphVisualSettings.profile.layerSummary", {
          count: 10,
          state: t(profile3d.edge.halo.enabled ? "common.state.on" : "common.state.off"),
        })}
        open
      >
        <div className="graph-visual-settings__profile-intro">
          <span>
            <strong>{t("graphVisualSettings.profile.layerStack")}</strong>
            <small>{t("graphVisualSettings.profile.layerStackDetail")}</small>
          </span>
          <button type="button" onClick={resetProfile3d}>
            <ArrowResetRegular />{t("graphVisualSettings.action.reset3d")}
          </button>
        </div>

        <div
          className="graph-visual-settings__layer-grid"
          role="group"
          aria-label={t("graphVisualSettings.profile.layerVisibilityAria")}
        >
          <FxLayerToggle profileId="3d" path="node.core.enabled" label={t("graphVisualSettings.layer.nodeCore")} enabled={profile3d.node.core.enabled} t={t} />
          <FxLayerToggle profileId="3d" path="node.halo.enabled" label={t("graphVisualSettings.layer.nodeHalo")} enabled={profile3d.node.halo.enabled} t={t} />
          <FxLayerToggle profileId="3d" path="node.pulse.enabled" label={t("graphVisualSettings.layer.nodePulse")} enabled={profile3d.node.pulse.enabled} t={t} />
          <FxLayerToggle profileId="3d" path="edge.core.enabled" label={t("graphVisualSettings.layer.relationCore")} enabled={profile3d.edge.core.enabled} t={t} />
          <FxLayerToggle profileId="3d" path="edge.halo.enabled" label={t("graphVisualSettings.layer.relationHalo")} enabled={profile3d.edge.halo.enabled} t={t} />
          <FxLayerToggle profileId="3d" path="signal.enabled" label={t("graphVisualSettings.layer.relationSignals")} enabled={profile3d.signal.enabled} t={t} />
          <FxLayerToggle profileId="3d" path="orb.innerNetwork.enabled" label={t("graphVisualSettings.layer.innerNetwork")} enabled={profile3d.orb.innerNetwork.enabled} t={t} />
          <FxLayerToggle profileId="3d" path="orb.rim.enabled" label={t("graphVisualSettings.layer.orbRim")} enabled={profile3d.orb.rim.enabled} t={t} />
          <FxLayerToggle profileId="3d" path="orb.sparks.enabled" label={t("graphVisualSettings.layer.ambientSparks")} enabled={profile3d.orb.sparks.enabled} t={t} />
          <FxLayerToggle profileId="3d" path="postFx.bloom.enabled" label={t("graphVisualSettings.layer.bloom")} enabled={profile3d.postFx.bloom.enabled} t={t} />
        </div>

        <FxCategory
          title={t("graphVisualSettings.category.nodeFx")}
          meta={t("graphVisualSettings.category.coreHaloSummary", {
            coreState: t(profile3d.node.core.enabled ? "common.state.on" : "common.state.off"),
            haloState: t(profile3d.node.halo.enabled ? "common.state.on" : "common.state.off"),
          })}
        >
          <div className="graph-visual-settings__control-grid">
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="node.master.scale" label={technicalLabel(t, "NODE MASTER SCALE")} detail={t("graphVisualSettings.control.nodeMasterScale.detail")} format="strength" disabled={!profile3d.node.core.enabled && !profile3d.node.halo.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="node.master.opacity" label={technicalLabel(t, "NODE MASTER OPACITY")} detail={t("graphVisualSettings.control.nodeMasterOpacity.detail")} format="percent" disabled={!profile3d.node.core.enabled && !profile3d.node.halo.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="node.size.byImportance" label={technicalLabel(t, "NODE SIZE BY IMPORTANCE")} detail={t("graphVisualSettings.control.nodeSizeByImportance.detail")} format="percent" disabled={!profile3d.node.core.enabled && !profile3d.node.halo.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="node.core.sizeScale" label={technicalLabel(t, "NODE CORE SIZE SCALE")} detail={t("graphVisualSettings.control.nodeCoreSizeScale.detail")} format="strength" disabled={!profile3d.node.core.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="node.core.opacity" label={technicalLabel(t, "NODE CORE OPACITY")} detail={t("graphVisualSettings.control.nodeCoreOpacity.detail")} format="percent" disabled={!profile3d.node.core.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="node.core.emissionIntensity" label={technicalLabel(t, "NODE CORE EMISSION INTENSITY")} detail={t("graphVisualSettings.control.nodeCoreEmission.detail")} format="strength" disabled={!profile3d.node.core.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="node.halo.radiusScale" label={technicalLabel(t, "NODE HALO RADIUS SCALE")} detail={t("graphVisualSettings.control.nodeHaloRadius.detail")} format="strength" disabled={!profile3d.node.halo.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="node.halo.opacity" label={technicalLabel(t, "NODE HALO OPACITY")} detail={t("graphVisualSettings.control.nodeHaloOpacity.detail")} format="percent" disabled={!profile3d.node.halo.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="node.halo.emissionIntensity" label={technicalLabel(t, "NODE HALO EMISSION INTENSITY")} detail={t("graphVisualSettings.control.nodeHaloEmission.detail")} format="strength" disabled={!profile3d.node.halo.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="node.pulse.amount" label={technicalLabel(t, "NODE PULSE AMOUNT")} detail={t("graphVisualSettings.control.nodePulseAmount.detail")} format="strength" disabled={!profile3d.node.pulse.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="node.pulse.rate" label={technicalLabel(t, "NODE PULSE RATE")} detail={t("graphVisualSettings.control.nodePulseRate.detail")} format="strength" disabled={!profile3d.node.pulse.enabled} />
          </div>
        </FxCategory>

        <FxCategory
          title={t("graphVisualSettings.category.relationFx")}
          meta={t("graphVisualSettings.category.coreHaloSummary", {
            coreState: t(profile3d.edge.core.enabled ? "common.state.on" : "common.state.off"),
            haloState: t(profile3d.edge.halo.enabled ? "common.state.on" : "common.state.off"),
          })}
          open
        >
          <div className="graph-visual-settings__control-grid">
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="edge.master.opacity" label={technicalLabel(t, "RELATION MASTER OPACITY")} detail={t("graphVisualSettings.control.relationMasterOpacity.detail")} format="percent" disabled={!profile3d.edge.core.enabled && !profile3d.edge.halo.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="edge.core.widthScale" label={technicalLabel(t, "RELATION CORE WIDTH SCALE")} detail={t("graphVisualSettings.control.relationCoreWidth.detail")} format="strength" disabled={!profile3d.edge.core.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="edge.core.opacity" label={technicalLabel(t, "RELATION CORE OPACITY")} detail={t("graphVisualSettings.control.relationCoreOpacity.detail")} format="percent" disabled={!profile3d.edge.core.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="edge.core.emissionIntensity" label={technicalLabel(t, "RELATION CORE EMISSION INTENSITY")} detail={t("graphVisualSettings.control.relationCoreEmission.detail")} format="strength" disabled={!profile3d.edge.core.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="edge.core.widthByStrength" label={technicalLabel(t, "CORE WIDTH BY STRENGTH")} detail={t("graphVisualSettings.control.coreWidthByStrength.detail")} format="percent" disabled={!profile3d.edge.core.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="edge.core.emissionByStrength" label={technicalLabel(t, "CORE EMISSION BY STRENGTH")} detail={t("graphVisualSettings.control.coreEmissionByStrength.detail")} format="percent" disabled={!profile3d.edge.core.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="edge.halo.radiusScale" label={technicalLabel(t, "RELATION HALO RADIUS SCALE")} detail={t("graphVisualSettings.control.relationHaloRadius.detail")} format="strength" disabled={!profile3d.edge.halo.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="edge.halo.opacity" label={technicalLabel(t, "RELATION HALO OPACITY")} detail={t("graphVisualSettings.control.relationHaloOpacity.detail")} format="percent" disabled={!profile3d.edge.halo.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="edge.halo.emissionIntensity" label={technicalLabel(t, "RELATION HALO EMISSION INTENSITY")} detail={t("graphVisualSettings.control.relationHaloEmission.detail")} format="strength" disabled={!profile3d.edge.halo.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="edge.halo.falloff" label={technicalLabel(t, "RELATION HALO FALLOFF")} detail={t("graphVisualSettings.control.relationHaloFalloff.detail")} format="strength" disabled={!profile3d.edge.halo.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="edge.halo.byStrength" label={technicalLabel(t, "RELATION HALO BY STRENGTH")} detail={t("graphVisualSettings.control.relationHaloByStrength.detail")} format="percent" disabled={!profile3d.edge.halo.enabled} />
          </div>
        </FxCategory>

        <FxCategory
          title={t("graphVisualSettings.category.signals")}
          meta={t("graphVisualSettings.category.signalsSummary", {
            count: profile3d.signal.count,
            speed: `${profile3d.signal.speed.toFixed(2)}×`,
          })}
        >
          <div className="graph-visual-settings__control-grid">
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="signal.count" label={technicalLabel(t, "SIGNAL COUNT")} detail={t("graphVisualSettings.control.signalCount.detail")} format="count" disabled={!profile3d.signal.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="signal.speed" label={technicalLabel(t, "SIGNAL SPEED")} detail={t("graphVisualSettings.control.signalSpeed.detail")} format="strength" disabled={!profile3d.signal.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="signal.sizeScale" label={technicalLabel(t, "SIGNAL SIZE SCALE")} detail={t("graphVisualSettings.control.signalSize.detail")} format="strength" disabled={!profile3d.signal.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="signal.opacity" label={technicalLabel(t, "SIGNAL OPACITY")} detail={t("graphVisualSettings.control.signalOpacity.detail")} format="percent" disabled={!profile3d.signal.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="signal.emissionIntensity" label={technicalLabel(t, "SIGNAL EMISSION INTENSITY")} detail={t("graphVisualSettings.control.signalEmission.detail")} format="strength" disabled={!profile3d.signal.enabled} />
          </div>
        </FxCategory>

        <FxCategory
          title={t("graphVisualSettings.category.orb")}
          meta={t("graphVisualSettings.category.orbSummary")}
        >
          <div className="graph-visual-settings__control-grid">
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="orb.innerNetwork.scale" label={technicalLabel(t, "INNER NETWORK SCALE")} detail={t("graphVisualSettings.control.innerNetworkScale.detail")} format="strength" disabled={!profile3d.orb.innerNetwork.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="orb.innerNetwork.opacity" label={technicalLabel(t, "INNER NETWORK OPACITY")} detail={t("graphVisualSettings.control.innerNetworkOpacity.detail")} format="percent" disabled={!profile3d.orb.innerNetwork.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="orb.innerNetwork.rotationSpeed" label={technicalLabel(t, "INNER COUNTER-ROTATION SPEED")} detail={t("graphVisualSettings.control.innerRotationSpeed.detail")} format="strength" disabled={!profile3d.orb.innerNetwork.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="orb.rim.intensity" label={technicalLabel(t, "ORB RIM INTENSITY")} detail={t("graphVisualSettings.control.orbRimIntensity.detail")} format="strength" disabled={!profile3d.orb.rim.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="orb.rim.fresnelPower" label={technicalLabel(t, "FRESNEL POWER")} detail={t("graphVisualSettings.control.fresnelPower.detail")} format="strength" disabled={!profile3d.orb.rim.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="orb.sparks.sizeScale" label={technicalLabel(t, "AMBIENT SPARK SIZE SCALE")} detail={t("graphVisualSettings.control.ambientSparkSize.detail")} format="strength" disabled={!profile3d.orb.sparks.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="orb.sparks.opacity" label={technicalLabel(t, "AMBIENT SPARK OPACITY")} detail={t("graphVisualSettings.control.ambientSparkOpacity.detail")} format="percent" disabled={!profile3d.orb.sparks.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="orb.sparks.emissionIntensity" label={technicalLabel(t, "AMBIENT SPARK EMISSION INTENSITY")} detail={t("graphVisualSettings.control.ambientSparkEmission.detail")} format="strength" disabled={!profile3d.orb.sparks.enabled} />
          </div>
        </FxCategory>

        <FxCategory
          title={t("graphVisualSettings.category.motion")}
          meta={t("graphVisualSettings.category.motionSummary")}
        >
          <div className="graph-visual-settings__control-grid">
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="motion.idleRotationSpeed" label={technicalLabel(t, "IDLE ROTATION SPEED")} detail={t("graphVisualSettings.control.idleRotationSpeed.detail")} format="strength" />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="motion.breathingAmount" label={technicalLabel(t, "BREATHING AMOUNT")} detail={t("graphVisualSettings.control.breathingAmount.detail")} format="strength" />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="motion.breathingRate" label={technicalLabel(t, "BREATHING RATE")} detail={t("graphVisualSettings.control.breathingRate.detail")} format="strength" />
          </div>
        </FxCategory>

        <FxCategory
          title={t("graphVisualSettings.category.postFx")}
          meta={t("graphVisualSettings.category.bloomSummary", {
            state: t(profile3d.postFx.bloom.enabled ? "common.state.on" : "common.state.off"),
          })}
        >
          <div className="graph-visual-settings__control-grid">
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="postFx.bloom.intensity" label={technicalLabel(t, "BLOOM INTENSITY")} detail={t("graphVisualSettings.control.bloomIntensity.detail")} disabled={!profile3d.postFx.bloom.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="postFx.bloom.threshold" label={technicalLabel(t, "BLOOM THRESHOLD")} detail={t("graphVisualSettings.control.bloomThreshold.detail")} disabled={!profile3d.postFx.bloom.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="postFx.bloom.softKnee" label={technicalLabel(t, "BLOOM SOFT KNEE")} detail={t("graphVisualSettings.control.bloomSoftKnee.detail")} disabled={!profile3d.postFx.bloom.enabled} />
            <GraphFxRangeControl profileId="3d" profile={profile3d} path="postFx.bloom.radius" label={technicalLabel(t, "BLOOM RADIUS")} detail={t("graphVisualSettings.control.bloomRadius.detail")} disabled={!profile3d.postFx.bloom.enabled} />
          </div>
        </FxCategory>
      </SettingsGroup>

      <SettingsGroup
        title={t("graphVisualSettings.section.view")}
        meta={t("graphVisualSettings.section.viewSummary", {
          visibility: t(settings.view.enabled
            ? "graphVisualSettings.option.show"
            : "common.state.off"),
          dimension: `${settings.view.dimension}D`,
        })}
      >
        <ChoiceGroup
          label={t("graphVisualSettings.choice.graphDisplay")}
          value={settings.view.enabled}
          options={visibilityOptions}
          onChange={(value) => setGraphVisualSetting("view", "enabled", value)}
          t={t}
        />
        <ChoiceGroup
          label={t("graphVisualSettings.choice.graphDimension")}
          value={settings.view.dimension}
          options={dimensionOptions}
          onChange={(value) => setGraphVisualSetting("view", "dimension", value)}
          t={t}
        />
        <p className="graph-visual-settings__view-help">
          {t("graphVisualSettings.section.viewHelp")}
        </p>
      </SettingsGroup>

      <SettingsGroup
        title={t("graphVisualSettings.section.nodes")}
        meta={t("graphVisualSettings.section.nodesSummary", {
          count: settings.node.maxCount,
          scale: `${settings.node.scale.toFixed(2)}×`,
          opacity: `${Math.round(settings.node.opacity * 100)}%`,
        })}
      >
        <div className="graph-visual-settings__control-grid">
          <RangeControl section="node" setting="maxCount" label={technicalLabel(t, "MAXIMUM NODES")} detail={t("graphVisualSettings.control.maximumNodes.detail")} value={settings.node.maxCount} format="count" />
          <RangeControl section="node" setting="scale" label={technicalLabel(t, "NODE SCALE")} detail={t("graphVisualSettings.control.nodeScale.detail")} value={settings.node.scale} format="strength" />
          <RangeControl section="node" setting="hubScale" label={technicalLabel(t, "HUB EMPHASIS")} detail={t("graphVisualSettings.control.hubEmphasis.detail")} value={settings.node.hubScale} format="strength" />
          <RangeControl section="node" setting="opacity" label={technicalLabel(t, "NODE OPACITY")} detail={t("graphVisualSettings.control.nodeOpacity.detail")} value={settings.node.opacity} format="percent" />
        </div>
        <div className="graph-visual-settings__color-grid">
          <ColorControl section="node" setting="baseColor" label={technicalLabel(t, "BASE")} value={settings.node.baseColor} effectiveValue={resolvedColors.baseColor} themeDriven={settings.node.useThemeColors} t={t} />
          <ColorControl section="node" setting="hubColor" label={technicalLabel(t, "HUB")} value={settings.node.hubColor} effectiveValue={resolvedColors.hubColor} themeDriven={settings.node.useThemeColors} t={t} />
          <ColorControl section="node" setting="activeColor" label={technicalLabel(t, "ACTIVE")} value={settings.node.activeColor} effectiveValue={resolvedColors.activeColor} themeDriven={settings.node.useThemeColors} t={t} />
          <ColorControl section="node" setting="groupColor" label={technicalLabel(t, "GROUP")} value={settings.node.groupColor} effectiveValue={resolvedColors.groupColor} themeDriven={settings.node.useThemeColors} t={t} />
        </div>
        {!settings.node.useThemeColors ? (
          <div
            className={`graph-visual-settings__contrast-status ${labelContrast.passes ? "is-pass" : "is-warning"}`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <span>
              <strong>
                {labelContrast.passes
                  ? t("graphVisualSettings.contrast.pass")
                  : t("graphVisualSettings.contrast.warning")}
              </strong>
              <small>
                {t("graphVisualSettings.contrast.metrics", {
                  background: labelContrast.background,
                  opacity: `${Math.round(labelContrast.opacity * 100)}%`,
                  target: `${labelContrast.minimum.toFixed(1)}:1`,
                })}
              </small>
            </span>
            <code>
              {labelContrast.passes
                ? t("graphVisualSettings.contrast.minimum", {
                  ratio: `${labelContrast.minimumRatio.toFixed(1)}:1`,
                })
                : labelContrast.failures
                  .map((entry) => `${entry.label} ${entry.ratio.toFixed(1)}:1`)
                  .join(" · ")}
            </code>
          </div>
        ) : null}
      </SettingsGroup>

      <SettingsGroup
        title={t("graphVisualSettings.section.relations")}
        meta={`${Math.round(settings.edge.opacity * 100)}%`}
      >
        <RangeControl section="edge" setting="opacity" label={technicalLabel(t, "LINE OPACITY")} detail={t("graphVisualSettings.control.lineOpacity.detail")} value={settings.edge.opacity} format="percent" />
        <div className="graph-visual-settings__color-grid is-single">
          <ColorControl section="edge" setting="color" label={technicalLabel(t, "RELATION COLOR")} value={settings.edge.color} effectiveValue={resolvedColors.edgeColor} themeDriven={settings.node.useThemeColors} t={t} />
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={t("graphVisualSettings.section.labels")}
        meta={`${settings.labels.count} · ${settings.labels.fontSize}PX`}
      >
        <div className="graph-visual-settings__control-grid">
          <RangeControl section="labels" setting="count" label={technicalLabel(t, "LABEL COUNT")} detail={t("graphVisualSettings.control.labelCount.detail", { count: quality.labelBudget })} value={settings.labels.count} format="count" />
          <RangeControl section="labels" setting="fontSize" label={technicalLabel(t, "FONT SIZE")} detail={t("graphVisualSettings.control.fontSize.detail")} value={settings.labels.fontSize} format="pixels" />
          <RangeControl section="labels" setting="opacity" label={technicalLabel(t, "LABEL OPACITY")} detail={t("graphVisualSettings.control.labelOpacity.detail")} value={settings.labels.opacity} format="percent" />
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={t("graphVisualSettings.section.layoutForces")}
        meta={t("graphVisualSettings.section.layoutSummary")}
      >
        <div className="graph-visual-settings__control-grid">
          <RangeControl section="layout" setting="repulsion" label={technicalLabel(t, "REPULSION STRENGTH")} detail={t("graphVisualSettings.control.repulsion.detail")} value={settings.layout.repulsion} format="strength" />
          <RangeControl section="layout" setting="linkDistance" label={technicalLabel(t, "PREFERRED RELATION LENGTH")} detail={t("graphVisualSettings.control.relationLength.detail")} value={settings.layout.linkDistance} format="strength" />
          <RangeControl section="layout" setting="linkStrength" label={technicalLabel(t, "RELATION CONSTRAINT STRENGTH")} detail={t("graphVisualSettings.control.relationConstraint.detail")} value={settings.layout.linkStrength} format="strength" />
          <RangeControl section="layout" setting="collision" label={technicalLabel(t, "COLLISION RADIUS")} detail={t("graphVisualSettings.control.collisionRadius.detail")} value={settings.layout.collision} format="strength" />
          <RangeControl section="layout" setting="center" label={technicalLabel(t, "CENTERING FORCE")} detail={t("graphVisualSettings.control.centeringForce.detail")} value={settings.layout.center} />
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={t("graphVisualSettings.section.scenePerformance")}
        meta={t("graphVisualSettings.section.sceneSummary", {
          count: settings.scene.stars,
          quality: settings.performance.quality.toUpperCase(),
        })}
      >
        <div className="graph-visual-settings__control-grid">
          <RangeControl section="scene" setting="stars" label={technicalLabel(t, "STAR FIELD")} detail={t("graphVisualSettings.control.starField.detail", { count: quality.starBudget })} value={settings.scene.stars} format="count" />
          <RangeControl section="scene" setting="bloomIntensity" label={technicalLabel(t, "BLOOM INTENSITY")} detail={t("graphVisualSettings.control.sceneBloomIntensity.detail")} value={settings.scene.bloomIntensity} />
        </div>
        <ChoiceGroup
          label={t("graphVisualSettings.choice.bloom")}
          value={settings.scene.bloom}
          options={bloomOptions}
          onChange={(value) => setGraphVisualSetting("scene", "bloom", value)}
          t={t}
        />
        <ChoiceGroup
          label={t("graphVisualSettings.choice.quality")}
          value={settings.performance.quality}
          options={qualityOptions}
          onChange={(value) => setGraphVisualSetting("performance", "quality", value)}
          t={t}
        />
      </SettingsGroup>

      <footer className="graph-visual-settings__footer">
        <p>
          {settings.node.useThemeColors
            ? t("graphVisualSettings.footer.themePalette", {
              theme: themeId.toUpperCase(),
            })
            : t("graphVisualSettings.footer.customPalette")}
          {" "}
          {t("graphVisualSettings.footer.quality", {
            requested: settings.performance.quality.toUpperCase(),
            effective: quality.id.toUpperCase(),
          })}
          {" "}
          {t("graphVisualSettings.footer.bloom", {
            requested: settings.scene.bloom.toUpperCase(),
            effective: t(effectiveBloom ? "common.state.on" : "common.state.off"),
          })}
          {" "}
          {t("graphVisualSettings.footer.runtime", {
            renderer: runtimeDiagnostics.rendererStatus.toUpperCase(),
            dpr: runtimeDiagnostics.effectiveDpr.toFixed(2),
            tier: runtimeDiagnostics.adaptiveTier,
          })}
          {" "}
          {runtimeConstraints.length > 0
            ? t("graphVisualSettings.footer.activeConstraints", {
              constraints: runtimeConstraints.join(" · "),
            })
            : t("graphVisualSettings.footer.noConstraints")}
        </p>
        <button type="button" onClick={reset}>
          <ArrowResetRegular />{t("graphVisualSettings.action.resetNebula")}
        </button>
      </footer>
    </section>
  );

  if (!embedded && mobileDrawer && typeof document !== "undefined") {
    return createPortal(panel, document.body);
  }

  return panel;
}
