import {
  AppsListDetailRegular,
  ArrowClockwiseRegular,
  ArrowSortRegular,
  ChevronRightRegular,
  ClipboardPasteRegular,
  CopyRegular,
  CutRegular,
  DeleteRegular,
  FolderAddRegular,
  FolderOpenRegular,
  GridRegular,
  InfoRegular,
  OpenRegular,
  RenameRegular,
  SettingsRegular,
} from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { useLanguage } from "../i18n/language-system.js";

function MenuItem({
  children,
  checked,
  checkType = "radio",
  disabled = false,
  icon: Icon,
  onClick,
  submenu,
}) {
  return (
    <button
      type="button"
      className="desktop-menu-item"
      role={checked === undefined ? "menuitem" : `menuitem${checkType}`}
      aria-checked={checked === undefined ? undefined : checked}
      aria-haspopup={submenu ? "menu" : undefined}
      aria-expanded={submenu ? submenu.open : undefined}
      data-submenu={submenu?.id}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={submenu?.onOpen}
    >
      <span className={`desktop-menu-item__icon ${checked ? "is-checked" : ""}`} aria-hidden="true">
        {checked === true ? "✓" : Icon ? <Icon /> : null}
      </span>
      <span className="desktop-menu-item__label">{children}</span>
      {submenu ? <ChevronRightRegular className="desktop-menu-item__chevron" aria-hidden="true" /> : null}
    </button>
  );
}

function MenuSeparator() {
  return <div className="desktop-menu-separator" role="separator" />;
}

export function DesktopContextMenu({
  alignToGrid,
  autoArrange,
  iconSize,
  menu,
  menuRef,
  onClose,
  onCopy,
  onCopyPath,
  onCut,
  onDelete,
  onNewFolder,
  onOpen,
  onOpenLocation,
  onOpenSettings,
  onPaste,
  onProperties,
  onRefresh,
  onRename,
  onSetIconSize,
  onSetSortMode,
  onToggleAlignToGrid,
  onToggleAutoArrange,
  shortcut,
  selectionCount,
  sortMode,
  canPaste,
}) {
  const { t } = useLanguage();
  const [activeSubmenu, setActiveSubmenu] = useState(null);

  useEffect(() => {
    setActiveSubmenu(null);
    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector(".desktop-menu-root > .desktop-menu-item:not(:disabled)")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [menu.kind, menu.shortcutId, menu.x, menu.y, menuRef]);

  const focusSubmenu = (id) => {
    setActiveSubmenu(id);
    window.requestAnimationFrame(() => {
      menuRef.current?.querySelector(`[data-submenu-panel="${id}"] .desktop-menu-item:not(:disabled)`)?.focus();
    });
  };

  const handleKeyDown = (event) => {
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    const currentItem = event.target.closest(".desktop-menu-item");
    const currentMenu = event.target.closest('[role="menu"]');
    if (!currentItem || !currentMenu) return;
    const items = [...currentMenu.querySelectorAll(":scope > .desktop-menu-item:not(:disabled)")];
    const currentIndex = items.indexOf(currentItem);

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      items[(currentIndex + direction + items.length) % items.length]?.focus();
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
      return;
    }
    if (event.key === "ArrowRight" && currentItem.dataset.submenu) {
      event.preventDefault();
      focusSubmenu(currentItem.dataset.submenu);
      return;
    }
    if (event.key === "ArrowLeft" && currentMenu.dataset.submenuPanel) {
      event.preventDefault();
      const submenuId = currentMenu.dataset.submenuPanel;
      setActiveSubmenu(null);
      menuRef.current?.querySelector(`[data-submenu="${submenuId}"]`)?.focus();
      return;
    }
  };

  const rootClassName = [
    "desktop-context-menu",
    `is-submenu-${menu.submenuSide}`,
    menu.kind === "item" ? "is-item-menu" : "is-desktop-menu",
  ].join(" ");
  const rootMenuLabel = menu.kind === "item"
    ? t("desktop.context.accessibility.itemCommands", {
      label: shortcut?.label ?? t("desktop.context.accessibility.item"),
    })
    : t("desktop.context.accessibility.desktopCommands");

  return (
    <section
      ref={menuRef}
      className={rootClassName}
      style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
      onKeyDown={handleKeyDown}
    >
      <div className="desktop-menu-root" role="menu" aria-label={rootMenuLabel}>
        {menu.kind === "item" ? (
          <>
            <MenuItem
              icon={OpenRegular}
              disabled={selectionCount !== 1}
              onClick={() => onOpen(shortcut)}
            >
              {t("desktop.context.action.open")}
            </MenuItem>
            <MenuItem
              icon={FolderOpenRegular}
              disabled={selectionCount !== 1 || !shortcut?.path}
              onClick={() => onOpenLocation(shortcut)}
            >
              {t("desktop.context.action.openLocation")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={CutRegular} disabled={!shortcut?.path} onClick={onCut}>
              {t("desktop.context.action.cut")}
            </MenuItem>
            <MenuItem icon={CopyRegular} disabled={!shortcut?.path} onClick={onCopy}>
              {t("desktop.context.action.copy")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={RenameRegular}
              disabled={selectionCount !== 1 || !shortcut?.path}
              onClick={() => onRename(shortcut)}
            >
              {t("desktop.context.action.rename")}
            </MenuItem>
            <MenuItem icon={DeleteRegular} disabled={!shortcut?.path} onClick={onDelete}>
              {t("desktop.context.action.delete")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={CopyRegular}
              disabled={selectionCount !== 1 || !shortcut?.path}
              onClick={() => onCopyPath(shortcut)}
            >
              {t("desktop.context.action.copyPath")}
            </MenuItem>
            <MenuItem
              icon={InfoRegular}
              disabled={selectionCount !== 1 || !shortcut?.path}
              onClick={() => onProperties(shortcut)}
            >
              {t("desktop.context.action.properties")}
            </MenuItem>
          </>
        ) : (
          <>
            <MenuItem icon={FolderAddRegular} onClick={onNewFolder}>
              {t("desktop.context.action.newFolder")}
            </MenuItem>
            <MenuItem icon={ClipboardPasteRegular} disabled={!canPaste} onClick={onPaste}>
              {t("desktop.context.action.paste")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={AppsListDetailRegular}
              submenu={{
                id: "view",
                open: activeSubmenu === "view",
                onOpen: () => setActiveSubmenu("view"),
              }}
              onClick={() => setActiveSubmenu("view")}
            >
              {t("desktop.context.action.view")}
            </MenuItem>
            <MenuItem
              icon={ArrowSortRegular}
              submenu={{
                id: "sort",
                open: activeSubmenu === "sort",
                onOpen: () => setActiveSubmenu("sort"),
              }}
              onClick={() => setActiveSubmenu("sort")}
            >
              {t("desktop.context.action.sortBy")}
            </MenuItem>
            <MenuItem icon={ArrowClockwiseRegular} onClick={onRefresh}>
              {t("desktop.context.action.refresh")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem checked={autoArrange} checkType="checkbox" onClick={onToggleAutoArrange}>
              {t("desktop.context.action.autoArrange")}
            </MenuItem>
            <MenuItem checked={alignToGrid} checkType="checkbox" onClick={onToggleAlignToGrid}>
              {t("desktop.context.action.alignToGrid")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={SettingsRegular} onClick={onOpenSettings}>
              {t("desktop.context.action.settings")}
            </MenuItem>

            {activeSubmenu === "view" ? (
              <div
                className="desktop-context-submenu is-view-submenu"
                role="menu"
                aria-label={t("desktop.context.accessibility.iconSize")}
                data-submenu-panel="view"
              >
                <MenuItem checked={iconSize === "large"} onClick={() => onSetIconSize("large")}>
                  {t("desktop.context.view.large")}
                </MenuItem>
                <MenuItem checked={iconSize === "medium"} onClick={() => onSetIconSize("medium")}>
                  {t("desktop.context.view.medium")}
                </MenuItem>
                <MenuItem checked={iconSize === "small"} onClick={() => onSetIconSize("small")}>
                  {t("desktop.context.view.small")}
                </MenuItem>
              </div>
            ) : null}

            {activeSubmenu === "sort" ? (
              <div
                className="desktop-context-submenu is-sort-submenu"
                role="menu"
                aria-label={t("desktop.context.accessibility.sort")}
                data-submenu-panel="sort"
              >
                <MenuItem checked={sortMode === "name"} onClick={() => onSetSortMode("name")}>
                  {t("desktop.context.sort.name")}
                </MenuItem>
                <MenuItem checked={sortMode === "type"} onClick={() => onSetSortMode("type")}>
                  {t("desktop.context.sort.type")}
                </MenuItem>
                <MenuItem checked={sortMode === "source"} onClick={() => onSetSortMode("source")}>
                  {t("desktop.context.sort.source")}
                </MenuItem>
                {sortMode === "none" ? (
                  <>
                    <MenuSeparator />
                    <div className="desktop-menu-hint">
                      <GridRegular aria-hidden="true" />
                      <span>{t("desktop.context.sort.windowsOrder")}</span>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
