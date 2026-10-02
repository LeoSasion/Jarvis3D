import { createLocalCommandRequest } from "./local-command-request.js";

export function createLocalConfiguration(fetcher = globalThis.fetch) {
  const request = createLocalCommandRequest("/__jarvis/configuration", "LOCAL_CONFIGURATION_UNAVAILABLE", fetcher);
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
