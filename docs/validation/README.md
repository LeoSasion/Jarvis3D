# Windows validation

JARVIS is a post-sign-in Windows desktop host. Its supported product family is
Windows 10 and Windows 11 Home/Pro; each release must preserve a safe return to
the native Explorer taskbar and desktop.

## Evidence kept in this repository

- [October 3 UI interaction delivery](ui-interaction-2026-10-03.md)
  records the P0/P1/P2 changes, synthetic browser flow, isolated native failure
  exits, and matching browser/WebView2 graph invariants.
- [October 3 Pi 1.0.0 adaptation](pi-1.0.0-adaptation-2026-10-03.md)
  records the updated upstream pin, tree verification, RPC disposition handling,
  isolated Host handshake, and deterministic loopback response.
- [October 2 Agent runtime and source checks](agent-runtime-2026-10-02.md)
  cover official Pi startup, Host RPC, the no-auth error path, citation snapshots,
  and the service-provider work still requiring credentials.
- [October 2 fixed WebGL regression](graphics-regression-2026-10-02.md)
  compares the same eight synthetic scenes in Edge and native WebView2.
- [October 2 native failure and candidate checks](native-release-validation-2026-10-02.md)
  record isolated startup/crash recovery, PowerShell 5.1 and 7 fault checks,
  the fullscreen foreground prerequisite, and exact-commit package validation.

- [October 2 workflow validation](workflow-validation-2026-10-02.md) records
  shared configuration and rollback, knowledge excerpts and saved conversations,
  visual comparison, actual browser interactions, and native performance samples.
- [Current browser preview stills](../design/references/jarvis-operator-hud-overview.png)
  show the idle desktop; [3D Explore](neuron-radiance-3d-preview.png) and
  [2D Explore](neuron-radiance-2d-preview.png) were captured on 2026-09-30.
  Earlier JPEGs remain with their dated material-study notes.
- [Current Windows 11 native acceptance](win11-native-acceptance-2026-08-20.md)
  records the latest automated and controlled native gates, audit score,
  validation-harness fixes, and the hardware-dependent coverage still missing.
- [Windows 11 test closure](win11-test-closure.md) is the dated, machine-specific
  record for the available Windows 11 hardware gates completed on 2026-07-30.
  It is historical evidence, not a claim of current-release certification.
- Automated CI checks live with the source: frontend tests and production build,
  Host tests and build, frontend license closure, and synthetic Pi staging
  safety checks. Run `scripts/verify-renderer-smoke.ps1` in both `en-US` and
  `zh-CN` from an interactive Windows desktop as a pre-release gate.
- [Runtime regression checks](runtime-regressions-2026-09-25.md) record four
  stateful cases found during the September 25 review.

## Coverage still required for a release claim

- A real Windows 10 machine: Hybrid and Full taskbar modes, safe exit, Explorer
  restart recovery, and DPI scaling.
- Multi-monitor and mixed-DPI placement.
- Physical keyboard switcher behavior, lock/unlock, sleep/resume, and network
  interruption recovery.
- Re-run packaging, checksums, and installer lifecycle checks against the exact
  release commit.

## Safety rule

Native taskbar replacement testing must be time-bounded. On every test exit,
verify that JARVIS has stopped, Explorer remains available, and the native
primary taskbar is visible before declaring the run complete.
