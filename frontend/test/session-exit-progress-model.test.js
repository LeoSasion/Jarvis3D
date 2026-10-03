import assert from "node:assert/strict";
import test from "node:test";
import { getSessionExitProgress } from "../src/session-exit-progress-model.js";
import { translate } from "../src/i18n/language-system.js";

test("safe exit does not claim taskbar verification until the Host confirms it", () => {
  assert.equal(getSessionExitProgress("idle", false), null);
  assert.equal(getSessionExitProgress("requested", false).verificationKey, "session.exit.verificationPending");
  assert.equal(getSessionExitProgress("restoring", false).verificationKey, "session.exit.verificationRetrying");
  assert.equal(getSessionExitProgress("verified", false).phase, "restoring");
  assert.equal(getSessionExitProgress("verified", true).verificationKey, "session.exit.verificationVerified");
});

test("every exit-progress state has readable English and Chinese next-step copy", () => {
  for (const phase of ["requested", "restoring", "verified"]) {
    const status = getSessionExitProgress(phase, phase === "verified");
    for (const language of ["en-US", "zh-CN"]) {
      for (const key of [status.titleKey, status.detailKey, status.verificationKey]) {
        assert.notEqual(translate(key, {}, language), key);
      }
    }
  }
});
