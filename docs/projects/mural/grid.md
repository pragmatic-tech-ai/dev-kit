# Grid

WPF-parity 2D layout panel: explicit row / column definitions, each
sized in one of three modes — pixel, auto, or star — and per-child
placement via `Grid.Row` / `Grid.Column` / `Grid.RowSpan` /
`Grid.ColumnSpan` attached properties.

Mirrors `System.Windows.Controls.Grid`. The layout algorithm is the
standard three-mode WPF resolver, simplified to a four-pass
measure/arrange.

**Implemented in:**
- [basic/panels/grid.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/panels/grid.ts) — `Grid`, `GridLength`,
  `ColumnDefinition`, `RowDefinition`, `GridUnitType`

See also: [layout.md](layout.md) for the underlying measure / arrange
contract every panel implements, [basic.md](basic.md) for the
broader control roster.

## 0. Version scope

The Grid implementation is staged across three labelled scopes. The
labels are load-bearing: each version is an explicit agreement about
what's in and what isn't, and a "Grid v1 only" mention in any code
comment or doc resolves to the table below.

| Scope | Shipping? | Includes |
|---|---|---|
| **Grid v1** | Yes | `GridLength` (pixel / auto / star); `RowDefinition` / `ColumnDefinition`; `Grid.Row` / `Column` / `RowSpan` / `ColumnSpan` attached properties; four-pass measure (pixel → auto → star → re-measure spanners); prefix-sum arrange; empty-definitions fallback to a single `1*` track. |
| **Grid v2.1** | Yes (extends v1) | `MinWidth` / `MaxWidth` on `ColumnDefinition`, `MinHeight` / `MaxHeight` on `RowDefinition`. Pixel tracks clamp inline; Auto tracks raise to Min and cap at Max during their distribution pass; Star tracks clamp in a redistribution loop — if a Star hits a bound, the freed weight redistributes to the other live Stars and the loop re-runs until no track newly clamps. |
| **Grid v2.2** | Yes (extends v2.1) | `SharedSizeGroup` on `ColumnDefinition` / `RowDefinition` — Auto tracks across multiple Grids coordinate by name, every member resolving to the max contribution across the group. Per-presentation-target registry; member-set invalidation when the max changes; removing a Grid recomputes the max from the survivors. Only Auto tracks participate; Pixel / Star ignore the DP even when set. |
| **Grid v3** | Yes (extends v2.2) | `ShowGridLines` debug rendering of cell boundaries (`ShowGridLines: boolean` + `GridLinesBrush: SolidColorBrush \| undefined`; paints dashed lines along every internal column AND row boundary). Star-track shrinkage policy when Auto tracks request more than the available size (Pass 2.6 in `MeasureOverride` proportionally shrinks Autos down to `autoMin` to free room for Stars; Star tracks no longer collapse to 0 when Autos over-request). |

Anything not in the table above is unscoped — if it comes up, we'd
either fold it into one of the existing versions or open a new label
with a separate agreement.

## 1. `GridLength`

The value type describing one track's sizing rule.

```ts
import { GridLength } from '@pragmatic-tech-ai/mural/basic';

new GridLength(120)              // pixel: exact size in pixels
new GridLength(120, 'pixel')     // same — explicit unit type
new GridLength(1, 'star')        // star: 1*  — splits leftover proportionally
new GridLength(2, 'star')        // star: 2*  — gets twice the share
GridLength.Auto                  // auto: sized to children
```

| `UnitType` | Track size | When to use |
|---|---|---|
| `'pixel'` | Exact `Value` pixels | Fixed-size chrome — toolbars, headers. |
| `'auto'` | Max of child desired sizes that touch the track | Wraps to content — labels next to inputs. |
| `'star'` | Proportional share of leftover space | Fills available — the document area in an IDE-style layout. |

The class is immutable; mutate a track by replacing its
`Width`/`Height` value rather than poking the existing GridLength.

## 2. `ColumnDefinition` / `RowDefinition`

Thin Model subclasses carrying a single `Width` / `Height` DP. They
appear in the Grid's `ColumnDefinitions` / `RowDefinitions`
ObservableCollections.

```ts
import { Grid, ColumnDefinition, RowDefinition, GridLength } from '@pragmatic-tech-ai/mural/basic';

const grid = new Grid();
const c0 = new ColumnDefinition(); c0.Width = new GridLength(200);
const c1 = new ColumnDefinition(); c1.Width = GridLength.Auto;
const c2 = new ColumnDefinition(); c2.Width = new GridLength(1, 'star');
grid.ColumnDefinitions.Add(c0);
grid.ColumnDefinitions.Add(c1);
grid.ColumnDefinitions.Add(c2);

const r0 = new RowDefinition(); r0.Height = new GridLength(40);
const r1 = new RowDefinition(); r1.Height = new GridLength(1, 'star');
grid.RowDefinitions.Add(r0);
grid.RowDefinitions.Add(r1);
```

If `ColumnDefinitions` is empty, the Grid behaves as if it has one 1\*
column. Same for `RowDefinitions`. A Grid with no definitions degrades
to a single 1×1 star cell that fills its slot — convenient for
container-only layouts where the consumer just wants something to
spread a child across its parent's bounds.

## 3. Attached properties

| Attached property | Default | Meaning |
|---|---|---|
| `Grid.Row` | `0` | Zero-based row index of this child. |
| `Grid.Column` | `0` | Zero-based column index of this child. |
| `Grid.RowSpan` | `1` | Number of rows this child spans. |
| `Grid.ColumnSpan` | `1` | Number of columns this child spans. |

```ts
import { Grid } from '@pragmatic-tech-ai/mural/basic';

Grid.SetRow(child, 1);
Grid.SetColumn(child, 2);
Grid.SetColumnSpan(child, 3);
const r = Grid.GetRow(child);
```

Out-of-range row / column values are clamped to the last valid index;
out-of-range spans are clamped to the remaining distance to the edge.
That means a typo (`Grid.Row = 99` on a 3-row grid) won't throw — it
places the child in the last row.

## 4. Layout algorithm

`Grid.MeasureOverride` runs four passes; `ArrangeOverride` then places
each child against the resolved track sizes via prefix-sum lookups.

### Pass 1 — Resolve pixel tracks

Pixel tracks (`GridLength(N)`) resolve to their declared size
immediately. The pass also records each track's kind (pixel / auto /
star) and its star weight so the later distribution pass can look them
up by index.

### Pass 2 — Measure children that touch any Auto track

Children whose cell touches at least one Auto track are measured with
`Size(Infinity, Infinity)` so their `DesiredSize` reflects the layout
they'd choose with unbounded space. Each child's desired size is
distributed across the spanned Auto tracks evenly, after subtracting
pixel tracks the same child also spans. Each Auto track ends up at the
MAX of every contribution — so a tall label in row 0 and a short label
in row 0 give row 0 the tall label's height.

```
Span = [pixel(50), auto, auto]   child.DesiredWidth = 110
  perAuto = (110 - 50) / 2 = 30
  → auto track 0 = max(current, 30)
  → auto track 1 = max(current, 30)
```

### Pass 3 — Distribute leftover among Star tracks

```
leftoverW  = max(0, availableSize.Width  - sum(resolved widths))
totalStars = sum(star weights)
for each star column i:
    widths[i] = leftoverW * (stars[i] / totalStars)
```

`leftoverH` distributes vertically the same way. Star tracks with
weight 0 stay at 0 — a degenerate but legal case.

### Pass 4 — Measure remaining children

Children that don't touch any Auto track are measured against the
exact cell rect their spanned tracks formed in Passes 1–3. This pass
gives those children a concrete `availableSize` to lay against, so a
TextBlock in a star cell doesn't keep its Infinity-measured size from
Pass 2 (it never ran there).

### Arrange

Per-track prefix sums give O(1) lookup of a track's left/top edge and
right/bottom edge. Each child arranges into the rect formed by its
spanned column and row edges.

```
colOffsets = [0, w0, w0+w1, w0+w1+w2, …]
rowOffsets = [0, h0, h0+h1, h0+h1+h2, …]

child.Arrange(new Rect(
    colOffsets[c0],
    rowOffsets[r0],
    colOffsets[c0 + cs] - colOffsets[c0],
    rowOffsets[r0 + rs] - rowOffsets[r0],
));
```

## 5. Worked example — IDE-style three-pane layout

A header bar (auto-height), a left sidebar (200 px), a main editing
area (star), and a status bar at the bottom (auto-height).

```ts
const g = new Grid();
const c0 = new ColumnDefinition(); c0.Width = new GridLength(200);
const c1 = new ColumnDefinition(); c1.Width = new GridLength(1, 'star');
g.ColumnDefinitions.Add(c0); g.ColumnDefinitions.Add(c1);
const r0 = new RowDefinition(); r0.Height = GridLength.Auto;
const r1 = new RowDefinition(); r1.Height = new GridLength(1, 'star');
const r2 = new RowDefinition(); r2.Height = GridLength.Auto;
g.RowDefinitions.Add(r0); g.RowDefinitions.Add(r1); g.RowDefinitions.Add(r2);

// Header spans both columns.
const header = new Border();
Grid.SetColumnSpan(header, 2);
g.AddChild(header);

// Sidebar = (row 1, col 0)
const sidebar = new Border();
Grid.SetRow(sidebar, 1);
g.AddChild(sidebar);

// Main area = (row 1, col 1)
const main = new Border();
Grid.SetRow(main, 1);
Grid.SetColumn(main, 1);
g.AddChild(main);

// Status bar spans both columns at the bottom.
const status = new Border();
Grid.SetRow(status, 2);
Grid.SetColumnSpan(status, 2);
g.AddChild(status);
```

In `400 × 300`:
- Row 0 (auto) sizes to the header's desired height — say `30`.
- Row 2 (auto) sizes to the status bar's desired height — say `20`.
- Row 1 (star) gets `300 - 30 - 20 = 250`.
- Column 0 (pixel) is `200`.
- Column 1 (star) gets `400 - 200 = 200`.

Sidebar's final rect is `(0, 30, 200, 250)`. Main's is `(200, 30, 200,
250)`. Status bar's is `(0, 280, 400, 20)`. Header's is `(0, 0, 400,
30)`.

## 6. Min / Max on track definitions (Grid v2.1)

Each `ColumnDefinition` carries `MinWidth` (default 0) and `MaxWidth`
(default `+Infinity`). `RowDefinition` carries the symmetric
`MinHeight` / `MaxHeight`. Setting either bound restricts the
track's resolved size at the appropriate sizing pass.

```ts
const c = new ColumnDefinition();
c.Width    = new GridLength(1, 'star');
c.MinWidth = 200;        // floor — track grows at least this wide
c.MaxWidth = 500;        // ceiling — track never exceeds this width
```

### How the clamps apply per track kind

| Track kind | When the clamp fires | Effect of Min hit | Effect of Max hit |
|---|---|---|---|
| Pixel | Inline during Pass 1. | Track is raised to `Min` immediately. | Track is capped at `Max` immediately. |
| Auto | Inline during Pass 2 + a Min-floor sweep after Pass 2. | Track is raised to `Min` even if no child demanded it. | Track is capped at `Max`; spanning children get the capped cell rect at Pass 4 re-measure. |
| Star | Iteratively during Pass 3 (the new redistribution loop). | Track is raised to `Min` and dropped from the live star pool; remaining stars split the smaller budget. | Track is capped at `Max` and dropped from the live star pool; the residual goes back into the budget for the other live stars. |

### Star redistribution loop

The Star clamp pass runs an iterative loop:

1. Distribute the leftover budget among live Star tracks
   proportionally to their weights.
2. Walk the live tracks and clamp each provisional size to its
   `[Min, Max]`. Any track that actually hit a bound gets locked in
   (its weight drops out of the live pool, its clamped size is added
   to the reserved total).
3. If at least one track was locked this round, re-loop. Otherwise
   the provisional sizes are accepted as final.

The loop is bounded by the number of Star tracks — each iteration
locks at least one — so the total work is at most `O(nStars²)` in the
worst case.

**Example.** Three Star tracks, each capped at 50 px, in a 300-px
container: naïve 1:1:1 gives 100 each, all three cap to 50 in iter 0,
loop terminates with `[50, 50, 50]`. Total used = 150; the remaining
150 px is unused (no remaining Star tracks to absorb it). That's the
correct behaviour — Star clamping intentionally leaves slack when no
unbounded Star track exists to receive the residual.

## 7. Cross-Grid coordination (Grid v2.2)

`SharedSizeGroup` is a string DP on both `ColumnDefinition` and
`RowDefinition`. Auto tracks across multiple Grids that declare the
same group name coordinate their resolved sizes — every member
resolves to the max contribution across the whole group.

```mu
Grid {
    Grid.ColumnDefinitions { ColumnDefinition[Width=Auto, SharedSizeGroup="labels"] }
    Grid.RowDefinitions    { RowDefinition[Height=Auto] }
    TextBlock[Text="Name:"]
}
Grid {
    Grid.ColumnDefinitions { ColumnDefinition[Width=Auto, SharedSizeGroup="labels"] }
    Grid.RowDefinitions    { RowDefinition[Height=Auto] }
    TextBlock[Text="Email address:"]
}
```

Both columns resolve to the width of the longer label
(`"Email address:"`), so adjacent property-editor rows align even
though they live in separate Grid instances.

### Scope of coordination

| Track kind | Participates? | Why |
|---|---|---|
| Auto | Yes | Coordination only makes sense for content-driven sizing. |
| Pixel | No | A pixel track has a declared size; coordinating it would override the declaration. |
| Star | No | Star sizing is per-Grid (proportional to the leftover budget); a shared "max" has no clear semantic. |

A Pixel or Star track with `SharedSizeGroup` set is silently ignored —
the track still resolves the way it normally would.

### Registry lifecycle

The coordination state lives on a registry keyed off the
presentation target — every Grid mounted under the same `HtmlTarget`
/ `HeadlessTarget` / etc. shares one registry. Two windows have
independent registries. The lookup is via a `WeakMap`, so a host
that's GC'd takes its registry with it.

### Convergence

A Grid contributes during its own measure pass and reads back the
current group max in the same pass. When the max changes — because
another Grid joined the group or shrank its contribution — every
OTHER member is invalidated; on the next layout pass those members
re-measure against the new max.

**Resolution converges within a single `PresentationTarget.Flush()`
call.** `Flush` iterates its measure / arrange queues until no Visual
remains dirty — Grids invalidated mid-pass by a member-set callback
are re-measured before Flush returns. The convergence loop caps at
`maxIterations` (default 16, passable as an argument to `Flush`); a
pathological cyclic invalidation that never converges hits the cap
and Flush returns silently with the queues cleared.

### Lifecycle on detach

When a Grid leaves its presentation target, its contributions are
removed from every group it participated in. The group's max is
recomputed from the surviving members; any survivor whose max
shrank gets invalidated and re-measures on the next flush.

### Multiple tracks in one Grid sharing a group

A Grid with two Auto columns both declaring `SharedSizeGroup="x"`
pre-aggregates: the contribution it reports is the MAX of its own
participating tracks' natural sizes. The group's overall max is then
the MAX across every Grid's reported contribution. Both columns in
that Grid resolve to the final group max.

## 8. Grid v3 — debug overlay + over-request resilience

Both items shipped as of Grid v3 (extends Grid v2.2). See [completed-backlog.md § 14](https://github.com/pragmatic-tech-ai/mural/blob/main/completed-backlog.md) for the full closure record.

- **`ShowGridLines`** (§ 14.1) — Boolean DP, default `false`. When `true`, `RenderOverride` paints dashed lines along every internal column AND row boundary. Outer boundaries are not drawn (the surrounding container already implies them). Companion `GridLinesBrush: SolidColorBrush | undefined` overrides the default 50%-opaque grey stroke. No-op for single-track grids.

- **Star-track shrinkage when Auto requests more than available** (§ 14.2) — A new Pass 2.6 in `MeasureOverride`. When `pixelSum + autoSum > available` AND the grid has at least one Star track, Auto tracks shrink proportionally to their headroom (above each track's own `MinWidth` floor) so the Star resolver receives positive budget. Stars with no declared MinWidth no longer collapse to 0; Stars WITH MinWidth get their min plus any excess freed by the Auto shrinkage. Auto.MinWidth is a hard floor.

## 9. Choosing Grid vs. other panels

| Use case | Panel |
|---|---|
| Single-direction list of items, all the same direction | `StackPanel` (constant cost; star sizing in one dim only) |
| N rows × M columns of equal cells | `UniformGrid` (no per-track definitions; symmetric) |
| Edge-docked chrome around a central fill | `DockPanel` (cheaper than Grid for the common header/footer/sidebar shape) |
| Mixed pixel / auto / star with multi-cell spans | `Grid` |

A Grid is more expensive than a StackPanel or DockPanel — four measure
passes vs. one — so reach for the simpler panel when the layout fits
its shape. Reach for Grid when sizing rules don't fit edges or single
axes.
