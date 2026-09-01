import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const agentSource = readFileSync(
  new URL("../src/components/AgentConversationWindow.jsx", import.meta.url),
  "utf8",
);

test("Agent transcript keeps a controlled log and linked relation anchors", () => {
  assert.match(agentSource, /className="agent-transcript"\s+role="log"\s+aria-live="off"/u);
  assert.match(agentSource, /data-linked-scroll-viewport="agent"/u);
  assert.match(agentSource, /data-agent-relation-target=\{linkedContext\?\.relationId\}/u);
  assert.match(agentSource, /role="status" aria-live="polite" aria-atomic="true"/u);
});

test("Agent messages use avatar, bubble, and metadata footer anatomy", () => {
  assert.match(agentSource, /className="agent-message__avatar"/u);
  assert.match(agentSource, /className="agent-message__group"/u);
  assert.match(agentSource, /className="agent-message__bubble"/u);
  assert.match(agentSource, /<footer className="agent-message__meta">/u);
});

test("linked context belongs to the compact one-row composer", () => {
  const transcriptStart = agentSource.indexOf('className="agent-transcript"');
  const composerStart = agentSource.indexOf('<form className="agent-composer"');
  const linkedContextUse = agentSource.indexOf("<LinkedContextEvent", transcriptStart);

  assert.ok(transcriptStart >= 0);
  assert.ok(composerStart > transcriptStart);
  assert.ok(linkedContextUse > composerStart);
  assert.match(agentSource, /className="agent-composer__attachments"/u);
  assert.match(agentSource, /className="agent-composer__input-row"/u);
  assert.match(agentSource, /rows=\{1\}/u);
});
