# UI interaction implementation and validation · 2026-10-03

This records implementation of the nine P0/P1/P2 packages in the [interaction plan](../design/ui-interaction-plan-2026-10-03.md). The black HUD, approved graph rendering, explicit Agent Send boundary, and Windows taskbar recovery contract remain in place.

| Package | Delivered behavior |
| --- | --- |
| P0.1 | Agent sources distinguish pending, attached to this turn, and history-only states. The exact excerpts and line ranges appear before Send. Completed, failed, aborted, and restored turns do not arm history for another request; reattach is explicit. |
| P0.2 | The native failure page names the failure and offers a focusable Exit to Windows button plus Esc. It collapses the WPF WebView2 child window before showing the native overlay, so a live child cannot cover the mouse target. |
| P0.3 | Exit shows request acceptance, native taskbar verification, and automatic safe retry progress. Repeated clicks do not submit a second exit request. Persistent taskbar fallback opens its settings detail even when Settings was already open. |
| P1.1 | Search selection offers Focus in graph; focus waits for the current layout and is consumed once. User pan cancels a pending focus, and a 2D/3D switch cannot replay an old command into the other camera. Fit respects visible pane insets; Reset camera and Clear selection remain separate. |
| P1.2 | The excerpt basket remains visible, while Agent compresses sent context to a source row. Answer citations open a scrollable snapshot with absolute line numbers and focus the cited line. Streaming follows only when the reader was near the bottom; otherwise New content returns there. |
| P1.3 | Conversation list, restore, save conflict, and graph search expose distinct retry/loading states. Old search results cannot be selected during a new request. |
| P2.1 | Long Settings sections have task anchors and a tracked current subsection. Advanced graph controls stay folded; parameter search presents a search-results state. |
| P2.2 | Narrow Explore retains a source/count badge. 2D and 3D announce distinct mouse, keyboard, and touch gestures. Floating windows move with Alt+Arrow, Shift accelerates, and Settings resets saved window bounds. |
| P2.3 | First successful launch shows a skippable three-step guide once. Degraded and safe-mode states keep a reason and a direct recovery/settings route. |

## Verification

- Frontend: **641/641** tests, ESLint, format contract, production Vite build, and **12/12** runtime-license checks passed. Host: **483/483** tests and Release build with zero warnings and errors.
- On Windows 11 build 26200 with Windows PowerShell 5.1, the [five-scenario native failure receipt](ui-native-failures-2026-10-03.json) passed startup-timeout Esc, startup-timeout mouse click while WebView2 was alive, WebView browser crash in safe mode and Full mode, and owned WM_CLOSE. Explorer's taskbar remained visible; zero Host processes remained; the production state fingerprint did not change. The final frontend build passed `verify-renderer-smoke.ps1` in both `en-US` and `zh-CN`.
- The fixed 96-node/186-relation graph completed all eight cases in the [browser receipt](ui-browser-graphics-2026-10-03.json) and [native WebView2 report](ui-native-graphics-2026-10-03/report.json). Camera type, simulation frame count, position digest, and signal digest matched case by case. Native PNG captures accompany the report. These frame intervals measure active frame cadence, not GPU execution time.
- A four-note synthetic Vault was used for desktop → Explore → local excerpt → Agent draft → explicit Send → historical source. At 1280×720, the pending row showed `[S1] Project Alpha · L1–6`; Send changed it to this-turn, then history-only without automatically arming the next request ([flow capture](ui-agent-flow-2026-10-03.png)). At Agent widths of 742 and 660 CSS pixels, separate `[S1]` clicks targeted absolute lines 12 and 18, and a repeat click closed the drawer. The [742-pixel citation capture](ui-agent-citation-2026-10-03.png) shows the L18 target. Focus → manual pan → 2D → 3D preserved the 3D camera position. At 1280×720, 1920×1080, and 2560×1440 the document had no page-level overflow; a 640×360 effective viewport retained controls. Emulated reduced motion stayed enabled without page overflow.

## Isolation and remaining device checks

The browser QA used a synthetic Vault and local simulator; it did not call an external Agent provider. During early QA, three synthetic conversations were accidentally saved by the development bridge under the ordinary local conversation directory. Their IDs, creation times, schema, and message counts were checked, then the three files were moved to a recoverable `%TEMP%\jarvis-ui-qa-conversations-20261003` quarantine; the production conversation directory now has no JSON files. Vite now accepts `JARVIS_PREVIEW_TEST_SETTINGS_DIRECTORY` for isolated browser QA. A subsequent save and citation QA left the production conversation directory unchanged. No other production settings file was modified during this run.

Physical touch gestures, Windows 10, OS-level 200% DPI, mixed-DPI monitors, lock/unlock, and sleep/resume still need their respective hardware. The 640×360 viewport checks reduced available CSS space but does not certify Windows display scaling. A real service-provider answer was not part of this UI validation.
