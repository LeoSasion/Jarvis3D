import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const terminalSource = await readFile(
  new URL("../src/components/TerminalWorkbench.jsx", import.meta.url),
  "utf8",
);

test("Terminal workbench chrome subscribes to the shared language runtime", () => {
  assert.match(
    terminalSource,
    /import \{ useLanguage \} from "\.\.\/i18n\/language-system\.js"/u,
  );
  assert.match(terminalSource, /const \{ t \} = useLanguage\(\)/u);
  assert.match(terminalSource, /t\("terminal\.accessibility\.window"\)/u);
  assert.match(terminalSource, /t\("terminal\.title"\)/u);
  assert.match(terminalSource, /t\("terminal\.tabs\.aria"\)/u);
  assert.match(terminalSource, /t\("terminal\.action\.newSession"\)/u);
});

test("search, statuses, explanations, errors, and accessibility use semantic keys", () => {
  assert.match(terminalSource, /const terminalStatusKeys = Object\.freeze/u);
  assert.match(terminalSource, /t\("terminal\.search\.placeholder"\)/u);
  assert.match(terminalSource, /t\("terminal\.search\.closeAria"\)/u);
  assert.match(terminalSource, /t\("terminal\.empty\.establishingChannel"\)/u);
  assert.match(terminalSource, /translatorRef\.current\("terminal\.toast\.inputFailed", \{/u);
  assert.match(
    terminalSource,
    /translatorRef\.current\("terminal\.toast\.profilesUnavailable", \{/u,
  );
  assert.match(terminalSource, /t\("terminal\.profile\.unavailable", \{/u);
  assert.match(terminalSource, /t\("terminal\.footer\.searchShortcut", \{/u);
  assert.doesNotMatch(terminalSource, /aria-label="JARVIS Terminal Workbench"/u);
  assert.doesNotMatch(terminalSource, /placeholder="Find in terminal"/u);
  assert.doesNotMatch(terminalSource, /ESTABLISHING CONPTY CHANNEL…/u);
});

test("language changes do not recreate a live ConPTY session", () => {
  assert.match(terminalSource, /const translatorRef = useRef\(t\)/u);
  assert.match(terminalSource, /translatorRef\.current = t/u);
  assert.match(
    terminalSource,
    /\}, \[onSessionState, onToast, tab\.localId, tab\.profileId\]\);/u,
  );
  assert.doesNotMatch(
    terminalSource,
    /\}, \[onSessionState, onToast, t, tab\.localId, tab\.profileId\]\);/u,
  );
  assert.match(terminalSource, /\}, \[onToast, open\]\);/u);
  assert.doesNotMatch(terminalSource, /\}, \[onToast, open, t\]\);/u);
});

test("Terminal protocols, profiles, commands, output, paths, and Host details remain raw", () => {
  assert.match(terminalSource, /<span>\{tab\.label\}<\/span>/u);
  assert.match(terminalSource, /profileId: profile\.id/u);
  assert.match(terminalSource, /defaultProfileId \?\? availableProfiles\[0\]\?\.id \?\? "powershell"/u);
  assert.match(terminalSource, />UTF-8<\/span>/u);
  assert.match(terminalSource, />VT SEQUENCES<\/span>/u);
  assert.match(terminalSource, /shortcut: "CTRL\+F"/u);
  assert.match(terminalSource, /JARVIS TERMINAL LINK FAILED/u);
  assert.match(terminalSource, /\[process exited/u);
  assert.match(terminalSource, /message: error\.message/u);
  assert.match(terminalSource, /profile: tab\.label/u);
});
