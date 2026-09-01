import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../i18n/language-system.js";

export function DesktopOperationDialog({
  confirmLabel,
  danger = false,
  description,
  initialValue = "",
  inputLabel,
  onCancel,
  onConfirm,
  title,
}) {
  const { t } = useLanguage();
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    const normalized = inputLabel ? value.trim() : value;
    if (inputLabel && !normalized) {
      setError(t("desktop.operation.error.nameRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(normalized);
    } catch (nextError) {
      setError(nextError?.message ?? t("desktop.operation.error.failed"));
      setBusy(false);
    }
  };

  return (
    <div className="desktop-operation-backdrop" role="presentation" onMouseDown={onCancel}>
      <form
        className="desktop-operation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-operation-title"
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <span>{t("desktop.operation.eyebrow")}</span>
          <strong id="desktop-operation-title">{title}</strong>
        </header>
        {description ? <p>{description}</p> : null}
        {inputLabel ? (
          <label>
            <span>{inputLabel}</span>
            <input
              ref={inputRef}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              disabled={busy}
              maxLength={255}
            />
          </label>
        ) : null}
        {error ? <div className="desktop-operation-error" role="alert">{error}</div> : null}
        <footer>
          <button type="button" onClick={onCancel} disabled={busy}>
            {t("common.action.cancel")}
          </button>
          <button className={danger ? "is-danger" : "is-primary"} type="submit" disabled={busy}>
            {busy
              ? t("desktop.operation.status.working")
              : confirmLabel ?? t("desktop.operation.action.confirm")}
          </button>
        </footer>
      </form>
    </div>
  );
}
