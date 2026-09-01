# Third-party notices

JARVIS is distributed under the GNU General Public License version 3.0 only.

## eDEX-UI

- Project: eDEX-UI
- Copyright: GitSquared and eDEX-UI contributors
- Source: https://github.com/GitSquared/edex-ui
- Reference revision: `04a00c4079908788b371c6ecdefff96d0d9950f8`
- License: GNU General Public License version 3.0
- Use in JARVIS: interaction and information-architecture reference for terminal tabs, startup sequencing, theme switching, system-process views, and UI sound-event categories. The Windows terminal backend and React components in JARVIS are new implementations for WPF, WebView2, and ConPTY; no eDEX-UI media assets are included.

The original license is available at https://github.com/GitSquared/edex-ui/blob/master/LICENSE.

## Microsoft Fluent UI System Icons

- Package: `@fluentui/react-icons`
- Source: https://github.com/microsoft/fluentui-system-icons
- License: MIT

## Pi coding agent

- Project: Pi coding agent
- Package: `@earendil-works/pi-coding-agent`
- Copyright: Copyright (c) 2025 Mario Zechner
- Source: https://github.com/earendil-works/pi
- Pinned release: `v0.83.0`
- Pinned commit: `845d6ff1f6643aba440341cce877ce1c43ebbc39`
- License: MIT
- Use in JARVIS: separately executed, privately bundled JSONL RPC runtime for the embedded chat surface. JARVIS V1 disables Pi tools, extensions, skills, prompt templates, project context, themes, approvals, and Pi-managed sessions.

Release packages retain the complete upstream Windows x64 distribution together
with `AgentRuntime/LICENSE-Pi.txt`, `AgentRuntime/runtime.json`, and provenance.
The official upstream release provides SHA-256 checksums but no Authenticode or
detached release signature. JARVIS pins the exact archive and entry point,
derives a deterministic receipt for all 217 upstream files, verifies that full
runtime tree before launch, and does not silently update the runtime.

The original license is available at https://github.com/earendil-works/pi/blob/v0.83.0/LICENSE.

## Microsoft WebView2

- Package: `Microsoft.Web.WebView2`
- Source: https://www.nuget.org/packages/Microsoft.Web.WebView2
- License: Microsoft software license terms; see the package and installed runtime terms.

## xterm.js

- Packages: `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-search`
- Source: https://github.com/xtermjs/xterm.js
- License: MIT
- Use in JARVIS: terminal rendering, fit, and search. Windows process hosting is implemented by JARVIS through ConPTY.

## React and Vite

- React: https://github.com/facebook/react — MIT
- Vite: https://github.com/vitejs/vite — MIT

## JARVIS graphics runtime

- Three.js `0.182.0`: https://github.com/mrdoob/three.js — MIT
- React Three Fiber `9.7.0`: https://github.com/pmndrs/react-three-fiber — MIT
- React Postprocessing `3.0.5`: https://github.com/pmndrs/react-postprocessing — MIT
- postprocessing `6.39.4`: https://github.com/pmndrs/postprocessing — zlib
- d3-force-3d `3.0.6`: https://github.com/vasturiano/d3-force-3d — MIT
- Graphology `0.26.0`: https://github.com/graphology/graphology — MIT
- Noto Sans SC `5.2.8`: https://fontsource.org/fonts/noto-sans-sc — SIL Open Font License 1.1
- Use in JARVIS: the dynamically loaded, demand-driven WebGL2 graph scene, offline Canvas2D label atlas, single postprocessing pipeline, and Worker-owned graph topology/layout.

Release packages include the reviewed license text for every package in the
complete frontend production dependency closure under
`ThirdPartyLicenses/frontend/`. The accompanying
`FRONTEND-RUNTIME-LICENSES.json` receipt binds each text to its package-lock
location, locked version and integrity, SPDX identifier, reviewed license
SHA-256, and the exact `package.json`, `package-lock.json`, and policy inputs.
When an npm package omits its repository license file, the release builder uses
the reviewed copy retained under `scripts/licenses/`. Staging and verification
fail closed if a dependency, lock entry, reviewed license, or receipt field
changes.
