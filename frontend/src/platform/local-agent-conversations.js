export function createLocalAgentConversations(fetcher = globalThis.fetch) {
  const request = async (method, params = {}) => {
    const response = await fetcher("/__jarvis/agent-conversations", {
      method: "POST", cache: "no-store", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method, ...params }),
      signal: AbortSignal.timeout(35_000),
    });
    if (!response.ok) throw new Error("LOCAL_CONVERSATIONS_UNAVAILABLE");
    return response.json();
  };
  return {
    list: () => request("agentConversations.list"),
    read: (conversationId) => request("agentConversations.read", { conversationId }),
    save: (conversation) => request("agentConversations.save", { conversation }),
    rename: (conversationId, title) => request("agentConversations.rename", { conversationId, title }),
    delete: (conversationId) => request("agentConversations.delete", { conversationId }),
  };
}
