export function createLocalCommandRequest(endpoint, errorMessage, fetcher) {
  return async (method, params = {}) => {
    const response = await fetcher(endpoint, {
      method: "POST", cache: "no-store", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method, ...params }),
      signal: AbortSignal.timeout(35_000),
    });
    if (!response.ok) throw new Error(errorMessage);
    return response.json();
  };
}
