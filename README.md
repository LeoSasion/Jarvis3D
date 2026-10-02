# JARVIS

JARVIS (`JarvisV1` in release tooling) is an experimental desktop shell for
Windows 10 and 11. A native C#/WPF host and a React/WebView2 interface bring
together a reversible taskbar, desktop commands, file tools, a local knowledge
graph, Agent workflows, and a ConPTY terminal. System state comes from the
Host; the browser preview labels simulated state instead of presenting it as
live Windows telemetry.

![Current JARVIS desktop preview with the idle neuron sphere, telemetry rail, and taskbar](docs/design/references/jarvis-operator-hud-overview.png)

*Current local browser preview: the idle neuron sphere behind the desktop
controls. The native Host is required for real Windows integration.*

## Neural graph

The desktop's idle neuron sphere and the Explore views use the same orange-family
cell and filament materials. Explore unfolds the graph into 3D branches or 2D
clusters. Selected relations light up along existing paths; short electrical
signals cross those paths and junctions, charge the cells they touch, then fade.
A signal keeps its assigned warm hue through its head, wake, and cell activation.
Line color follows each filament's own strength and transparency gradient, while
scene-wide Bloom spreads light from bright geometry. Still images cannot show
the signal motion or the focused lines' brightness breathing.

### 3D Explore

![Current 3D neuron graph with highlighted routes and active cells](docs/validation/neuron-radiance-3d-preview.png)

### 2D Explore

![Current 2D neuron graph with clustered cells and existing connections](docs/validation/neuron-radiance-2d-preview.png)

These are unedited 1280×720 captures of the running local browser preview. The
[filament notes](docs/design/concepts/neuron-filament-notes.md) retain the earlier
material study and its dated comparisons.

### Screen recording

Use **Record / 录屏** in the top rail, choose the current tab in the browser's capture picker,
then click **Stop recording / 停止录屏** to download the video. Recording captures the final
page composition, including the graph's glow and interface, directly as H.264 MP4 with a
6 Mbps target bitrate, up to 1920×1080 at 30 fps, and no audio. The button shows elapsed time;
the browser's stop-sharing control also finishes the download. A runtime without screen
capture or resize-safe H.264 MP4 encoding (`avc3`) reports that limitation instead of
substituting another codec. Use an up-to-date Chrome or Edge browser; resizing the captured
tab or window during recording is supported.

### Local graph visual settings

**Graph Visual Settings** provides bounded controls for node variation and
activation, filament and signal appearance, idle emission, Bloom, layout, and
scene visibility. The active profile is shared or independent across idle, 2D,
and 3D according to the selected mode.

Search parameters across all categories, show only changed values, or reset a single
control. **A / B** captures a temporary reference and previews it without overwriting
the current configuration. Freeze the camera and signal time for a steady comparison;
closing the editor ends the comparison. Actual quality, automatic adjustment reasons,
and recent active-frame interval statistics appear in the performance controls.
After sustained headroom, adaptive quality recovers gradually with a cooldown to avoid
repeated switching. Static redraws and paused animations do not count as slow frames.

The active graph configuration is saved in `%LOCALAPPDATA%\JARVIS\Settings\graph-visual-settings.json`.
The Windows Host and the loopback Vite development/preview server use the same file. Visible browser
pages check for changes every 1.5 seconds and refresh on focus, so different browsers share current
node, connection, signal, glow, layout and view parameters. Named graph presets, themes,
custom colors, language, interface preferences, audio and screen effects share the
neighboring `workspace-preferences.json` file. Operational Windows preferences remain
under their existing dedicated services.

On first use, an absent file imports the opening browser's existing visual configuration. Once the file
exists, it takes precedence over browser storage. Saves use atomic replacement, keep the previous file
as `.json.bak`, and merge locally edited fields after a revision conflict instead of replacing newer
settings with a stale browser snapshot. The visual menu reports pending saves and failures; a malformed
file is preserved for recovery. Browser previews require the local Vite server and .NET 8 SDK; static
web hosting alone cannot write this file.

**Settings → Interface → Local configuration & recovery** shows save state and build
identity, copies a diagnostic without personal paths or configuration contents, and
keeps up to eight named snapshots. A restore first saves the current configuration as
another snapshot, then restores both preference files together. Concurrent changes
are checked by revision; an interrupted restore is rolled back before the next read.
Keep one snapshot slot free to allow this recovery copy.

### Knowledge and Agent workflow

Open **Explore** to search note titles, paths, aliases and tags, follow incoming or
outgoing links, or display a one- or two-hop neighborhood. The search index can find
notes beyond the global rendering budget; the local view remains bounded. The native
Host can open a selected note through its registered Windows application.

Choose **Read excerpt locally** to inspect a bounded note snapshot with its source
path and line range. Add at most two excerpts of 6,000 characters each, then choose
summary, comparison or a question. Agent shows the prepared context and waits for
**Send** before sharing it with the selected provider. Global graph payloads remain
metadata-only. Explorer links remain metadata-only, and the Pi adapter remains
chat-only with tools disabled.

Completed conversations are saved locally and can be named and continued from the
Agent conversation library after a restart. Storage is bounded to 40 conversations,
100 messages and 40,000 characters per conversation. Continuing sends at most 8,000
characters of prior dialogue on the next message; it does not silently reattach old
note bodies. These local files may contain the excerpts the user chose to send.

## Current scope

- Windows 10 and Windows 11 Home/Pro desktop environments
- Hybrid primary-taskbar composition by default, preserving Explorer's notification area, with optional native fallback and experimental full replacement, fullscreen-aware reversible suppression, running-window synchronization, delayed DWM hover previews, session-scoped Show Desktop restore, and a recovery watchdog
- Current-virtual-desktop window scoping for the replacement taskbar and bounded HUD Alt+Tab switcher, with fail-open public-API fallback and native Windows fallback in hybrid, safe, secure-desktop, and renderer-failure paths
- Local Quick Search from the desktop and replacement taskbar, with keyboard scope switching and bounded history
- A persistent provider-neutral Agent entry immediately after Start, replacing the former search-box slot without consuming the running-app rail; Pi is the first supported adapter, with tools disabled and a repository-pinned private runtime started only when a prompt is sent
- Explorer-owned notification area in hybrid mode, with automatic native fallback
- Real Windows audio, network, power, and local-time state shared by the top bar, taskbar, Quick Settings, and the taskbar date-and-time center
- Keyboard-accessible Monday-first calendar with session-event filtering and an allowlisted handoff to Windows Date & Time Settings
- Guarded Session Control center for Exit to Windows, lock, sign out, restart, and shutdown, with single-use confirmation capabilities and no renderer-supplied commands
- Session-only JARVIS System Feed with bounded, deduplicated host events
- Keyboard-first application search and launcher
- Cancellable File Explorer copy/move jobs with conflict policies, byte progress, long-path support, and verified cross-volume moves
- Live desktop-folder synchronization, Windows-style multi-selection, native clipboard file operations, and recycle-safe desktop commands
- Drag-and-drop between the JARVIS desktop and File Explorer, plus validated file drops from Windows onto either surface
- Primary-monitor desktop ownership with per-monitor DPI telemetry while secondary Windows taskbars remain available
- Truthful Windows notification-history readiness reporting; history remains disabled until a signed MSIX identity and user consent are available
- Windows-native system telemetry and on-demand process/hardware inspection
- Integrated PowerShell, Command Prompt, and WSL sessions through ConPTY
- A source-bounded local Obsidian knowledge graph with 2D/3D neuron views, a porous neuron sphere at idle, searchable local neighborhoods, and explicit bounded note excerpts for Agent
- Configurable conservative, enhanced, and experimental immersive window styling
- Layered low-glare HUD themes and optional local interaction sounds
- Per-user installer and startup registration

JarvisV1 is under active development. The experimental immersive mode can alter the appearance of eligible application windows, but it does not replace the Windows sign-in or secure desktop. `Ctrl+Shift+Q` is the global recovery shortcut for returning to the native Windows shell.

The [next-stage priorities](docs/next-stage.md) focus on real Agent workflows,
repeatable rendering validation, and an installable release candidate.

## Architecture

- `frontend/` — React and Vite interface rendered by WebView2
- `host/` — .NET 8 WPF host, Windows bridge, taskbar and recovery services
- `installer/` — Inno Setup definition for per-user installation
- `scripts/` — release and native lifecycle verification scripts
- `third_party/pi/` — pinned Pi release trust manifest and retained MIT license; upstream binaries remain build artifacts, not source-control payloads
- `docs/design/` — current design-reference index and the smallest approved raster set
- `docs/validation/` — native lifecycle and release-validation evidence

The WebView renderer receives bounded capabilities rather than executable paths or arbitrary command lines. Windows integration and safety-sensitive operations remain in the native host. Bridge input, output, concurrency, and per-surface permissions are bounded independently. Agent providers also sit behind an explicit capability contract; a provider cannot use chat, streaming, history, abort, or session controls unless it declares that capability, and the current chat contract requires streaming support.

## Development

Requirements:

- x64-compatible Windows 10 build 17763 (version 1809) or later, or Windows 11
- Node.js and npm
- .NET 8 SDK
- Microsoft Edge WebView2 Runtime

The installer and native host both verify WebView2. If the Evergreen Runtime is
missing, setup stops before writing application files and the host also fails
closed without changing the Windows desktop or taskbar.

Build the frontend:

```powershell
cd .\frontend
npm ci
npm run build
```

Build and run the native host from the repository root:

```powershell
dotnet restore .\host\Jarvis.Host.sln
dotnet build .\host\Jarvis.Host.sln -c Debug
dotnet run --project .\host\Jarvis.Host\Jarvis.Host.csproj
```

After both builds complete, run the isolated Host/WebView2 smoke gate:

```powershell
.\scripts\verify-renderer-smoke.ps1 -Culture en-US
.\scripts\verify-renderer-smoke.ps1 -Culture zh-CN
```

It opens an off-screen 1040x720 renderer against an isolated WebView2 profile,
checks Help through a locale-independent DOM contract, Explorer, Agent linking,
notice bounds, and Reduced Motion, then exits automatically. The gate refuses to
start while JARVIS is already running and verifies that the native Windows
taskbar remains visible. Run both cultures from an interactive Windows desktop
as a pre-release gate; hosted CI does not claim this desktop-only coverage.

To also measure the native idle, focused 3D and focused 2D scenes, use:

```powershell
.\scripts\verify-renderer-smoke.ps1 -Culture en-US -MeasurePerformance
```

This optional gate uses a visible, non-activating 1280×720 window, an isolated
96-note synthetic Vault and configuration directory, and a full-motion override.
It writes a JSON report with active frame intervals, process CPU, summed working
sets and sampling completeness. Frame intervals are not GPU timings; process
working sets can contain shared pages. No taskbar replacement is enabled.

Run the controlled native lifecycle gates only when the desktop can briefly
yield to JARVIS:

```powershell
.\scripts\verify-native-lifecycle.ps1 `
  -JarvisExecutable .\host\Jarvis.Host\bin\Debug\net8.0-windows\Jarvis.Host.exe `
  -LaunchSafeMode
.\scripts\verify-fullscreen-lifecycle.ps1
.\scripts\verify-host-crash-recovery.ps1
```

The latter two gates temporarily request Full mode. They refuse to overwrite an
existing taskbar preference, exercise safe exit or watchdog recovery, remove
their test setting, and finish only after the native taskbar and clean startup
ledger have been verified.

Set `JARVIS_KEEP_NATIVE_TASKBAR=1` before launch to keep the Windows taskbar visible while developing or recovering. More native-host and release details are documented in [`host/README.md`](host/README.md); current coverage and historical Windows evidence live in [`docs/validation/`](docs/validation/README.md).

If both JARVIS and its watchdog have already exited but Explorer's primary
taskbar is still hidden after an interrupted development session, run
`.\scripts\restore-native-taskbar.ps1`. The script refuses to act while any
`Jarvis.Host` process is still running, so it cannot bypass an active recovery
lease.

Taskbar modes are stored per user. `native` preserves the complete Windows
taskbar, `hybrid` yields the notification area to Explorer, and `full` hides the
primary taskbar behind the watchdog-backed experimental replacement. Any failed
probe or activation returns to the native taskbar. A fresh profile starts in
`hybrid`; `full` remains an explicit experimental opt-in, and every existing
valid user selection is preserved.

Run the non-mutating compatibility readiness probe on each target machine:

```powershell
.\scripts\test-windows-compatibility.ps1
```

The probe checks the Windows build, x64 architecture, display topology, and
WebView2 registration. A successful run prepares a machine for testing; it
does not replace real Windows 10 hardware validation.

## License

JarvisV1 is licensed under [GPL-3.0-only](LICENSE). Third-party components and reference notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
