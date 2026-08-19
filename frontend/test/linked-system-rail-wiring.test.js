import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const railSource = readFileSync(
  new URL("../src/components/LinkedSystemRail.jsx", import.meta.url),
  "utf8",
);

test("status-only providers are described truthfully in the linked system rail", () => {
  assert.match(railSource, /getLinkedAgentStatusPresentation\(agentState, agentChatAvailable\)/u);
  assert.match(railSource, /agentStatus\.commandBusLabel/u);
  assert.match(railSource, /agentStatus\.dataAccessLabel/u);
  assert.doesNotMatch(railSource, /agentChatAvailable \? "READY" : "CHAT UNAVAILABLE"/u);
});

test("rail failures without an action render as status text instead of disabled buttons", () => {
  assert.match(railSource, /\{notificationItem \? \(\s*<button/su);
  assert.match(railSource, /\) : \(\s*<p className="linked-system-rail-priority" role="status">/su);
  assert.doesNotMatch(railSource, /disabled=\{!notificationItem\}/u);
});
