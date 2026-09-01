import { ChevronLeftRegular, ChevronRightRegular } from "@fluentui/react-icons";
import { useLanguage } from "../i18n/language-system.js";
import {
  getLinkedPaneToggleTarget,
  isCompactLinkedVariant,
} from "../workspace-layout-mode.js";

export function LinkedWorkspaceHandle({ activeId, variant, onActivate }) {
  const { t } = useLanguage();
  if (!isCompactLinkedVariant(variant)) return null;
  const targetId = getLinkedPaneToggleTarget(activeId, variant);
  if (!targetId) return null;
  const Icon = targetId === "agent" ? ChevronLeftRegular : ChevronRightRegular;
  const targetLabel = targetId === "agent" ? "Agent" : "Explorer";

  return (
    <button
      type="button"
      className={`linked-workspace-handle is-${activeId === "agent" ? "agent" : "explorer"}`}
      aria-label={t("linkedWorkspaceHandle.showPaneAria", { target: targetLabel })}
      aria-controls={`workspace-window-${targetId}`}
      aria-keyshortcuts="Alt+F8"
      aria-pressed={activeId === "agent"}
      onClick={() => onActivate(targetId)}
    >
      <Icon aria-hidden="true" />
      <span>
        <strong>{t("linkedWorkspaceHandle.linkedStatus")}</strong>
        <small>{t("linkedWorkspaceHandle.showPaneHint", { target: targetLabel })}</small>
      </span>
    </button>
  );
}
