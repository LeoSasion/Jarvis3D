// Keep only locally edited leaves when rebasing onto a newer on-disk revision.
// Opening an old browser must never turn its cached full snapshot into a write.
function changes(before, after, path = [], result = []) {
  for (const key of Object.keys(after)) {
    const next = after[key];
    const previous = before?.[key];
    if (next && typeof next === "object" && !Array.isArray(next)) changes(previous, next, [...path, key], result);
    else if (JSON.stringify(previous) !== JSON.stringify(next)) result.push({ path: [...path, key], value: next });
  }
  return result;
}

function overlay(base, pending) {
  const result = structuredClone(base);
  for (const { path, value } of pending.values()) {
    let target = result;
    for (const key of path.slice(0, -1)) target = target[key] ??= {};
    target[path.at(-1)] = value;
  }
  return result;
}

export function createGraphSettingsFileSync({ api, initial, normalize, onValue, onStatus, select = (value) => value }) {
  let base = select(initial);
  let presented = select(initial);
  let revision;
  let sequence = 0;
  let active = null;
  let disposed = false;
  const pending = new Map();
  const status = (state, error = null) => { if (!disposed) onStatus(state, error); };

  const validate = (snapshot) => {
    if (!snapshot || typeof snapshot.revision !== "string" || snapshot.settings?.version !== 7)
      throw new Error("INVALID_LOCAL_SETTINGS");
  };

  const adopt = (snapshot, remote) => {
    validate(snapshot);
    const changedRevision = snapshot.revision !== revision;
    revision = snapshot.revision;
    base = select(normalize(snapshot.settings));
    const next = normalize(overlay(base, pending));
    presented = select(next);
    if (!disposed) onValue(next, remote && changedRevision);
  };

  const run = async (read) => {
    try {
      if (read || revision === undefined) {
        let snapshot = await api.read();
        if (disposed) return;
        if (snapshot?.settings === null && snapshot.revision === null) {
          // Only an absent file can import the opening browser's existing profile.
          snapshot = await api.write({ revision: null, settings: initial });
        }
        if (disposed) return;
        adopt(snapshot, true);
      }
      for (let attempt = 0; pending.size && attempt < 8 && !disposed; attempt++) {
        const sent = new Map(pending);
        const settings = normalize(overlay(base, sent));
        const saved = await api.write({ revision, settings });
        if (disposed) return;
        validate(saved);
        if (!saved.conflict) {
          for (const [key, change] of sent) {
            if (pending.get(key)?.sequence === change.sequence) pending.delete(key);
          }
        }
        adopt(saved, Boolean(saved.conflict));
      }
      status(pending.size ? "saving" : "saved");
    } catch (error) {
      // Preserve unsaved edits and the file. Retry on the next refresh/focus.
      status("error", String(error?.message ?? error));
    }
  };

  const synchronize = (read) => {
    if (disposed) return Promise.resolve();
    if (!active) active = run(read).finally(() => { active = null; });
    return active;
  };

  return {
    edit(next) {
      const selected = select(next);
      for (const change of changes(presented, selected)) {
        pending.set(JSON.stringify(change.path), { ...change, sequence: ++sequence });
      }
      presented = selected;
      if (pending.size) status("saving");
    },
    refresh: () => synchronize(true),
    flush: () => synchronize(false),
    dispose() { disposed = true; },
  };
}
