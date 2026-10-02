import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { useLanguage } from "../i18n/language-system.js";
import { platform } from "../platform/index.js";
import { getGraphVisualSettingsPersistenceState, subscribeGraphVisualSettings } from "../graphics/graph/graph-visual-settings.js";
import {
  createConfigurationDiagnostic, createConfigurationSnapshot, deleteConfigurationSnapshot,
  frontendBuild, getWorkspaceConfigurationSnapshot, listConfigurationSnapshots,
  restoreConfigurationSnapshot, retryWorkspaceConfiguration, subscribeWorkspaceConfiguration,
} from "./workspace-configuration.js";
import "./configuration-settings.css";

export function ConfigurationSettingsPanel() {
  const { language } = useLanguage();
  const zh = language === "zh-CN";
  const text = (en, cn) => zh ? cn : en;
  const id = useId();
  const configuration = useSyncExternalStore(subscribeWorkspaceConfiguration, getWorkspaceConfigurationSnapshot);
  const graphState = useSyncExternalStore(subscribeGraphVisualSettings, getGraphVisualSettingsPersistenceState);
  const [snapshots, setSnapshots] = useState([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [restoreId, setRestoreId] = useState(null);
  const [runtime, setRuntime] = useState(null);
  useEffect(() => {
    let active = true;
    const refreshSnapshots = () => {
      if (document.visibilityState === "hidden") return;
      listConfigurationSnapshots().then((items) => { if (active) setSnapshots(items); })
        .catch(() => { if (active) setMessage(zh ? "无法读取本地快照列表，原有文件未被更改。" : "Could not read local snapshots. Existing files are unchanged."); });
    };
    refreshSnapshots();
    window.addEventListener("focus", refreshSnapshots);
    document.addEventListener("visibilitychange", refreshSnapshots);
    platform.lifecycle?.getRuntimeInfo().then((value) => { if (active) setRuntime(value); }).catch(() => {});
    return () => { active = false; window.removeEventListener("focus", refreshSnapshots); document.removeEventListener("visibilitychange", refreshSnapshots); };
  }, [zh]);
  const run = async (action, success) => {
    setBusy(true); setMessage("");
    try { await action(); setSnapshots(await listConfigurationSnapshots()); setMessage(success); }
    catch (error) { setMessage(error?.message === "CONFIGURATION_CHANGED_BEFORE_RESTORE"
      ? text("Another window changed the configuration. Restore was not applied; review the refreshed settings and retry.", "其他窗口已更新配置，本次恢复未执行。请检查刷新后的配置再重试。")
      : text("Could not complete this action. Unsaved edits are retained; retry after checking local storage.", "操作未完成。未保存的编辑仍保留，请检查本地存储后重试。")); }
    finally { setBusy(false); }
  };
  const states = {
    browser: text("Browser storage only", "仅浏览器存储"), loading: text("Reading local file…", "正在读取本地文件…"),
    saving: text("Saving…", "正在保存…"), saved: text("Saved locally", "已保存到本地"),
    error: text("Not saved — retry", "尚未保存 · 请重试"),
  };
  const available = Boolean(platform.configuration);
  const savedAt = configuration.savedAtUtc ? new Date(configuration.savedAtUtc).toLocaleString(language) : "—";
  return <section className="configuration-settings" aria-labelledby={id}>
    <header><strong id={id}>{text("Local configuration & recovery", "本地配置与恢复")}</strong>
      <span role="status">{states[configuration.status]}</span></header>
    <p>{text("Theme, custom colors, interface, language, audio, screen effects and named graph presets share one local file. Active graph effects use their own synchronized file.", "主题、自定义颜色、界面、语言、音效、屏幕特效和命名图谱预设共用本地文件；当前图谱特效使用独立同步文件。")}</p>
    <dl>
      <div><dt>{text("Source", "来源")}</dt><dd>{available ? "%LOCALAPPDATA%\\JARVIS\\Settings" : text("This browser", "当前浏览器")}</dd></div>
      <div><dt>{text("Preferences", "界面配置")}</dt><dd><code>{configuration.revision?.slice(0, 12) ?? "—"}</code> · {savedAt}</dd></div>
      <div><dt>{text("Graph", "图谱配置")}</dt><dd><code>{configuration.graph?.revision?.slice(0, 12) ?? "—"}</code> · {states[graphState] ?? graphState}{configuration.graph?.savedAtUtc ? ` · ${new Date(configuration.graph.savedAtUtc).toLocaleString(language)}` : ""}</dd></div>
      <div><dt>{text("Frontend build", "前端构建")}</dt><dd><code>{frontendBuild.revision.slice(0, 12)}</code>{frontendBuild.dirty ? text(" · working changes", " · 含未提交更改") : ""}</dd></div>
      <div><dt>Host</dt><dd>{platform.kind === "windows" ? runtime?.version ?? "…" : text("Browser preview", "浏览器预览")}</dd></div>
    </dl>
    <div className="configuration-settings__actions">
      <button type="button" disabled={busy || !available} onClick={() => run(retryWorkspaceConfiguration, text("Local configuration refreshed.", "已刷新本地配置。"))}>{text("Retry / refresh", "重试 / 刷新")}</button>
      <button type="button" disabled={busy} onClick={() => run(() => navigator.clipboard.writeText(JSON.stringify(createConfigurationDiagnostic({ runtime, kind: platform.kind }), null, 2)), text("Diagnostic copied without usernames, paths, vault names or settings values.", "已复制诊断，不含用户名、绝对路径、库名或配置值。"))}>{text("Copy diagnostic", "复制脱敏诊断")}</button>
    </div>
    <form onSubmit={(event) => { event.preventDefault(); void run(async () => { await createConfigurationSnapshot(name); setName(""); }, text("Snapshot saved locally.", "快照已保存到本地。")); }}>
      <label htmlFor={`${id}-name`}>{text("Configuration snapshot", "完整配置快照")}</label>
      <div className="configuration-settings__actions"><input id={`${id}-name`} maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder={text("Name this configuration", "为当前配置命名")} />
        <button type="submit" disabled={!available || busy || !name.trim() || snapshots.length >= 8}>{text("Save snapshot", "保存快照")}</button></div>
    </form>
    <small>{text("Up to 8 snapshots. Restore first saves the current configuration, so keep one free slot. Active graph settings and all preferences are included.", "最多 8 份。恢复前会先备份当前配置，请保留一个空位。快照包含当前图谱参数及全部上述偏好。")}</small>
    {snapshots.length > 0 && <ul>{snapshots.map((snapshot) => <li key={snapshot.id}>
      <span><strong>{snapshot.isDamaged ? text("Damaged snapshot", "损坏的快照") : snapshot.label}</strong><small>{snapshot.isDamaged ? text("Cannot restore. Delete to free a snapshot slot.", "无法恢复，可删除以释放快照空位。") : new Date(snapshot.createdAtUtc).toLocaleString(language)}</small></span>
      <button type="button" disabled={busy || snapshot.isDamaged || snapshots.length >= 8} onClick={() => setRestoreId(snapshot.id)}>{text("Restore", "恢复")}</button>
      <button type="button" disabled={busy} aria-label={`${text("Delete snapshot", "删除快照")} ${snapshot.isDamaged ? snapshot.id : snapshot.label}`} onClick={() => run(() => deleteConfigurationSnapshot(snapshot.id), text("Snapshot deleted.", "快照已删除。"))}>{text("Delete", "删除")}</button>
    </li>)}</ul>}
    {restoreId && <div className="configuration-settings__confirm" role="group" aria-label={text("Confirm restore", "确认恢复")}>
      <p>{text("Restore graph effects, presets and interface preferences? Your current configuration will be saved as a new snapshot first.", "恢复图谱特效、预设库和界面偏好？将先保存当前配置为新快照。")}</p>
      <button type="button" disabled={busy} onClick={() => run(async () => { await restoreConfigurationSnapshot(restoreId); setRestoreId(null); }, text("Configuration restored and saved locally.", "配置已恢复并保存到本地。"))}>{text("Confirm restore", "确认恢复")}</button>
      <button type="button" disabled={busy} onClick={() => setRestoreId(null)}>{text("Cancel", "取消")}</button>
    </div>}
    <p role="status" aria-live="polite">{message}</p>
  </section>;
}
