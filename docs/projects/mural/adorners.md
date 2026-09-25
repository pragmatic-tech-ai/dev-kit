# Adorners

Architecture and usage reference for the adorner subsystem — Visuals that decorate other Visuals (selection rectangles, drag ghosts, insertion lines, error chrome, resize handles, …) without the consumer doing host-coordinate math.

WPF parity with mural-specific divergences called out inline. Closes backlog item 5.8.

Implementation: [src/runtime/adorner.ts](src/runtime/adorner.ts), [src/basic/scroll/scroll-content-presenter.ts](src/basic/scroll/scroll-content-presenter.ts), [src/basic/validation-error-adorner.ts](src/basic/validation-error-adorner.ts).

---

## 1. The problem

A bare overlay layer makes the consumer responsible for "where does this go on screen?" Selecting the rectangle around shape X means walking from X up the visual tree summing `ArrangedRect` offsets, computing a host-coord rect, then painting that rect on a flat overlay anchored at the host root. Every consumer reimplements the walk; nothing tracks the element if it moves.

The deeper problem is **transforms**. If X sits inside a scrolled `ScrollViewer`, the overlay rect is correct only the moment you compute it — the next scroll tick moves X but the overlay stays put. You'd have to subscribe to every scroll change, every layout pass, every reflow above X.

WPF solved this by making adorners **descendants of the same subtree they decorate**. Any transform their ancestors apply — scroll offset, rotation, zoom — applies to the adorners too, automatically. The framework doesn't need a "follow this scroll" mechanism; the visual tree already provides it.

---

## 2. The three types

```
Adorner          — what to paint, bound to AdornedElement
AdornerLayer     — Panel-like host for Adorners, lives inside the visual tree
AdornerDecorator — Single-child wrapper that provides an AdornerLayer for its subtree
```

### `Adorner`

Abstract `Visual`. Constructed with a non-null `AdornedElement: Visual`. Subclasses override `Placement(adornedRect, desiredSize): Rect` to compute where they paint relative to the adorned element's rect (which the layer hands them, already converted to the layer's local frame), and `RenderOverride(dc)` to draw.

```ts
class BoundsAdorner extends Adorner {
    protected override MeasureOverride(_a: Size): Size { return Size.Zero; }
    public override Placement(adornedRect: Rect, _desired: Size): Rect {
        return adornedRect;                    // paint at the adorned element's rect
    }
    protected override RenderOverride(dc: DrawingContext): void {
        const s = this.RenderSize;
        dc.DrawRectangle(undefined, new Pen(BLUE, 2), new Rect(0, 0, s.Width, s.Height));
    }
}
```

`AdornedElement` is a readonly ctor arg, not a DP — adorners don't re-target after construction. Make a new adorner instead.

### `AdornerLayer`

`extends Panel`. `Add(adorner)` / `Remove(adorner)` / `GetAdorners(adornedElement): readonly Adorner[] | undefined`. Sized to its parent's slot. Arranged so each adorner sits at the rect its `Placement` returned, with the adorned element's position pre-computed in the layer's **local frame** (see § 5).

`IsHitTestVisible` defaults to `false` on the layer itself. The layer is a positioning shell, not a hit target; individual adorners opt back in.

Static lookups:
- **`GetAdornerLayer(visual): AdornerLayer | undefined`** — walks UP from `visual` and returns the first ancestor that exposes an `AdornerLayer` property of the right type. Duck-typed (`(cur as { AdornerLayer?: unknown }).AdornerLayer`) so providers in `basic/` (the `ScrollContentPresenter`) don't force a runtime → basic dependency. Returns `undefined` when no ancestor provides one; callers either short-circuit or fall back to an imperative overlay.
- **`FindFirstInSubtree(root): AdornerLayer | undefined`** — DFS the subtree from `root`. For top-level hosts (`HtmlTarget`) that need to drop an adornment without an in-tree anchor — the outermost `AdornerDecorator` typically wraps the app root, so the DFS finds it on the first hit.

### `AdornerDecorator`

`extends Single` — the µ-mural analog of WPF `Decorator`. Holds one `Child` and one internal `AdornerLayer`. `visualChildren` returns `[child, layer]` (layer painted on top); `logicalChildren` returns `[child]` so resources / DataContext don't flow into the layer.

```mu
AdornerDecorator {
    DockPanel {
        // … your app content …
    }
}
```

Wrap an `AdornerDecorator` around the part of the tree you want adornment scope over. Behaviors attached to descendants locate the layer via `GetAdornerLayer(this)` and `Add(new MyAdorner(target))`.

---

## 3. Layer placement is everything

The win in this architecture isn't that there can be **multiple** layers — it's that **where you put a layer in the visual tree decides what transforms apply to its adorners.**

A layer inside a scrolled subtree → adorners scroll with the content. A layer at the window root → adorners stay screen-anchored while content scrolls under them. A layer inside a rotated/zoomed canvas → adorners rotate and scale with the canvas.

The two questions a layer placement answers:

1. **Does the adorner move when its anchor moves?** Anchored to scrolled content → inner layer. Anchored to cursor / viewport / fixed corner → outer layer. Anchored inside a rotated/zoomed canvas (a Diagram) → inside that transform.
2. **Should the adorner be clipped by its container?** Layers inherit ancestor clips. An adorner inside a 100×100 clipped Border can't paint outside it; tooltips and dropdowns escape their host's clip by living at the outer layer.

| Pattern | Layer |
|---|---|
| Insertion line riding scrolled list | inner (SCP) |
| Selection rectangle around a Diagram shape | inner (Diagram canvas) |
| Resize handles on a selected element | inner |
| Validation error chrome on a TextBox | inner if the TextBox is in a scroller, outer otherwise |
| Drag ghost following the cursor | outer (root `AdornerDecorator`) |
| Drawer scrim, modal backdrop, toast | outer or imperative `OverlayLayer` |
| Tooltip | outer |
| Combo dropdown popup | outer or imperative `OverlayLayer` (escapes scroll clip) |

The mural platform demo wraps its root in `AdornerDecorator` ([demo/platform/platform.mu](demo/platform/platform.mu)) — that's the OUTER layer. `ScrollContentPresenter` provides the INNER layer automatically.

### Why not just put a layer inside `ScrollViewer.Content`?

You can — that's exactly what `ScrollContentPresenter` does, but it owns the layer directly rather than nesting an `AdornerDecorator` inside its content. The reason is logical-tree ownership: `ContentControl` owns the consumer's content logically. Wrapping it in an `AdornerDecorator` would change which element is the logical parent, breaking DataContext flow, resource lookup, and any binding ancestor walk. So SCP attaches the layer as a **sibling** visual child of its content (the layer is a visual-only attach), arranges it at the same rect, and gets the same outcome: lookups from inside the scrolled subtree find the SCP's layer first because of the duck-typed `AdornerLayer` getter on SCP.

---

## 4. Discovery — same consumer, different layer

```
Window
 └── AdornerDecorator                       ← OUTER layer's host
      ├── AdornerLayer (OUTER)              ← For(cursorGhost) lands here
      └── content
           └── ScrollViewer
                └── ScrollContentPresenter
                     ├── content
                     │    └── Canvas
                     │         └── Shape   ← For(Shape) finds INNER first
                     └── AdornerLayer (INNER)
```

```ts
const layer = AdornerLayer.GetAdornerLayer(target);   // walks UP from `target`
layer?.Add(new MyAdorner(target));
```

The screen-fixed-vs-content-tracked decision is encoded in **where** layers sit, not in which API the consumer called. Same call site for both cases:

- `GetAdornerLayer(Shape)` → walks `Shape → Canvas → content → ScrollContentPresenter` and stops at the SCP's inner layer.
- `GetAdornerLayer(someToolbarButton)` (outside the scroll subtree) → walks up to the root `AdornerDecorator`'s outer layer.

A behavior that wants to skip the scroll frame intentionally — say a drag ghost that should follow the cursor across scrollable regions — uses `FindFirstInSubtree` from the host root instead:

```ts
const outerLayer = AdornerLayer.FindFirstInSubtree(presentationTarget.Content);
```

---

## 5. Layer-frame positioning math

The layer hands `Placement(adornedRect, desiredSize)` a rect that's **already in the layer's local coordinate frame**. The adorner just decides what shape to paint at that rect (or some offset from it). Consumers never do the host-coord walk.

The layer computes `adornedRect` by:

1. Walking from `adornedElement` UP through `visualParent` chain, summing `ArrangedRect.X/Y`.
2. **Stopping at `this.GetVisualParent()`** (the AdornerDecorator OR the ScrollContentPresenter — whoever mounted the layer).
3. Subtracting the layer's own `ArrangedRect.X/Y` to convert from layer-parent-local to layer-local.

```ts
private computeAdornedRectInLayerFrame(adorner: Adorner): Rect {
    const adorned = adorner.AdornedElement;
    const stop = this.GetVisualParent();
    let x = 0, y = 0;
    let cur: Visual | undefined = adorned;
    while (cur !== undefined && cur !== stop) {
        x += cur.ArrangedRect.X;
        y += cur.ArrangedRect.Y;
        cur = cur.GetVisualParent();
    }
    if (cur === undefined) return new Rect(0, 0, 0, 0);   // adorned not under our layer
    x -= this.ArrangedRect.X;
    y -= this.ArrangedRect.Y;
    return new Rect(x, y, adorned.RenderSize.Width, adorned.RenderSize.Height);
}
```

Decorator-hosted layers sit at `(0, 0)` in their parent, so the subtraction is a no-op. SCP-hosted layers in clip-and-translate mode sit at `(-offX, -offY)` — the subtraction shifts the walk's result back into the layer's local frame.

Adorners running off the top of the tree (the adorned element isn't under the layer at all) get `Rect(0, 0, 0, 0)` — the adorner stays at the layer origin rather than tracking an unreachable target.

**Initial v2 cut had this wrong:** it stopped the walk at a `_decorator` sentinel that was undefined for SCP-owned layers, fell off the top, and returned zeros. Decoration adorners with default `Placement` (like `ValidationErrorAdorner`) ended up pinned at the layer origin with zero size. Fixed by stopping at `GetVisualParent()` and subtracting the layer's offset. Regression pinned by `scp-adorner-layer.test.ts`.

### Custom Placement

Override `Placement` to offset, scale, or pin to a corner of the adorned rect:

```ts
class TopEdgeInsertionLine extends Adorner {
    public override Placement(adornedRect: Rect, _desired: Size): Rect {
        // Thin horizontal bar at the adorned element's top edge,
        // spanning its full width.
        return new Rect(adornedRect.X, adornedRect.Y - 1, adornedRect.Width, 2);
    }
}
```

For an adorner that fills the **entire layer** (e.g., a Canvas wrapper that positions content imperatively in layer-local coords), use the layer's `RenderSize`:

```ts
public override Placement(_adornedRect: Rect, _desired: Size): Rect {
    const layer = this.GetVisualParent();
    if (layer === undefined) return new Rect(0, 0, 0, 0);
    const ls = layer.RenderSize;
    return new Rect(0, 0, ls.Width, ls.Height);
}
```

### Consumer-side helpers — when you need layer-local coords yourself

If a behavior manages its own positioning (a Canvas inside an adorner with `Canvas.SetTop` writes), it needs to translate from somewhere into the layer's local frame. The pattern `ListReorderBehavior` uses:

```ts
const stop = layer.GetVisualParent();
const oX = layer.ArrangedRect.X;
const oY = layer.ArrangedRect.Y;
const localY = topInFrame(container, stop) - oY;

function topInFrame(v: Visual, stop: Visual | undefined): number {
    let y = 0;
    let cur: Visual | undefined = v;
    while (cur !== undefined && cur !== stop) {
        y += cur.ArrangedRect.Y;
        cur = cur.GetVisualParent();
    }
    return y;
}
```

`stop = undefined` walks to root (host-coord). Pass `layer.GetVisualParent()` to walk to the layer's mount point. Subtract `layer.ArrangedRect.X/Y` afterward to get layer-local.

---

## 6. Hit-testing

`Visual.IsHitTestVisible` (default `true`, `MetaData.Render`) is the v3 opt-out. The SVG renderer mirrors it onto BOTH:

- The outer `<g>` (so the element itself isn't a hit target).
- The `mural-hit` pad inside it (so the pad's explicit `pointer-events="all"` doesn't beat the inherited `"none"`).

Setting only the outer wouldn't work — explicit values on descendants override inheritance, and the pad's `"all"` would still catch events. This is the same reason `HtmlTarget.suppressPointerEvents` walks every element in a drag-ghost clone setting `pointer-events="none"` explicitly.

**Adorners that should NOT block events** — decoration only, the user is interacting with the adorned element underneath — set `IsHitTestVisible = false` in their constructor. The three shipped adorners (`DragGhostAdorner`, `ReorderInsertionAdorner`, `ValidationErrorAdorner`) all do this.

**Adorners that ARE interactive** — a resize handle, a drag affordance — leave `IsHitTestVisible = true` (the default). They receive pointer events normally because their pad has explicit `"all"`, which overrides the inherited `"none"` from the layer's outer.

**`AdornerLayer.IsHitTestVisible = false`** in its constructor. The layer is a positioning shell — its full-surface pad would catch every click in the platform demo, blocking content underneath. Adorner children opt back in by default.

```
AdornerDecorator <g>            pointer-events: <none on outer or pad>
 ├── child <g>                  hittable (the app content)
 └── layer <g>                  pointer-events: none on outer AND pad
      └── adorner <g>           hittable when IsHitTestVisible = true
                                pointer-events: none on outer AND pad when false
```

---

## 7. The built-in adorner roster

### `DragGhostAdorner` — [src/runtime/adorner.ts](src/runtime/adorner.ts)

Cursor-anchored adorner used by `HtmlTarget` to host the drag preview when the visual tree contains an `AdornerDecorator`. `SetPosition(x, y)` pins the ghost in the layer's local frame; `SetContent(visual)` hosts a DataTemplate-derived preview (mode C in [src/visual-engine/targets/html-target.ts](src/visual-engine/targets/html-target.ts)) or stays empty (mode A — HtmlTarget appends a manually-cloned source `<g>` into the adorner's outer after Flush).

`IsHitTestVisible = false` so the ghost doesn't intercept the drag-over dispatch the receiver is waiting for.

### `ReorderInsertionAdorner` — [src/basic/behaviors/list-reorder-behavior.ts](src/basic/behaviors/list-reorder-behavior.ts)

Internal adorner the `ListReorderBehavior` instantiates when an `InsertionAdornerTemplate` is set and a reorderable drag is in progress. Hosts a Canvas wrapper that contains the user-supplied template's produced Visual; the behavior writes `Canvas.SetLeft / SetTop` in **layer-local** coords on the wrapper so the line lands at the right gap.

Adornment target is the host `ItemsControl`. `Placement` returns the full layer rect so the wrapper Canvas occupies the layer's frame and the behavior's positioning math (in layer-local coords) lands at the intended on-screen position.

When the host's tree contains an AdornerLayer (typical case: the SCP's inner layer for a virtualized ListBox), the line **rides the scrolled subtree's translate** — it stays glued to its gap as auto-scroll fires, no DragOver re-fire heuristic needed. Falls back to the imperative `PresentationTarget.AttachOverlay` path on hosts not under any AdornerLayer.

### `ValidationErrorAdorner` — [src/basic/validation-error-adorner.ts](src/basic/validation-error-adorner.ts)

Reactive adorner that paints a red rectangle around the adorned element when `Validation.GetHasError(target)` is true. Subscribes to the adorned element's `Validation.HasErrorKey` change notifications via `AddPropertyChangedListener`; `InvalidateVisual` on every flip flows through the standard repaint loop.

Static `AttachTo(target): (() => void) | undefined` finds the layer and installs the adorner, returning a detach thunk that removes both the adorner and the property subscription. Returns `undefined` when no `AdornerLayer` is in scope (consumer decides whether to fail loudly or silently skip).

`Dispose()` (not `Detach` — name collision with `Visual.Detach(child)`) removes the property listener. Hit-test transparent so the chrome doesn't block edits on the underlying TextBox.

---

## 8. Writing a new adorner

```ts
import { Adorner, AdornerLayer, Rect, Size, Visual, type DrawingContext } from '../runtime/index.js';
import { Pen, SolidColorBrush } from '../visual-engine/index.js';

export class SelectionBoxAdorner extends Adorner {
    private static readonly STROKE = new SolidColorBrush(/* … */);
    private static readonly THICKNESS = 2;

    constructor(adornedElement: Visual) {
        super(adornedElement);
        // Selection chrome is decoration — the user is clicking the
        // adorned element, not the box. Don't intercept hits.
        this.IsHitTestVisible = false;
    }

    protected override MeasureOverride(_a: Size): Size { return Size.Zero; }

    public override Placement(adornedRect: Rect, _desired: Size): Rect {
        // Default behavior — paint at the adorned element's rect.
        return adornedRect;
    }

    protected override RenderOverride(dc: DrawingContext): void {
        const s = this.RenderSize;
        if (s.Width <= 0 || s.Height <= 0) return;
        const t = SelectionBoxAdorner.THICKNESS;
        const half = t / 2;
        dc.DrawRectangle(
            undefined,
            new Pen(SelectionBoxAdorner.STROKE, t),
            new Rect(half, half,
                     Math.max(0, s.Width  - t),
                     Math.max(0, s.Height - t)),
        );
    }
}

// Usage:
const layer = AdornerLayer.GetAdornerLayer(shape);
if (layer !== undefined) {
    const sel = new SelectionBoxAdorner(shape);
    layer.Add(sel);
    // … later, when selection clears:
    layer.Remove(sel);
}
```

**Rules to follow:**

1. `AdornedElement` is set ONCE at construction. To re-target, dispose and create a new adorner.
2. Override `Placement` to derive your rect from `adornedRect`. Don't compute host coords yourself.
3. Override `RenderOverride` to paint. Coords inside `dc` are local to the adorner.
4. Set `IsHitTestVisible = false` if you're decoration only. Leave it `true` (the default) if you need to receive pointer events (resize handle, drag affordance).
5. If your adorner subscribes to anything (a DP listener, a routed-event listener, a timer), expose a `Dispose()` that unwires. The behavior or control that owns the adorner is responsible for calling `Dispose` after `layer.Remove(adorner)`.
6. If your adorner hosts child Visuals (a Canvas wrapper, a Border, etc.), `AttachVisual` them in the ctor or a setter and `DetachVisual` on swap. Implement `visualChildren` so the renderer walks them.

---

## 9. WPF parity notes

| WPF | mural | Notes |
|---|---|---|
| `Adorner` (abstract `FrameworkElement`) | `Adorner extends Visual` | µ-mural's `Visual` covers what WPF's `FrameworkElement` does at this layer. |
| `Adorner.AdornedElement` (ctor) | `Adorner.AdornedElement` (ctor, readonly) | Same — set once, can't be re-targeted. |
| `OnRender(DrawingContext)` | `RenderOverride(dc)` | Same shape; name follows the existing `MeasureOverride` / `ArrangeOverride` convention. |
| `GetDesiredTransform(elementTransform)` | `Placement(adornedRect, desiredSize): Rect` | Different shape. WPF returns a Transform; we return the rect to arrange at, which composes with the layer's arrange step. Simpler in a system without a full Transform stack. |
| `AdornerLayer.GetAdornerLayer(UIElement)` | `AdornerLayer.GetAdornerLayer(Visual)` | Same semantics — walks UP, returns nearest. Duck-types on the `AdornerLayer` property so providers in `basic/` don't force a runtime → basic dep. |
| `AdornerLayer.Add` / `Remove` | `AdornerLayer.Add` / `Remove` | Same. |
| `AdornerLayer.GetAdorners(UIElement)` | `AdornerLayer.GetAdorners(Visual)` | Returns `undefined` for none (µ-mural's absent convention) vs. WPF's `null`. |
| `AdornerDecorator` (`extends Decorator`) | `AdornerDecorator extends Single` | `Single` is µ-mural's `Decorator` analog. |
| `AdornerDecorator` automatically wraps `Window.Content` | mural's platform.mu wraps the root manually | One-line opt-in is consistent with the rest of the framework (DataContext, etc. are also explicit). |
| `ScrollContentPresenter` carries an inner `AdornerLayer` automatically | `ScrollContentPresenter` carries an inner `AdornerLayer` automatically | Parity — but mural's SCP owns the layer directly as a sibling rather than via a nested `AdornerDecorator`, to avoid a logical-tree collision with `ContentControl`'s ownership of the content. Functional outcome identical. |
| `IsHitTestVisible` opt-out | `Visual.IsHitTestVisible` (default `true`, `MetaData.Render`) | Same opt-out, plumbed through the SVG renderer (sets `pointer-events="none"` on both outer `<g>` and `mural-hit` pad). |
| `AdornerLayer.Update(UIElement)` | (n/a) | Not implemented — µ-mural's arrange pass re-runs on every InvalidateArrange, so the adorner's `Placement` is re-evaluated automatically. No manual update API needed. |

### Things mural has that WPF doesn't

- **`AdornerLayer.FindFirstInSubtree(root)`** — DFS lookup for top-level hosts that need to drop adornments without an in-tree anchor (HtmlTarget's drag ghost path).
- **Duck-typed `AdornerLayer` property** — any Visual exposing an `AdornerLayer` getter qualifies as a layer provider. Used by SCP to provide an inner layer without inheriting from `AdornerDecorator`.

### Things WPF has that mural doesn't

- **`Adorner.GetDesiredTransform`** — WPF lets adorners apply an arbitrary transform on top of the host. mural's `Placement` returns a rect; if you need a transform you set the adorner's own `RenderTransform` (orthogonal to Placement).
- **Automatic `AdornerLayer` in the `Window` template** — mural's platform demo wraps the root explicitly; no automatic top-level layer. Consistent with the rest of the framework (no implicit DataContext, no implicit anything).

---

## 10. Related fixes

The adorner work surfaced two unrelated bugs that needed to ship alongside:

- **`InvalidateVisual` while detached.** Recycled ListBoxItem containers transition through a detached state during `bindContainer` (after `RemoveVisualChild`, before `AddVisualChild`). Property changes during that window — IsSelected flipping, the Background trigger un-applying on PART_Border — called `InvalidateVisual` on a Visual with `_target = undefined`, silently dropping the notification. The container then got re-attached with the renderer unaware that PART_Border needed repaint, so the stale chrome from the prior binding leaked through. Fixed in [src/runtime/visual.ts](src/runtime/visual.ts): `InvalidateVisual` on a detached Visual sets a one-shot flag; `SetTarget` on the undefined → defined transition replays the invalidation. Same mechanism handles adorner re-attach scenarios.

- **AdornerLayer outer + pad pointer-events.** Setting `pointer-events="none"` only on the outer `<g>` wasn't enough — the inner `mural-hit` pad's explicit `pointer-events="all"` overrode the inherited "none" and still caught events. Fixed in [src/visual-engine/svg-renderer.ts](src/visual-engine/svg-renderer.ts): `applyHitTestVisibility` now sets the attribute on both. This is what makes `AdornerLayer.IsHitTestVisible = false` actually transparent.

---

## 11. Testing

| Suite | What it pins |
|---|---|
| `src/runtime/tests/adorner.test.ts` (11 tests) | Adorner / Layer / Decorator construction, attach, GetAdornerLayer walk, FindFirstInSubtree DFS, arrange-time positioning. |
| `src/basic/tests/scp-adorner-layer.test.ts` (5 tests) | SCP exposes layer; GetAdornerLayer lands on SCP layer when walking up from content; SCP inner layer wins over outer AdornerDecorator; layer arranges at content rect; adorner adorning a leaf inside non-origin SCP lands at layer-local position (the regression for the walk bug). |
| `src/basic/tests/validation-error-adorner.test.ts` (7 tests) | AttachTo finds the layer; detach removes the adorner; HasError flip triggers repaint; Dispose unsubscribes; positions at the adorned rect; integration with TextBox. |
| `src/basic/tests/list-box-recycle-selection.test.ts` (5 tests) | Recycle/rebind preserves IsSelected via _selectedData; chrome end-to-end; ItemContainerStyle + custom template + IsSelected trigger across recycle (word-toolbox parity); InvalidateVisual-while-detached replay. |

Plus indirect coverage through `list-reorder-behavior.test.ts` (insertion-line via fallback path) and `drag-drop-overlay.test.ts` (HtmlTarget drag ghost integration).
