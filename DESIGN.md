---
name: JARVIS Operator Blackbox
description: A tactical Windows command surface for geeks and code workers.
colors:
  blackbox-black: "#000000"
  canvas-black: "#010101"
  surface-quiet: "#020202"
  surface-raised: "#050505"
  surface-high: "#080808"
  instrument-white: "#f5f1e9"
  ink-secondary: "#c0bbb3"
  ink-muted: "#837d75"
  frame-weak: "rgba(245, 241, 233, 0.15)"
  frame: "rgba(245, 241, 233, 0.28)"
  frame-strong: "rgba(245, 241, 233, 0.54)"
  signal-core: "#ff5a00"
  command-orange: "#ff6a00"
  command-orange-pale: "#ffb13f"
  command-fill: "rgb(255 106 0 / 4%)"
  command-fill-strong: "rgb(255 106 0 / 7%)"
  status-warning: "#ff9b50"
  status-danger: "#ff5a3c"
typography:
  display:
    fontFamily: "Bahnschrift SemiCondensed, Segoe UI Variable Display, Segoe UI, sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.08em"
  headline:
    fontFamily: "Bahnschrift SemiCondensed, Segoe UI Variable Display, Segoe UI, sans-serif"
    fontSize: "18px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.04em"
  title:
    fontFamily: "Bahnschrift SemiCondensed, Segoe UI Variable Display, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.08em"
  body:
    fontFamily: "Segoe UI Variable Text, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  label:
    fontFamily: "Cascadia Mono, Cascadia Code, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.1em"
  meta:
    fontFamily: "Cascadia Mono, Cascadia Code, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "0.1em"
rounded:
  square: "0px"
  micro: "1px"
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
    rounded: "{rounded.square}"
    padding: "0 12px"
    height: "34px"
  command-button-active:
    backgroundColor: "{colors.command-fill}"
    textColor: "{colors.instrument-white}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "0 12px"
    height: "34px"
  command-input:
    backgroundColor: "{colors.blackbox-black}"
    textColor: "{colors.instrument-white}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
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

# Design System: JARVIS Operator Blackbox

## Overview

**Creative North Star: "The Operator Blackbox"**

JARVIS is a tactical command environment, not a decorative science-fiction
dashboard. The interface should feel like a black-box console owned by a highly
technical operator: dense enough to support sustained code work, forceful enough
to make active commands unmistakable, and disciplined enough that every mark can
be traced to real state.

Black is operational space rather than a backdrop. Instrument White carries
trusted information, Frame Gray exposes structure, and Command Orange arms the
currently selected, connected, or executable path. The tone is militarized and
decisive without becoming theatrical; hierarchy comes from contrast, alignment,
and sparse signals before ornament.

The default material is flat and exact. Glass, gradients, rings, glow, scanning,
and other dimensional effects are available design tools rather than forbidden
motifs, but they earn their place only by clarifying hierarchy, mode, causality,
or live system state.

**Key Characteristics:**

- True-black, edge-to-edge operational space.
- Compact, high-density geometry for code-centered work.
- Warm-white facts, neutral structure, and sparse orange commands.
- Square vector marks, hairline dividers, and tabular data alignment.
- Motion reserved for transitions, active routes, and truthful live state.
- Tactical, direct controls with visible keyboard and recovery affordances.
- Explicit provenance whenever a surface is simulated rather than Host-backed.

## Colors

The palette is an instrument panel: Blackbox Black holds the field, Instrument
White reports truth, Frame Gray organizes it, and Command Orange identifies
armed or live paths. The frontmatter values are normative.

### Primary

- **Command Orange** (`#ff6a00`): Active selection, executable
  commands, relation routes, focused nodes, checked state, and brief state glow.
- **Signal Core** (`#ff5a00`): The hotter vector-energy value used
  where a live signal needs to read separately from ordinary command chrome.

### Neutral

- **Blackbox Black** (`#000000`): The uninterrupted desktop,
  rails, taskbar, menus, and default control surface.
- **Canvas Black** (`#010101`): The center graph and deepest internal canvas.
- **Quiet Black** (`#020202`), **Raised Black** (`#050505`), and **High Black**
  (`#080808`): Small tonal distinctions inside dense workspaces; they do not
  create floating card stacks.
- **Instrument White** (`#f5f1e9`): Primary labels, selected
  content, critical readouts, and trustworthy system facts.
- **Secondary Instrument Ink** (`#c0bbb3`) and **Muted Instrument Ink**
  (`#837d75`): Supporting values, metadata, inactive labels, and unavailable
  state.
- **Weak Frame Gray** (`rgba(245, 241, 233, 0.15)`), **Frame Gray**
  (`rgba(245, 241, 233, 0.28)`), and **Strong Frame Gray**
  (`rgba(245, 241, 233, 0.54)`): Structural lines scaled from internal ledgers
  to outer rails and focus-bearing boundaries.

### Tertiary

- **Command Orange Pale** (`#ffb13f`): Limited high-energy annotation or warning
  detail.
- **Tactical Warning** (`#ff9b50`) and **Tactical Danger** (`#ff5a3c`): Reserved
  semantic states; do not use them as general decoration.

### Named Rules

**The Armed Signal Rule.** Orange means selected, connected, executable, or live;
an idle ornament does not receive the same authority.

**The Instrument White Rule.** Warm white carries facts and primary content.
Orange may lead the eye, but it must not replace readable information.

**The Effects Need Clearance Rule.** Glass, gradients, cool accents, rings, glow,
and scan motion are allowed when they reveal a real mode or state and remain
subordinate to the black-white-orange command hierarchy.

## Typography

**Display Font:** Bahnschrift SemiCondensed with Segoe UI display fallbacks

**Body Font:** Segoe UI Variable Text with Segoe UI fallback

**Label/Mono Font:** Cascadia Mono with Cascadia Code and Consolas fallbacks

**Character:** Condensed display type creates command authority without consuming
horizontal space. Monospaced labels and numerals behave like system telemetry;
Segoe UI remains available for longer reading and native-feeling explanatory
copy.

### Hierarchy

- **Display** (Bahnschrift SemiCondensed, weight 600, 30px, line-height 1,
  letter-spacing 0.08em): The largest identity or workspace title. Use sparingly
  and keep the line compact.
- **Headline** (Bahnschrift SemiCondensed, weight 500, 18px, line-height 1.2,
  letter-spacing 0.04em): Major workspace headings and important mode
  declarations.
- **Title** (Bahnschrift SemiCondensed, weight 600, 13px, line-height 1.2,
  letter-spacing 0.08em): Window titles, selected object names, and command-group
  identities.
- **Body** (Segoe UI Variable Text, weight 400, 13px, line-height 1.45):
  Explanatory copy, Agent responses, and longer status messages. Keep reading
  measures bounded rather than stretching prose across a full monitor.
- **Label** (Cascadia Mono, weight 600, 11px, line-height 1, letter-spacing
  0.1em): Uppercase commands, tabs, status keys, and navigation items.
- **Meta** (Cascadia Mono, weight 400, 11px, line-height 1.2, letter-spacing
  0.1em): Timestamps, dimensions, paths, counters, capabilities, and secondary
  telemetry.

Tabular numerals are the default for values and clocks. Uppercase is a functional
signal for short labels, not a treatment for paragraphs.

### Named Rules

**The Console Grammar Rule.** Commands are short, uppercase, and monospaced;
explanations remain sentence case and readable.

**The One Readout Rule.** A region may have one dominant value or title. Supporting
data steps down through size, weight, and ink before another accent is introduced.

## Layout

JARVIS owns the full desktop viewport. The standard shell uses a compact 48px top
rail and a 56px bottom taskbar, with the operational workspace touching their
inner edges. The desktop grid reserves a fixed left region for shortcuts, a
flexible center for the interactive local knowledge graph or managed windows,
and a bounded right rail for telemetry.

The default desktop columns are approximately 176–220px on the left, a flexible
center, and 260–340px on the right. Desktop icons occupy fixed grid slots; label
length never changes icon coordinates. The taskbar reserves Start and the single
persistent Agent slot first, gives all remaining width to pinned and running
applications, and keeps the system tray at the far edge. Application icons use
stable 48px slots by default; contextual labels appear above hover, focus, or the
active app without changing rail geometry. Overflow preserves application order.

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
to 124px while command labels and keyboard hints step away. The taskbar remains
icon-first at the 520px application-container threshold. Height compression
begins at 820px; at 720px and below the taskbar contracts from 56px to 52px and
the linked workspace uses its shortest composition.
At 144dpi and 192dpi, the smallest graph, telemetry, and control roles step up in
size while CSS-pixel geometry remains stable under Windows scaling.

Spacing follows the observed 4px base rhythm: 4, 8, 12, 16, and 24px. Dense
regions may use ledger lines instead of extra padding. Body copy and persistent
action text do not fall below 11px; compact telemetry and graph metadata may use
8–10px at 96dpi, then step up at 144dpi and 192dpi. Persistent interactive hit
areas do not fall below 24px.

## Elevation & Depth

The system is flat by default. Resting surfaces do not float above Blackbox Black;
they are distinguished by structural hairlines, tonal steps close to black, and
the priority of their content. Persistent shadows are not part of ordinary
window, panel, menu, or taskbar geometry. Transient notices, drawers, contextual
taskbar labels, and the selected graph inspector may use one bounded black shadow
to separate an actionable layer from live content.

Depth appears as a response to state. A small local orange emission may mark an
active node, live route, focused control, or ready system channel. Stronger
dimensional effects are permitted for a deliberate mode or transition, but they
must not imply nonexistent activity or blur the underlying vector geometry.

### Shadow Vocabulary

- **Status emission** (`0 0 4px rgb(255 106 0 / 38%)`): A compact glow for live
  markers, selected nodes, and active route terminals.
- **Active emission** (`0 0 6px rgb(255 106 0 / 28%)`): A restrained halo for a
  currently working state; never a panel-wide ambient fog.
- **Focus inset** (`0 0 0 1px rgb(255 106 0 / 28%) inset`): Reinforces an active
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

The core form language is square and instrument-like. Ordinary controls and
surfaces use zero-radius corners; the shared micro-radius is 1px where browser or
native rendering benefits from a stable edge. Structural rails use 0.5px CSS
hairlines on high-density displays. State and relationship strokes use 1–1.5px,
while a keyboard focus boundary may reach 2px when legibility requires it.

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

- **Shape:** Square, compact, and flush with the local grid.
- **Primary:** Blackbox Black with Instrument White or Secondary Ink; short
  uppercase labels use the mono role.
- **Hover / Focus:** Command Fill appears locally, text rises to Instrument White,
  and focus receives a precise orange outline or inset marker.
- **Active:** An orange edge, underline, or state node identifies the chosen
  command. Avoid scaling the control or shifting surrounding layout.
- **Danger:** Status Danger is restricted to destructive actions and confirmation
  states.

### Cards / Containers

- **Corner Style:** Square by default.
- **Background:** Blackbox Black or one near-black tonal step.
- **Shadow Strategy:** Flat at rest; use the local emission vocabulary for state.
- **Border:** Hairline frames and ledger dividers. Prefer open regions over a stack
  of equal framed boxes.
- **Internal Padding:** Draw from the 8, 12, 16, and 24px rhythm according to
  density.

### Inputs / Fields

- **Style:** Black field, strong neutral stroke, Instrument White value, muted
  metadata, and no decorative fill.
- **Focus:** Command Orange replaces or reinforces the neutral stroke. Focus must
  remain visible without relying on glow alone.
- **Error / Disabled:** Danger is semantic; disabled fields step down to Muted Ink
  while preserving legibility.

### Navigation

Top rail, taskbar, Explorer navigation, tabs, and menus share a flat command
grammar. Neutral dividers define groups; hover uses Command Fill; active state
uses a sparse orange line, node, or icon. Functional commands use Fluent line
icons, while native application icons retain their Windows identity.

### Taskbar

The taskbar is a 56px command rail, not a floating dock. Start is followed by the
single persistent Agent launcher, then pinned and running applications, then the
system tray. Inactive applications have no orange underline. A running but
inactive application may use a small neutral point; the active application owns
the orange marker. Icon slots remain fixed at 48px whenever an application has a
recognizable icon. Full accessible names remain available even when visible
labels become contextual overlays; hover, focus, and active state never trigger
a width recalculation.

### Context Menus

Desktop, Explorer, and taskbar menus use Blackbox Black, a neutral hairline,
Instrument White commands, muted disabled text, square geometry, and orange only
for focus, selection, checked state, or destructive confirmation. Headers and
keyboard shortcuts remain compact and monospaced. Menus remain flat; they do not
borrow the shadows reserved for notices, drawers, inspectors, or contextual
taskbar labels.

### Explorer Rows

Rows are ledger entries rather than cards. Names carry primary contrast;
metadata remains secondary. Hover adds a weak command fill, and selection uses an
orange boundary or leading marker without moving the row. In linked mode,
vertical cell walls yield to a single horizontal ledger rhythm.

### Agent Conversation and Linked Payloads

Messages form an open timeline. One small square node identifies each turn;
assistant or streaming state may fill the node orange. Full boundaries are
reserved for accepted file context, completed linked results, editable directives,
and errors requiring action. Only the latest genuinely related message receives
a route anchor.

### Linked System Rail

The rail is a disclosure surface rather than a wall of permanent telemetry.
Nominal state starts collapsed; new warning or error attention expands it once,
severity escalation or a genuinely reappearing event may expand it again, and a
manual collapse remains respected for the same event. The toggle is a real
button with `aria-expanded` and stable controlled content. Collapsed state keeps
only Host, Agent, attention count, and the priority item; expanded state reveals
performance, connections, notifications, and tasks without inventing values.

### Knowledge Graph

The desktop center is a bounded, deterministic vector workspace driven by the
latest Explorer metadata snapshot. It groups up to 42 unique local entries,
supports filtering, temporary search expansion of collapsed groups, node
selection, drag repositioning, proportional wheel zoom from 72% to 220%, reset,
an inspector, Show in Explorer, and metadata-only Agent linkage. Low-contrast orthogonal edges
and labels provide structure; only the selected source, node, or real relation
receives Command Orange.

When no verified source exists, an open three-command ledger may offer local
search, Explorer, or a desktop-only session; it never claims that choosing a
file has already connected the graph. Browser fixtures remain visibly labeled
as simulated and never become a verified local graph by presentation alone. The
center has no generic Agent call-to-action. Reduced Motion keeps graph geometry
and a deterministic static state while removing nonessential animation.

## Do's and Don'ts

### Do:

- **Do** make the current command, selection, and causal relationship immediately
  identifiable through sparse Command Orange.
- **Do** let Instrument White carry facts, filenames, commands, and results.
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

- **Don't** use orange everywhere; it loses command authority when every label or
  border competes for it.
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
