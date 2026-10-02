# Native failures and release candidate — 2026-10-02

Validation was performed on the available Windows 11 desktop, build 26200.
The primary monitor measured 2560 × 1440. This record does not certify the
unavailable Windows 10 or multi-monitor hardware matrix.

## Isolated native checks

Native lifecycle checks now launch the real Host with a generated
`--native-validation-data-root=` under the dedicated system temporary directory.
The Host rejects production roots, roots outside that parent, invalid run IDs,
and existing reparse points. Settings, startup health, appearance recovery,
logs, WebView2 data, Agent state, and the synthetic Vault share this isolated
root. A taskbar watchdog receives the same root. Renderer smoke also directs
all of these services to its existing isolated root.

Validation launchers and direct validation CLI modes remove inherited frontend,
external Pi, diagnostic-window, and `WEBVIEW2_*` overrides, then set the owned
WebView2 profile explicitly. The created environment's actual `UserDataFolder`
is checked. Smoke receipts identify the resolved frontend source; a candidate
with `version.json` must use its packaged frontend. The installer lifecycle
probe additionally requires the verified bundled Pi runtime identity and path.
Normal production startup keeps its existing environment behavior.

Negative checks passed with polluted override variables, including an unknown
future `WEBVIEW2_*` key. A direct smoke CLI invocation bypassing the launcher
still reported an isolated profile and packaged frontend, with no external
profile created. Ancestor and descendant junction fixtures were rejected before
validation writes or recursive cleanup; the outside sentinel remained intact.

The new failure script checks production Settings, State, Recovery, PiAgent,
and Vault-configuration file hashes before and after the run. It does not copy
private file contents into the reports. Cleanup verifies that Explorer remains
available, the native taskbar is visible, the owned Host exits, and temporary
WebView2 profile locks are released.

| Check | Current machine result | Evidence |
| --- | --- | --- |
| Renderer startup deadline | Passed. A validation-only readiness fault exercised the actual timeout path; native taskbar and clean shutdown were preserved. | [PowerShell 7 failures](native-failure-paths.json), [Windows PowerShell 5.1 failures](native-failure-paths-powershell51.json) |
| WebView2 browser process crash in Safe Mode | Passed. Only the browser child of the owned Host was terminated; the Host reported `BrowserProcessExited` and exited cleanly on its safety command. | Same failure reports |
| Exit during startup | Passed. The safety-exit message was sent after the initialization log appeared. This checks Host startup interruption, not forced termination of the test-driver process. | Same failure reports |
| Full-mode Host termination | Passed. The real watchdog restored Explorer's taskbar; the incomplete startup ledger caused the next launch to enter Safe Mode; final safe exit cleaned the ledger. | [Host crash recovery](native-host-crash-recovery.json) |
| Ordinary Safe Mode lifecycle | Passed. The driver now checks both process ownership and the exact `JARVIS` window title before sending the exit command. | [Safe lifecycle](native-safe-lifecycle.json) |
| Fullscreen foreground suppression | Not verified in this run. The owned probe covered the physical primary-monitor bounds, but Windows did not give it foreground focus. Its prerequisite failed before product suppression could be assessed. Host and probe both exited and the native taskbar was restored. | [Fullscreen prerequisite report](native-fullscreen-lifecycle.json) |

The checked-in initial receipts above were collected from the development
build before the release source freeze. They are not evidence that a separately
built installer has passed. The failure harness also includes a Full-mode
WebView2 browser crash case for the candidate rerun.

## Candidate procedure

The intended candidate version is `0.1.0-rc.20261002`. Build it only after
committing the verified source snapshot, and record the full commit in the
candidate result. `publish-release.ps1` can reuse the already SHA-verified,
repository-pinned Pi v0.83.0 archive with `-OfflinePiRuntime` and
`-PiRuntimeArchivePath`; no second runtime download is required.

1. Run `verify-release-artifacts.ps1` with the candidate version and exact
   source commit. It rejects a dirty-source manifest, checks the Host's
   informational version, all files in `SHA256SUMS.txt`, ZIP/installer sizes
   and hashes, and every portable file against the verified directory, including
   the checksum receipt. Missing, extra, duplicate, unsafe, and mismatched ZIP
   entries are rejected.
2. Run `verify-installer-lifecycle.ps1` against that installer with
   `-ExpectedCommit` set to the same full source commit. It requires clean
   installed provenance and the exact expected commit before probing the Host.
   It refuses an
   existing production installation, JARVIS startup registration, or legacy
   NightShell startup value. The real installer targets a dedicated test
   directory. The check covers packaged frontend/WebView2/Pi runtime probing,
   same-version repair after deliberate damage to the owned test Pi runtime,
   uninstall, startup cleanup, and residual-process checks.
3. Rerun native smoke and the isolated failure harness against the actual
   candidate executable. Keep generated package and lifecycle receipts with
   this validation record.

Installer validation now compares the full informational version
`version+commit` with both the expected source commit and `version.json`,
rather than comparing it with the bare release version. Installer and
uninstaller processes have a bounded deadline.
The script emits its successful JSON result only after cleanup has succeeded.

`scripts/test-release-verifiers.ps1` passed 32 synthetic checks without running
an installer or Host. These cover matching ZIPs, missing/extra/duplicate files,
the checksum receipt, same-length content changes, unsafe paths and links,
installed commit/dirty-state/executable mismatches, and cleanup junctions at
the target, parent, and descendant levels. Both verifier scripts passed
PowerShell AST parsing. Run this suite before the real candidate checks.

Candidate packaging and installer results will be appended after the source
snapshot is committed and the candidate is built.

## Remaining physical-device matrix

| Environment or behavior | Status |
| --- | --- |
| Available Windows 11 build 26200, isolated Safe/Full recovery | Native checks above completed; candidate rerun still required. |
| Windows 10 Home/Pro, Hybrid and Full modes | Missing physical-device evidence. |
| Multiple monitors and mixed DPI | Missing physical-device evidence. |
| Foreground fullscreen entry/exit | Requires an interactive run in which the owned probe becomes foreground. |
| Physical keyboard switcher behavior | Not exercised by these message-based exit checks. |
| Lock/unlock and sleep/resume | Not executed on the user's active desktop. |
| Explorer restart and network interruption | Not executed in this validation batch. |

These rows remain release-acceptance gaps; compatibility claims must not be
inferred from a successful build or from the available Windows 11 checks.
