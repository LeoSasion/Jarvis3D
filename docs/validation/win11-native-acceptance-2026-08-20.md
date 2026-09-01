# Windows 11 native acceptance — 2026-08-20

Status: `AVAILABLE WINDOWS 11 GATES PASSED · HARDWARE COVERAGE DEFERRED`

This current-machine validation started from commit `bdd00d5` and includes the
validation-harness fixes recorded below. It is not a Windows 10 certification
and does not claim coverage for hardware or disruptive scenarios that were
unavailable during the run.

## Test environment

- Windows build `26200`, x64, Pro, display version `25H2`
- one primary display; the run began at `2560×1440` and the current compatibility
  probe finished at `1920×1200` after external display-setting changes
- initial system scale: 96 DPI / 100%
- WebView2 Evergreen `151.0.4129.93`
- Explorer running with a visible `Shell_TrayWnd`
- supported power states include S3 standby and hibernation

## Completed gates

- [x] strict Windows compatibility readiness probe
- [x] frontend unit/model suite: 227 passed
- [x] frontend ESLint and format contract
- [x] frontend production build: 317 modules transformed
- [x] Host full test suite: 347 passed
- [x] Impeccable mechanical detector: no findings
- [x] native Explorer/taskbar baseline in the real user window station
- [x] isolated WebView2 renderer smoke, including Help, Explorer + Agent linked
      layout, notice placement, and Reduced Motion
- [x] product recovery shortcut restored a clean startup ledger, zero JARVIS
      processes, a live Explorer process, and the visible native taskbar
- [x] default Hybrid activation retained the Explorer taskbar and notification
      area while the JARVIS desktop occupied the primary work area
- [x] Full activation completed the watchdog handshake, hid the native primary
      taskbar, and restored it through the product safe-exit path
- [x] a bounded borderless primary-monitor fullscreen probe hid and restored the
      JARVIS taskbar without rebinding the replacement session
- [x] forced Host termination left an auditable abnormal-run ledger; the
      watchdog restored Explorer, the next launch entered automatic Safe Mode,
      and final safe exit cleared the ledger

## Audit health score

| Dimension | Score | Evidence / limitation |
| --- | ---: | --- |
| Accessibility | 3/4 | Keyboard, focus, notice, linked-pane, and Reduced Motion contracts pass; no current assistive-technology walkthrough was performed. |
| Performance | 3/4 | Production build and bounded model tests pass; sustained native frame-time and idle CPU sampling remain outstanding. |
| Appearance & theming | 4/4 | The detector found no implementation drift; the black/warm-white/orange token system remains coherent. |
| Responsive behavior | 3/4 | 1040×720 renderer smoke passes; physical 125–200% DPI and multi-monitor transitions were unavailable. |
| Implementation integrity | 4/4 | Host/renderer boundaries, truthful preview provenance, recovery, and current source contracts pass. |
| **Total** | **17/20 · Good** | Current available gates pass; assistive-tech, sustained performance, high-DPI, and multi-monitor evidence remain. |

## Defects found and closed

### P1 — Safe lifecycle reported success after forcing an abnormal Host exit

- Location: `Request-JarvisGracefulClose` in
  `scripts/verify-native-lifecycle.ps1`.
- Evidence: the script waited five seconds for `CloseMainWindow()`, force-stopped
  the Host, then returned `READY` because Explorer and the taskbar were visible.
  The production startup ledger still contained the terminated PID and active
  run ID.
- Impact: the following normal launch is quarantined in Safe Mode as an
  abnormal-exit recovery. A release gate can therefore report success while
  mutating the next-launch behavior.
- Fix: the script now discovers the top-level window by verified Host PID,
  posts the same bounded `WM_HOTKEY` recovery message as `Ctrl+Shift+Q`, waits
  for normal exit, and requires a clean startup-ledger readback. Missing window,
  timeout, forced cleanup, or an armed ledger returns `ATTENTION`.
- Revalidation: final Safe Mode lifecycle returned `READY`; active run ID, PID,
  and start time were null; Explorer and the native taskbar remained available.

### P2 — Compatibility probe assumed the first screen was primary

- Location: `scripts/test-windows-compatibility.ps1`, lines 42–52.
- Impact: `Screen.AllScreens` ordering is not the primary-monitor contract, so
  a multi-monitor receipt can attribute the wrong resolution to the primary
  display.
- Fix: the probe now selects the screen whose `Primary` property is true,
  reports that screen's resolution, and fails compatibility when Windows does
  not expose a primary display.
- Revalidation: strict compatibility passed and reported the current primary
  display as `1920×1200`.

## New repeatable gates

- `scripts/verify-fullscreen-lifecycle.ps1` performs a bounded Full-mode
  watchdog handshake, local fullscreen suppression/restoration probe, safe
  exit, native-taskbar recovery, process cleanup, and ledger verification.
- `scripts/verify-host-crash-recovery.ps1` force-terminates only the active Full
  Host, verifies watchdog recovery, verifies automatic next-launch Safe Mode,
  and finishes with a clean safe exit.
- Both scripts refuse to overwrite an existing taskbar preference and remove
  the temporary Full-mode setting before returning.

## Deferred controlled gates

The following were deliberately not automated while the user could be working:

- Explorer restart and taskbar rebind
- sleep/resume and lock/unlock
- physical 125%, 150%, 175%, and 200% DPI transitions
- physical multi-monitor and mixed-DPI placement
- a real browser F11 and full-screen game pass beyond the deterministic local
  borderless-fullscreen probe
- screen-reader walkthrough and sustained native frame-time / idle CPU sampling

Every remaining live test must end with zero JARVIS processes, Explorer alive,
the native taskbar visible, and a clean startup ledger.
