# Local configuration, knowledge and rendering workflow validation

Validated on 2026-10-02 against the six-part workflow change. Browser and native
checks used separate synthetic Vaults and isolated configuration directories.
Personal Vault contents, credentials and local preferences are not test fixtures.

## Functional evidence

| Area | Observed result |
| --- | --- |
| Shared preferences | Changed the theme and Bloom, saved a named graph preset, and opened a second browser client. The second client loaded the same file-backed preferences. Restoring the baseline snapshot restored theme, Bloom and preset library in both clients and created a before-restore snapshot. |
| Persistence boundaries | Separate GraphPreview processes exercised revision conflicts, field-level merge and two-file restore recovery. Tests cover corrupt settings preservation, interrupted restore journals and concurrent updates. Damaged snapshots stay on disk and count toward capacity, while intact snapshots remain usable; the damaged entries can be explicitly deleted to free space. Build and configuration provenance are visible in Settings without exposing personal paths. |
| Visual editor | Searching Bloom while filtering modified controls showed only matching changes. A/B mode disabled edits while viewing A, switching back to B restored the editable value, and single-field reset removed the control from the modified result. Closing the editor ends temporary comparison. |
| Freeze | With the camera at Z=720, changing node emission while frozen left both camera and shader signal time unchanged. The observed signal uniform stayed at 259.7672999998875 through the edit. Unfreezing resumed animation and statistics. The renderer remained a single GPU canvas. |
| Knowledge | An alias search found the expected synthetic note. One-hop and two-hop views contained 3 and 5 nodes, respectively, with incoming/outgoing relations. Explicit reading returned the expected 269-character, 11-line excerpt. Search and neighborhood tests also cover notes beyond the global drawing budget, large alias/tag metadata, byte clipping and pagination cursors. |
| Agent context | Adding one excerpt prepared an attributed summary draft; two excerpts prepared a comparison draft containing S1/S2 source paths and line ranges. Preparing a draft did not send a message. Explicit sending was tested with the local simulator, whose reply is visibly labelled as simulated. |
| Saved conversations | A named conversation survived browser reload and GraphPreview restart and could be restored with its source records. Two clients then saved competing continuations: the stale save was rejected, its local messages stayed visible, and “Save as new conversation” preserved both versions as separate four-message conversations. |
| Native interaction | Release Host/WebView2 smoke gates passed in en-US and zh-CN. The optional performance gate also searched a real synthetic Vault alias, selected its note, read its excerpt, staged S1 without sending, and exited/re-entered Explore three times. The native taskbar stayed visible and Host exited cleanly. |

The final isolated browser inspection reported no console warnings or errors.
Routine regression screenshots remain local; approved visual references are not
replaced by synthetic QA captures.

## Performance baseline

These are measurements of the implemented state, not a before/after speedup claim.
Both environments used a 1280×720 viewport and a synthetic 96-note Vault
(192 relations in the browser fixture; 288 in the native fixture), effective Low
quality, DPR 1 and adaptive tier 0. The differing relation counts mean these
samples are separate baselines, not a direct browser-versus-native comparison.
A query override enabled
animation while the operating system's reduced-motion preference remained set;
automatic base quality therefore stayed Low.

| Scenario | Browser frame P50 / P95 (ms) | Native frame P50 / P95 (ms) | Native CPU (% machine) | Native peak summed working set (MiB) |
| --- | --- | --- | --- | --- |
| Idle neuron sphere | 4.2 / 4.8 | 4.2 / 4.3 | 2.58 | 589.2 |
| Focused 3D Explore | 4.2 / 4.4 | 4.2 / 4.3 | 2.72 | 610.1 |
| Focused 2D Explore | 4.2 / 4.6 | 4.2 / 4.3 | 2.94 | 608.8 |

- Frame numbers measure intervals between continuously requested R3F frames,
  not GPU execution time or guaranteed screen presentation rate. Each sample
  contains the most recent 600 intervals, approximately 2.5 seconds here.
- Native process measurements span approximately 16 seconds per scenario after
  a warm-up. CPU includes Host and its WebView2 processes, normalized across 24
  logical processors. All six processes remained stable; no readings failed.
- Working sets are summed and can double-count shared pages. Browser CPU and
  memory were not measured. Background desktop work and occlusion can change
  these results.
- Raw evidence: [browser samples](browser-performance-2026-10-02.json) and
  [native samples](native-performance-2026-10-02.json). Native WebView2 was
  154.0.4258.48.

The adaptive controller now requires sustained measured headroom before recovery,
applies a cooldown, and backs off repeated failed recoveries. Statistics clear
when the scene, quality, DPR or renderer changes. Isolated input redraws and
paused demand rendering cannot be mistaken for slow continuous animation.
Deterministic tests cover recovery and backoff; this machine did not naturally
trigger a slow-device recovery during the reported samples.

To reproduce the native gate after building frontend and Release Host:

```powershell
.\scripts\verify-renderer-smoke.ps1 -Culture en-US -MeasurePerformance `
  -HostPath .\host\Jarvis.Host\bin\Release\net8.0-windows\Jarvis.Host.exe
.\scripts\verify-renderer-smoke.ps1 -Culture zh-CN `
  -HostPath .\host\Jarvis.Host\bin\Release\net8.0-windows\Jarvis.Host.exe
```

## Checks and limits

Frontend tests (613), lint, formatting and production build passed. The existing
large graphics-chunk warning remains. Host tests passed (445), and the Release
build passed without warnings or errors. Frontend runtime license checks passed
(12), as did the synthetic Pi
staging checks (9); no official Pi archive was downloaded for this run.

Real external-provider answer quality and launching the system's default note
application were not manually exercised. Win10 hardware, mixed-DPI monitors,
secure desktop, lock/unlock and sleep/resume remain separate hardware gates.
Installer packaging and release installation were not rerun for this workflow
change. These results do not replace the release coverage listed in the
[validation index](README.md).
