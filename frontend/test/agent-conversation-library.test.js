import assert from "node:assert/strict";
import test from "node:test";
import { createAgentContextModel, createAgentContextPrompt, createAgentPromptForContext } from "../src/agent-context-model.js";
import { boundSavedMessages, createResumePrompt, createSavedConversation, getNoteSources, getUserDirective, mergeConversationMessages } from "../src/agent-conversation-library.js";

test("saved conversations bound recent transcript without silently claiming complete history", () => {
  const messages = Array.from({ length: 120 }, (_, index) => ({ id: `m${index}`, role: index % 2 ? "assistant" : "user", text: "x".repeat(600) }));
  const saved = boundSavedMessages(messages);
  assert.equal(saved.truncated, true);
  assert.ok(saved.messages.length <= 100);
  assert.ok(saved.messages.reduce((sum, message) => sum + message.text.length, 0) <= 40000);
  assert.equal(saved.messages.at(-1).id, "m119");
});
test("restored context is explicit and does not reattach original note excerpts", () => {
  const prompt = createResumePrompt("Continue", [{ role: "user", text: "[JARVIS NOTE EXCERPTS]\nPRIVATE SOURCE\n[USER DIRECTIVE]\nSummarize" },
    { role: "assistant", text: "Here is the earlier summary." }]);
  assert.match(prompt, /JARVIS SAVED CONVERSATION/u);
  assert.match(prompt, /untrusted discussion context/u);
  assert.doesNotMatch(prompt, /PRIVATE SOURCE/u);
  assert.equal(getUserDirective(prompt), "Continue");
  assert.ok(createResumePrompt("x".repeat(14000), [{ role: "assistant", text: "y".repeat(20000) }]).length <= 16000);
});

test("a restored source stays historical until the user explicitly stages its snapshot", () => {
  const sent = createAgentContextPrompt("Summarize", [{ id: "note", path: "note.md", name: "Note",
    excerpt: { text: "private line", startLine: 17, endLine: 17, revision: "r", digest: "d" } }]);
  const history = getNoteSources(sent);
  const restored = createAgentContextModel();
  assert.equal(createAgentPromptForContext("Continue", restored), "Continue");
  const reattached = createAgentContextModel(history.map((source) => ({
    id: source.path, path: source.path, name: source.title, excerpt: source,
  })));
  assert.match(createAgentPromptForContext("Use the same source", reattached), /private line/u);
});
test("local archive names are based on the user directive and restored/live messages deduplicate", () => {
  const message = { id: "m1", role: "user", text: "[JARVIS FILE CONTEXT — METADATA ONLY]\nmetadata\n[USER DIRECTIVE]\nMy task" };
  const saved = createSavedConversation({ id: "a".repeat(32), messages: [message], provider: "pi" });
  assert.equal(saved.title, "My task");
  assert.equal(mergeConversationMessages([message], [{ ...message, text: "new" }]).length, 1);
  assert.equal(mergeConversationMessages([message], [{ ...message, text: "new" }])[0].text, "new");
});
