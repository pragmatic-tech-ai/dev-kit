# Diagram Design Tokens — complete catalog (Mural framework)

Goal: a single list of every visual token needed to render the framework diagram
surface with **zero hardcoded visual values**. Scope: Mural framework diagram only
(Figure/shape, connector, group, callout, text, editing chrome, guides, rulers,
toolbox, inspector). Plexus arch visuals are out of scope (follow-up).

Two token layers already exist:
- **Theme layer** — `@`-refs resolved from the app resource dictionary
  (`@Primary`, `@Surface`, `@OnSurface`, `@OnSurfaceVariant`, `@OutlineVariant`,
  typography `@TitleSmall` / `@BodySmall`).
- **`DiagramSettings`** — the diagram's own tunable-constant catalog
  (`src/framework/diagram/diagram-settings.ts`): user-overridable, numeric + color,
  grouped Shapes / Connectors / Chrome / Toolbox / Rulers.

Status legend: **✓ theme** = existing `@`-token · **✓ settings** = existing
`DiagramSettings.X()` · **● GAP** = hardcoded, no token yet.

---

## Status — theme-adaptive diagram surface (IMPLEMENTED, mural 0.18.0)

Shipped in `mural@0.18.0` + Plexus `^0.18.0`. Live-verified in **both** schemes
(diagram-3, 22 arch nodes): light canvas `#fdfdfd` w/ dark labels; dark canvas
`#2a2a2e` w/ light labels; page borders, connectors, node ink all adapt.

**New theme token** — `@DiagramCanvas` (Material catalog, `material.mu`):
light `#FDFDFD`, dark `#2A2A2E`. The dedicated diagram drawing-surface color.

**Tunable-with-theme-defaults model** (`diagram-settings.ts`): five `DiagramSettings`
colors now seed an *undefined* definition default, so — absent a user override —
`color()` resolves a live scheme token via `themeBrush(token)` (app-level
`Application.Resources.Resolve`); the compiled hex survives only as the no-theme
fallback. A user override still persists and wins; `Reset` returns to the theme
default. Linked keys (`THEME_LINK`):
- `ShapeLabelInk` → `@OnSurface` · `ConnectorDefaultStroke` → `@OnSurfaceVariant`
- `RulerFill` → `@Surface` · `RulerTickColor` → `@OnSurfaceVariant`
- `RulerHoverFill` → `@Primary` wash (α≈41)

**Surface wiring** (dynamic resources → re-paint live on scheme swap):
- **Pages** (the paper): Plexus `DiagramCanvasPanel` `PaginatedCanvas.PaperBrush =
  @DiagramCanvas`, `PageBorderBrush = @OutlineVariant`. (Root cause of the old white
  canvas: `PaginatedCanvas` hardcodes `#ffffff` paper — themed at the app wiring
  point, the layer that instantiates it.)
- **Desk** (pasteboard behind/around pages, viewport-filling): mural
  `diagram.template.mu` `PART_CanvasBg` Border `Fill = @DiagramCanvas`.
- **Arch-node caption ink** (Plexus): `#000000` → `@OnSurface`.
- **Selection / halo**: stay `@Primary` (correct now the canvas adapts).

Deferred: paper fill is not yet a `DiagramSettings`-tunable key (theme-adaptive via
the token only); mural `PaginatedCanvas` keeps its generic `#ffffff` default for
non-diagram consumers (the Diagrammer demo); callout leader `#64748b` still inline.

---

## 1. Colors

### 1a. Node & content colors
| Token | Value | Source | Status |
|---|---|---|---|
| Shape default fill | `#bfdbfe` | `DiagramSettings.ShapeDefaultFill` | ✓ settings |
| Shape default stroke | `#1976d2` | `DiagramSettings.ShapeDefaultStroke` | ✓ settings |
| Connector default stroke | `#475569` | `connector.ts:70` (`DEFAULT_STROKE_BRUSH`) | ● GAP |
| Label default ink | `Color.Black` | `shape-text.ts:74` | ● GAP |
| Text-node fill | `#00000000` | `text-node.ts:7` | ● GAP |
| Text-node stroke | `#94a3b8` | `text-node.ts:8` | ● GAP |
| Callout leader color | `#64748b` | `diagram.template.mu:72` | ● GAP |
| Cap preview ink | `#64748b` | `caps/connector-cap-options.ts:31` | ● GAP |

### 1b. Selection & editing-chrome colors — **the main gap**
| Token | Value | Source | Status |
|---|---|---|---|
| Group selection outline | `@Primary` | `diagram.template.mu:179` | ✓ theme |
| Selection bbox outline | `#1976d2` | `basic/selection-bounds-adorner.ts:93` | ● GAP |
| Resize handle fill | `#ffffff` | `basic/selection-bounds-adorner.ts:94` | ● GAP |
| Alignment (snap) guide | `#1976d2` | `behaviors/alignment-guides-adorner.ts:28` | ● GAP |
| Text-block accent (outline/stem) | `#1976d2` | `behaviors/text-block-adorner.ts:38` | ● GAP |
| Text-block grip fill | `#ffffff` | `behaviors/text-block-adorner.ts:39` | ● GAP |
| Endpoint drag dot | `#ff5722` | `behaviors/connector-interactions-behavior.ts:121` | ● GAP |
| Waypoint drag dot | `#ff9800` | `…-behavior.ts:122` | ● GAP |
| Segment drag pad | `#2196f3` | `…-behavior.ts:126` | ● GAP |
| Side-attach bar | `#ff9800` | `…-behavior.ts:120` | ● GAP |
| Port marker | `#ff9800` | `…-behavior.ts:130` | ● GAP |
| Connector hover halo | `#6750A4` | `…-behavior.ts:140` | ● GAP |

### 1c. Guides, rulers, toolbox colors (already covered)
| Token | Value | Source | Status |
|---|---|---|---|
| Persistent guide | `#e5484d` | `DiagramSettings.PersistentGuideColor` | ✓ settings |
| Selected guide | `#f59e0b` | `DiagramSettings.PersistentGuideSelectedColor` | ✓ settings |
| Guide preview | `#e5484d` | `DiagramSettings.PersistentGuidePreviewColor` | ✓ settings |
| Ruler fill | `#f3f4f6` | `DiagramSettings.RulerFill` | ✓ settings |
| Ruler tick color | `#6b7280` | `DiagramSettings.RulerTickColor` | ✓ settings |
| Ruler hover fill | `#dbeafe` | `DiagramSettings.RulerHoverFill` | ✓ settings |
| Toolbox preview fill | `#1976d2` | `DiagramSettings.ToolboxPreviewFill` | ✓ settings |

> **Palette observation:** the hardcoded chrome uses *three different blues*
> (`#1976d2`, `#2196f3`, `#6750A4`), *two oranges/red* (`#ff9800`, `#ff5722`), and
> white fills — an ad-hoc palette. Tokenizing is the moment to collapse these into
> a small **semantic set** (e.g. one "primary affordance" blue for
> selection/alignment/text-block, one "attach" accent for side-bars/ports/handles),
> rather than porting 12 literal colors 1:1.

---

## 2. Stroke widths
| Token | Value | Source | Status |
|---|---|---|---|
| Shape stroke width | `1.5` | `DiagramSettings.ShapeStrokeWidth` | ✓ settings |
| Connector stroke width | `1.5` | `DiagramSettings.ConnectorStrokeWidth` | ✓ settings |
| Text-node stroke width | `1` | `text-node.ts:8` | ● GAP |
| Callout leader width | `1.5` | `diagram.template.mu:72` | ● GAP |
| Cap preview stroke width | `1.5` | `caps/connector-cap-options.ts:32` | ● GAP |
| Group selection outline width | `1` | `diagram.template.mu:184` | ● GAP |
| Text-block stem width | `1` | `DiagramSettings.TextStemWidth` | ✓ settings |
| Alignment guide thickness | `1` | `DiagramSettings.GuideThickness` | ✓ settings |
| Persistent guide thickness | `1` | `DiagramSettings.PersistentGuideThickness` | ✓ settings |

---

## 3. Opacities
| Token | Value | Source | Status |
|---|---|---|---|
| Hover halo opacity | `0.45` | `DiagramSettings.HoverHaloOpacity` | ✓ settings |
| Guide preview opacity | `0.4` | `guides/persistent-guides-adorner.ts:17` | ● GAP |

---

## 4. Dimensions & sizes

### 4a. Shape / node / text
| Token | Value | Source | Status |
|---|---|---|---|
| Shape default size | `80` | `DiagramSettings.ShapeDefaultSize` | ✓ settings |
| Shape min resize | `8` | `DiagramSettings.ShapeMinResize` | ✓ settings |
| Shape label margin | `8` | `DiagramSettings.ShapeLabelMargin` | ✓ settings |
| Default label font size | `12` | `DiagramSettings.TextDefaultFontSize` | ✓ settings |
| Label default padding | `2` | `shape-text.ts:231` | ● GAP |
| Text-node default width | `120` | `text-node.ts:9` | ● GAP |
| Text-node default height | `44` | `text-node.ts:10` | ● GAP |

### 4b. Connector routing (already covered)
`ConnectorHitWidth 14` · `ConnectorOrthogonalStub 20` · `ConnectorLaneGap 10` ·
`ConnectorBezierMinOffset 20` · `ConnectorSegmentJogStub 20` · `ConnectorJogMargin 6`
— all ✓ settings.

### 4c. Caps
| Token | Value | Source | Status |
|---|---|---|---|
| Default cap scale (source/target) | `0.8` | `diagram.template.mu:210-211` | ● GAP |
| Filled-arrow cap size / inset | `12 / 12` | `caps/caps.template.mu:36` | ● GAP |
| Open-arrow cap size | `12 × 6` | `caps/caps.template.mu:30` | ● GAP |
| Circle cap radius | `6` | `caps/caps.template.mu:43,54` | ● GAP |
| Diamond cap size / inset | `16×10 / 8` | `caps/caps.template.mu:60` | ● GAP |

> Cap path *shapes* stay literal (silhouette geometry); the **base size / inset /
> default scale** are the tokenizable knobs.

### 4d. Editing-chrome sizes (already covered)
`EndpointHandleSize 11` · `WaypointHandleSize 9` · `SegmentHandleSize 9` ·
`PortMarkerSize 7` · `SideBarThickness 3` · `FigureProximity 8` ·
`HoverHaloMinThickness 5` · `TextHandleSize 9` · `TextRotateGap 18` ·
`GuideGrabTolerance 6` · `GuideCreateMargin 14` — all ✓ settings.

### 4e. Rulers / toolbox (already covered)
`RulerThickness 20` · `RulerTickMinSpacing 60` · `ToolboxTileSize 48` — ✓ settings.

---

## 5. Typography
| Token | Value | Source | Status |
|---|---|---|---|
| Label font size | `12` | `DiagramSettings.TextDefaultFontSize` | ✓ settings |
| Label ink | `Color.Black` | `shape-text.ts:74` | ● GAP (see 1a) |
| Inspector section title | `@TitleSmall` | `diagram.template.mu` | ✓ theme |
| Inspector field label | `@BodySmall` | `diagram.template.mu` | ✓ theme |
| Inspector rail label | `@TitleSmall` | `diagram.template.mu:323` | ✓ theme |

> Font *family* and *weight* for shape labels come from `ShapeText` DP defaults;
> not currently surfaced as diagram tokens — candidate if label typography should
> be themeable.

---

## 6. Inspector-pane spacing (Format Shape / Size & Position)
A self-contained family of hardcoded layout values in `diagram.template.mu`. Lower
priority than the canvas visuals but part of "100%".
| Token | Value | Lines |
|---|---|---|
| Page body padding | `12` | 364, 384 | ● GAP |
| Field row bottom gap | `6` | 408–447 | ● GAP |
| Section title bottom gap | `8` | 407 | ● GAP |
| Section separator (top+bottom) | `12 / 8` | 433 | ● GAP |
| Field label column width | `110` | 409–447 | ● GAP |
| Rail item padding | `12,8,12,8` | 321 | ● GAP |
| Rail selected-accent thickness | `2` | 320 | ● GAP |
| Rail / divider border | `1` | 341 | ● GAP |

---

## Summary — what "100%" requires

| Category | Already tokenized | Gaps to add |
|---|---|---|
| Colors | 9 (settings) + `@Primary` etc. | **~15** (12 chrome + connector/label/text-node/callout/cap-preview) |
| Stroke widths | 5 | 4 |
| Opacities | 1 | 1 |
| Dimensions | ~25 (settings) | ~8 (text-node, label pad, caps) |
| Typography | font size + theme styles | label ink (+ optional family/weight) |
| Inspector spacing | — (theme colors only) | ~8 |

**Dimensions are ~95% done; the real work is colors.** The cleanest path is to add
a semantic **chrome color** group to `DiagramSettings` (mirroring the existing
`PersistentGuideColor` pattern), rationalized to a small palette rather than the
current ad-hoc literals.

---

## 7. Approved semantic color palette (2026-08-21)

`@Primary` resolves to Material purple (`#6750A4` light / `#D0BCFF` dark). Decisions:
selection accent → **live `@Primary`** (theme-adaptive); connector handles → **keep 3**.

**Theme-resolved (live `@Primary`, adapts light/dark — resolved via `TryFindResource`/DynamicResource, not a fixed DiagramSettings color):**
| Semantic token | Replaces (uses) |
|---|---|
| `@Primary` (selection accent) | selection bbox outline, group outline (already), resize-handle stroke, text-block accent/stem, alignment/snap guide — all `#1976d2` → `@Primary` |
| `@Primary` (hover halo) | connector hover halo `#6750A4` (it already *is* the primary) |

**New fixed diagram color tokens (functional palette — `DiagramSettings`, hex defaults):**
| Token key | Default | Replaces |
|---|---|---|
| `ChromeHandleFill` | `#ffffff` | resize handles + text-block grips |
| `ChromeConnectorEndpoint` | `#ff5722` | endpoint dots |
| `ChromeConnectorHandle` | `#ff9800` | waypoint + port marker + side-bar |
| `ChromeConnectorSegment` | `#2196f3` | segment pads |
| `ConnectorDefaultStroke` | `#475569` | fresh connector stroke |
| `ShapeLabelInk` | `#000000` | shape label text ink |
| `TextNodeFill` | `#00000000` | text-node fill |
| `TextNodeStroke` | `#94a3b8` | text-node outline |
| `NeutralInk` | `#64748b` | callout leader **+** cap-preview glyph |

Net: 15 literals → 2 theme refs + 9 fixed tokens; the 3× `#1976d2` and 3× `#ff9800`
duplicates collapse, and the hover-halo purple is recognized as `@Primary`.

### Implemented (2026-08-21)

New `DiagramSettings` keys + accessors: `ChromeHandleFill`, `ChromeConnectorEndpoint`,
`ChromeConnectorHandle`, `ChromeConnectorSegment`, `ChromeNeutralInk`,
`ConnectorDefaultStroke`, `ShapeLabelInk`, `TextNodeFill`, `TextNodeStroke`.

Rewired consumers:
- `connector-interactions-behavior.ts` — endpoint/waypoint/segment/side-bar/port fills → tokens; hover halo → live `@Primary` (`TryFindResource`, opacity from settings).
- `alignment-guides-adorner.ts` — snap guide → `@Primary` via `DynamicResource`.
- `text-block-adorner.ts` — accent → `@Primary` (resolved per instance), grip → `HandleFill`.
- `diagram.ts` — selection `SelectionBoundsAdorner.ChromeStroke` → `@Primary` (`DynamicResource`), `ChromeFill` → `HandleFill`.
- `connector.ts` (default stroke), `shape-text.ts` (label ink, ctor write), `text-node.ts` (fill/stroke), `connector-cap-options.ts` (neutral ink).

**Selection is now uniformly `@Primary`** (bbox + group outline + resize handles + snap
guide + text-block + hover halo), theme-adaptive light/dark.

**One remaining literal:** the callout leader stroke `#64748b` stays inline in
`diagram.template.mu` — it's `.mu`-bound (markup can't reach `DiagramSettings`) and
tokenizing it needs a `PART_Leader` template-part + `Callout` ctor wiring; deferred
to avoid risking an invisible leader (callouts aren't in the arch smoke diagram).
Value matches the `ChromeNeutralInk` token, so a later refactor is a drop-in.

Mural 4455 tests green.
