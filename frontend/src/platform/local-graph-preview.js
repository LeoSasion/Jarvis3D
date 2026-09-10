export function createLocalGraphPreview(fetchGraph = globalThis.fetch.bind(globalThis)) {
  const request = async (method, params = {}) => {
    const response = await fetchGraph(`/__jarvis/graph/${method}?${new URLSearchParams(params)}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) {
      const error = new Error(translate("graph.source.diagnostic.error.detail"));
      error.code = payload.code ?? "LOCAL_GRAPH_UNAVAILABLE";
      throw error;
    }
    return payload;
  };
  return {
    getDefaultManifest: (params) => request("manifest", params),
    getDefaultChunk: (params) => request("chunk", params),
  };
}
import { translate } from "../i18n/language-system.js";
