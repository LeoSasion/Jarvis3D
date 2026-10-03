import assert from "node:assert/strict";
import test from "node:test";
import { createAgentContextPrompt } from "../src/agent-context-model.js";
import { boundSavedMessages, createResumePrompt, getNoteSources } from "../src/agent-conversation-library.js";
import { canExportAnswer, createAnswerMarkdown, getAnswerSources, getCitationTargetLine, getUnverifiedCitations, splitAnswerCitations } from "../src/agent-answer-model.js";

const note = (id, text = `Frozen ${id}`, overrides = {}) => ({ id, path: `${id}.md`, name: id,
  excerpt: { text, startLine: 2, endLine: 3, revision: `revision-${id}`, digest: `digest-${id}`, truncated: false }, ...overrides });
const prompt = (...notes) => createAgentContextPrompt("Compare [S1] and [S2]", notes);
const question = (id, runId, ...notes) => ({ id, runId, clientMessageId: `client-${id}`, role: "user", text: prompt(...notes), status: "complete" });
const answer = (id, runId, text = "A claim [S1].") => ({ id, runId, role: "assistant", text, status: "complete" });

test("answer citations bind only to the immediately submitted question and matching run", () => {
  const first = question("q1", "run-1", note("first"));
  const second = question("q2", "run-2", note("second"));
  const messages = [first, answer("a1", "run-1"), second, answer("a2", "run-2"), answer("late", "run-1"),
    { ...question("q3", "run-3"), text: "A follow-up without excerpts" }, answer("a3", "run-3")];
  const sources = getAnswerSources(messages);
  assert.equal(sources.get("a1")[0].text, "Frozen first");
  assert.equal(sources.get("a2")[0].text, "Frozen second");
  assert.deepEqual(sources.get("late"), []);
  assert.deepEqual(sources.get("a3"), []);
  const reusedRun = getAnswerSources([first, answer("a1", "run-1"), { ...second, runId: "run-1" }, answer("a2", "run-1")]);
  assert.equal(reusedRun.get("a2")[0].path, "second.md");
});

test("missing or mismatched run/client identity never borrows another message's sources", () => {
  const q = question("q", "run", note("source"));
  assert.deepEqual(getAnswerSources([answer("orphan", "run"), q]).get("orphan"), []);
  assert.deepEqual(getAnswerSources([{ ...q, runId: null }, answer("a", "run")]).get("a"), []);
  assert.deepEqual(getAnswerSources([q, answer("a", null)]).get("a"), []);
  assert.deepEqual(getAnswerSources([q, { ...answer("a", "run"), clientMessageId: "another-client" }]).get("a"), []);
  assert.equal(getAnswerSources([q, { ...answer("a", "run"), clientMessageId: q.clientMessageId }]).get("a").length, 1);
  assert.deepEqual(getAnswerSources([q, answer("duplicate", "run"), answer("duplicate", "run")]).get("duplicate"), []);
});

test("new saved transcripts preserve source binding while trimmed and legacy history fail closed", () => {
  const messages = [question("q", "run", note("saved")), answer("a", "run")];
  const saved = boundSavedMessages(messages).messages;
  assert.equal(saved[0].clientMessageId, "client-q");
  assert.equal(getAnswerSources(saved).get("a")[0].path, "saved.md");
  assert.deepEqual(getAnswerSources(saved.map(({ runId: _runId, ...message }) => message)).get("a"), []);
  const trimmed = boundSavedMessages([{ ...messages[0], text: "x".repeat(16_000) + messages[0].text }, messages[1]]);
  assert.equal(trimmed.truncated, true);
  assert.equal(trimmed.messages[0].runId, null);
  assert.deepEqual(getAnswerSources(trimmed.messages).get("a"), []);
});

test("source parsing isolates resumed current excerpts from quoted history and legacy wrappers", () => {
  const historical = prompt(note("old"));
  const current = prompt(note("current", "A line containing [USER DIRECTIVE] and [S2]."));
  const resumed = createResumePrompt(current, [{ role: "assistant", text: historical }]);
  assert.equal(getNoteSources(resumed)[0].path, "current.md");
  assert.deepEqual(getNoteSources(createResumePrompt("No excerpts this turn", [{ role: "assistant", text: historical }])), []);
  assert.deepEqual(getNoteSources(`A quotation: ${historical}`), []);
  assert.deepEqual(getNoteSources(`[JARVIS SAVED CONVERSATION]\n\nLegacy discussion\n\n[USER DIRECTIVE]\n\n${current}`), []);
  const escaped = createResumePrompt("Continue", [{ role: "assistant", text: '\\"\n'.repeat(7000) }]);
  assert.ok(escaped.length <= 16_000);
  assert.ok(escaped.split("\n")[2].length <= 8_000);
});

test("malformed, duplicate or missing sources cannot relabel another source", () => {
  const lines = prompt(note("one"), note("two")).split("\n");
  const raw = JSON.parse(lines[3]);
  raw[0].startLine = -1;
  lines[3] = JSON.stringify(raw);
  const remaining = getNoteSources(lines.join("\n"));
  assert.deepEqual(remaining.map((source) => source.source), ["S2"]);
  assert.throws(() => { remaining[0].text = "mutated"; }, TypeError);
  assert.throws(() => remaining.push(raw[0]), TypeError);
  raw[1].source = "S1";
  lines[3] = JSON.stringify(raw);
  assert.deepEqual(getNoteSources(lines.join("\n")), []);
  for (const [field, value] of [["path", "bad\npath"], ["text", "x".repeat(6001)], ["digest", ""], ["revision", null]]) {
    const invalid = prompt(note("one")).split("\n");
    invalid[3] = JSON.stringify([{ ...JSON.parse(invalid[3])[0], [field]: value }]);
    assert.deepEqual(getNoteSources(invalid.join("\n")), []);
  }
});

test("known references are interactive candidates while absent IDs remain unverified text", () => {
  const sources = getNoteSources(prompt(note("one")));
  const text = "Supported [S1]; absent [S2], [S3], [S3], [S0], [S01].";
  const parts = splitAnswerCitations(text, sources);
  assert.equal(parts.map((part) => part.text).join(""), text);
  assert.deepEqual(parts.filter((part) => part.source).map((part) => part.citation), ["S1"]);
  assert.deepEqual(getUnverifiedCitations(parts), ["[S2]", "[S3]", "[S0]", "[S01]"]);
});

test("citation drawer targets absolute cited lines and falls back to the excerpt start", () => {
  const source = { source: "S1", startLine: 40, endLine: 46 };
  for (const [answer, expected] of [
    ["See L43–L44 [S1] for the claim.", 43],
    ["The claim [S1] 第45行 explains it.", 45],
    ["The claim [S1] has no line.", 40],
    ["See L99 [S1].", 40],
  ]) {
    const citation = splitAnswerCitations(answer, [source]).find((part) => part.source);
    assert.equal(getCitationTargetLine(answer, citation, source), expected);
  }
  const answer = "L43 [S1] and L45 [S1]";
  const citations = splitAnswerCitations(answer, [source]).filter((part) => part.source);
  assert.notEqual(citations[0].offset, citations[1].offset);
  assert.deepEqual(citations.map((part) => getCitationTargetLine(answer, part, source)), [43, 45]);
});

test("Markdown export contains this answer and its exact sent snapshots with safe source formatting", () => {
  const body = 'Original snapshot\n```\n<script>not executed</script>\n````';
  const selected = note("snapshot", body, { name: "<b>Snapshot</b>", path: "notes/[snapshot](x).md" });
  selected.excerpt.truncated = true;
  const sources = getNoteSources(prompt(selected));
  const message = answer("answer:/1", "run", "Answer [S1], uncertain [S3].");
  const exported = createAnswerMarkdown(message, sources, {
    title: "Answer", sources: "Shared sources", snapshot: "Frozen at send time", path: "Path", lines: "Lines",
    truncated: "Excerpt truncated", unverified: "Unverified citations:",
  });
  assert.equal(exported.filename, "jarvis-answer-answer--1.md");
  assert.ok(exported.text.includes(message.text));
  assert.ok(exported.text.includes(body));
  assert.ok(exported.text.includes("`````text\n"));
  assert.ok(exported.text.includes("&lt;b&gt;Snapshot&lt;/b&gt;"));
  assert.ok(exported.text.includes("notes/\\[snapshot\\]\\(x\\)\\.md"));
  assert.match(exported.text, /Lines: 2–3/u);
  assert.match(exported.text, /Excerpt truncated/u);
  assert.match(exported.text, /Unverified citations: \[S3\]/u);
  assert.doesNotMatch(exported.text, /revision-|digest-|JARVIS NOTE EXCERPTS/u);
  for (const status of ["streaming", "pending", "error", "aborted"]) {
    assert.equal(canExportAnswer({ ...message, status }), false);
    assert.throws(() => createAnswerMarkdown({ ...message, status }, sources, {}), /ANSWER_NOT_COMPLETE/u);
  }
});
