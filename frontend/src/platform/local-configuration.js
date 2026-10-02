export function createLocalConfiguration(fetcher = globalThis.fetch) {
  const request = async (method, params = {}) => {
    const response = await fetcher("/__jarvis/configuration", {
      method: "POST", cache: "no-store", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method, ...params }),
      signal: AbortSignal.timeout(35_000),
    });
    if (!response.ok) throw new Error("LOCAL_CONFIGURATION_UNAVAILABLE");
    return response.json();
  };
  return {
    read: () => request("configuration.read"),
    write: (params) => request("configuration.write", params),
    listSnapshots: () => request("configuration.snapshots.list"),
    createSnapshot: (params) => request("configuration.snapshots.create", params),
    readSnapshot: (params) => request("configuration.snapshots.read", params),
    deleteSnapshot: (params) => request("configuration.snapshots.delete", params),
    restoreSnapshot: (params) => request("configuration.snapshots.restore", params),
  };
}
