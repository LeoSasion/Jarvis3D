import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const agentSource = await readFile(
  new URL("../src/components/AgentConversationWindow.jsx", import.meta.url),
  "utf8",
);

test("Agent conversation chrome subscribes to the shared language runtime", () => {
  assert.match(
    agentSource,
    /import \{ useLanguage \} from "\.\.\/i18n\/language-system\.js"/u,
  );
  assert.match(agentSource, /const \{ language, t \} = useLanguage\(\)/u);
  assert.match(agentSource, /t\("agent\.accessibility\.window"\)/u);
  assert.match(agentSource, /t\("agent\.accessibility\.transcript"\)/u);
  assert.match(agentSource, /t\("agent\.announcement\.responseComplete"\)/u);
});

test("Agent controls, composer, status, errors, and linked context use semantic keys", () => {
  assert.match(agentSource, /const STATUS_COPY_KEYS = Object\.freeze/u);
  assert.match(agentSource, /const ERROR_COPY_KEYS = Object\.freeze/u);
  assert.match(agentSource, /const LINKED_FLOW_COPY_KEYS = Object\.freeze/u);
  assert.match(agentSource, /t\("agent\.action\.newSession\.aria"\)/u);
  assert.match(agentSource, /t\("agent\.composer\.placeholder\.ready"\)/u);
  assert.match(agentSource, /t\("agent\.composer\.action\.send\.label"\)/u);
  assert.match(agentSource, /t\("agent\.context\.selection\.metadataExplanation"\)/u);
  assert.match(agentSource, /t\("agent\.empty\.connected\.detail"\)/u);
  assert.match(agentSource, /t\("agent\.history\.currentChatAvailable"\)/u);
  assert.doesNotMatch(
    agentSource,
    /aria-label="(?:Start new Agent session|Minimize Agent|Close Agent|Agent transcript)"/u,
  );
  assert.doesNotMatch(
    agentSource,
    /Agent response in progress…|Ask the Agent…|Connect a supported provider to enable Agent chat/u,
  );
});

test("Agent messages and live platform details remain raw while time follows the UI locale", () => {
  assert.match(agentSource, /<p>\{messageDisplayText\(message\)\}<\/p>/u);
  assert.match(
    agentSource,
    /<span>\{state\.error\.message \|\| t\("agent\.error\.requestFailed"\)\}<\/span>/u,
  );
  assert.match(
    agentSource,
    /historyError === AGENT_HISTORY_UNAVAILABLE[\s\S]*t\("agent\.history\.temporarilyUnavailable"\)[\s\S]*: historyError/u,
  );
  assert.match(agentSource, /<span>\{historyErrorText\}<\/span>/u);
  assert.match(agentSource, /provider: providerLabel/u);
  assert.match(agentSource, /state\?\.model \|\| t\("agent\.connection\.modelPending"\)/u);
  assert.match(agentSource, /formatTime\(date, language\)/u);
  assert.doesNotMatch(agentSource, /toLocaleTimeString/u);
  assert.match(agentSource, />JARVIS Agent<\/strong>/u);
  assert.match(agentSource, /\[JARVIS FILE CONTEXT — METADATA ONLY\]/u);
});
