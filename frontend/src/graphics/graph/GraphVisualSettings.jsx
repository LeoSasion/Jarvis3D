import {
  ArrowResetRegular,
  DismissRegular,
  EyeOffRegular,
  EyeRegular,
} from "@fluentui/react-icons";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { getGraphVisualProfileLibrarySnapshot, saveGraphVisualProfile } from "../../graph/graph-visual-profile-library.js";
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
import { normalizeGraphRangeInput } from "./graph-settings-input.js";
import {
  getGraphFxSettingRange,
  getGraphFxSettingValue,
} from "./graph-fx-profile.js";
import {
  getGraphVisualPresetId,
  getGraphVisualSettingsSnapshot,
  getGraphVisualSettingsPersistenceState,
  retryGraphVisualSettingsPersistence,
  graphVisualPresets,
  graphVisualSettingRanges,
  initializeGraphVisualSettings,
  resetActiveGraphVisualSettings,
  resetGraphVisualSettings,
  resetGraphVisualProfile,
  resolveGraphVisualColors,
  setGraphVisualPreset,
  setGraphVisualProfileSetting,
  setGraphVisualSetting,
  setGraphSharedNeuronStyle,
  subscribeGraphVisualSettings,
} from "./graph-visual-settings.js";
import "./graph-visual-settings.css";

const SettingsCategoryContext = createContext("nodes");
const settingsCategories = ["nodes", "edges", "glow", "layout", "scene", "presets"];

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
  neuron3d: "graphVisualSettings.preset.neuron3d.detail",
  neuron: "graphVisualSettings.preset.neuron.detail",
  neural: "graphVisualSettings.preset.neural.detail",
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
  if (format === "seconds") return `${Number(Number(value).toFixed(2))} s`;
  return Number(value).toFixed(2);
}

function technicalLabel(t, label) {
  return t(`graphVisualSettings.label.${label.toLowerCase().replaceAll(" ", "_")}`);
}

function RangeValue({ value, range, format, label, disabled, onCommit }) {
  const { t } = useLanguage();
  const multiplier = format === "percent" ? 100 : 1;
  const displayValue = Number((value * multiplier).toFixed(4));
  const [draft, setDraft] = useState(String(displayValue));
  return (
    <div className="graph-visual-settings__value">
      <input
        type="number"
        aria-label={t("graphVisualSettings.editor.precise", { label })}
        value={draft}
        min={range.min * multiplier}
        max={range.max * multiplier}
        step={Number((range.step * multiplier).toFixed(8))}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const next = normalizeGraphRangeInput(draft, range, format, value);
          setDraft(String(Number((next * multiplier).toFixed(4))));
          if (next !== value) onCommit(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.stopPropagation();
            setDraft(String(displayValue));
          }
        }}
      />
      <span aria-hidden="true">{format === "percent" ? "%" : format === "strength" ? "×" : format === "pixels" ? "px" : format === "seconds" ? "s" : ""}</span>
    </div>
  );
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
  const commit = (nextValue) => {
    if (onValueChange) onValueChange(nextValue);
    else setGraphVisualSetting(section, setting, nextValue);
  };
  return (
    <div className={`graph-visual-settings__range ${disabled ? "is-disabled" : ""}`}>
      <span>
        <label htmlFor={inputId}><strong>{label}</strong></label>
        <small id={detailId}>{detail}</small>
      </span>
      <output id={outputId} htmlFor={inputId} aria-hidden="true" className="sr-only">{formattedValue}</output>
      <RangeValue key={value} value={value} range={range} format={format} label={label} disabled={disabled} onCommit={commit} />
      <input
        id={inputId}
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        style={{ "--range-progress": `${(value - range.min) / (range.max - range.min) * 100}%` }}
        aria-describedby={detailId}
        aria-valuetext={formattedValue}
        disabled={disabled}
        onChange={(event) => {
          commit(Number(event.currentTarget.value));
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

function SettingsGroup({ category, title, meta, children, open = false }) {
  const activeCategory = useContext(SettingsCategoryContext);
  if (category && category !== activeCategory) return null;
  return (
    <details className="graph-visual-settings__group" open={open}>
      <summary><strong>{title}</strong><code>{meta}</code></summary>
      <div>{children}</div>
    </details>
  );
}

function FxCategory({ category, title, meta, children, open = true }) {
  const activeCategory = useContext(SettingsCategoryContext);
  if (category !== activeCategory) return null;
  return (
    <details className="graph-visual-settings__fx-category" open={open}>
      <summary><strong>{title}</strong><code>{meta}</code></summary>
      <div>{children}</div>
    </details>
  );
}

function FxLayerToggle({ profileId, path, label, enabled, t }) {
  const activeCategory = useContext(SettingsCategoryContext);
  const category = path.startsWith("node.") ? "nodes"
    : path.startsWith("edge.") || path.startsWith("orb.signals.") ? "edges"
      : path.startsWith("postFx.") ? "glow"
        : path.startsWith("orb.") ? "layout" : "scene";
  if (category !== activeCategory) return null;
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
  const contentRef = useRef(null);
  const categoryId = useId();
  const [category, setCategory] = useState("nodes");
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
  const profileId = `${settings.view.dimension}d`;
  const activeProfile = settings.profiles[profileId];
  // An idle sphere must not hide controls used by the independent Explore view.
  const neuronMaterials = settings.layout.mode === "neuron";
  const idleSphere = settings.idleShape === "neuronSphere" && settings.view.dimension === 3;
  const routeSignalsAvailable = neuronMaterials || idleSphere;
  const visiblePresets = graphVisualPresets.filter((preset) => !preset.dimensions || preset.dimensions.includes(settings.view.dimension));
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
  const bloomRequested = activeProfile.postFx.bloom.enabled;
  const effectiveBloom = bloomRequested
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
    const panel = panelRef.current;
    const focusTarget = closeButtonRef.current ?? panel;
    focusTarget?.focus({ preventScroll: true });

    return () => {
      // Switching to another tool keeps focus on the newly chosen control.
      const focusedElement = typeof document === "undefined" ? null : document.activeElement;
      if (focusedElement && focusedElement !== document.body && !panel?.contains(focusedElement)) return;
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
      ) ?? [])].filter((element) => element.tabIndex >= 0
        && element.getClientRects().length > 0
        && (element.checkVisibility?.() ?? true));
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
    if (["neural", "neuron", "neuron3d"].includes(preset.id) && presetId !== preset.id) {
      const backupLabel = t(`graphVisualSettings.preset.${preset.id}.backup`);
      if (!getGraphVisualProfileLibrarySnapshot().profiles.some((profile) => profile.label === backupLabel)) {
        saveGraphVisualProfile(backupLabel, settings);
      }
    }
    setGraphVisualPreset(preset.id);
    onToast?.(t("graphVisualSettings.toast.presetSelected", {
      profile: preset.labelKey ? t(preset.labelKey) : preset.label,
    }));
  };

  const changeStyleLink = (enabled) => {
    if (enabled && !settings.sharedStyle) {
      const label = t("graphVisualSettings.shared.backup");
      if (!getGraphVisualProfileLibrarySnapshot().profiles.some((profile) => profile.label === label)) saveGraphVisualProfile(label, settings);
    }
    setGraphSharedNeuronStyle(enabled);
  };

  const reset = () => {
    resetActiveGraphVisualSettings();
    onToast?.(t("graphVisualSettings.scope.reset", { dimension: settings.view.dimension }));
  };

  const resetActiveProfile = () => {
    resetGraphVisualProfile(profileId);
    onToast?.(t(settings.sharedStyle ? "graphVisualSettings.shared.reset" : "graphVisualSettings.scope.reset", { dimension: settings.view.dimension }));
  };

  const applyDefaultStyle = () => {
    saveGraphVisualProfile(t("graphVisualSettings.defaults.backup"), settings);
    if (getGraphVisualProfileLibrarySnapshot().error) {
      onToast?.(t("graphVisualSettings.defaults.backupFailed"));
      return;
    }
    resetGraphVisualSettings();
    onToast?.(t("graphVisualSettings.defaults.applied"));
  };

  const chooseCategory = (nextCategory) => {
    setCategory(nextCategory);
    contentRef.current?.scrollTo({ top: 0 });
  };

  const panel = (
    <SettingsCategoryContext.Provider value={category}>
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
          <strong id={embedded ? "graph-visual-settings-title-embedded" : "graph-visual-settings-title"}>
            {t("graphVisualSettings.title")}
          </strong>
        </span>
        <button type="button" className="graph-visual-settings__preset-link" onClick={() => chooseCategory("presets")}>
          {presetId === "custom" ? t("graphVisualSettings.editor.custom") : presetId.toUpperCase()}
        </button>
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

      <div className="graph-visual-settings__mode">
        <ChoiceGroup
          label={t("graphVisualSettings.scope.title")}
          value={settings.view.dimension}
          options={dimensionOptions}
          onChange={(value) => setGraphVisualSetting("view", "dimension", value)}
          t={t}
        />
        <span className="graph-visual-settings__scope" title={t(settings.sharedStyle ? "graphVisualSettings.shared.detail" : "graphVisualSettings.scope.detail", { dimension: settings.view.dimension })}>
          {t(settings.sharedStyle ? "graphVisualSettings.editor.shared" : "graphVisualSettings.editor.independent")}
        </span>
      </div>
      <div className="graph-visual-settings__tabs" role="tablist" aria-label={t("graphVisualSettings.editor.categories")}>
        {settingsCategories.map((id, index) => (
          <button
            key={id}
            id={`${categoryId}-${id}`}
            type="button"
            role="tab"
            aria-selected={category === id}
            aria-controls={`${categoryId}-panel`}
            tabIndex={category === id ? 0 : -1}
            onClick={() => chooseCategory(id)}
            onKeyDown={(event) => {
              let next;
              if (event.key === "ArrowRight") next = (index + 1) % settingsCategories.length;
              else if (event.key === "ArrowLeft") next = (index + settingsCategories.length - 1) % settingsCategories.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = settingsCategories.length - 1;
              else return;
              event.preventDefault();
              event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next]?.focus();
              chooseCategory(settingsCategories[next]);
            }}
          >{t(`graphVisualSettings.editor.tab.${id}`)}</button>
        ))}
      </div>
      <div ref={contentRef} id={`${categoryId}-panel`} className="graph-visual-settings__content" role="tabpanel" aria-labelledby={`${categoryId}-${category}`} tabIndex={0}>
        <p className="graph-visual-settings__category-help">{t(`graphVisualSettings.editor.help.${category}`)}</p>
      {category === "presets" ? <>
      <div className="graph-visual-settings__reset-actions">
        <button type="button" onClick={applyDefaultStyle}><ArrowResetRegular />{t("graphVisualSettings.defaults.apply")}</button>
      </div>
      <p className="graph-visual-settings__view-help">{t("graphVisualSettings.defaults.detail")}</p>
      <div className="graph-visual-settings__sharing">
        <ChoiceGroup
          label={t("graphVisualSettings.shared.title")}
          value={settings.sharedStyle}
          options={[{ id: true, labelKey: "graphVisualSettings.shared.on" }, { id: false, labelKey: "graphVisualSettings.shared.off" }]}
          onChange={changeStyleLink}
          t={t}
        />
      </div>
      <div
        className="graph-visual-settings__presets"
        role="radiogroup"
        aria-label={t("graphVisualSettings.preset.aria")}
      >
        {visiblePresets.map((preset, index) => (
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={preset.id === presetId}
            tabIndex={getRadioTabIndex(presetId, visiblePresets, index)}
            className={preset.id === presetId ? "is-selected" : ""}
            onClick={() => choosePreset(preset)}
            onKeyDown={(event) => handleRadioNavigation(
              event,
              visiblePresets,
              index,
              (id) => choosePreset(visiblePresets.find((candidate) => candidate.id === id)),
            )}
          >
            <strong>{preset.labelKey ? t(preset.labelKey) : preset.label}</strong>
            <small>
              {presetDetailKeys[preset.id]
                ? t(presetDetailKeys[preset.id])
                : preset.detail}
            </small>
          </button>
        ))}
      </div>
      <div className="graph-visual-settings__reset-actions">
        <button type="button" onClick={resetActiveProfile}><ArrowResetRegular />{t(settings.sharedStyle ? "graphVisualSettings.shared.resetButton" : "graphVisualSettings.scope.resetButton", { dimension: settings.view.dimension })}</button>
        <button type="button" onClick={reset}><ArrowResetRegular />{t("graphVisualSettings.scope.resetAllButton", { dimension: settings.view.dimension })}</button>
      </div>
      </> : null}

      {settings.layout.mode === "neuron" && settings.view.dimension === 3 ? <GraphLayoutSettings settings={settings} t={t} open /> : null}

      <div className="graph-visual-settings__effects">
        <div
          className="graph-visual-settings__layer-grid"
          role="group"
          aria-label={t("graphVisualSettings.profile.layerVisibilityAria")}
        >
          <FxLayerToggle profileId={profileId} path="node.core.enabled" label={t("graphVisualSettings.layer.nodeCore")} enabled={activeProfile.node.core.enabled} t={t} />
          {!neuronMaterials && <FxLayerToggle profileId={profileId} path="node.halo.enabled" label={t("graphVisualSettings.layer.nodeHalo")} enabled={activeProfile.node.halo.enabled} t={t} />}
          <FxLayerToggle profileId={profileId} path="node.pulse.enabled" label={t("graphVisualSettings.layer.nodePulse")} enabled={activeProfile.node.pulse.enabled} t={t} />
          {routeSignalsAvailable && <FxLayerToggle profileId={profileId} path="node.activation.enabled" label={t("graphVisualSettings.activation.title")} enabled={activeProfile.node.activation.enabled} t={t} />}
          <FxLayerToggle profileId={profileId} path="edge.core.enabled" label={t("graphVisualSettings.layer.relationCore")} enabled={activeProfile.edge.core.enabled} t={t} />
          {!neuronMaterials && <FxLayerToggle profileId={profileId} path="edge.halo.enabled" label={t("graphVisualSettings.layer.relationHalo")} enabled={activeProfile.edge.halo.enabled} t={t} />}
          {routeSignalsAvailable && <FxLayerToggle profileId={profileId} path="edge.signal.enabled" label={t("graphVisualSettings.routeSignals.title")} enabled={activeProfile.edge.signal.enabled} t={t} />}
          {idleSphere && <FxLayerToggle profileId={profileId} path="orb.signals.enabled" label={t("graphVisualSettings.idleSignals.title")} enabled={activeProfile.orb.signals.enabled} t={t} />}
          <FxLayerToggle profileId={profileId} path="signal.enabled" label={t(neuronMaterials ? "graphVisualSettings.routeSignals.background" : "graphVisualSettings.layer.relationSignals")} enabled={activeProfile.signal.enabled} t={t} />
          {settings.view.dimension === 3 ? <>
          {settings.idleShape !== "neuronSphere" ? <FxLayerToggle profileId={profileId} path="orb.innerNetwork.enabled" label={t("graphVisualSettings.layer.innerNetwork")} enabled={activeProfile.orb.innerNetwork.enabled} t={t} /> : null}
          <FxLayerToggle profileId={profileId} path="orb.rim.enabled" label={t("graphVisualSettings.layer.orbRim")} enabled={activeProfile.orb.rim.enabled} t={t} />
          <FxLayerToggle profileId={profileId} path="orb.sparks.enabled" label={t("graphVisualSettings.layer.ambientSparks")} enabled={activeProfile.orb.sparks.enabled} t={t} />
          </> : null}
          <FxLayerToggle profileId={profileId} path="postFx.bloom.enabled" label={t("graphVisualSettings.layer.bloom")} enabled={activeProfile.postFx.bloom.enabled} t={t} />
        </div>

        <FxCategory
          category="nodes"
          title={t("graphVisualSettings.category.nodeFx")}
          meta={t(neuronMaterials ? "graphVisualSettings.category.sceneGlowSummary" : "graphVisualSettings.category.coreHaloSummary", {
            coreState: t(activeProfile.node.core.enabled ? "common.state.on" : "common.state.off"),
            haloState: t(activeProfile.node.halo.enabled ? "common.state.on" : "common.state.off"),
          })}
        >
          <div className="graph-visual-settings__control-grid">
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="node.master.scale" label={technicalLabel(t, "NODE MASTER SCALE")} detail={t("graphVisualSettings.control.nodeMasterScale.detail")} format="strength" disabled={!activeProfile.node.core.enabled && (neuronMaterials || !activeProfile.node.halo.enabled)} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="node.master.opacity" label={technicalLabel(t, "NODE MASTER OPACITY")} detail={t("graphVisualSettings.control.nodeMasterOpacity.detail")} format="percent" disabled={!activeProfile.node.core.enabled && (neuronMaterials || !activeProfile.node.halo.enabled)} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="node.size.byImportance" label={technicalLabel(t, "NODE SIZE BY IMPORTANCE")} detail={t("graphVisualSettings.control.nodeSizeByImportance.detail")} format="percent" disabled={!activeProfile.node.core.enabled && (neuronMaterials || !activeProfile.node.halo.enabled)} />
            {routeSignalsAvailable && <>
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="node.size.variation" label={t("graphVisualSettings.cellVariation.size")} detail={t("graphVisualSettings.cellVariation.sizeDetail")} format="percent" />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="node.color.groupVariation" label={t("graphVisualSettings.cellVariation.hue")} detail={t("graphVisualSettings.cellVariation.hueDetail")} format="strength" />
            </>}
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="node.core.sizeScale" label={technicalLabel(t, "NODE CORE SIZE SCALE")} detail={t("graphVisualSettings.control.nodeCoreSizeScale.detail")} format="strength" disabled={!activeProfile.node.core.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="node.core.opacity" label={technicalLabel(t, "NODE CORE OPACITY")} detail={t("graphVisualSettings.control.nodeCoreOpacity.detail")} format="percent" disabled={!activeProfile.node.core.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="node.core.emissionIntensity" label={technicalLabel(t, "NODE CORE EMISSION INTENSITY")} detail={t("graphVisualSettings.control.nodeCoreEmission.detail")} format="strength" disabled={!activeProfile.node.core.enabled} />
            {!neuronMaterials && <>
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="node.halo.radiusScale" label={technicalLabel(t, "NODE HALO RADIUS SCALE")} detail={t("graphVisualSettings.control.nodeHaloRadius.detail")} format="strength" disabled={!activeProfile.node.halo.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="node.halo.opacity" label={technicalLabel(t, "NODE HALO OPACITY")} detail={t("graphVisualSettings.control.nodeHaloOpacity.detail")} format="percent" disabled={!activeProfile.node.halo.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="node.halo.emissionIntensity" label={technicalLabel(t, "NODE HALO EMISSION INTENSITY")} detail={t("graphVisualSettings.control.nodeHaloEmission.detail")} format="strength" disabled={!activeProfile.node.halo.enabled} />
            </>}
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="node.pulse.amount" label={technicalLabel(t, "NODE PULSE AMOUNT")} detail={t("graphVisualSettings.control.nodePulseAmount.detail")} format="strength" disabled={!activeProfile.node.pulse.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="node.pulse.rate" label={technicalLabel(t, "NODE PULSE RATE")} detail={t("graphVisualSettings.control.nodePulseRate.detail")} format="strength" disabled={!activeProfile.node.pulse.enabled} />
          </div>
        </FxCategory>

        {routeSignalsAvailable && <FxCategory category="nodes" title={t("graphVisualSettings.activation.title")} meta={t("graphVisualSettings.activation.summary")}>
          <div className="graph-visual-settings__control-grid">
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="node.activation.strength" label={t("graphVisualSettings.activation.strength")} detail={t("graphVisualSettings.activation.strengthDetail")} format="strength" disabled={!activeProfile.node.activation.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="node.activation.restingBrightness" label={t("graphVisualSettings.activation.resting")} detail={t("graphVisualSettings.activation.restingDetail")} format="percent" disabled={!activeProfile.node.activation.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="node.activation.chargeTime" label={t("graphVisualSettings.activation.charge")} detail={t("graphVisualSettings.activation.chargeDetail")} format="seconds" disabled={!activeProfile.node.activation.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="node.activation.holdTime" label={t("graphVisualSettings.activation.hold")} detail={t("graphVisualSettings.activation.holdDetail")} format="seconds" disabled={!activeProfile.node.activation.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="node.activation.decayTime" label={t("graphVisualSettings.activation.decay")} detail={t("graphVisualSettings.activation.decayDetail")} format="seconds" disabled={!activeProfile.node.activation.enabled} />
          </div>
        </FxCategory>}

        <FxCategory
          category="edges"
          title={t("graphVisualSettings.category.relationFx")}
          meta={t(neuronMaterials ? "graphVisualSettings.category.sceneGlowSummary" : "graphVisualSettings.category.coreHaloSummary", {
            coreState: t(activeProfile.edge.core.enabled ? "common.state.on" : "common.state.off"),
            haloState: t(activeProfile.edge.halo.enabled ? "common.state.on" : "common.state.off"),
          })}
          open
        >
          <div className="graph-visual-settings__control-grid">
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="edge.master.opacity" label={technicalLabel(t, "RELATION MASTER OPACITY")} detail={t("graphVisualSettings.control.relationMasterOpacity.detail")} format="percent" disabled={!activeProfile.edge.core.enabled && (neuronMaterials || !activeProfile.edge.halo.enabled)} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="edge.core.widthScale" label={technicalLabel(t, "RELATION CORE WIDTH SCALE")} detail={t("graphVisualSettings.control.relationCoreWidth.detail")} format="strength" disabled={!activeProfile.edge.core.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="edge.core.opacity" label={technicalLabel(t, "RELATION CORE OPACITY")} detail={t("graphVisualSettings.control.relationCoreOpacity.detail")} format="percent" disabled={!activeProfile.edge.core.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="edge.core.emissionIntensity" label={technicalLabel(t, "RELATION CORE EMISSION INTENSITY")} detail={t("graphVisualSettings.control.relationCoreEmission.detail")} format="strength" disabled={!activeProfile.edge.core.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="edge.core.widthByStrength" label={technicalLabel(t, "CORE WIDTH BY STRENGTH")} detail={t("graphVisualSettings.control.coreWidthByStrength.detail")} format="percent" disabled={!activeProfile.edge.core.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="edge.core.emissionByStrength" label={technicalLabel(t, "CORE EMISSION BY STRENGTH")} detail={t("graphVisualSettings.control.coreEmissionByStrength.detail")} format="percent" disabled={!activeProfile.edge.core.enabled} />
            {settings.layout.mode === "neuron" || settings.idleShape === "neuronSphere" ? <>
              <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="edge.filament.taper" label={t("graphVisualSettings.filament.taper")} detail={t("graphVisualSettings.filament.taperDetail")} format="percent" disabled={!activeProfile.edge.core.enabled} />
              <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="edge.filament.rootWidth" label={t("graphVisualSettings.filament.rootWidth")} detail={t("graphVisualSettings.filament.rootWidthDetail")} format="strength" disabled={!activeProfile.edge.core.enabled || activeProfile.edge.filament.taper === 0} />
              <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="edge.filament.roundness" label={t("graphVisualSettings.filament.roundness")} detail={t("graphVisualSettings.filament.roundnessDetail")} format="percent" disabled={!activeProfile.edge.core.enabled} />
              <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="edge.filament.translucency" label={t("graphVisualSettings.filament.translucency")} detail={t("graphVisualSettings.filament.translucencyDetail")} format="percent" disabled={!activeProfile.edge.core.enabled && (neuronMaterials || !activeProfile.edge.halo.enabled)} />
            </> : null}
            {!neuronMaterials && <>
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="edge.halo.radiusScale" label={technicalLabel(t, "RELATION HALO RADIUS SCALE")} detail={t("graphVisualSettings.control.relationHaloRadius.detail")} format="strength" disabled={!activeProfile.edge.halo.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="edge.halo.opacity" label={technicalLabel(t, "RELATION HALO OPACITY")} detail={t("graphVisualSettings.control.relationHaloOpacity.detail")} format="percent" disabled={!activeProfile.edge.halo.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="edge.halo.emissionIntensity" label={technicalLabel(t, "RELATION HALO EMISSION INTENSITY")} detail={t("graphVisualSettings.control.relationHaloEmission.detail")} format="strength" disabled={!activeProfile.edge.halo.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="edge.halo.falloff" label={technicalLabel(t, "RELATION HALO FALLOFF")} detail={t("graphVisualSettings.control.relationHaloFalloff.detail")} format="strength" disabled={!activeProfile.edge.halo.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="edge.halo.byStrength" label={technicalLabel(t, "RELATION HALO BY STRENGTH")} detail={t("graphVisualSettings.control.relationHaloByStrength.detail")} format="percent" disabled={!activeProfile.edge.halo.enabled} />
            </>}
          </div>
        </FxCategory>

        {routeSignalsAvailable && <FxCategory category="edges" title={t("graphVisualSettings.routeSignals.title")} meta={t(activeProfile.edge.signal.enabled ? "common.state.on" : "common.state.off")}>
          <div className="graph-visual-settings__control-grid">
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="edge.signal.speed" label={t("graphVisualSettings.routeSignals.speed")} detail={t("graphVisualSettings.routeSignals.speedDetail")} format="strength" disabled={!activeProfile.edge.signal.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="edge.signal.emissionIntensity" label={t("graphVisualSettings.routeSignals.emission")} detail={t("graphVisualSettings.routeSignals.emissionDetail")} format="strength" disabled={!activeProfile.edge.signal.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="edge.signal.colorStart" label={t("graphVisualSettings.routeSignals.colorStart")} detail={t("graphVisualSettings.routeSignals.colorRangeDetail")} format="percent" disabled={!activeProfile.edge.signal.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="edge.signal.colorEnd" label={t("graphVisualSettings.routeSignals.colorEnd")} detail={t("graphVisualSettings.routeSignals.colorBirthDetail")} format="percent" disabled={!activeProfile.edge.signal.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="edge.signal.headLength" label={t("graphVisualSettings.routeSignals.head")} detail={t("graphVisualSettings.routeSignals.headDetail")} format="strength" disabled={!activeProfile.edge.signal.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="edge.signal.wakeLength" label={t("graphVisualSettings.routeSignals.wake")} detail={t("graphVisualSettings.routeSignals.wakeDetail")} format="strength" disabled={!activeProfile.edge.signal.enabled} />
            {neuronMaterials && <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="edge.signal.spacing" label={t("graphVisualSettings.routeSignals.spacing")} detail={t("graphVisualSettings.routeSignals.spacingDetail")} format="strength" disabled={!activeProfile.edge.signal.enabled} />}
          </div>
        </FxCategory>}

        {idleSphere && <FxCategory category="edges" title={t("graphVisualSettings.idleSignals.title")} meta={t(activeProfile.orb.signals.enabled ? "common.state.on" : "common.state.off")}>
          <div className="graph-visual-settings__control-grid">
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="orb.signals.count" label={t("graphVisualSettings.idleSignals.count")} detail={t("graphVisualSettings.idleSignals.countDetail")} format="count" disabled={!activeProfile.orb.signals.enabled || !activeProfile.edge.signal.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="orb.signals.sizeVariation" label={t("graphVisualSettings.idleSignals.sizeVariation")} detail={t("graphVisualSettings.idleSignals.sizeVariationDetail")} format="percent" disabled={!activeProfile.orb.signals.enabled || !activeProfile.edge.signal.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="orb.signals.batchInterval" label={t("graphVisualSettings.idleSignals.batchInterval")} detail={t("graphVisualSettings.idleSignals.batchIntervalDetail")} format="seconds" disabled={!activeProfile.orb.signals.enabled || !activeProfile.edge.signal.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="orb.signals.launchSpread" label={t("graphVisualSettings.idleSignals.launchSpread")} detail={t("graphVisualSettings.idleSignals.launchSpreadDetail")} format="percent" disabled={!activeProfile.orb.signals.enabled || !activeProfile.edge.signal.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="orb.signals.hops" label={t("graphVisualSettings.idleSignals.hops")} detail={t("graphVisualSettings.idleSignals.hopsDetail")} format="count" disabled={!activeProfile.orb.signals.enabled || !activeProfile.edge.signal.enabled} />
          </div>
        </FxCategory>}

        {neuronMaterials && <FxCategory category="edges" title={t("graphVisualSettings.focusBreath.title")} meta={t("graphVisualSettings.focusBreath.summary")} open={false}>
          <div className="graph-visual-settings__control-grid">
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="edge.focus.boost" label={t("graphVisualSettings.focusBreath.boost")} detail={t("graphVisualSettings.focusBreath.boostDetail")} format="percent" />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="edge.focus.amplitude" label={t("graphVisualSettings.focusBreath.amplitude")} detail={t("graphVisualSettings.focusBreath.amplitudeDetail")} format="percent" />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="edge.focus.period" label={t("graphVisualSettings.focusBreath.period")} detail={t("graphVisualSettings.focusBreath.periodDetail")} format="seconds" />
          </div>
        </FxCategory>}

        <FxCategory
          category="scene"
          title={t(neuronMaterials ? "graphVisualSettings.routeSignals.background" : "graphVisualSettings.category.signals")}
          meta={t("graphVisualSettings.category.signalsSummary", {
            count: activeProfile.signal.count,
            speed: `${activeProfile.signal.speed.toFixed(2)}×`,
          })}
        >
          <div className="graph-visual-settings__control-grid">
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="signal.count" label={technicalLabel(t, "SIGNAL COUNT")} detail={t("graphVisualSettings.control.signalCount.detail")} format="count" disabled={!activeProfile.signal.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="signal.speed" label={technicalLabel(t, "SIGNAL SPEED")} detail={t("graphVisualSettings.control.signalSpeed.detail")} format="strength" disabled={!activeProfile.signal.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="signal.sizeScale" label={technicalLabel(t, "SIGNAL SIZE SCALE")} detail={t("graphVisualSettings.control.signalSize.detail")} format="strength" disabled={!activeProfile.signal.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="signal.opacity" label={technicalLabel(t, "SIGNAL OPACITY")} detail={t("graphVisualSettings.control.signalOpacity.detail")} format="percent" disabled={!activeProfile.signal.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="signal.emissionIntensity" label={technicalLabel(t, "SIGNAL EMISSION INTENSITY")} detail={t("graphVisualSettings.control.signalEmission.detail")} format="strength" disabled={!activeProfile.signal.enabled} />
          </div>
        </FxCategory>

        {settings.view.dimension === 3 ? (
        <FxCategory
          category="layout"
          title={t("graphVisualSettings.scope.idleOrb")}
          meta={t(settings.idleShape === "neuronSphere" ? "graphVisualSettings.sphere.summary" : "graphVisualSettings.category.orbSummary")}
        >
          <div className="graph-visual-settings__control-grid">
            {settings.idleShape === "neuronSphere" ? <>
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="orb.network.sizeScale" label={t("graphVisualSettings.sphere.size.label")} detail={t("graphVisualSettings.sphere.size.detail")} format="strength" />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="orb.network.branchSpread" label={t("graphVisualSettings.sphere.spread.label")} detail={t("graphVisualSettings.sphere.spread.detail")} format="strength" />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="orb.network.weave" label={t("graphVisualSettings.sphere.weave.label")} detail={t("graphVisualSettings.sphere.weave.detail")} format="strength" />
            </> : null}
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="orb.network.density" label={t("graphVisualSettings.control.shellDensity.label")} detail={t("graphVisualSettings.control.shellDensity.detail")} format="strength" />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="orb.network.shellRatio" label={t("graphVisualSettings.control.shellRatio.label")} detail={t("graphVisualSettings.control.shellRatio.detail")} format="percent" />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="orb.network.depthContrast" label={t("graphVisualSettings.control.depthContrast.label")} detail={t("graphVisualSettings.control.depthContrast.detail")} format="percent" />
            {settings.idleShape !== "neuronSphere" ? <>
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="orb.innerNetwork.scale" label={technicalLabel(t, "INNER NETWORK SCALE")} detail={t("graphVisualSettings.control.innerNetworkScale.detail")} format="strength" disabled={!activeProfile.orb.innerNetwork.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="orb.innerNetwork.opacity" label={technicalLabel(t, "INNER NETWORK OPACITY")} detail={t("graphVisualSettings.control.innerNetworkOpacity.detail")} format="percent" disabled={!activeProfile.orb.innerNetwork.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="orb.innerNetwork.rotationSpeed" label={technicalLabel(t, "INNER COUNTER-ROTATION SPEED")} detail={t("graphVisualSettings.control.innerRotationSpeed.detail")} format="strength" disabled={!activeProfile.orb.innerNetwork.enabled} />
            </> : null}
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="orb.rim.intensity" label={technicalLabel(t, "ORB RIM INTENSITY")} detail={t("graphVisualSettings.control.orbRimIntensity.detail")} format="strength" disabled={!activeProfile.orb.rim.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="orb.rim.fresnelPower" label={technicalLabel(t, "FRESNEL POWER")} detail={t("graphVisualSettings.control.fresnelPower.detail")} format="strength" disabled={!activeProfile.orb.rim.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="orb.sparks.sizeScale" label={technicalLabel(t, "AMBIENT SPARK SIZE SCALE")} detail={t("graphVisualSettings.control.ambientSparkSize.detail")} format="strength" disabled={!activeProfile.orb.sparks.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="orb.sparks.opacity" label={technicalLabel(t, "AMBIENT SPARK OPACITY")} detail={t("graphVisualSettings.control.ambientSparkOpacity.detail")} format="percent" disabled={!activeProfile.orb.sparks.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="orb.sparks.emissionIntensity" label={technicalLabel(t, "AMBIENT SPARK EMISSION INTENSITY")} detail={t("graphVisualSettings.control.ambientSparkEmission.detail")} format="strength" disabled={!activeProfile.orb.sparks.enabled} />
          </div>
        </FxCategory>
        ) : null}

        <FxCategory
          category="scene"
          title={t("graphVisualSettings.category.motion")}
          meta={t("graphVisualSettings.category.motionSummary")}
        >
          <div className="graph-visual-settings__control-grid">
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="motion.idleRotationSpeed" label={technicalLabel(t, "IDLE ROTATION SPEED")} detail={t("graphVisualSettings.control.idleRotationSpeed.detail")} format="strength" />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="motion.breathingAmount" label={technicalLabel(t, "BREATHING AMOUNT")} detail={t("graphVisualSettings.control.breathingAmount.detail")} format="strength" />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="motion.breathingRate" label={technicalLabel(t, "BREATHING RATE")} detail={t("graphVisualSettings.control.breathingRate.detail")} format="strength" />
          </div>
        </FxCategory>

        {(settings.layout.mode === "neuron" || settings.idleShape === "neuronSphere") && (
          <FxCategory category="glow" title={t("graphVisualSettings.radiance.title")} meta={t("graphVisualSettings.radiance.summary")}>
            <div className="graph-visual-settings__control-grid">
              {["temperature", "focus", "transmissionLink"].map((control) => (
                <GraphFxRangeControl key={control} profileId={profileId} profile={activeProfile} path={`postFx.radiance.${control}`} label={t(`graphVisualSettings.radiance.${control}`)} detail={t(`graphVisualSettings.radiance.${control}Detail`)} format="percent" />
              ))}
            </div>
          </FxCategory>
        )}

        <FxCategory
          category="glow"
          title={t("graphVisualSettings.category.postFx")}
          meta={t("graphVisualSettings.category.bloomSummary", {
            state: t(activeProfile.postFx.bloom.enabled ? "common.state.on" : "common.state.off"),
          })}
        >
          <div className="graph-visual-settings__control-grid">
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="postFx.bloom.intensity" label={technicalLabel(t, "BLOOM INTENSITY")} detail={t("graphVisualSettings.control.bloomIntensity.detail")} disabled={!activeProfile.postFx.bloom.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="postFx.bloom.threshold" label={technicalLabel(t, "BLOOM THRESHOLD")} detail={t("graphVisualSettings.control.bloomThreshold.detail")} disabled={!activeProfile.postFx.bloom.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="postFx.bloom.softKnee" label={technicalLabel(t, "BLOOM SOFT KNEE")} detail={t("graphVisualSettings.control.bloomSoftKnee.detail")} disabled={!activeProfile.postFx.bloom.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="postFx.bloom.radius" label={technicalLabel(t, "BLOOM RADIUS")} detail={t("graphVisualSettings.control.bloomRadius.detail")} disabled={!activeProfile.postFx.bloom.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="postFx.bloom.falloff" label={t("graphVisualSettings.glow.falloff")} detail={t("graphVisualSettings.glow.falloffDetail")} disabled={!activeProfile.postFx.bloom.enabled} />
            <GraphFxRangeControl profileId={profileId} profile={activeProfile} path="postFx.bloom.colorPreservation" label={t("graphVisualSettings.glow.colorPreservation")} detail={t("graphVisualSettings.glow.colorPreservationDetail")} format="percent" disabled={!activeProfile.postFx.bloom.enabled} />
          </div>
        </FxCategory>
      </div>

      <SettingsGroup
        category="scene"
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
        category="nodes"
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
        category="edges"
        title={t("graphVisualSettings.section.relations")}
        meta={`${Math.round(settings.edge.opacity * 100)}%`}
      >
        <RangeControl section="edge" setting="opacity" label={technicalLabel(t, "LINE OPACITY")} detail={t("graphVisualSettings.control.lineOpacity.detail")} value={settings.edge.opacity} format="percent" />
        <div className="graph-visual-settings__color-grid is-single">
          <ColorControl section="edge" setting="color" label={technicalLabel(t, "RELATION COLOR")} value={settings.edge.color} effectiveValue={resolvedColors.edgeColor} themeDriven={settings.node.useThemeColors} t={t} />
        </div>
      </SettingsGroup>

      <SettingsGroup
        category="nodes"
        title={t("graphVisualSettings.section.labels")}
        meta={`${settings.labels.count} · ${settings.labels.fontSize}PX`}
      >
        <div className="graph-visual-settings__control-grid">
          <RangeControl section="labels" setting="count" label={technicalLabel(t, "LABEL COUNT")} detail={t("graphVisualSettings.control.labelCount.detail", { count: quality.labelBudget })} value={settings.labels.count} format="count" />
          <RangeControl section="labels" setting="fontSize" label={technicalLabel(t, "FONT SIZE")} detail={t("graphVisualSettings.control.fontSize.detail")} value={settings.labels.fontSize} format="pixels" />
          <RangeControl section="labels" setting="opacity" label={technicalLabel(t, "LABEL OPACITY")} detail={t("graphVisualSettings.control.labelOpacity.detail")} value={settings.labels.opacity} format="percent" />
        </div>
      </SettingsGroup>

      {!(settings.layout.mode === "neuron" && settings.view.dimension === 3) ? <GraphLayoutSettings settings={settings} t={t} /> : null}

      <SettingsGroup
        category="scene"
        open
        title={t("graphVisualSettings.section.scenePerformance")}
        meta={t("graphVisualSettings.section.sceneSummary", {
          count: settings.scene.stars,
          quality: settings.performance.quality.toUpperCase(),
        })}
      >
        <div className="graph-visual-settings__control-grid">
          <RangeControl section="scene" setting="stars" label={technicalLabel(t, "STAR FIELD")} detail={t("graphVisualSettings.control.starField.detail", { count: quality.starBudget })} value={settings.scene.stars} format="count" />
        </div>
        <ChoiceGroup
          label={t("graphVisualSettings.choice.quality")}
          value={settings.performance.quality}
          options={qualityOptions}
          onChange={(value) => setGraphVisualSetting("performance", "quality", value)}
          t={t}
        />
      </SettingsGroup>

      {category === "scene" ? <details className="graph-visual-settings__diagnostics">
        <summary>{t("graphVisualSettings.editor.diagnostics")}</summary>
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
            requested: bloomRequested ? "ON" : "OFF",
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
      </details> : null}
      </div>
      <footer className="graph-visual-settings__footer">
        <GraphPersistenceStatus />
        <span>{t("graphVisualSettings.editor.editing", { dimension: settings.view.dimension })}</span>
      </footer>
    </section>
    </SettingsCategoryContext.Provider>
  );

  if (!embedded && mobileDrawer && typeof document !== "undefined") {
    return createPortal(panel, document.body);
  }

  return panel;
}

function GraphPersistenceStatus() {
  const { t } = useLanguage();
  const state = useSyncExternalStore(subscribeGraphVisualSettings, getGraphVisualSettingsPersistenceState);
  return <span role="status">
    {t(`graphVisualSettings.storage.${state}`)}
    {state === "error" ? <button type="button" onClick={retryGraphVisualSettingsPersistence}>
      {t("graphVisualSettings.storage.retry")}
    </button> : null}
  </span>;
}

function GraphLayoutSettings({ settings, t, open = true }) {
  return (
      <SettingsGroup
        category="layout"
        title={t(settings.layout.mode === "neuron" ? "graphVisualSettings.neuron.layout" : "graphVisualSettings.section.layoutForces")}
        open={open}
        meta={t(settings.layout.mode === "neuron" ? "graphVisualSettings.neuron.layoutDetail" : "graphVisualSettings.section.layoutSummary")}
      >
        <div className="graph-visual-settings__control-grid">
          <RangeControl section="layout" setting="repulsion" label={settings.layout.mode === "neuron" ? t("graphVisualSettings.neuron.spacing") : technicalLabel(t, "REPULSION STRENGTH")} detail={t(settings.layout.mode === "neuron" ? "graphVisualSettings.neuron.spacingDetail" : "graphVisualSettings.control.repulsion.detail")} value={settings.layout.repulsion} format="strength" />
          <RangeControl section="layout" setting="linkDistance" label={settings.layout.mode === "neuron" ? t("graphVisualSettings.neuron.branchLength") : technicalLabel(t, "PREFERRED RELATION LENGTH")} detail={t(settings.layout.mode === "neuron" ? "graphVisualSettings.neuron.branchLengthDetail" : "graphVisualSettings.control.relationLength.detail")} value={settings.layout.linkDistance} format="strength" />
          {settings.layout.mode === "neuron" && settings.view.dimension === 3 ? <>
            <RangeControl section="layout" setting="depth" label={t("graphVisualSettings.neuron.depth")} detail={t("graphVisualSettings.neuron.depthDetail")} value={settings.layout.depth} format="strength" />
            <RangeControl section="layout" setting="branchSpread" label={t("graphVisualSettings.neuron.branchSpread")} detail={t("graphVisualSettings.neuron.branchSpreadDetail")} value={settings.layout.branchSpread} format="percent" />
            <RangeControl section="layout" setting="weave" label={t("graphVisualSettings.neuron.weave")} detail={t("graphVisualSettings.neuron.weaveDetail")} value={settings.layout.weave} format="strength" />
            <RangeControl section="layout" setting="crossLinks" label={t("graphVisualSettings.neuron.crossLinks")} detail={t("graphVisualSettings.neuron.crossLinksDetail")} value={settings.layout.crossLinks} format="percent" />
            <RangeControl section="layout" setting="depthContrast" label={t("graphVisualSettings.neuron.depthContrast")} detail={t("graphVisualSettings.neuron.depthContrastDetail")} value={settings.layout.depthContrast} format="percent" />
          </> : null}
          {settings.layout.mode !== "neuron" ? <>
            <RangeControl section="layout" setting="linkStrength" label={technicalLabel(t, "RELATION CONSTRAINT STRENGTH")} detail={t("graphVisualSettings.control.relationConstraint.detail")} value={settings.layout.linkStrength} format="strength" />
            <RangeControl section="layout" setting="collision" label={technicalLabel(t, "COLLISION RADIUS")} detail={t("graphVisualSettings.control.collisionRadius.detail")} value={settings.layout.collision} format="strength" />
            <RangeControl section="layout" setting="center" label={technicalLabel(t, "CENTERING FORCE")} detail={t("graphVisualSettings.control.centeringForce.detail")} value={settings.layout.center} />
          </> : null}
        </div>
      </SettingsGroup>
  );
}
