# JARVIS Design References

The durable visual contract lives in [`DESIGN.md`](../../DESIGN.md). This
directory keeps only the smallest useful raster set for composition review;
runtime behavior, accessibility, and Host-backed state remain authoritative.

## Current reference set

- `references/jarvis-operator-hud-overview.png` — current 1920×1080 browser-
  preview capture of the operator HUD. Simulated telemetry is visibly labeled.
- `references/jarvis-neural-orb-reference.jpg` — orange neural-orb emission and
  node-energy reference for the passive 3D idle field.
- `references/jarvis-explorer-workspace.png` — Explorer-only workspace
  composition: navigation, content, and Inspector between the global rails.
- `references/jarvis-explorer-agent-workspace.png` — explicit Explorer-to-Agent
  linked workflow with persistent system telemetry.

These images define composition and hierarchy, not literal runtime data. The
formal responsive validation matrix remains 1280×720, 1920×1080, and
2560×1440. Retired blue/cyan studies, temporary comparison sheets, and local
QA screenshots are intentionally excluded.

## Graph concept directions

The requested [3D neuron and nebula concept sketches](concepts/README.md)
explore distribution, depth and selective connection visibility. The user chose
neurons first: the original sketch grounds 2D, while the
[spatial revision](concepts/3d-neuron-depth-notes.md) grounds the independent
3D neuron preset. Nebula remains an unselected concept.

The selected [neuron sphere](concepts/3d-neuron-sphere-concept.png) now grounds the
idle state after exiting Explore. Its shared-style mode links 2D, 3D and idle FX
while keeping layouts and cameras separate; previous settings are backed up.
See the [implementation notes](concepts/3d-neuron-volume-notes.md).

The [shared filament study](concepts/neuron-filament-notes.md) compares both
selected references and records the tapered ribbon material, translucency,
current parameters and live captures for sphere, 3D and 2D.
