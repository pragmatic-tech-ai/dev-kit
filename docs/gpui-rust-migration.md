# GPUI / Rust Migration — Feasibility Study

A feasibility analysis of rebuilding the suite's UI stack (Mural, and the Plexus
workbench that hosts it) natively in Rust on **GPUI** — Zed's GPU-accelerated UI
framework — in place of the current TypeScript stack that renders to SVG/DOM.

This document records what was proven with working code, what remains open, and
the strategy and cost of executing the migration. It is written for engineers
evaluating or planning that migration; every performance number here came from a
throwaway probe crate run on Windows 11, not from estimation.

## Verdict in one paragraph

The native GPUI foundation is real and was validated end-to-end on Windows: the
framework builds and runs, paints Mural's own retained visual tree through a
single low-level canvas (bypassing GPUI's own element model), sustains real-time
frame rates, renders text and complex paths with holes, and lets us own
z-ordered, shape-accurate hit-testing, dragging, clipping, scrolling, images,
SVG, and hi-DPI. A minimal but real code editor — the one component with no
GPUI-native equivalent — was also built and works. The remaining risk is not
capability; it is **scope**: porting ~130–145k lines of Rust and standing up the
service layers that a browser or native shell cannot host in-process. Planning
figure for an agent-assisted port is on the order of **several hundred million
tokens** (midpoint ≈ 0.5B), best replaced with a measured rate from a calibration
port of Fresco before committing.

## Background and the decision

The current stack is layered: `todl-runtime` (a zero-dependency TypeScript core
that owns the reactive `Observable` base) sits beneath **[Mural](projects/mural/)**
(the UI framework — property system, `.mu` markup, controls, theming, diagrams),
which sits beneath **[TODL](projects/todl/)** (the language and compiler) and the
**[Plexus](projects/plexus/)** workbench. **[Fresco](projects/fresco/)** is a
self-contained hierarchical layout engine feeding Mural's diagrams.

Four motivations drove considering Rust: render/layout performance, a
cross-platform core, decoupling Mural from TODL's runtime, and memory-safety in
the mutation-heavy core. The literal reading — "rewrite everything in Rust" — was
rejected: most of Mural is exactly where TypeScript is the right tool. The idea
sharpened into two questions:

1. Can GPUI act as a **dumb GPU canvas** hosting Mural's own retained tree
   (Option A), or does adopting GPUI force Mural onto GPUI's element and flexbox
   model (Option B)? Option A preserves Mural's identity; Option B is a rewrite of
   its semantics.
2. What is the true cost of the **code editor** that must replace Monaco, which
   cannot cross to a native target?

The target chosen was **native desktop** (macOS/Linux/Windows); web was
explicitly deprioritized (see [Web deployment](#web-deployment) for why that
matters). Everything below answers question 1 as **Option A**, and question 2 as
**bounded, not a wall**.

## What GPUI is, and how it was consumed

GPUI is a hybrid immediate/retained, GPU-accelerated Rust UI framework developed
in the Zed monorepo and published to crates.io as `gpui` (the study used version
`0.2.2`). It exposes three registers: a declarative element/view model (its
Tailwind-like `div` builder over a flexbox layout), a state/model layer, and a
**low-level element register** that gives "total control over how elements are
rendered." That third register is the one Option A depends on.

The key seam is the `canvas` element: `canvas(prepaint, paint)` hands you a raw
paint closure over a pixel-space bounds, from which you can issue primitives
directly — `window.paint_quad`, `window.paint_path`, `window.paint_svg`, shaped
text via `window.text_system().shape_line(...).paint(...)` — at absolute
coordinates, with no `div`/flexbox involved. A single such element becomes the
"Mural surface," painting the entire foreign visual tree.

## The spike: what was proven, with numbers

All results are from a throwaway crate (`mural-gpui-probe`, ~10 small binaries)
on Windows 11 with the MSVC toolchain. GPUI's first build pulled its Windows
platform backend, the Blade graphics layer, and the lyon path tessellator, and
produced a ~26 MB executable — GPUI's supposed macOS-first weakness did not
materialize.

### Rendering and performance

- **Primitive painting from a foreign tree.** A single `canvas` element painted
  ~1,760 rounded-rect node cards plus ~880 stroked diagonal connector paths —
  2,640 primitives — every frame, from an external data structure, bypassing
  GPUI's element model entirely. This confirms Option A directly.
- **Frame rate.** Swept every frame (worst case, full rebuild): a debug build
  managed ~17 FPS; the **release build ran 60 → 198 FPS**. The debug figure is a
  CPU-side artifact (per-frame path tessellation in unoptimized code) and must
  never be used to judge GPUI. Production would cache geometry and dirty-track, as
  Mural already does.

### Text

A deliberately pathological test shaped and painted **29,040 glyphs per frame,
re-shaped from scratch every frame** (the frame counter was baked into each line
so no shaping cache could ever hit), across 120 dense lines. It held **~50 FPS
with zero paint failures**, resolving a Windows system font and Unicode glyphs.
Real text never re-shapes wholesale each frame — Mural, like Zed, retains shaped
lines — so ~50 FPS is a floor, not a ceiling.

### Interaction — owned by our model

GPUI supplies only the raw event; hit-testing and state live in our tree.

- **Basic hit-testing.** Clicks resolved to the correct node through our own
  geometry math, mutated state, and repainted via `cx.notify()`.
- **Overlapping figures, z-ordered and shape-accurate.** A pile of overlapping
  rectangles and circles: painting back-to-front, picking front-to-back against
  true shape geometry (circles by radius, not bounding box), with click-to-front.
  Every click resolved to the correct topmost figure; clicking a circle's
  bounding-box corner correctly fell through to the rectangle beneath.
- **Complex paths with holes.** Real glyph outlines (Arial Bold, via
  `ttf-parser`, curves flattened to polylines shared by renderer and hit-test):
  an even-odd point-in-path test respected the letter counters, so clicking inside
  the hole of an O, B, 8, or @ fell through instead of selecting that glyph. GPUI's
  `paint_path` fills multi-subpath outlines with correct winding, so the holes
  render transparent with no manual stencil work.
- **Drag-to-move.** Press/move/release with drag state in our model; grab always
  took the topmost figure; shapes dragged smoothly across the window.

### Clipping, scroll, DPI, media

- **Clipping and scroll.** A tall list clipped to a viewport rectangle via
  `window.with_content_mask`, with mouse-wheel scroll panning the content and the
  offset clamped correctly. Content is cut cleanly at the clip bounds.
- **Hi-DPI.** GPUI reports `scale_factor` and works in **logical pixels**. At
  100% the viewport was 1100×560 logical; at 150% the viewport stayed 1100×560
  logical while device pixels became 1650×840. Layout math never changes with DPI
  — you author in logical pixels and the GPU renders at device resolution.
- **Images and SVG.** SVG renders both declaratively (`svg().path(...)`) and via
  low-level `window.paint_svg` from a canvas — the path a native Mural would use.
  Raster images render via a file path or an in-memory image. One gotcha: an
  `img()` given a bare string does not route through a custom `AssetSource`; use a
  file path or a decoded image handle for raster assets.

### Custom window chrome

Assessed (not yet probed), and a strong yes: **Zed's entire window chrome is
custom-drawn on GPUI** — custom title bars, min/max/close, rounded corners,
transparency — so this is a first-class capability, not a stretch. The current
Plexus approach (a frameless Electron window with a mural-painted title bar and a
draggable region) maps over directly: GPUI client-side decorations turn off the
OS titlebar; the title bar becomes an ordinary element in the GPUI view tree
(the existing `HeaderContent`/`PragmaticWindowChrome` concept, painted by GPUI
instead of DOM); `window.start_window_move()` replaces the `-webkit-app-region`
drag region; and window-control buttons call GPUI's `minimize`/zoom/close.
Client-decorated windows also support rounded corners, custom shadow, and
transparent/blurred backgrounds.

Two platform nuances are the actual work: on **macOS**, keep and *position* the
native traffic lights rather than reinventing them; on **Windows 11**, the
maximize-button **Snap Layouts** hover requires reporting custom caption buttons
to the OS via window hit-testing (`WM_NCHITTEST`) — Zed implements this, so the
pattern exists to follow. A frameless-window-with-custom-chrome probe (~80–120
lines) would confirm the Windows Snap-Layout path, the one genuinely fiddly part.

### Cross-platform input

The input **event model is cross-platform by design** — GPUI's per-OS backends
(Cocoa, Win32, Wayland/X11) normalize native input into one set of event types
(`MouseDownEvent`, `KeyDownEvent`/`Keystroke`, `ScrollWheelEvent`, `Modifiers`),
so the interaction code above is write-once. Verified on Windows only this
session; macOS is GPUI's most mature backend. Three portability notes: shortcuts
must key off the **`platform` modifier** (Cmd on macOS, Ctrl elsewhere), not
`control` directly; scroll *feel* differs by hardware (trackpad pixel/inertial vs
wheel line steps) even though `pixel_delta` normalizes the number; and correct
text entry (dead keys, CJK/IME) uses GPUI's input-handler path, not raw
keystrokes. All three are application-level concerns, not GPUI limitations.

### Still unproven at the substrate level

Multi-window tear-off was not tested; custom window chrome was assessed but not
probed; and the 150%-scaling crispness was confirmed only numerically, not
stress-tested at higher fractional scales. None is a blocker; all are "known GPUI
features to wire up."

## The code editor — replacing Monaco

Monaco is not a Mural component; it is a separate web/DOM editor embedded in the
Plexus shell for authoring `.todl` and `.mu`. A native target cannot carry it, so
the migration has **two independent workstreams**: Mural → GPUI, and a
native-code editor. There is no drop-in code editor for GPUI — Zed's own editor
crate is deeply coupled to its monorepo and is not a reusable library — so this is
a build.

A minimal but real editor was built on GPUI in **430 lines**: a multi-line text
buffer, keyboard editing (typing, Enter, Backspace, Delete, Tab), caret movement
(arrows, Home, End), selection (Shift+arrows and mouse drag), click-to-place
caret, vertical scroll with clipping, a line-number gutter, and TODL syntax
coloring. It compiled and ran first try.

**What GPUI provided for free** — the expensive parts: multi-run colored text
shaping (`shape_line` + `TextRun`), exact caret and click mapping
(`LineLayout::x_for_index` / `closest_index_for_x`, correct for any font),
keyboard input with layout and modifiers resolved, focus, mouse, wheel, and
content-mask clipping. **What was written** (~300 lines): the buffer, edit
operations, cursor and selection model, click-to-position, scroll, and a
tokenizer.

**The remaining tail to reach Monaco parity, and why each is bounded:**

| Piece | Effort | Note |
| --- | --- | --- |
| Undo / redo | Low | An engine already exists in the codebase; wire it |
| Clipboard | Low | GPUI has clipboard APIs |
| LSP: diagnostics, completion, hover | Medium | The TODL language server already exists and speaks stdio; connect it as a client, host the popups as GPUI elements |
| IME / dead keys / CJK | Medium | The spike used keystroke input (Latin only); the production path is GPUI's input handler, which Zed uses for full IME |
| Soft-wrap + horizontal scroll | Medium | Supported by GPUI's line wrapping |
| Large-file virtualization | Medium | Swap the line vector for a rope; offscreen lines are already culled |
| Multi-cursor, find/replace, bracket match | Low–Med each | Additive to the model |

**Two gotchas found by touch, both easy to miss:** the spacebar arrives as a key
named "space" with an empty character field and must be handled explicitly; and
programming ligatures (turning `==>`, `->`, `!=` into single glyphs) are **off by
default** — they are enabled per-font via `FontFeatures` (`calt`/`liga`), exactly
as Zed exposes them, **and** the operator characters must be grouped into a single
shaped run, or per-character syntax coloring splits the ligature apart.

**Estimate:** a usable single-DSL editor is roughly 1–2 weeks (the spike is a day
of it); Monaco parity for TODL/`.mu` is plausibly **4–8 weeks** — sharply reduced
because it targets one DSL rather than a general IDE, and because the existing LSP
and undo engine transfer directly. Zed itself is proof the ceiling is very high.

### Where syntax features come from

Symbol navigation, IntelliSense, hover, diagnostics, folding, and semantic
highlighting are split: the **language server** supplies the AST-derived facts
(definitions, references, completions, diagnostics, semantic tokens, folding
ranges) as position-based data; the **editor client** hosts every piece of UI,
manages buffer sync and cancellation, maps LSP's UTF-16 positions to buffer
offsets, and actually performs the fold/jump/insert. Some features (folding,
basic highlighting, bracket matching) can also be done client-side without the
server, typically via **tree-sitter** — an incremental, error-tolerant parser
that keeps a live syntax tree per keystroke, used by Zed and the natural choice
for local highlighting and structure on GPUI. The server half already exists for
TODL; the migration builds the client half.

## Rust modularity and composition

Rust composes at **compile time** (static types, monomorphization, no stable
ABI), where TypeScript composes at runtime. This suits the codebase's existing
constructor-injection discipline almost exactly.

- **Dependency injection / composition root.** Interfaces become **traits**;
  services take their dependencies as `Arc<dyn Trait>` (dynamic dispatch, clean
  signatures — the right default for the service graph) or generics (zero-cost,
  for hot leaves). The object graph is wired explicitly in one `build()` function
  — a hand-written composition root, verified whole by the compiler. No container,
  no reflection.
- **Modules as crates.** A Cargo workspace of library crates, each exposing a
  `register(&mut Registry)`, wired at the root — mirroring the current
  module-contributed, keyed-registry pattern. Note that **workspace crates do not
  become DLLs**: they compile to static `rlib`s linked into one binary (the probe's
  entire dependency tree became a single 26 MB executable). Adding a module means
  recompiling.
- **Custom build actions authored as agents.** A planned Plexus feature — users
  write custom build actions as agent text inserted into the build pipeline at
  runtime — needs **none** of the dynamic-loading machinery. The variability is a
  prompt (data) executed by the already-compiled agent runtime. A
  `CustomBuildAction` is one struct implementing a `BuildAction` trait, holding the
  agent text and an injected `Arc<dyn AiProvider>`; the pipeline is an ordered
  `Vec<Arc<dyn BuildAction>>` and "insert at runtime" is a `Vec::insert`. It
  persists as `{ name, agent_text, placement }` and re-wires its runtime dependency
  on load. Sandboxing lives at the agent tool-permission layer, not the language.
- **Property registration is made ergonomic with proc macros.** A naive Rust port
  of the dependency-property system would be *more* verbose than the current
  TypeScript (no module-load side effects to run registration; hand-written
  `LazyLock` keys per property). A `#[mural_object]` attribute macro over the
  struct — with `#[property(default = …, affects = …, coerce = …, inherits,
  read_only)]` on each field — collapses that to one annotated field per property
  and generates the key, the registration (self-registering via the `inventory`
  crate, the analog to TS module-eval registration), typed accessors, metadata,
  and the binding-path name the `.mu` compiler resolves against. It is a thin
  typed facade over the same runtime (a sparse per-instance value map), so it can
  be added *after* the runtime is ported with hand-written keys, with no rework.
  Attached properties use a sibling item-level macro. This is the single
  highest-leverage macro in the migration and makes the Rust declaration more
  pleasant than today's key/name/phantom-`T` triple.
- **True dynamic binary plugins** (loading a `.dll` at runtime) are the one hard
  case, because Rust has no stable ABI. The realistic answers are **WASM
  components** (the Component Model + WIT — how Zed's extensions work) or a C-ABI
  crate such as `abi_stable`; not naive dynamic linking.

## WASM: migration hybrid vs. web deployment

Two distinct WASM questions, with opposite answers.

- **A TS/Rust hybrid running both worlds in one WASM runtime during migration —
  not advisable.** TypeScript does not compile to WASM (the options are
  AssemblyScript, a different dead-end language, or embedding a JS engine per
  module via ComponentizeJS). Cross-language interop does exist via the Component
  Model, but the boundary is copy/marshal with no shared object graph — splitting
  Mural's tightly-coupled reactive tree across it would be ruinous — and it
  reintroduces a JS engine while the whole point was to shed the JS runtime for a
  native target. WASM's one good migration use is narrow: porting an isolated,
  pure-compute leaf (Fresco) to Rust→WASM and loading it into the current TS app
  to validate the port in place.
- **Shipping the finished native app to the web as one big WASM module — yes,
  technically.** GPUI has a web target (`web_init`): the whole Rust app compiles to
  `wasm32` and paints to a single WebGPU/WebGL canvas, the same one-module model
  Figma and Zed's web build use. The caveats are real: it is a canvas app (no DOM,
  no HTML accessibility, bundled fonts, multi-MB download), GPUI's web backend is
  newer than native, and the process-based layers (agents, LSP, compiler
  subprocess, filesystem) do not exist in a browser and must move server-side. The
  possibility is settled; the maturity and the service relocation are the caveats.
  Notably, the current DOM-based Mural is a better *web* citizen than a GPUI
  canvas — the GPUI bet pays off for native and compromises on web.

## Web deployment

Because the target chosen was native desktop, web became a secondary surface. The
suite's current web story is DOM-based (light, accessible). A GPUI web build is a
heavy canvas app. If web is ever first-class, the realistic options are to keep a
DOM front end for web while GPUI serves native, or to accept the canvas tradeoffs
and host the agent/LSP/compiler as backend services. This should be decided
explicitly rather than assumed to come free with the native migration.

## Token budget for the migration

Grounded in a real line count of the workspace.

| Codebase | Source LOC | Tests |
| --- | --- | --- |
| Mural | 134,900 | 30,700 |
| TODL compiler | 26,800 | 20,600 |
| Plexus shell | 13,100 | — |
| Fresco | 6,200 | 1,000 |
| todl-runtime | 1,600 | 1,200 |
| Total | ~182,500 | ~53,500 |

Not all of this becomes Rust. Three adjustments dominate:

- **GPUI absorbs the rendering layer.** Mural's visual engine (~39k) is largely
  SVG/DOM plumbing that is deleted, not ported — GPUI paints.
- **The compiler and language server relocate rather than port.** The TODL
  compiler (~27k) and the `.mu` tooling are not UI and can remain TypeScript
  services (the web target forces this regardless); relocating them costs no port
  tokens.
- **The editor is net-new** (~15k Rust), and tests are rewritten in Rust.

Net Rust to write: roughly **115–145k lines of code** plus **40–60k of tests**,
i.e. ~160–200k delivered lines. At an all-in agentic rate of ~1.5k–4k tokens per
delivered line (context reloading dominates; Rust's borrow checker and GPUI's
pre-1.0 churn add fix cycles a straight TS→TS port would not), plus 20–40% for
design, hard-debugging spikes, and integration:

- Low ≈ 240M tokens
- Mid ≈ 450M tokens
- High ≈ 800M tokens

**Planning figure: on the order of 300M–1B tokens, midpoint ≈ 0.5B**, with
roughly 3× error bars. The single most effective way to tighten this is to
**calibrate**: port Fresco (6.2k lines, self-contained, the natural first chunk)
end-to-end with the exact agent workflow the migration will use, measure the
tokens it actually consumes, and multiply out — converting a 3× guess into a ~1.3×
estimate. Two caveats: tokens are rarely the binding constraint (human review
bandwidth and wall-clock are — a half-billion-token migration is many months of
reviewed work), and the ongoing cost of tracking GPUI's pre-1.0 churn is separate
from the one-time port.

## Recommended migration strategy

- **Strangler-fig, not a big-bang rewrite.** Build the native GPUI app alongside
  the current one and move features across until parity; keep the TS app shippable
  throughout.
- **Bottom-up by crate, in dependency order:** todl-runtime → Fresco → the model
  layer → Plexus shell → the Mural framework → the editor.
- **Bridge with coarse process/RPC seams, not a fine-grained hybrid.** During the
  transition, native Rust and not-yet-ported TS talk over stdio/JSON-RPC — the same
  pattern the LSP and agent runtime already use. Where in-process calls are needed,
  a Node native addon beats WASM.
- **Port tightly-coupled subsystems wholesale.** The visual tree and the
  property/binding engine move as one unit; never split a shared object graph
  across a boundary.
- **Reserve WASM for validating isolated pure-compute leaves** (Fresco) in the
  current app — not for a dual-world runtime.

## Immediate next step

Run the **Fresco calibration port**: port Fresco to Rust end-to-end with the
production agent workflow, and measure. It is the ideal first migration chunk
(self-contained, pure compute, a simple serializable boundary), it replaces the
token estimate above with a measured rate, and — validated as Rust→WASM loaded
into the current app — it de-risks the port in place before any commitment to the
larger rewrite.

## Appendix: GPUI API notes discovered

- Consumed via crates.io `gpui = "0.2.2"`; every API used compiled first try,
  which is a good signal for a pre-1.0 crate, though breaking changes between
  versions are expected.
- Low-level painting: `canvas(prepaint, paint)`, `window.paint_quad(fill(bounds,
  color))`, `PaintQuad` with public `corner_radii` for circles/rounded shapes,
  `PathBuilder` (`fill`/`stroke`, `move_to`/`line_to`/`close`/`build`) →
  `window.paint_path`.
- Text: `window.text_system().shape_line(text, size, &runs, None)` →
  `ShapedLine::paint`; caret and click via `LineLayout::x_for_index` and
  `closest_index_for_x`.
- Input: `on_mouse_down`/`on_mouse_move` (`pressed_button`)/`on_mouse_up`,
  `on_key_down` with `Keystroke.key` and `key_char`, `on_scroll_wheel` with
  `ScrollDelta::pixel_delta`; focus via `FocusHandle` and `track_focus`.
- Convert `Pixels` to `f32` with `.to_f64() as f32` (the tuple field is private).
- Assets via `Application::with_assets(impl AssetSource)`; SVG paints with
  `window.paint_svg(bounds, path, TransformationMatrix::unit(), color, cx)`.
- Ligatures require `Font.features = FontFeatures(calt/liga)` and a single shaped
  run over the operator.
