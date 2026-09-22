export function createLocalVisualSettings(fetcher = globalThis.fetch) {
  const send = async (params) => {
    const response = await fetcher("/__jarvis/visual-settings", {
      method: params ? "PUT" : "GET",
      cache: "no-store",
      credentials: "same-origin",
      ...(params ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(params), keepalive: true } : {}),
      signal: AbortSignal.timeout(35_000),
    });
    if (!response.ok) throw new Error("LOCAL_SETTINGS_UNAVAILABLE");
    return response.json();
  };
  return { read: () => send(), write: (params) => send(params) };
}
