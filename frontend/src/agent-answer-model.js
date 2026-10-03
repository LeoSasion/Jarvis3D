import { getNoteSources } from "./agent-conversation-library.js";

const EMPTY_SOURCES = Object.freeze([]);

export function getAnswerSources(messages) {
  const answers = new Map();
  let question = null;
  let sources = EMPTY_SOURCES;
  for (const message of messages) {
    if (message.role === "user") {
      question = message;
      sources = getNoteSources(message.text);
    } else if (message.role === "assistant") {
      const sameRun = typeof message.runId === "string" && message.runId.length > 0 && message.runId.length <= 160
        && !/[\x00-\x1f\x7f]/u.test(message.runId)
        && message.runId === question?.runId;
      const sameClient = !message.clientMessageId
        || message.clientMessageId === question?.clientMessageId;
      // Duplicate identities are ambiguous even when their run IDs happen to match.
      answers.set(message.id, !answers.has(message.id) && sameRun && sameClient ? sources : EMPTY_SOURCES);
    }
  }
  return answers;
}

export function splitAnswerCitations(text, sources = EMPTY_SOURCES) {
  const value = String(text ?? "");
  const sourceById = new Map(sources.map((source) => [source.source, source]));
  const parts = [];
  let offset = 0;
  for (const match of value.matchAll(/\[S\d+\]/gu)) {
    if (match.index > offset) parts.push({ text: value.slice(offset, match.index) });
    const citation = match[0].slice(1, -1);
    parts.push({ text: match[0], citation, source: sourceById.get(citation) ?? null,
      offset: match.index });
    offset = match.index + match[0].length;
  }
  if (offset < value.length) parts.push({ text: value.slice(offset) });
  return parts;
}

export function getUnverifiedCitations(parts) {
  return [...new Set(parts.filter((part) => part.citation && !part.source).map((part) => part.text))];
}

export function getCitationTargetLine(answer, citation, source) {
  const first = source.startLine;
  const last = Math.min(source.endLine, first + (typeof source.text === "string"
    ? source.text.split(/\r?\n/u).length - 1 : source.endLine - first));
  if (!Number.isInteger(first) || !Number.isInteger(last)) return null;
  const text = String(answer ?? "");
  const offset = citation?.offset;
  if (!Number.isInteger(offset)) return first;
  const before = text.slice(Math.max(0, offset - 48), offset).split(/[.!?。！？\n]/u).at(-1);
  const after = text.slice(offset + citation.text.length, offset + citation.text.length + 48)
    .split(/[.!?。！？\n]/u)[0];
  const linePattern = /(?:\bL(?:ine)?\s*|第\s*)(\d+)(?:\s*行)?/giu;
  const precedingLines = [...before.matchAll(linePattern)];
  let preceding = precedingLines.at(-1);
  const previous = precedingLines.at(-2);
  if (previous && preceding
    && /^[\s\-–—~至到]+$/u.test(before.slice(previous.index + previous[0].length, preceding.index))) {
    preceding = previous;
  }
  const following = [...after.matchAll(linePattern)][0];
  const line = Number(preceding?.[1] ?? following?.[1]);
  return Number.isInteger(line) && line >= first && line <= last ? line : first;
}

export function canExportAnswer(message) {
  return message?.role === "assistant" && ["complete", "completed"].includes(message.status)
    && typeof message.text === "string" && message.text.trim().length > 0;
}

function markdownText(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replace(/([\\`*_{}[\]()#+.!|~-])/gu, "\\$1");
}

function quotedSnapshot(text) {
  const fence = "`".repeat(Math.max(3, ...[...text.matchAll(/`+/gu)].map((match) => match[0].length + 1)));
  return `${fence}text\n${text}\n${fence}`;
}

export function createAnswerMarkdown(message, sources, labels) {
  if (!canExportAnswer(message)) throw new Error("ANSWER_NOT_COMPLETE");
  const unverified = getUnverifiedCitations(splitAnswerCitations(message.text, sources));
  const sections = [`# ${markdownText(labels.title)}`, message.text];
  if (unverified.length) sections.push(`${markdownText(labels.unverified)} ${unverified.join(", ")}`);
  if (sources.length) {
    sections.push(`## ${markdownText(labels.sources)}`, markdownText(labels.snapshot));
    for (const source of sources) {
      sections.push(`### [${source.source}] ${markdownText(source.title)}`,
        `${markdownText(labels.path)}: ${markdownText(source.path)}  \n${markdownText(labels.lines)}: ${source.startLine}–${source.endLine}`,
        ...(source.truncated ? [markdownText(labels.truncated)] : []), quotedSnapshot(source.text));
    }
  }
  return { filename: `jarvis-answer-${String(message.id).replace(/[^a-zA-Z0-9_-]/gu, "-").slice(0, 64) || "export"}.md`,
    text: `${sections.join("\n\n")}\n` };
}
