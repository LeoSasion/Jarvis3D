# Windows validation

JARVIS is a post-sign-in Windows desktop host. Its supported product family is
Windows 10 and Windows 11 Home/Pro; each release must preserve a safe return to
the native Explorer taskbar and desktop.

## Evidence kept in this repository

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
