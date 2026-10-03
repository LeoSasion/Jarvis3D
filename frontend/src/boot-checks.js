import { platform } from "./platform/index.js";

export const bootCheckDefinitions = Object.freeze([
  Object.freeze({
    id: "runtime",
    index: "01",
    labelKey: "boot.check.runtime.label",
    detailKey: "boot.check.runtime.detail",
    run: () => platform.lifecycle.getRuntimeInfo(),
    validate: (result) => Boolean(result?.recoveryReady),
  }),
  Object.freeze({
    id: "telemetry",
    index: "02",
    labelKey: "boot.check.telemetry.label",
    detailKey: "boot.check.telemetry.detail",
    run: () => platform.system.getSnapshot(),
    validate: (result) => Boolean(result?.cpu ?? result?.Cpu),
  }),
  Object.freeze({
    id: "windows",
    index: "03",
    labelKey: "boot.check.windowChannel.label",
    detailKey: "boot.check.windowChannel.detail",
    run: () => platform.taskbar.getSnapshot(),
    validate: (result) => Array.isArray(result?.windows ?? result?.Windows),
  }),
  Object.freeze({
    id: "terminal",
    index: "04",
    labelKey: "boot.check.conpty.label",
    detailKey: "boot.check.conpty.detail",
    run: () => platform.terminal.listProfiles(),
    validate: (result) => Boolean(result?.conPtyAvailable),
  }),
]);

let sharedChecks = null;

export function getBootChecks() {
  if (!sharedChecks) {
    sharedChecks = bootCheckDefinitions.map((definition) => ({
      ...definition,
      promise: Promise.resolve().then(definition.run),
    }));
  }
  return sharedChecks;
}

export function getDegradedBootCheckIds(checks, settledResults, isNative) {
  if (!isNative) return [];
  return checks.filter((check, index) =>
    settledResults[index]?.status !== "fulfilled"
    || !check.validate(settledResults[index].value)).map((check) => check.id);
}
