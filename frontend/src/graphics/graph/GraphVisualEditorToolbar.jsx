import { useEffect, useSyncExternalStore } from "react";
import { useLanguage } from "../../i18n/language-system.js";
import { GRAPH_EDITOR_COPY } from "./graph-visual-editor-model.js";
import {
  captureGraphVisualReference, endGraphVisualPreview, getGraphVisualPreviewSnapshot,
  selectGraphVisualPreview, setGraphVisualPreviewFrozen, subscribeGraphVisualPreview,
} from "./graph-visual-preview.js";

export function GraphVisualEditorToolbar({ settings, query, onQuery, changedOnly, onChangedOnly }) {
  const { language } = useLanguage();
  const copy = GRAPH_EDITOR_COPY[language] ?? GRAPH_EDITOR_COPY["en-US"];
  const preview = useSyncExternalStore(subscribeGraphVisualPreview, getGraphVisualPreviewSnapshot);
  useEffect(() => () => endGraphVisualPreview(), []);
  return <div className="graph-visual-settings__editor-tools">
    <input type="search" aria-label={copy.search} placeholder={copy.search} value={query} onChange={(event) => onQuery(event.target.value)} />
    <label><input type="checkbox" checked={changedOnly} onChange={(event) => onChangedOnly(event.target.checked)} />{copy.changed}</label>
    <details className="graph-visual-settings__comparison">
      <summary>A / B</summary>
      <div className="graph-visual-settings__comparison-actions">
        <button type="button" onClick={() => captureGraphVisualReference(settings)}>{copy[preview.reference ? "recapture" : "capture"]}</button>
        {preview.reference && <>
          <button type="button" aria-pressed={preview.side === "a"} onClick={() => selectGraphVisualPreview("a")}>{copy.a}</button>
          <button type="button" aria-pressed={preview.side === "b"} onClick={() => selectGraphVisualPreview("b")}>{copy.b}</button>
          <button type="button" onClick={endGraphVisualPreview}>{copy.end}</button>
        </>}
      </div>
      <label><input type="checkbox" checked={preview.frozen} onChange={(event) => setGraphVisualPreviewFrozen(event.target.checked)} />{copy.freeze}</label>
      <p aria-live="polite">{preview.side === "a" ? copy.reference : preview.frozen ? copy.frozen : copy.comparing}</p>
    </details>
  </div>;
}
