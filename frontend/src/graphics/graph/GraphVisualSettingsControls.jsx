import { ArrowResetRegular, EyeOffRegular, EyeRegular } from "@fluentui/react-icons";
import { Children, isValidElement, createContext, useContext, useId, useState } from "react";
import { useLanguage } from "../../i18n/language-system.js";
import { normalizeGraphRangeInput } from "./graph-settings-input.js";
import { getGraphFxSettingRange, getGraphFxSettingValue } from "./graph-fx-profile.js";
import { DEFAULT_GRAPH_VISUAL_SETTINGS, graphVisualSettingRanges, setGraphVisualProfileSetting, setGraphVisualSetting, updateGraphVisualSettingsSection } from "./graph-visual-settings.js";
import { GRAPH_EDITOR_COPY, graphSettingChanged, graphSettingDefault, matchesGraphControlFilter } from "./graph-visual-editor-model.js";

export const SettingsCategoryContext = createContext("nodes");
export const SettingsFilterContext = createContext({ query: "", changedOnly: false, dimension: 3 });

function useControlFilter({ section, setting, label, detail, path, value, defaultValue }) {
  const filter = useContext(SettingsFilterContext);
  const baseline = defaultValue ?? graphSettingDefault(DEFAULT_GRAPH_VISUAL_SETTINGS, filter.dimension, section, setting);
  return {
    readOnly: filter.readOnly,
    defaultValue: baseline,
    changed: graphSettingChanged(value, baseline),
    visible: matchesGraphControlFilter(filter, { label, detail, path: path ?? `${section}.${setting}`, value, defaultValue: baseline }),
  };
}

function ResetParameter({ changed, label, onReset }) {
  const { readOnly } = useContext(SettingsFilterContext);
  const { language } = useLanguage();
  const copy = GRAPH_EDITOR_COPY[language] ?? GRAPH_EDITOR_COPY["en-US"];
  return <button type="button" className="graph-visual-settings__parameter-reset" disabled={!changed || readOnly}
    title={copy.reset} aria-label={`${copy.reset}: ${label}`} onClick={() => { if (!readOnly) onReset(); }}><ArrowResetRegular /></button>;
}

function formatValue(value, format) {
  if (format === "percent") return `${Math.round(value * 100)}%`;
  if (format === "count") return String(Math.round(value));
  if (format === "pixels") return `${Math.round(value)} PX`;
  if (format === "strength") return `${Number(value).toFixed(2)}×`;
  if (format === "seconds") return `${Number(Number(value).toFixed(2))} s`;
  return Number(value).toFixed(2);
}

export function technicalLabel(t, label) {
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

export function RangeControl({
  section,
  setting,
  label,
  detail,
  value,
  format,
  disabled = false,
  onValueChange,
  range: providedRange,
  defaultValue: providedDefault,
  path,
}) {
  const range = providedRange ?? graphVisualSettingRanges[section][setting];
  const inputId = useId();
  const detailId = `${inputId}-detail`;
  const outputId = `${inputId}-output`;
  const formattedValue = formatValue(value, format);
  const control = useControlFilter({ section, setting, label, detail, value, path, defaultValue: providedDefault });
  disabled ||= control.readOnly;
  const commit = (nextValue) => {
    if (control.readOnly) return;
    if (onValueChange) onValueChange(nextValue);
    else setGraphVisualSetting(section, setting, nextValue);
  };
  if (!control.visible) return null;
  return (
    <div className={`graph-visual-settings__range graph-settings-control ${disabled ? "is-disabled" : ""}`} data-modified={control.changed}>
      <span>
        <label htmlFor={inputId}><strong>{label}</strong></label>
        <small id={detailId}>{detail}</small>
      </span>
      <output id={outputId} htmlFor={inputId} aria-hidden="true" className="sr-only">{formattedValue}</output>
      <RangeValue key={value} value={value} range={range} format={format} label={label} disabled={disabled} onCommit={commit} />
      <ResetParameter changed={control.changed} label={label} onReset={() => commit(control.defaultValue)} />
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

export function GraphFxRangeControl({
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
      path={path}
      defaultValue={getGraphFxSettingValue(DEFAULT_GRAPH_VISUAL_SETTINGS.profiles[profileId], path)}
      onValueChange={(value) => setGraphVisualProfileSetting(profileId, path, value)}
    />
  );
}

export function ColorControl({
  section,
  setting,
  label,
  value,
  effectiveValue,
  themeDriven,
  t,
}) {
  const displayedValue = effectiveValue ?? value;
  const control = useControlFilter({ section, setting, label, value });
  if (!control.visible) return null;
  return (
    <div className="graph-visual-settings__color graph-settings-control" data-modified={control.changed}>
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
        disabled={control.readOnly}
        aria-label={label}
        value={displayedValue}
        onChange={(event) => { if (!control.readOnly) setGraphVisualSetting(section, setting, event.currentTarget.value); }}
      />
      <ResetParameter changed={control.changed} label={label} onReset={() => updateGraphVisualSettingsSection(section, { [setting]: control.defaultValue })} />
    </div>
  );
}

export function getRadioTabIndex(value, options, index) {
  const selectedIndex = options.findIndex((option) => option.id === value);
  return index === (selectedIndex < 0 ? 0 : selectedIndex) ? 0 : -1;
}

export function handleRadioNavigation(event, options, currentIndex, onChange) {
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

export function ChoiceGroup({ label, value, options, onChange, t, section, setting, disabled = false }) {
  const control = useControlFilter({ section, setting, label, value });
  if (section && !control.visible) return null;
  return (
    <fieldset disabled={disabled || control.readOnly} className={`graph-visual-settings__choices ${section ? "graph-settings-control" : ""}`}>
      <legend>{label}{section && <ResetParameter changed={control.changed} label={label} onReset={() => onChange(control.defaultValue)} />}</legend>
      <div role="radiogroup" aria-label={label}>
        {options.map((option, index) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={value === option.id}
            tabIndex={getRadioTabIndex(value, options, index)}
            className={value === option.id ? "is-selected" : ""}
            onClick={() => { if (!control.readOnly) onChange(option.id); }}
            onKeyDown={(event) => handleRadioNavigation(event, options, index, (value) => { if (!control.readOnly) onChange(value); })}
          >
            {option.labelKey ? t(option.labelKey) : option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function hasMatchingControl(children, filter) {
  return Children.toArray(children).some((child) => {
    if (!isValidElement(child)) return false;
    const props = child.props;
    if (child.type === RangeControl || child.type === ColorControl || child.type === ChoiceGroup || child.type === GraphFxRangeControl) {
      const value = props.profile ? getGraphFxSettingValue(props.profile, props.path) : props.value;
      const defaultValue = props.profileId
        ? getGraphFxSettingValue(DEFAULT_GRAPH_VISUAL_SETTINGS.profiles[props.profileId], props.path)
        : graphSettingDefault(DEFAULT_GRAPH_VISUAL_SETTINGS, filter.dimension, props.section, props.setting);
      return matchesGraphControlFilter(filter, { ...props, value, defaultValue, path: props.path ?? `${props.section}.${props.setting}` });
    }
    return hasMatchingControl(props.children, filter);
  });
}

export function SettingsGroup({ category, title, meta, children, open = false }) {
  const activeCategory = useContext(SettingsCategoryContext);
  const filter = useContext(SettingsFilterContext);
  if (activeCategory === null && !hasMatchingControl(children, filter)) return null;
  if (activeCategory && category && category !== activeCategory) return null;
  return (
    <details className="graph-visual-settings__group" open={activeCategory === null || open}>
      <summary><strong>{title}</strong><code>{meta}</code></summary>
      <div>{children}</div>
    </details>
  );
}

export function FxCategory({ category, title, meta, children, open = false }) {
  const activeCategory = useContext(SettingsCategoryContext);
  const filter = useContext(SettingsFilterContext);
  if (activeCategory === null && !hasMatchingControl(children, filter)) return null;
  if (activeCategory && category !== activeCategory) return null;
  return (
    <details className="graph-visual-settings__fx-category" open={activeCategory === null || open}>
      <summary><strong>{title}</strong><code>{meta}</code></summary>
      <div>{children}</div>
    </details>
  );
}

export function FxLayerToggle({ profileId, path, label, enabled, t }) {
  const activeCategory = useContext(SettingsCategoryContext);
  const defaultValue = getGraphFxSettingValue(DEFAULT_GRAPH_VISUAL_SETTINGS.profiles[profileId], path);
  const control = useControlFilter({ path, label, value: enabled, defaultValue });
  const category = path.startsWith("node.") ? "nodes"
    : path.startsWith("edge.") || path.startsWith("orb.signals.") ? "edges"
      : path.startsWith("postFx.") ? "glow"
        : path.startsWith("orb.") ? "layout" : "scene";
  if ((activeCategory && category !== activeCategory) || !control.visible) return null;
  const stateLabel = t(enabled ? "common.state.on" : "common.state.off");
  return (
    <div className="graph-visual-settings__layer-control graph-settings-control">
    <button
      type="button"
      aria-label={t("graphVisualSettings.layer.toggleAria", {
        label,
        state: stateLabel,
      })}
      disabled={control.readOnly}
      aria-pressed={enabled}
      className={enabled ? "is-enabled" : ""}
      onClick={() => { if (!control.readOnly) setGraphVisualProfileSetting(profileId, path, !enabled); }}
    >
      <strong>{label}</strong>
      <span>
        {enabled ? <EyeRegular /> : <EyeOffRegular />}
        <code>{stateLabel}</code>
      </span>
    </button>
    <ResetParameter changed={control.changed} label={label} onReset={() => setGraphVisualProfileSetting(profileId, path, defaultValue)} />
    </div>
  );
}
