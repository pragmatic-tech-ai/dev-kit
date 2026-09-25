# Layout & Render Lifecycle

How a Visual goes from "I have properties" to "pixels on the screen". This is
the part of `Visual` that builds custom controls: the three-phase lifecycle
(Measure / Arrange / Render), the sizing properties, alignment, and margin.

**Implemented in:**
- [runtime/visual.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/visual.ts) — the Measure / Arrange / Render entry points + the alignment / margin / sizing properties

See also: [visual-tree.md](visual-tree.md) for tree structure,
[drawing.md](drawing.md) for what `RenderOverride` actually draws,
[targets.md](targets.md) for who drives the lifecycle.

## 1. The three phases

A render pass walks the Visual tree three times:

```
Measure(availableSize) → DesiredSize         "how big do I want to be, given this budget?"
Arrange(finalRect)     → RenderSize           "you got this rect; tell me your actual painted size"
Render(dc)             → drawing primitives   "paint your contribution"
```

Each Visual has **public entry points** that the host calls (`Measure`,
`Arrange`, `Render`) and **protected overrides** that subclasses implement
(`MeasureOverride`, `ArrangeOverride`, `RenderOverride`). Never override the
entry points — they handle caching, alignment, margin clamping, and other
framework-level concerns before calling the override.

```ts
class MyControl extends Visual {
    protected override MeasureOverride(availableSize: Size): Size { /* ... */ }
    protected override ArrangeOverride(finalSize: Size): Size      { /* ... */ }
    protected override RenderOverride(dc: DrawingContext): void    { /* ... */ }
}
```

### Default behaviors

| Override | Default if not implemented |
|---|---|
| `MeasureOverride` | Returns `Size.Zero` (this Visual takes no space) |
| `ArrangeOverride` | Returns `finalSize` (accept what the parent gave) |
| `RenderOverride` | Empty (this Visual paints nothing — children draw themselves) |

These are reasonable for containers and leaf Visuals alike. `Single` and
`Panel` don't override — `Border` overrides all three to handle insets +
background + stroke.

## 2. Measure

```ts
public Measure(availableSize: Size): void
```

The Measure phase asks "given this much room, how big do you want to be?"
The result is cached as `DesiredSize`, which the parent reads when arranging
children.

A typical container's `MeasureOverride` measures each child, then computes
its own desired size from theirs:

```ts
protected override MeasureOverride(availableSize: Size): Size {
    let w = 0, h = 0;
    for (const child of this.children) {
        child.Measure(availableSize);        // recurse
        w  = Math.max(w, child.DesiredSize.Width);
        h += child.DesiredSize.Height;        // stack vertically
    }
    return new Size(w, h);
}
```

A leaf's `MeasureOverride` typically returns its intrinsic size:

```ts
class Rectangle extends Visual {
    protected override MeasureOverride(_a: Size): Size {
        return new Size(this.Width, this.Height);
    }
}
```

### What Visual.Measure does for you

Before calling `MeasureOverride`, the framework:

1. Caches the call — if `IsMeasureValid` and `availableSize` equals the last
   one, the override doesn't re-run.
2. Subtracts `Margin` from `availableSize` so the override sees only the
   inner budget.
3. Resolves `[min, max]` per axis from `Width / Height / MinWidth /
   MinHeight / MaxWidth / MaxHeight` (see §6) and clamps the inner budget
   into that range.

After the override runs:

4. Clamps the returned size into the same `[min, max]` range.
5. Adds `Margin` back so `DesiredSize` reflects the full bounding box the
   parent must reserve.
6. Marks `IsMeasureValid = true` and `IsArrangeValid = false`.

That means: **your `MeasureOverride` only sees the inner space available
for content, and only returns the inner desired size**. Margin and explicit
size constraints are framework concerns.

## 3. Arrange

```ts
public Arrange(finalRect: Rect): void
```

The Arrange phase says "you got this rect — work out where to actually
render and place your children." A container's `ArrangeOverride` positions
each child within the rect:

```ts
protected override ArrangeOverride(finalSize: Size): Size {
    let y = 0;
    for (const child of this.children) {
        child.Arrange(new Rect(0, y, finalSize.Width, child.DesiredSize.Height));
        y += child.DesiredSize.Height;
    }
    return finalSize;
}
```

The rect handed to each child is in the **parent's local coordinate space**
(origin at the parent's top-left). When the renderer walks the tree, it
pushes a translate for each child based on `child.ArrangedRect.{X, Y}` so
the child draws in its own (0, 0).

### What Visual.Arrange does for you

Before calling `ArrangeOverride`, the framework:

1. Caches the call — if `IsArrangeValid` and `finalRect` matches the last
   one, the override doesn't re-run.
2. Forces a Measure if not measured yet (rare; usually the parent measured
   you already).
3. Subtracts `Margin` from `finalRect` to get the **margined rect** —
   the area this Visual's content actually lives in.
4. Computes the **render size** per axis:
   - Explicit `Width` / `Height` → use it (clamped to Min/Max).
   - `Stretch` alignment + no explicit size → fill the margined slot
     (clamped to Min/Max).
   - Any other alignment → use `DesiredSize` minus margin.
5. Computes the **alignment offset** within the margined slot
   (`Left/Top/Right/Bottom/Center/Stretch` per axis — see §7).

After the override runs:

6. Stores `ArrangedRect = (marginedRect.X + offsetX, marginedRect.Y +
   offsetY, renderW, renderH)`. This is the **final aligned rect** the
   renderer translates to.
7. Stores `RenderSize` from the override's return value.

**`ArrangedRect` is what the host uses for translates**, not the raw
parent-given rect. It already includes margin offset + alignment offset.

## 4. Render

```ts
public Render(dc: DrawingContext): void
```

The Render phase asks each Visual to emit its drawing primitives into the
given `DrawingContext`. The default Render delegates to RenderOverride:

```ts
protected override RenderOverride(dc: DrawingContext): void {
    dc.DrawRectangle(this.Fill, this.Stroke, new Rect(0, 0, this.RenderSize.Width, this.RenderSize.Height));
}
```

Important rules for RenderOverride:

- **Draw at local origin (0, 0)** — alignment and positioning are handled
  by the host's translate before calling Render.
- **Don't paint children** — the host walks the tree and calls each Visual's
  Render in turn. A container's RenderOverride only paints its own
  contribution (chrome, background, stroke).
- **Use `RenderSize`** (cached after Arrange) for "how big am I drawing
  right now". `DesiredSize` is your wish; `RenderSize` is the reality.

What `DrawingContext` exposes — `DrawRectangle`, `DrawText`, `DrawGeometry`,
`PushTransform`, `Pop` — is in [drawing.md](drawing.md).

## 5. Invalidation

When any property with a layout-affecting `MetaData` flag changes, the
framework automatically calls the matching `Invalidate*` method. You rarely
need to call them yourself unless you've changed external state the framework
doesn't track (e.g., a backing data structure).

```ts
public InvalidateMeasure(): void   // re-measure; cascades to arrange too
public InvalidateArrange(): void   // re-arrange only
public InvalidateVisual(): void    // re-render only
```

Each method clears the corresponding validity flag, notifies the host
via the `VisualHost.OnXxxInvalidated` hook, AND cascades UP the visual
tree invalidating ancestors' caches too (dedup'd: the upward walk
stops at the first already-invalid ancestor). Without that walk, a
parent whose cache is still valid would short-circuit the next top-down
Measure / Arrange pass and never reach this Visual through its
`MeasureOverride` / `ArrangeOverride`. This matters specifically for
property changes that mutate child state which the parent can't infer
on its own — for example `VirtualizingStackPanel.Viewport`, where the
panel needs a re-measure that the IC ancestor wouldn't otherwise
trigger.

The host notification fires regardless of cascade dedup (the host's
queue handles its own dedup); the cascade itself stops at the first
already-invalid ancestor so chains of property changes don't re-walk
the whole tree.

Property-to-invalidation routing:

| `MetaData` flag | Property change triggers |
|---|---|
| `Measure` | `InvalidateMeasure()` (which also invalidates arrange) |
| `Arrange` | `InvalidateArrange()` |
| `Render` | `InvalidateVisual()` |
| `Inherits` | property value cascades to descendants |
| `None` | nothing — just fires change listeners |

Combine flags with `|`: a property that affects both layout and rendering
uses `MetaData.Measure | MetaData.Render`.

### PresentationTarget.Flush — convergence loop

`Flush` runs a measure + arrange pass on the host's `Content` (and on
the overlay layer if attached). Cross-Visual coupling — `Grid`'s
`SharedSizeGroup`, future adorner-driven re-measures, etc. — can
re-invalidate Visuals during a pass: the measure / arrange queues
become non-empty mid-flush.

`Flush` handles this by iterating: each pass clears the dirty queues,
runs the layout walk, and checks whether the queues are empty again.
If they are, the layout has converged and Flush returns. If
something got re-dirtied, Flush runs another pass.

```ts
target.Flush();                    // default: up to 16 iterations
target.Flush(/*maxIterations=*/8); // override the cap
```

The default cap (16) is generous for realistic scenes; the common
case converges on iteration 1. Pathological cyclic invalidation
(Visual A invalidates B which invalidates A which …) hits the cap
and Flush returns silently with the queues cleared — the renderer
sees whatever state the last iteration produced, not an infinite
hang.

Only the measure / arrange queues drive the convergence check;
`renderDirty` is intentionally not part of it (a render pass is what
clears renderDirty, and Flush doesn't paint).

## 6. Sizing — Width / Height / Min / Max

Visual defines six sizing properties, all bindable:

| Property | Default | Effect |
|---|---|---|
| `Width` | `NaN` | When set, locks the render size on the horizontal axis. NaN means "size to content". |
| `Height` | `NaN` | Vertical equivalent. |
| `MinWidth` | `0` | Floor on the horizontal size. |
| `MinHeight` | `0` | Floor on the vertical size. |
| `MaxWidth` | `+Infinity` | Ceiling on the horizontal size. |
| `MaxHeight` | `+Infinity` | Ceiling on the vertical size. |

All four contribute to a single per-axis `[min, max]` range. The framework
clamps three places:

1. The `availableSize` handed to `MeasureOverride`.
2. The value returned by `MeasureOverride` (so MeasureOverride can't "lie"
   about being smaller than `MinWidth` or larger than `MaxWidth`).
3. The `finalSize` handed to `ArrangeOverride`.

**Explicit `Width` collapses the range** to `[Width, Width]` (clamped to
user-specified Min/Max if they conflict — Min wins on lower bound, Max wins
on upper). With Width set, `MeasureOverride` sees exactly Width as the
constrained width and DesiredSize.Width is exactly Width regardless of what
MeasureOverride returned.

```ts
v.Width    = 100;           // lock to 100
v.MinWidth = 50;            // never < 50 (Width=100 is fine here)
v.MaxWidth = 200;           // never > 200 (Width=100 is fine here)

// Width=300 + MaxWidth=200 → MaxWidth wins → effective range = [200, 200]
v.Width    = 300;
v.MaxWidth = 200;
v.Measure(new Size(1000, 1000));
v.DesiredSize.Width;        // 200
```

To return a Visual to "size to content" after setting an explicit size:

```ts
v.Width = Number.NaN;
```

## 7. HorizontalAlignment / VerticalAlignment

Determines how the rendered area is positioned within the parent-given slot
when it's smaller than the slot:

```ts
enum HorizontalAlignment { Left, Center, Right, Stretch }
enum VerticalAlignment   { Top,  Center, Bottom, Stretch }
```

Defaults are `Stretch` for both. With `Stretch` and no explicit size, the
Visual fills the slot. With `Stretch` + explicit size, **WPF semantics apply
and the rendered area centers** within the slot (the same as `Center`).

| Configuration | Behavior |
|---|---|
| `Stretch`, no Width set | Fill the slot horizontally |
| `Stretch`, Width set | Use Width, center horizontally |
| `Left`, Width set | Use Width, hug the left edge |
| `Right`, Width set | Use Width, hug the right edge |
| `Center`, Width set | Use Width, center horizontally |
| `Center`, no Width set | Use DesiredSize.Width, center horizontally |

The vertical axis works identically with `Top` / `Bottom` / `Center` / `Stretch`.

Alignment is `MetaData.Arrange` — changing it invalidates arrange but not measure.

```ts
import { HorizontalAlignment, VerticalAlignment } from '../runtime/index.js';

text.Width = 100;
text.HorizontalAlignment = HorizontalAlignment.Center;
text.VerticalAlignment   = VerticalAlignment.Top;
// text renders 100px wide at the top of its slot, horizontally centered
```

When the rendered area is **larger** than the slot (e.g., explicit Width
exceeds available), it clips at the slot origin — no offset applies.

## 8. Margin

`Margin` is outer spacing — the gap between this Visual's rendered area
and the edges of its parent-given slot. Differs from a Border's `Padding`
(which sits inside the Border, around its child).

```ts
import { Thickness } from '../runtime/index.js';

v.Margin = new Thickness(10);          // 10 on all four sides
v.Margin = new Thickness(10, 20);      // horizontal=10, vertical=20
v.Margin = new Thickness(10, 20, 30, 40);  // left, top, right, bottom
```

What changes with Margin set:
- `MeasureOverride` sees `availableSize - margin` (less budget for content).
- `DesiredSize` is `MeasureOverride result + margin` (so the parent reserves
  the whole bounding box).
- `ArrangeOverride` sees the margined slot (alignment offsets are computed
  inside the margined slot, not the raw parent slot).
- `ArrangedRect` is positioned inside the margined slot.

Margin is `MetaData.Measure` — changing it invalidates the layout pass.

## 9. Layout state getters

Read the cached layout state from any Visual:

| Getter | Returns |
|---|---|
| `DesiredSize` | The size this Visual asked for in the last Measure (includes margin) |
| `RenderSize` | The size this Visual is actually rendering at (no margin) |
| `ArrangedRect` | The final aligned rect in the parent's coordinate space |
| `IsMeasureValid` | `true` if the measure cache is current |
| `IsArrangeValid` | `true` if the arrange cache is current |

These are populated by the framework — you read but never set them.
`DesiredSize` is set by Measure; `RenderSize` and `ArrangedRect` are set
by Arrange.

## 10. Complete custom container example

A horizontal stack panel that respects Width / Height / Alignment / Margin
on its children automatically (since the framework handles those):

```ts
import {
    HorizontalAlignment, MetaData, Model, Panel, Rect, Size,
} from '../runtime/index.js';

class HStack extends Panel {
    static {
        Model.RegisterProperty(HStack, 'Spacing', 0, MetaData.Measure);
    }
    public get Spacing(): number { return this.get_property_value('Spacing'); }
    public set Spacing(v: number) { this.set_property_value('Spacing', v); }

    protected override MeasureOverride(availableSize: Size): Size {
        const spacing = this.Spacing;
        let totalW = 0, maxH = 0;
        const children = this.children;
        const childAvail = new Size(availableSize.Width, availableSize.Height);
        for (let i = 0; i < children.length; i++) {
            const c = children[i]!;
            c.Measure(childAvail);
            totalW += c.DesiredSize.Width;
            if (i < children.length - 1) totalW += spacing;
            maxH = Math.max(maxH, c.DesiredSize.Height);
        }
        return new Size(totalW, maxH);
    }

    protected override ArrangeOverride(finalSize: Size): Size {
        const spacing = this.Spacing;
        let x = 0;
        for (const c of this.children) {
            c.Arrange(new Rect(x, 0, c.DesiredSize.Width, finalSize.Height));
            x += c.DesiredSize.Width + spacing;
        }
        return finalSize;
    }
}

// Use:
const row = new HStack();
row.Spacing = 8;
row.AddChild(new TextBlock('Left'));
row.AddChild(new TextBlock('Middle'));
row.AddChild(new TextBlock('Right'));

const target = new HeadlessTarget(400, 80, row);
target.Render(new SvgDrawingContext());
```

Notice the container doesn't touch Margin, MinWidth, MaxWidth, alignment, or
explicit Width on its children — `Visual.Measure` and `Visual.Arrange` apply
those before/after the children's overrides run. You get them for free.

## 11. When to invalidate explicitly

The framework invalidates automatically when a registered property changes
(if its MetaData flag implies a phase). You'd call `Invalidate*` directly
when:

- An external (non-property) source of layout changed — e.g., your control
  depends on the size of an underlying canvas you don't expose as a property.
- You implement a control whose layout depends on time (animation) or other
  side-band signals.

For typical declarative use — properties drive the layout — you don't
invalidate explicitly. The framework does.
