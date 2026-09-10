# Independent 2D / 3D controls

Validated on 2026-09-08 against the local Obsidian preview (808 notes and 7,809 source relations).

## Behavior

- The right rail remains available beside the expanded settings panel. Its zoom readout shows a percentage in 2D and camera Z in 3D.
- Wheel input over the canvas changes orthographic zoom in 2D. In 3D it dollies along the camera's local Z axis, including after orbiting; perspective zoom remains 1 and FOV stays fixed.
- Each camera retains its position and target across dimension changes. A previous Fit/Reset command is not replayed when the graph scene mounts for the other dimension. Resetting 3D does not reset 2D zoom.
- The settings panel edits the active dimension. Node/edge styles, labels, layout forces and spacing, scene settings, quality, and FX values persist independently. Presets and reset affect only the active dimension. Orb-only layers are explicitly labeled as visible outside Explore.
- Version 6 and older settings migrate without discarding custom values. Former shared styles initialize both dimensions; existing separate FX profiles are retained. Version 7 JSON and named-profile exports round trip both sets.
- The active profile directly controls Bloom and the node, halo, pulse, relation, and signal layers. Detailed core/halo sizes reach shader uniforms independently. Explicit Bloom uses the existing quality-bounded pass implementation.
- Relation bands clip endpoints at the near plane before screen-space extrusion and use alpha compositing to avoid unbounded additive overexposure in dense graphs.
- Dimension changes can replace the scene without a cross-dimension morph. The GPU canvas and renderer remain mounted. Debounced layout values from the other dimension are never applied to the new scene.

## Verification

- Frontend unit/contract suite: 474 passing tests, including new dimension isolation, preset/reset/undo, v6 migration, JSON round-trip and wheel-input tests.
- Browser: 1280×720, 1920×1080, 2560×1440 and 1280×1032, both dimensions. No horizontal overflow; expanded settings do not overlap the fixed tool rail. One canvas remains connected throughout.
- Real mouse-wheel input: 2D zoom changes without changing camera Z; 3D camera Z changes without changing perspective zoom. Orbit then dolly moves along the rotated camera axis.
- Browser controls: keyboard-adjusted 3D particle master scale to 1.8 and 2D to 0.6; switching and page reload retain both values. Scrolling inside the panel leaves the camera unchanged.
- Bloom was toggled through its actual UI switch. Canvas-only screenshots changed across 46.6% of pixels above a 12-channel-value difference threshold. Browser checks reported no JavaScript or shader errors.
- Production build, lint and formatting checks pass. The existing large graphics-bundle warning remains.

Browser checks used Edge with software rendering in the local preview. Native WebView2/GPU hardware was not separately exercised in this change. Temporary QA scripts, screenshots and JSON results stay outside the repository under the local Codex temporary directory.
