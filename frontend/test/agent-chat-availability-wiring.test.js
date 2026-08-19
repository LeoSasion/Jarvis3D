import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const agentSource = readFileSync(
  new URL("../src/components/AgentConversationWindow.jsx", import.meta.url),
  "utf8",
);
const explorerSource = readFileSync(
  new URL("../src/components/FileExplorerWindow.jsx", import.meta.url),
  "utf8",
);

test("all Agent-link entry points use the shared chat availability gate", () => {
  assert.match(appSource, /const agentChatAvailable = canUseAgentChat\(agentSession\.state\)/u);
  assert.equal(appSource.match(/if \(!agentChatAvailable\)/gu)?.length, 2);
  assert.match(appSource, /canUseAgentChat=\{agentChatAvailable\}/u);
  assert.match(agentSource, /const supportsChat = canUseAgentChat\(state\)/u);
  assert.match(explorerSource, /disabled=\{!canUseAgentChat\}/u);
  assert.match(
    explorerSource,
    /disabled=\{!canUseAgentChat \|\| agentContextSelection\.length === 0\}/u,
  );
});
