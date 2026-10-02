# Fixed WebGL regression baseline

2026-10-02. Browser and native WebView2 completed the same eight synthetic scenes. Camera matrices, simulation/shader times, position and signal-history digests, draw counts and resource counts matched across both runtimes. This is a repeatable local regression gate; it does not change the approved graphics defaults.

## Fixed inputs and scope

- Entry: `graphics-regression.html`, built alongside the ordinary application. It does not load the shell/platform bridge, connect settings files, read a Vault, or contact an Agent.
- Fixture: `six-clusters-96-v1`, 96 synthetic notes and 186 source relations. Stable IDs include seed `jarvis-webgl-v1`; the existing topology-based model seeds therefore remain identical.
- Stage: 960 × 640 CSS pixels, renderer DPR 1, balanced quality, Nexus palette, bundled graph label font, the existing initial orthographic/perspective cameras. Complete camera matrices are recorded.
- Simulation: one 1/60-second step per real rendered frame. Each initial scene captures frame 240, time 4 seconds. The first 60 simulation frames warm up; measured intervals come from actual frame callback times, not the fixed simulation delta. Reentry advances two further 60-frame segments and captures time 6 seconds.
- The renderer uses its existing scene, shaders, compositor, label pass, worker layout, A/B state and context-recovery lifecycle. Only this isolated entry supplies a controlled clock and fixes quality/DPR. Production adaptive-quality behavior remains covered separately.
- `window.jarvisGraphicsRegression` exposes a fixed, ordered case list, `start(caseId)`, serializable status and environment metadata. It exposes no renderer, camera object, arbitrary scene setter, file access or script execution API. Concurrent/out-of-order/unknown cases are rejected.

## Results

Both runtimes used the same production assets built at `2026-10-02T14:20:11.311Z`, based on revision `85d5d6971e5eccce05f2f35b64003a799459bb9f` with working changes (`dirty: true`). This records the tested build identity; it is not an exact-commit release certification. Browser Edge and WebView2 both reported version `154.0.4258.48`.

| Case | Time | Draw calls | Geometries / textures | Browser / native P95 | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Idle neuron sphere | 4 s | 13 | 6 / 10 | 5.9 / 5.9 ms | Passed |
| Explore 2D, fixed focus | 4 s | 13 | 6 / 10 | 6.0 / 6.0 ms | Passed |
| Explore 3D, fixed focus | 4 s | 13 | 6 / 10 | 5.9 / 6.0 ms | Passed |
| Frozen A | 4 s | 13 | 6 / 10 | 5.9 / 6.0 ms | Passed |
| Frozen B, Bloom intensity 0.75 | 4 s | 13 | 6 / 10 | 5.9 / 6.0 ms | Passed |
| Frozen A restored | 4 s | 13 | 6 / 10 | 5.9 / 6.0 ms | Passed |
| Exit and reenter Explore | 6 s | 13 | 7 / 10 | 5.9 / 6.1 ms | Passed |
| WebGL context lost and restored | 6 s | 13 | 6 / 10 | 5.9 / 6.1 ms | Passed |

Draw calls include the full compositor and crisp-label pass: the probe resets `renderer.info` once before a frame and reads it after composition. Frozen cases retain the preceding active sample window; they do not claim to measure paused rendering. Reentry includes its active transition frames. These P95 values are frame callback intervals, **not GPU execution time or presented display FPS**. The temporary seventh geometry during reentry is recorded consistently in both runtimes, and the restored-context scene returns to six.

Within each runtime, A → B changes the composed screenshot, returning to A restores the exact PNG, and context recovery restores the reentry PNG exactly. Two independent browser runs also matched every scene/resource invariant and all eight PNGs.

After the final source review, a fresh production frontend build at
`2026-10-02T14:30:40.913Z` repeated the browser check. All eight scene and
resource invariants, as well as all eight PNGs, matched the preceding
production-browser baseline. The committed candidate will receive a separate
native rerun before its graphics gate is considered complete.

Cross-runtime PNG bytes are not an equality gate because native and browser encoders differ. An additional decoded RGB comparison found the idle image identical; Explore 2D differed in 504 of 614,400 pixels (0.082%), and the other six focused captures differed in 389 pixels (0.063%). Differences lie in the label regions, consistent with text rasterization variance. Scene digests and camera matrices remained identical. Keep this pixel variance separate from the invariant scene checks when reviewing future runs.

Evidence was retained outside the repository:

- `%TEMP%\jarvis-graphics-native-20261002-a\report.json` and eight PNGs.
- `%TEMP%\jarvis-graphics-browser-production-20261002-c\report.json` and eight PNGs, including the successful native-to-browser invariant comparison.
- `%TEMP%\jarvis-graphics-browser-20261002-c` and `...-d`: independent development-browser repeatability checks.

## Repeat the checks

Build and serve the production frontend. Use a free loopback port; these commands intentionally do not require a configured Vault or a GraphPreview server:

```powershell
cd frontend
npm run build
node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 8897 --strictPort
```

In another shell, run the browser gate with a **new** output directory. The runner resolves an installed `playwright` package, or accepts its entry file via `--playwright-module` / `JARVIS_PLAYWRIGHT_MODULE`. No browser dependency was added to the application. It defaults to installed Edge in headless mode; `--headed` records a visible-browser run.

```powershell
node frontend/scripts/verify-graphics-regression.mjs `
  --url http://127.0.0.1:8897/graphics-regression.html `
  --output "$env:TEMP\jarvis-graphics-browser-new" `
  --playwright-module "C:\path\to\playwright\index.mjs"
```

Append `--baseline "C:\path\to\previous\report.json"` to compare. Same-browser-build comparisons require scene, resource and PNG equality. Cross-runtime/build comparisons require scene invariants and report screenshot/resource differences for review. P95 ratios are recorded without an arbitrary machine-independent speed threshold. Reports include browser version and frontend revision/dirty/build timestamp.

After building the Host with those same frontend assets, close ordinary JARVIS instances and run the existing isolated smoke wrapper:

```powershell
dotnet build host/Jarvis.Host/Jarvis.Host.csproj -c Release --no-restore
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify-renderer-smoke.ps1 `
  -HostPath "$PWD\host\Jarvis.Host\bin\Release\net8.0-windows\Jarvis.Host.exe" `
  -Culture en-US -GraphicsRegression `
  -GraphicsReportPath "$env:TEMP\jarvis-graphics-native-new"
```

The native command first completes ordinary shell smoke assertions, then runs the independent graphics entry, captures browser-composited WebView PNGs, crops/resizes the stage to 960 × 640, writes its report and exits. The wrapper keeps the native taskbar visible, uses an isolated profile/data root, preserves produced graphics artifacts on failure, refuses to overwrite an output directory, and cleans up its own process tree. It was exercised through Windows PowerShell 5.1.

Validation also passed: frontend ESLint, 14 focused clock/fixture/editor/runtime tests, 17 Host smoke-option tests, frontend production build, and Host Release build with zero warnings/errors. Large Vault scales, other GPUs/drivers, mixed-DPI capture and adaptive performance are outside this fixed 96-node gate; they should retain separate results rather than being inferred from this baseline.

## Final release candidate: 76d22a0

The packaged `0.1.0-rc.20261002` frontend passed all eight cases in Edge and native WebView2. Both runtime reports identify revision `76d22a020fe320319dd4094a5b85941cecb97328`, `dirty: false`, and frontend build time `2026-10-02T15:21:15.981Z`; both report browser version `154.0.4258.48`. The packaged `version.json` agrees on version, source commit and clean state, with package build time `2026-10-02T15:20:14.5824963+00:00`.

Every case has exactly matching camera matrices, simulation/shader times, position and signal digests, canvas/context state, scene metadata, and complete render/memory counters across Edge and WebView2. The fixture manifest also matches. Draw calls are 13 and textures are 10 throughout; geometries are six except for the recorded seventh geometry during reentry. Edge additionally matches the earlier clean `3d9ee38` packaged baseline and production-browser baseline in all eight scene/resource records and PNG hashes. Within each runtime, B changes the image, restoring A reproduces its exact PNG, and context restoration reproduces the reentry PNG.

| Case | Differing decoded pixels, WebView2 versus Edge | Edge / WebView2 P95 |
| --- | ---: | ---: |
| `idle` | 0 | 4.6 / 4.7 ms |
| `explore-2d` | 504 (0.08203125%) | 4.6 / 4.6 ms |
| `explore-3d` | 389 (0.0633138%) | 4.6 / 4.6 ms |
| `frozen-a` | 389 (0.0633138%) | 4.6 / 4.6 ms |
| `frozen-b` | 389 (0.0633138%) | 4.6 / 4.6 ms |
| `frozen-a-restored` | 389 (0.0633138%) | 4.6 / 4.6 ms |
| `reentry` | 389 (0.0633138%) | 4.7 / 4.8 ms |
| `context-restored` | 389 (0.0633138%) | 4.7 / 4.8 ms |

All captures are 960 × 640 pixels. Cross-runtime PNG file hashes differ, including the pixel-identical idle capture, because capture/encoding differs. Decoded differences in the focused scenes are confined to label glyph regions, consistent with text rasterization variance; maximum channel differences are 156/255 in 2D and 94/255 in the other six captures. The node/edge scene pixels agree.

P95 describes actual active frame callback intervals while simulation advances in fixed 1/60-second steps. Each runtime records 179 interval samples for the first six cases and 297 for the final two; frozen cases retain the preceding active sample window. These values do not measure GPU execution time, presented display FPS or general application performance. The observed cross-runtime difference is 0–0.1 ms.

Final-candidate evidence:

- Tracked native [report and build identity](candidate-native-graphics-2026-10-02/report.json), with all eight PNGs in the same directory.
- Edge report and eight PNGs: `C:\Users\Administrator\AppData\Local\Temp\jarvis-graphics-packaged-76d22a0-20261002-a\report.json` (`%TEMP%\jarvis-graphics-packaged-76d22a0-20261002-a`). The same directory contains `production-baseline-comparison.json` and `packaged-build-identity.json`, including the complete packaged asset SHA-256 inventory.
