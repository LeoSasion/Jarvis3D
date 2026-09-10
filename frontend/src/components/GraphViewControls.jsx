import { ArrowResetRegular, SettingsRegular, ZoomInRegular, ZoomOutRegular } from "@fluentui/react-icons";
import { createPortal } from "react-dom";
import { useDesktopTools } from "../desktop-tools-context.js";
import { setGraphVisualSetting } from "../graphics/graph/graph-visual-settings.js";
import { useLanguage } from "../i18n/language-system.js";

export function GraphViewControls({
  active,
  dimension,
  zoom,
  depth = 720,
  onZoom,
  onFit,
  onReset,
  onOpenVisualSettings,
  visualSettingsOpen,
  visualSettingsTriggerRef,
}) {
  const { t } = useLanguage();
  const { graphToolsTarget } = useDesktopTools();
  if (!active || !graphToolsTarget) return null;
  const actionLabel = (action) => t(`graph.workspace.action.${action}`);
  const settingsLabel = actionLabel(visualSettingsOpen ? "closeVisualSettings" : "openVisualSettings");

  // Only the controls move into the rail; the owning graph and its camera stay mounted.
  return createPortal(
    <div className="desktop-graph-tools" role="group" aria-label={t("graph.workspace.viewControls.aria")}>
      <div className="desktop-graph-tools__group">
        {[2, 3].map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={dimension === value}
            aria-label={actionLabel(`switch${value}d`)}
            title={actionLabel(`switch${value}d`)}
            onClick={() => setGraphVisualSetting("view", "dimension", value)}
          >{value}D</button>
        ))}
      </div>
      <div className="desktop-graph-tools__group">
        <button type="button" onClick={() => onZoom(0.12)} aria-label={actionLabel(dimension === 3 ? "dollyIn" : "zoomIn")} title={actionLabel(dimension === 3 ? "dollyIn" : "zoomIn")}><ZoomInRegular aria-hidden="true" /></button>
        <output aria-label={t(dimension === 3 ? "graph.camera.depth.aria" : "graph.workspace.zoom.aria")}>{dimension === 3 ? `Z ${Math.round(depth)}` : `${Math.round(zoom * 100)}%`}</output>
        <button type="button" onClick={() => onZoom(-0.12)} aria-label={actionLabel(dimension === 3 ? "dollyOut" : "zoomOut")} title={actionLabel(dimension === 3 ? "dollyOut" : "zoomOut")}><ZoomOutRegular aria-hidden="true" /></button>
        <button type="button" onClick={onFit} aria-label={actionLabel("fit")} title={actionLabel("fit")}>{actionLabel("fitShort")}</button>
        <button type="button" onClick={onReset} aria-label={actionLabel("resetView")} title={actionLabel("resetView")}><ArrowResetRegular aria-hidden="true" /></button>
      </div>
      <div className="desktop-graph-tools__group">
        <button
          ref={visualSettingsTriggerRef}
          type="button"
          onClick={onOpenVisualSettings}
          aria-label={settingsLabel}
          title={settingsLabel}
          aria-controls="graph-visual-settings-panel"
          aria-expanded={visualSettingsOpen}
        ><SettingsRegular aria-hidden="true" /></button>
      </div>
    </div>,
    graphToolsTarget,
  );
}
