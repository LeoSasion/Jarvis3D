---
name: JARVIS Operator HUD Workspace
description: A themeable, source-truthful Windows operator HUD for developers and local agents.
colors:
  blackbox-black: "#000000"
  canvas-black: "#000000"
  surface-quiet: "#070605"
  surface-raised: "#100e0c"
  surface-high: "#100e0c"
  surface-hover: "#181715"
  instrument-white: "#fffdf8"
  ink-secondary: "#f5f1e9"
  ink-muted: "#aaa39a"
  frame-weak: "#1c1a17"
  frame: "#35312d"
  frame-strong: "#77716a"
  signal-core: "#ff5a00"
  command-orange: "#ff5a00"
  command-orange-pale: "#ff7429"
  command-fill: "rgb(255 90 0 / 10%)"
  command-fill-strong: "rgb(255 90 0 / 16%)"
  status-warning: "#ffb020"
  status-danger: "#f97066"
typography:
  display:
    fontFamily: "Bahnschrift SemiCondensed, Segoe UI Variable Display, Segoe UI, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Bahnschrift SemiCondensed, Segoe UI Variable Display, Segoe UI, sans-serif"
    fontSize: "18px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Segoe UI Variable Text, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.08em"
  body:
    fontFamily: "Segoe UI Variable Text, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  label:
    fontFamily: "Segoe UI Variable Text, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.1em"
  meta:
    fontFamily: "Cascadia Mono, Cascadia Code, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "0.1em"
rounded:
  square: "0px"
  control: "8px"
  panel: "12px"
  message: "10px"
  menu: "10px"
  menu-item: "6px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-6: "24px"
components:
  command-button:
    backgroundColor: "{colors.blackbox-black}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "34px"
  command-button-active:
    backgroundColor: "{colors.command-fill}"
    textColor: "{colors.instrument-white}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "34px"
  command-input:
    backgroundColor: "{colors.blackbox-black}"
    textColor: "{colors.instrument-white}"
    typography: "{typography.body}"
    rounded: "{rounded.panel}"
    padding: "10px 12px"
  hud-panel:
    backgroundColor: "{colors.blackbox-black}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.square}"
    padding: "0px"
  taskbar-agent:
    backgroundColor: "{colors.blackbox-black}"
    textColor: "{colors.instrument-white}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "0 14px"
    width: "clamp(156px, 13vw, 208px)"
    height: "56px"
  taskbar-application:
    backgroundColor: "{colors.blackbox-black}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "0px"
    width: "48px"
    height: "56px"
  system-rail-collapsed:
    backgroundColor: "{colors.blackbox-black}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.meta}"
    rounded: "{rounded.square}"
    padding: "8px"
    width: "116px"
---

# Design System: JARVIS Operator HUD Workspace

## Overview

**Creative North Star: "The Grounded Operator HUD"**

JARVIS is intentionally a science-fiction-inspired operator HUD for developers
and Agent-assisted work. The identity is allowed to be dramatic: the passive
neural field, compact telemetry, vector marks, and instrument typography may
remain visible at rest. It is not a fictional simulation, however. Applications,
the current task, conversation, and commands stay operable above the atmosphere;
every system claim is Host-backed or explicitly labeled as simulated.

The Agent Harness, desktop chrome, and menus take their structural cues from
OpenClaw's WebUI and TUI. This is an aesthetic and interaction reference, not a
color clone: hierarchy, density, whitespace, natural typography, quiet
navigation, grouped conversation turns, a compact composer, and restrained
progressive disclosure are the governing qualities. JARVIS keeps its own product
identity and does not copy OpenClaw branding, imagery, or product names.

The graph remains a specialized visual workspace inside this quieter shell. Its
rendering, layout, and user appearance controls are not redesigned by this shell
calibration; it may inherit shared semantic colors only.

**Key Characteristics:**

- Edge-to-edge working space with restrained raised layers and theme-owned color.
- Operator-HUD identity with readable 14px task and conversation copy.
- Grouped conversation turns, quiet metadata, and a compact bounded composer.
- Low-noise navigation that reveals secondary actions only when they are useful.
- Square desktop rails with softly rounded conversational and transient controls.
- Motion reserved for 100–180ms interaction feedback and truthful live state.
- Direct controls with visible keyboard and recovery affordances.
- Explicit provenance whenever a surface is simulated rather than Host-backed.

## Colors

Color is a replaceable system input, not the source of the OpenClaw-inspired
aesthetic. The frontmatter values describe the default Carbon theme pack only.
Whole theme packs own background, surfaces, text, borders, accent, semantic
states, selection, elevation, and graph-facing semantic values. Users may switch
packs or customize a complete palette without changing component anatomy.

The shipping semantic override layers (`vector-shell.css`,
`operator-workspace.css`, `shell-aesthetic.css`, and global visual effects)
consume centralized theme tokens and contain no private color literals. The
older `styles.css` remains a geometry and compatibility base; its historical
color declarations are fallbacks only and must not be referenced by new work.
Graph internals keep their own appearance controls and may inherit only the
shared semantic values explicitly exposed by the theme system.

### Primary

- **Command Orange** (`#ff5a00`): Active selection, executable
  commands, relation routes, focused nodes, checked state, and brief state glow.
- **Signal Core** (`#ff5a00`): The live interaction value used
  where a live signal needs to read separately from ordinary command chrome.

### Neutral

- **Blackbox Black** (`#000000`): The uninterrupted desktop,
  rails, taskbar, menus, and default control surface.
- **Canvas Black** (`#000000`): The center graph and deepest internal canvas.
- **Quiet Black** (`#070605`) and **Raised Black** (`#100e0c`): Small tonal
  distinctions inside dense workspaces and transient
  layers; they do not create nested card stacks.
- **Instrument White** (`#fffdf8`): Primary labels, selected
  content, critical readouts, and trustworthy system facts.
- **Secondary Instrument Ink** (`#f5f1e9`) and **Muted Instrument Ink**
  (`#aaa39a`): Supporting values, metadata, inactive labels, and unavailable
  state.
- **Weak Frame Gray** (`#1c1a17`), **Frame Gray** (`#35312d`), and **Strong Frame
  Gray** (`#77716a`): Structural lines scaled from internal ledgers
  to outer rails and focus-bearing boundaries.

### Tertiary

- **Command Orange Pale** (`#ff7429`): Limited high-energy annotation or warning
  detail.
- **Status Warning** (`#ffb020`) and **Status Danger** (`#f97066`): Reserved
  semantic states; do not use them as general decoration.

### Named Rules

**The Armed Signal Rule.** The active theme accent means selected, connected,
executable, or live; an idle ornament does not receive the same authority.

**The Primary Ink Rule.** The theme's primary ink carries facts and primary
content. Accent may lead the eye, but it must not replace readable information.

**The Effects Need Clearance Rule.** Glass, gradients, cool accents, rings, glow,
and scan motion are allowed when they reveal a real mode or state and remain
subordinate to the theme's content and action hierarchy.

## Typography

**Display Font:** Bahnschrift SemiCondensed with Segoe UI display fallbacks

**Body Font:** Segoe UI Variable Text with Segoe UI fallback

**Label/Mono Font:** Cascadia Mono with Cascadia Code and Consolas fallbacks

**Character:** HUD typography is intentional but bounded. Condensed display type
carries workspace identity and major mode declarations; monospaced type is
reserved for code, shortcuts, measurements, and terminal-like readouts.
Navigation, conversation, menus, settings, and explanatory status copy use the
readable body family so atmosphere never reduces comprehension.

### Hierarchy

- **Display** (Bahnschrift SemiCondensed, weight 600, 22px, line-height 1,
  letter-spacing -0.01em): The largest identity or workspace title. Use sparingly
  and keep the line compact.
- **Headline** (Bahnschrift SemiCondensed, weight 500, 18px, line-height 1.2,
  letter-spacing -0.01em): Major workspace headings and important mode
  declarations.
- **Title** (Segoe UI Variable Text, weight 600, 13px, line-height 1.2,
  letter-spacing 0.08em): Window titles, selected object names, navigation, and
  group identities.
- **Body** (Segoe UI Variable Text, weight 400, 14px, line-height 1.45):
  Explanatory copy, Agent responses, and longer status messages. Keep reading
  measures bounded rather than stretching prose across a full monitor.
- **Label** (Segoe UI Variable Text, weight 600, 12px, line-height 1,
  letter-spacing 0.1em): Tabs, navigation items, field labels, and ordinary
  commands. Use sentence case by default.
- **Meta** (Cascadia Mono, weight 400, 12px, line-height 1.2, letter-spacing
  0.1em): Timestamps, dimensions, paths, counters, capabilities, and secondary
  telemetry.

Tabular numerals are the default for values and clocks. Uppercase is a functional
signal for short labels, not a treatment for paragraphs.

### Named Rules

**The Console Grammar Rule.** Shell language is natural, concise, and sentence
case. Uppercase monospace belongs only to actual console grammar, shortcuts, and
compact machine measurements.

**The One Readout Rule.** A region may have one dominant value or title. Supporting
data steps down through size, weight, and ink before another accent is introduced.

## Layout

JARVIS owns the full desktop viewport. The primary design baseline is
**1920×1080 at 100% Windows scale**: a 56px top rail, a 64px bottom taskbar,
40px persistent operator targets, and an operational workspace touching the
rails' inner edges. The desktop grid reserves a fixed left region for shortcuts,
a flexible center for the interactive local knowledge graph or managed windows,
and a bounded right rail for telemetry. The 1280×720 layout remains a compact
compatibility state with a 48px top rail and 52–56px taskbar; it is not the scale
from which the high-resolution composition is visually derived.

At 1920×1080 the default desktop columns use a 104px shortcut rail, a flexible
center, and a telemetry rail capped at 320px. The desktop exposes six fixed entry
slots; remaining desktop items stay available through Start and Quick Search.
Label length never changes icon coordinates. The taskbar
reserves Start and the single persistent Agent slot first, gives all remaining
width to pinned and running applications, and keeps the system tray at the far
edge. Application items remain density-planned rather than stretched merely to
fill space; contextual labels appear above hover, focus, or the active app
without changing rail geometry. Overflow preserves application order.

Larger displays step up by content breakpoint rather than applying `zoom` to the
whole shell. A nominal 2560×1440 composition uses 64px/72px top and bottom rails,
44px operator targets, larger desktop marks inside the same 104px rail, and the
same bounded 320px telemetry rail. A 3840×2160 composition uses 72px/80px rails
and 48px operator targets without turning telemetry into a wider dashboard.
Center-canvas space remains the main beneficiary of additional pixels;
typography and controls increase only one measured step at each breakpoint.

In the linked three-pane workspace, a nominal system rail may collapse to 116px
and return the released width to the Agent. A new warning or error may expand it,
but manually dismissing the same attention state must not create an expansion
loop. Compact mode retains only Host, Agent, attention count, and the highest
priority truthful status.

Maximized and docked managed windows touch the rails without an inherited floating
gutter, outline, or shadow. Explorer uses navigation, content, and inspector
columns when space permits. The linked Explorer/Agent workspace becomes one
causal composition rather than adjacent framed panels; its route overlay follows
the currently related source and message.

Responsive behavior is desktop-first. The top rail compresses around 1380px and
1080px. Linked workspaces move through three-pane, two-pane, drawer, and
single-pane states at available widths of 1440px, 1180px, and 920px. Explorer
container queries remove its inspector at 1039px; at 819px its navigation narrows
to 124px while command labels and keyboard hints step away. The graph toolbar
keeps all four buttons in a four-column control group after the zoom readout is
removed. At 640px and below, Graph Visual Settings becomes a workspace-height
drawer instead of a floating panel over the graph. The taskbar remains icon-first
at the 520px application-container threshold. Height compression begins at 820px;
at 720px and below the taskbar contracts from 56px to 52px and the linked
workspace uses its shortest composition.

At 144dpi and 192dpi, the smallest graph, telemetry, and control roles step up in
size while CSS-pixel geometry remains stable under Windows scaling. 144dpi raises
persistent graph controls and labels to at least 40px/12px; 192dpi raises them to
at least 44px/13px. Coarse pointers independently enforce a 44px target floor.
Resolution, DPI, and pointer input are separate constraints and resolve to the
largest applicable semantic token.

Spacing follows the observed 4px base rhythm: 4, 8, 12, 16, 24, 32, and 40px.
Conversation body copy defaults to 14px and does not fall below 13px. Persistent
action text does not fall below 12px; compact telemetry and graph metadata may use
10–11px at 96dpi, then step up at 144dpi and 192dpi. Persistent interactive hit
areas do not fall below 28px and coarse pointers use a 44px floor.

## Elevation & Depth

The system is quiet by default. Resting desktop rails remain planar, while the
Agent composer, menus, and transient panels may use one soft black shadow and one
tonal step to clarify their temporary layer. Do not combine a heavy border and a
heavy shadow, and never use colored zero-offset glow as generic elevation.

Depth appears as a response to state. A small local accent emission may mark an
active node, live route, focused control, or ready system channel. Stronger
dimensional effects are permitted for a deliberate mode or transition, but they
must not imply nonexistent activity or blur the underlying vector geometry.

### Shadow Vocabulary

- **Status emission** (`0 0 4px rgb(255 90 45 / 30%)`): A compact glow for live
  markers, selected nodes, and active route terminals.
- **Active emission** (`0 0 6px rgb(255 90 45 / 22%)`): A restrained halo for a
  currently working state; never a panel-wide ambient fog.
- **Focus inset** (`0 0 0 1px rgb(255 90 45 / 28%) inset`): Reinforces an active
  field or command without lifting it from the surface.
- **Context label** (`0 8px 18px rgb(0 0 0 / 72%)`): The taskbar's contextual
  application label, positioned above a stable icon slot.
- **Transient overlay** (`0 12px 36px rgb(0 0 0 / 48%)`): Actionable notices and
  the selected graph-node inspector; never a resting card treatment.
- **Linked drawer** (`-18px 0 44px rgb(0 0 0 / 82%)`): Narrow linked-workspace
  separation when the Agent becomes a drawer.

### Named Rules

**The Flat-at-Rest Rule.** Geometry is planar until interaction or truthful system
state creates a reason for depth.

**The Local Emission Rule.** Glow stays attached to the node, line, edge, or
control that owns the state; it does not wash across unrelated content.

## Shapes

The desktop frame, taskbar, window bounds, graph canvas, and structural rails stay
square. Conversational and transient tool surfaces use the implemented radius
vocabulary: 8px controls, 12px panels and composers, and 10px message bubbles.
Context menus are the compact exception at 10px for the menu and 6px for each
item. This is a functional distinction between persistent workspace geometry and
temporary interaction layers, not a license to round every container. Structural
rails use 0.5–1px hairlines; keyboard focus may reach 2px when legibility requires
it.

Vector icons use square line caps, miter joins, deterministic SVG or Canvas
geometry, and no bitmap-dependent ornamental frame. Full rectangular boundaries
belong to selected sources, accepted payloads, editable directives, confirmations,
and actionable errors. At rest, spacing and ledger lines should usually carry the
composition.

Relationship routes use an exact horizontal-vertical-horizontal path between
real ports. Knowledge-graph geometry uses points, orthogonal or angular relations,
small square nodes, and sparse type or region labels. Decorative circular or
chamfered forms may be introduced when a specific mode needs them; they are not
the default silhouette.

### Named Rules

**The Legible Stroke Rule.** Structural lines remain 0.5px; state and relation
lines use 1–1.5px; a keyboard focus boundary may reach 2px without changing the
control's geometry.

## Components

### Buttons

- **Shape:** 8px radius inside Agent and transient panels; square on taskbar and
  persistent desktop rails.
- **Primary:** Theme surface with primary or secondary ink; ordinary labels use
  the body role and sentence case.
- **Hover / Focus:** Theme action fill appears locally, text rises to primary ink,
  and focus receives a precise accent outline or inset marker.
- **Active:** An accent edge, underline, or state node identifies the chosen
  command. Avoid scaling the control or shifting surrounding layout.
- **Danger:** Status Danger is restricted to destructive actions and confirmation
  states.

### Cards / Containers

- **Corner Style:** Square for workspace framing; 12px for transient panels and
  composers, 10px for Agent messages and menus, and 6px for menu items.
- **Background:** The active theme's base or one tonal surface step.
- **Shadow Strategy:** Flat for workspace framing; soft black depth for transient
  layers; use local emission only for real state.
- **Border:** Hairline frames and ledger dividers. Prefer open regions over a stack
  of equal framed boxes.
- **Internal Padding:** Draw from the 8, 12, 16, and 24px rhythm according to
  density.

### Inputs / Fields

- **Style:** Theme field, strong neutral stroke, primary-ink value, muted metadata,
  and no decorative fill.
- **Focus:** The theme accent replaces or reinforces the neutral stroke. Focus must
  remain visible without relying on glow alone.
- **Error / Disabled:** Danger is semantic; disabled fields step down to Muted Ink
  while preserving legibility.

### Navigation

Top rail, taskbar, Explorer navigation, tabs, and menus share a flat command
grammar. Navigation uses one clear primary path, quiet grouping, natural labels,
and stable geometry. Secondary commands appear on hover, focus, selection, or
explicit disclosure instead of occupying permanent dashboard space. Theme tokens
own hover and active colors. Functional commands use Fluent line icons, while
native application icons retain their Windows identity.

### Taskbar

The taskbar is a breakpoint-owned command rail, not a floating dock: 52–56px in
the 1280×720 compact state, 64px at the 1920×1080 baseline, 72px at 2560×1440,
and up to 80px at 4K. Start is followed by the single persistent Agent launcher,
then pinned and running applications, then the system tray. Inactive applications
have no accent underline. A running but inactive application may use a small
neutral point; the active application owns the accent marker. Icon slots remain
fixed at 48px whenever an application has a recognizable icon. Full accessible
names remain available even when visible labels become contextual overlays;
hover, focus, and active state never trigger a width recalculation.

### Context Menus

Desktop, Explorer, and taskbar menus use the active theme's elevated surface,
hairline, primary ink, muted ink, and action tokens, with a 10px panel radius and
6px item radius. Decorative headers are omitted; keyboard shortcuts remain
compact and monospaced. Menus reveal only the commands relevant to the current
context, use one soft theme-owned shadow, and enter in 180ms or less.

### Explorer Rows

Rows are ledger entries rather than cards. Names carry primary contrast;
metadata remains secondary. Hover adds a weak action fill, and selection uses an
accent boundary or leading marker without moving the row. In linked mode,
vertical cell walls yield to a single horizontal ledger rhythm.

### Agent Conversation and Linked Payloads

The conversation is the primary visual layer and uses a centered readable column
bounded near 48rem. Consecutive turns are visually grouped by sender and intent,
with consistent bubble geometry, 10–16px internal padding, and 10–14px rhythm
between groups. Assistant and user turns use distinct theme-owned surfaces rather
than different ornamental frames. Sender, timestamp, and turn actions live in a
quiet footer; nonessential actions reveal on hover or keyboard focus.

Tool calls and linked metadata use compact 10px-radius disclosure cards with
inline pending, success, or error state. The composer is one bounded 12px-radius
surface near 48rem, with a one-line minimum textarea that grows only as content
requires, a compact action row, and a quiet focus ring. It must not become a tall
dashboard or repeat status already visible elsewhere. Only the latest genuinely
related message receives a route anchor.

### Linked System Rail

The rail is a disclosure surface rather than a wall of permanent telemetry.
Nominal state starts collapsed; new warning or error attention expands it once,
severity escalation or a genuinely reappearing event may expand it again, and a
manual collapse remains respected for the same event. The toggle is a real
button with `aria-expanded` and stable controlled content. Collapsed state keeps
only Host, Agent, attention count, and the priority item; expanded state reveals
performance, connections, notifications, and tasks without inventing values.

### Knowledge Graph

The desktop center is a bounded, deterministic vector workspace. Its default
source is a read-only Obsidian Vault index supplied by the Windows Host in
revision-stable chunks; Explorer metadata remains a smaller contextual graph.
The native index exposes only Vault-relative paths, titles, tags, aliases, and
relation metadata. Note bodies and absolute Vault paths never cross into the
renderer.

2D and 3D are camera/layout modes of one React Three Fiber scene, not separate
visual products. Nodes are instanced, relations are batched, labels use a sparse
offline atlas, and force layout runs in a Worker. The passive desktop view does
not claim pointer input; explicit Explore mode enables search, selection,
pan/orbit, Fit, Reset, keyboard navigation, and relation inspection. Selected
nodes and their actual neighbors receive the active theme accent while relation type,
direction, group, and weight remain semantically visible.

Appearance is user-owned within bounded performance limits. Built-in presets
and named Global/Vault profiles cover node prominence and palette, relation
opacity/color, label density, force tuning, stars, Bloom, quality, and 2D/3D.
Profiles are versioned, importable/exportable JSON and can be undone as a single
change. Requested settings remain distinct from effective DPR, adaptive quality,
reduced-motion, forced-color, and GPU texture constraints shown in diagnostics.

All authored GPU content shares one WebGL2 renderer, R3F scheduler, color/tone
mapping policy, resource lifecycle, and EffectComposer. Static or hidden scenes
stop submitting frames. Context loss, display/DPR changes, pixel budgets, slow
frame downgrades, and disposal are handled by the shared runtime; terminals do
not consume a second WebGL context.

When no verified source exists, an open three-command ledger may offer local
search, Explorer, or a desktop-only session; it never claims that choosing a
file has already connected the graph. Browser fixtures remain visibly labeled
as simulated and never become a verified local graph by presentation alone. The
center has no generic Agent call-to-action. Reduced Motion keeps graph geometry
and a deterministic static state while removing nonessential animation.

## Do's and Don'ts

### Do:

- **Do** make the current command, selection, and causal relationship immediately
  identifiable through the active theme's sparse accent.
- **Do** let the active theme's primary ink carry facts, filenames, commands, and
  results.
- **Do** preserve OpenClaw-like hierarchy, density, whitespace, natural type,
  grouped chat, compact composition, and progressive disclosure across Agent,
  desktop, and menus regardless of the selected palette.
- **Do** source every product color from the centralized theme definition and
  switch whole palettes as one coherent unit.
- **Do** preserve the fixed shell geometry: compact rails, stable desktop slots,
  and a taskbar that leaves maximum width to real applications.
- **Do** use point-line vector geometry for product-owned identity and system
  relationships.
- **Do** attach animation and emission to real transitions or live state, and
  provide reduced-motion and forced-color behavior.
- **Do** expose whether system, Explorer, graph, and taskbar state is Host-backed,
  simulated, unavailable, or not inspected.
- **Do** allow glass, gradients, rings, glow, scanning, or cool accents when a
  scoped mode genuinely benefits from them and the command hierarchy remains
  intact.

### Don't:

- **Don't** confuse the OpenClaw reference with a black-and-orange skin; copying
  colors without its hierarchy and restraint does not satisfy this design.
- **Don't** add component-level color literals or one-off palette constants.
- **Don't** use the active accent everywhere; it loses command authority when
  every label or border competes for it.
- **Don't** create false telemetry, false Agent capability, false file access, or
  decorative activity that reads as real system state; browser preview choices
  must never be labeled as effective Windows changes.
- **Don't** turn every region into an equally weighted framed card or reintroduce
  floating-window gutters around maximized work.
- **Don't** duplicate the persistent Agent launcher in the top rail or desktop
  center.
- **Don't** let labels, hover transforms, or badges move fixed icon coordinates or
  cause taskbar applications to jump.
- **Don't** keep an idle scan or route animation running when it no longer
  communicates work, especially under reduced-motion preferences.
