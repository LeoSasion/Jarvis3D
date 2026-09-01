import assert from "node:assert/strict";
import test from "node:test";
import {
  canReplaceAllConflicts,
  isTransferTerminal,
  normalizeTransferPreflight,
  normalizeTransferSnapshot,
} from "../src/file-transfer-state.js";

test("normalizes PascalCase native preflight and detects self-conflicts", () => {
  const preflight = normalizeTransferPreflight({
    Mode: "copy",
    DestinationPath: "C:\\Work",
    ItemCount: 2,
    CrossesVolumes: false,
    Conflicts: [{
      Source: "C:\\Work\\alpha.txt",
      Target: "C:\\Work\\alpha.txt",
      Name: "alpha.txt",
      SourceIsDirectory: false,
      TargetIsDirectory: false,
    }],
  });

  assert.equal(preflight.conflicts.length, 1);
  assert.equal(preflight.conflicts[0].name, "alpha.txt");
  assert.equal(canReplaceAllConflicts(preflight), false);
});

test("normalizes transfer progress and clamps invalid percentages", () => {
  const transfer = normalizeTransferSnapshot({
    jobId: "job-1",
    mode: "move",
    status: "transferring",
    totalItems: 3,
    completedItems: 1,
    totalBytes: 300,
    bytesTransferred: 120,
    percent: 140,
    result: {
      operation: "move",
      items: [{ source: "C:\\a", target: "D:\\a", name: "a" }],
      failures: [],
      skipped: [{ source: "C:\\b", code: "SKIPPED_CONFLICT", message: "Exists" }],
    },
  });

  assert.equal(transfer.percent, 100);
  assert.equal(transfer.result.items[0].target, "D:\\a");
  assert.equal(transfer.result.skipped[0].code, "SKIPPED_CONFLICT");
  assert.equal(isTransferTerminal(transfer.status), false);
});

test("recognizes terminal transfer states", () => {
  const completed = normalizeTransferSnapshot({
    jobId: "job-2",
    status: "completed",
    completedItems: 4,
    skippedItems: 2,
    result: {},
  });
  assert.equal(isTransferTerminal(completed.status), true);
  assert.equal(isTransferTerminal("cancelled"), true);
  assert.equal(isTransferTerminal("transferring"), false);
});

test("missing Host failure text remains empty for the localized view fallback", () => {
  const transfer = normalizeTransferSnapshot({
    status: "failed",
    result: { failures: [{ code: "TRANSFER_FAILED" }] },
  });

  assert.equal(transfer.result.failures[0].message, null);
});
