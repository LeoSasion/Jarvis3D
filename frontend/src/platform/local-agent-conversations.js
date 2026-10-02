import { createLocalCommandRequest } from "./local-command-request.js";

export function createLocalAgentConversations(fetcher = globalThis.fetch) {
  const request = createLocalCommandRequest("/__jarvis/agent-conversations", "LOCAL_CONVERSATIONS_UNAVAILABLE", fetcher);
  return {
    list: () => request("agentConversations.list"),
    read: (conversationId) => request("agentConversations.read", { conversationId }),
    save: (conversation) => request("agentConversations.save", { conversation }),
    rename: (conversationId, title) => request("agentConversations.rename", { conversationId, title }),
    delete: (conversationId) => request("agentConversations.delete", { conversationId }),
  };
}
