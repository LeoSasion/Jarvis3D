import {
  ArrowDownloadRegular,
  ArrowImportRegular,
  ArrowUndoRegular,
  DeleteRegular,
  SaveRegular,
} from "@fluentui/react-icons";
import {
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useLanguage } from "../i18n/language-system.js";
import { formatDate } from "../i18n/locale-format.js";
import {
  deleteGraphVisualProfile,
  getGraphVisualProfileLibrarySnapshot,
  importGraphVisualProfileDocument,
  saveGraphVisualProfile,
  serializeGraphVisualProfileDocument,
  subscribeGraphVisualProfileLibrary,
} from "./graph-visual-profile-library.js";
import {
  canUndoGraphVisualSettings,
  getGraphVisualSettingsSnapshot,
  replaceGraphVisualSettings,
  subscribeGraphVisualSettings,
  undoGraphVisualSettings,
} from "../graphics/graph/graph-visual-settings.js";
import "./graph-profile-manager.css";

function createScope(vaultName, mode) {
  return mode === "vault" && vaultName ? `vault:${vaultName}` : "global";
}

function downloadProfileDocument(profiles) {
  const contents = serializeGraphVisualProfileDocument(profiles);
  const objectUrl = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = `jarvis-graph-visuals-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  globalThis.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

export function GraphProfileManager({ vaultName = "", onToast }) {
  const { language, t } = useLanguage();
  const library = useSyncExternalStore(
    subscribeGraphVisualProfileLibrary,
    getGraphVisualProfileLibrarySnapshot,
    getGraphVisualProfileLibrarySnapshot,
  );
  const settings = useSyncExternalStore(
    subscribeGraphVisualSettings,
    getGraphVisualSettingsSnapshot,
    getGraphVisualSettingsSnapshot,
  );
  const [name, setName] = useState("");
  const [scopeMode, setScopeMode] = useState(vaultName ? "vault" : "global");
  const [message, setMessage] = useState("");
  const fileInputRef = useRef(null);
  const scope = createScope(vaultName, scopeMode);
  const visibleProfiles = useMemo(
    () => library.profiles.filter((profile) => profile.scope === scope),
    [library.profiles, scope],
  );

  const report = (nextMessage) => {
    setMessage(nextMessage);
    onToast?.(nextMessage);
  };

  const save = () => {
    try {
      const profile = saveGraphVisualProfile(name, settings, scope);
      setName("");
      report(t("graph.profileManager.toast.saved", { profile: profile.label }));
    } catch (error) {
      setMessage(t("graph.profileManager.error.saveFailed", {
        message: error.message,
      }));
    }
  };

  const applyProfile = (profile) => {
    replaceGraphVisualSettings(profile.settings, { historyKey: `profile:${profile.id}` });
    report(t("graph.profileManager.toast.applied", { profile: profile.label }));
  };

  const removeProfile = (profile) => {
    deleteGraphVisualProfile(profile.id);
    report(t("graph.profileManager.toast.deleted", { profile: profile.label }));
  };

  const importProfiles = async (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      if (file.size > 256 * 1_024) {
        setMessage(t("graph.profileManager.error.fileTooLarge"));
        return;
      }
      const imported = importGraphVisualProfileDocument(await file.text(), scope);
      report(t(imported.length === 1
        ? "graph.profileManager.toast.imported.one"
        : "graph.profileManager.toast.imported.other", {
        count: imported.length,
      }));
    } catch (error) {
      setMessage(t("graph.profileManager.error.importFailed", {
        message: error.message,
      }));
    }
  };

  const exportProfiles = () => {
    downloadProfileDocument(visibleProfiles);
    report(t("graph.profileManager.toast.exported", {
      count: visibleProfiles.length,
    }));
  };

  const undo = () => {
    if (!undoGraphVisualSettings()) return;
    report(t("graph.profileManager.toast.undo"));
  };

  return (
    <section className="graph-profile-manager" aria-labelledby="graph-profile-manager-title">
      <header>
        <span>
          <strong id="graph-profile-manager-title">
            {t("graph.profileManager.title")}
          </strong>
          <small>{t("graph.profileManager.description")}</small>
        </span>
        <code>{library.profiles.length}/12</code>
      </header>

      <div
        className="graph-profile-manager__scope"
        role="radiogroup"
        aria-label={t("graph.profileManager.scope.aria")}
      >
        <button
          type="button"
          role="radio"
          aria-checked={scopeMode === "global"}
          className={scopeMode === "global" ? "is-selected" : ""}
          onClick={() => setScopeMode("global")}
        >
          {t("graph.profileManager.scope.global")}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={scopeMode === "vault"}
          className={scopeMode === "vault" ? "is-selected" : ""}
          disabled={!vaultName}
          onClick={() => setScopeMode("vault")}
        >
          {t("graph.profileManager.scope.currentVault")}
        </button>
      </div>

      <form
        className="graph-profile-manager__save"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <label>
          <span>{t("graph.profileManager.name.label")}</span>
          <input
            type="text"
            value={name}
            maxLength={40}
            placeholder={t("graph.profileManager.name.placeholder")}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <button type="submit" disabled={!name.trim()}>
          <SaveRegular />{t("graph.profileManager.action.saveCurrent")}
        </button>
      </form>

      <div
        className="graph-profile-manager__list"
        aria-label={t("graph.profileManager.list.aria")}
      >
        {visibleProfiles.length === 0 ? (
          <p>{t("graph.profileManager.list.empty")}</p>
        ) : visibleProfiles.map((profile) => (
          <article key={profile.id}>
            <button type="button" onClick={() => applyProfile(profile)}>
              <strong>{profile.label}</strong>
              <small>{formatDate(profile.updatedAt, language)}</small>
            </button>
            <button
              type="button"
              aria-label={t("graph.profileManager.action.deleteAria", {
                profile: profile.label,
              })}
              onClick={() => removeProfile(profile)}
            >
              <DeleteRegular />
            </button>
          </article>
        ))}
      </div>

      <div className="graph-profile-manager__actions">
        <button type="button" disabled={!canUndoGraphVisualSettings()} onClick={undo}>
          <ArrowUndoRegular />{t("graph.profileManager.action.undo")}
        </button>
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          <ArrowImportRegular />{t("graph.profileManager.action.import")}
        </button>
        <button
          type="button"
          disabled={visibleProfiles.length === 0}
          onClick={exportProfiles}
        >
          <ArrowDownloadRegular />{t("graph.profileManager.action.export")}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={importProfiles}
        />
      </div>

      <p className="graph-profile-manager__status" role="status" aria-live="polite">
        {library.error
          ? t("graph.profileManager.error.library", { message: library.error })
          : message}
      </p>
    </section>
  );
}
