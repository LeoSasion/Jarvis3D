# Native failures and release candidate — 2026-10-02

Validation was performed on the available Windows 11 desktop, build 26200.
The primary monitor measured 2560 × 1440. This record does not certify the
unavailable Windows 10 or multi-monitor hardware matrix.

The final candidate is `0.1.0-rc.20261002`, built from clean source commit
`76d22a020fe320319dd4094a5b85941cecb97328`. The actual candidate passed package
verification, install/repair/uninstall, renderer smoke in both languages,
eight native graphics cases, and the native failure and recovery checks below.

## Isolated native checks

Native lifecycle checks now launch the real Host with a generated
`--native-validation-data-root=` under the dedicated system temporary directory.
The Host rejects production roots, roots outside that parent, invalid run IDs,
and existing reparse points. Settings, startup health, appearance recovery,
logs, WebView2 data, Agent state, and the synthetic Vault share this isolated
root. A taskbar watchdog receives the same root. Renderer smoke also directs
all of these services to its existing isolated root.

Validation roots and receipt paths must use ordinary absolute local drive
paths. Device, extended-length, and UNC namespaces are rejected before path
normalization or filesystem inspection, preventing aliases of production data
from bypassing isolation. Root and receipt regressions passed alongside the
existing production-overlap and reparse checks.

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
| Renderer startup deadline | Passed. A validation-only readiness fault exercised the actual timeout path; native taskbar and clean shutdown were preserved. | [Candidate PowerShell 7 failures](candidate-native-failures-2026-10-02.json), [Candidate Windows PowerShell 5.1 failures](candidate-native-failures-powershell51-2026-10-02.json) |
| WebView2 browser process crash in Safe Mode | Passed. Only the browser child of the owned Host was terminated; the Host reported `BrowserProcessExited` and exited cleanly on its safety command. | Same failure reports |
| WebView2 browser process crash in Full mode | Passed. The check waited for active taskbar replacement before terminating the owned browser child; the native taskbar recovered and the Host exited cleanly. | Same failure reports |
| Exit during startup | Passed. The safety-exit message was sent after the initialization log appeared. This checks Host startup interruption, not forced termination of the test-driver process. | Same failure reports |
| Full-mode Host termination | Passed. The real watchdog restored Explorer's taskbar; the incomplete startup ledger caused the next launch to enter Safe Mode; final safe exit cleaned the ledger. | [Candidate Host crash recovery](candidate-host-crash-recovery-2026-10-02.json) |
| Ordinary Safe Mode lifecycle | Passed. The driver checks both process ownership and the exact `JARVIS` window title before sending the exit command. | [Candidate Safe lifecycle](candidate-native-safe-lifecycle-2026-10-02.json) |
| Fullscreen foreground suppression | Not verified in this run. The owned probe covered the physical primary-monitor bounds, but Windows did not give it foreground focus. Its prerequisite failed before product suppression could be assessed. Host and probe both exited and the native taskbar was restored. | [Fullscreen prerequisite report](native-fullscreen-lifecycle.json) |

The four failure cases passed with the packaged Host under PowerShell 7.6.6
and Windows PowerShell 5.1.26100.9444. Both reports confirm unchanged production
state and zero Host processes after cleanup. The fullscreen prerequisite report
is from the earlier development build; it remains an explicit validation gap.
Earlier non-candidate receipts are retained as development evidence only.

## Candidate verification

`publish-release.ps1` built the committed source using its default clean
`npm ci` path and the repository-pinned Pi v0.83.0 archive through
`-OfflinePiRuntime -PiRuntimeArchivePath`. Target containment and reparse-point
checks ran immediately before package and installer lifecycle operations.

| Check | Result | Evidence |
| --- | --- | --- |
| Package provenance and integrity | Passed. Clean exact commit; Host informational version `0.1.0-rc.20261002+76d22a020fe3`; 786 package files and all 787 portable entries verified, including the checksum receipt. | [Candidate artifact receipt](release-candidate-2026-10-02.json) |
| Real installer lifecycle | Passed. Isolated install, installed frontend/WebView2/bundled Pi probe, deliberate Pi corruption followed by same-version repair, uninstall, and startup cleanup. Explorer count stayed 1; Host count ended at 0. | [Installer lifecycle receipt](installer-lifecycle-2026-10-02.json) |
| English renderer smoke | Passed under PowerShell 7 against the packaged Host, including the packaged-frontend and actual isolated WebView2 profile checks. | `verify-renderer-smoke.ps1 -Culture en-US -GraphicsRegression`; graphics receipt below |
| Chinese renderer smoke | Passed under Windows PowerShell 5.1 against the same packaged Host. | `verify-renderer-smoke.ps1 -Culture zh-CN` returned `renderer-smoke: PASS (zh-CN)` |
| Native graphics regression | Passed all eight cases on WebView2 154.0.4258.48. Runtime metadata reports the candidate version, exact source commit, and `dirty: false`. | [Native report and PNGs](candidate-native-graphics-2026-10-02/report.json) |

The native graphics fixture uses 96 nodes, 186 relations, a 960 × 640 CSS stage,
DPR 1, and the Balanced profile. Frozen A/restored-A captures match, B differs,
and context-restored capture matches reentry. Active frame-interval P95 ranged
from 4.6 to 4.8 ms in this short synthetic run; this is not GPU execution time
or evidence for the untested device matrix.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `JARVIS-0.1.0-rc.20261002-win-x64.zip` | 122871189 | `372fc400d504cec503b1a2965d17501eff023152b94607a27be2ec959e2cc629` |
| `JARVIS-Setup-0.1.0-rc.20261002-win-x64.exe` | 83819955 | `d0797267a23486f7d29454001fdc6208d25583babb26b9c91eafad55a74298be` |

The release directory is
`artifacts/release/JARVIS-0.1.0-rc.20261002-win-x64`; the installer is under
`artifacts/installer`. Candidate identity remains tied to the commit above
even when a later documentation-only commit records these receipts.

Installer validation now compares the full informational version
`version+commit` with both the expected source commit and `version.json`,
rather than comparing it with the bare release version. Installer and
uninstaller processes have a bounded deadline.
The script emits its successful JSON result only after cleanup has succeeded.

`scripts/test-release-verifiers.ps1` passed 44 synthetic checks without running
an installer or Host. These cover matching ZIPs, missing/extra/duplicate files,
the checksum receipt, same-length content changes, unsafe paths and links,
installed commit/dirty-state/executable mismatches, and cleanup junctions at
the target, parent, and descendant levels. Installed Pi license bytes are checked
against the pinned license hash; only the repository reference is normalized for
Windows checkout line endings. Tampered and malformed license fixtures fail.
Both verifier scripts passed PowerShell AST parsing. The full Host test suite
passed 477 tests before this source commit was packaged.

## Remaining physical-device matrix

| Environment or behavior | Status |
| --- | --- |
| Available Windows 11 build 26200, isolated Safe/Full recovery | Candidate checks above passed. |
| Windows 10 Home/Pro, Hybrid and Full modes | Missing physical-device evidence. |
| Multiple monitors and mixed DPI | Missing physical-device evidence. |
| Foreground fullscreen entry/exit | Requires an interactive run in which the owned probe becomes foreground. |
| Physical keyboard switcher behavior | Not exercised by these message-based exit checks. |
| Lock/unlock and sleep/resume | Not executed on the user's active desktop. |
| Explorer restart and network interruption | Not executed in this validation batch. |

These rows remain release-acceptance gaps; compatibility claims must not be
inferred from a successful build or from the available Windows 11 checks.
