# Visual Engine — Design

Tracking items 5.4 (layout / render pipeline) and 7.3 (skeleton thereof) in [current-backlog.md](current-backlog.md). Captures the drawing API design before implementation so the trade-offs are explicit.

## 0. The reframing

The Visual tree gives us *what* is on screen. The visual engine gives us *how it appears on a surface*. WPF separates these cleanly: `Visual` owns tree structure and `OnRender(DrawingContext)`; the renderer (and below it, the composition layer) owns pixels. We're matching that split.

Two practical constraints shape the design:

1. We're targeting SVG first, Canvas second, possibly WebGL much later. The drawing API has to abstract over all three without leaking renderer details into Visuals.
2. Brushes, pens, geometries, and text styles are first-class state — they bind, animate, inherit, default. They have to be Models so the existing property/binding machinery applies. Only the *renderer surface itself* (the thing that turns drawing primitives into pixels) is renderer-specific.

So: imperative-style `OnRender(dc)` on Visual, with the DC being a renderer-supplied seam, and a hierarchy of Brush/Pen/Geometry Models that the DC consumes.

## 1. Renderer choice

**SVG first.** Each Visual gets a `<g>` slot; `OnRender` creates or updates SVG elements under it; the browser handles layout invalidation, hit testing, focus, ARIA, text, and DPI. Fastest path to a working framework; ceiling is ~5–10k DOM nodes before scroll/layout stalls.

**Canvas later** for subtree-virtualization Visuals (grids, timelines, large lists). A `CanvasHost` Visual owns a `<canvas>`; its subtree renders into the canvas via a `CanvasDrawingContext`; the rest of the tree stays SVG. Hybrid is normal.

**WebGL only** when a concrete app needs it (CAD viewer, large graph viz). The cost is text rendering, hit testing, and a11y, all of which we'd have to reinvent.

The Visual API doesn't change between these. Only the concrete DC implementation changes.

## 2. Drawing model

Three layers, top-down:

```
PresentationTarget      scene description — Width/Height, Content (root Visual),
  │                     Background, DeviceScale. Renderer-agnostic Model.
  ▼
Visual                  tree node, holds properties, has OnRender(dc)
  │
  ▼
DrawingContext          renderer-supplied seam — DrawRectangle, DrawText, PushTransform, …
  │
  ▼
Renderer                SVG / Canvas / WebGL impl — owns the surface, observes one
                        PresentationTarget, walks the dirty tree, constructs a DC per
                        Visual, caches the result
```

Visual contributes drawing *primitives*; it never sees the renderer. The renderer caches whatever the DC built (SVG nodes, a command list, a vertex buffer) and replays / updates on the next dirty cycle.

Composition lives entirely on the Visual tree. `OnRender` paints **only this Visual's contribution**, never its children. The renderer walks children separately, calling `OnRender` on each. A `Button` is a `Single` containing a `Border` containing a `TextBlock` — each contributes its own primitives.

## 3. PresentationTarget — the scene root

A PresentationTarget is the entry point: scene description plus host bridge. We follow WPF's `PresentationSource` pattern — one class per host environment, sharing a common scene description on the Model layer.

```ts
abstract class PresentationTarget extends Model
{
    static {
        Model.RegisterProperty(PresentationTarget, 'Width',       0,         MetaData.Measure);
        Model.RegisterProperty(PresentationTarget, 'Height',      0,         MetaData.Measure);
        Model.RegisterProperty(PresentationTarget, 'DeviceScale', 1,         MetaData.Measure);
        Model.RegisterProperty(PresentationTarget, 'Content',     undefined, MetaData.Render);
        Model.RegisterProperty(PresentationTarget, 'Background',  undefined, MetaData.Render);
    }
    // typed accessors; protected constructor
}

class HtmlTarget       extends PresentationTarget { /* host Element + resize observer + event delegate + SVG/Canvas mount */ }
class FileTarget       extends PresentationTarget { /* output path/Blob + format + Save() */ }
class HeadlessTarget   extends PresentationTarget { /* backing buffer for tests / server-side */ }
// OffscreenCanvasTarget, PdfTarget, … as needs arise.
```

Each concrete subclass owns its renderer internally (HtmlTarget instantiates an `SvgRenderer` or `CanvasRenderer` depending on a `{ backend }` option; FileTarget picks based on file format). The user constructs one object:

```ts
const vp = new HtmlTarget(document.querySelector('#scene')!);
vp.Content = rootVisual;
// done — resize, DPI, event routing, rendering all wired
```

Design points:

- **Abstract.** `new PresentationTarget()` is a type error. You always pick a target.
- **Model, not Visual.** PresentationTarget doesn't appear in `Visual.parent` walks, has no parent of its own, has no children in the Visual sense. It's pure data on the base — five properties — so its concrete subclass's renderer participates in the existing change-notification machinery by subscribing via `AddPropertyChangedListener`.
- **`Content` is the root Visual.** Assigning fires a `Content`-change notification; the subclass's renderer detaches the previous tree and mounts the new one. No parent/child relationship — PresentationTarget never appears as `Visual.parent`. Assigning the same Visual to two PresentationTargets is undefined behavior; concrete subclasses reject it if they can detect it cheaply.
- **`Width` / `Height` drive the layout pass's available size.** Both in DIPs, not device pixels. HtmlTarget translates `ResizeObserver` callbacks into `this.Width = ...` / `this.Height = ...`; FileTarget sets them once at construction.
- **`DeviceScale`** is the DIP → device-pixel multiplier (default 1). HtmlTarget initializes from `window.devicePixelRatio`; FileTarget from a `{ dpi }` option; HeadlessTarget from its constructor arg. DPI-aware Visuals read it through the PresentationTarget.
- **`Background: Brush | undefined`** fills the target surface before any of Content's primitives. Distinct from a Visual's own background — this is what's visible when Content is undefined, what shows through transparent regions of Content, and what the renderer paints as the initial clear.
- **MetaData flags are advisory.** Since PresentationTarget extends Model (not Visual), `OnPropertyChanged` is a no-op — the flags don't auto-fire `Mark*Dirty`. They document which property the renderer should subscribe to and how it should react (re-measure vs re-render).

Trade-off acknowledged: one PresentationTarget observed by multiple renderers (render the same scene to screen + PDF simultaneously) is not supported in this design. The path back if we need it: extract a `Scene` Model holding Content/Background/Width/Height, have PresentationTargets reference a Scene instead of carrying those properties directly. Defer until something concretely asks for it.

## 4. Visual.OnRender

```ts
abstract class Visual extends Model
{
    // Called by the renderer when this Visual is marked render-dirty.
    // Default is empty — most Visuals are pure composition (Single, Panel)
    // and contribute nothing themselves; their children do the drawing.
    protected OnRender(_dc: DrawingContext): void { /* override in leaf Visuals */ }
}
```

Lifecycle:

- `MarkRenderDirty` enqueues the Visual on the renderer.
- On the next render tick the renderer constructs a DC scoped to this Visual's render slot, calls `OnRender(dc)`, and the DC's methods produce / update the renderer-native artifacts.
- `OnRender` is cheap and called only when dirty. Property changes with `MetaData.Render` (or `Measure | Render`) already trigger `MarkRenderDirty` via the existing hook routing in `Visual.OnPropertyChanged`.
- Children are walked by the renderer, not by the parent's `OnRender`. There is no `dc.DrawChild(child)` — composition is not a draw primitive.

## 5. DrawingContext

```ts
interface DrawingContext
{
    // Primitives — brush is fill, pen is stroke; either may be undefined.
    DrawRectangle(brush: Brush | undefined, pen: Pen | undefined, rect: Rect): void;
    DrawRoundedRectangle(brush: Brush | undefined, pen: Pen | undefined, rect: Rect, rx: number, ry: number): void;
    DrawEllipse(brush: Brush | undefined, pen: Pen | undefined, center: Point, rx: number, ry: number): void;
    DrawLine(pen: Pen, p0: Point, p1: Point): void;
    DrawGeometry(brush: Brush | undefined, pen: Pen | undefined, geometry: Geometry): void;
    DrawText(text: FormattedText, origin: Point): void;
    DrawImage(image: ImageSource, rect: Rect): void;

    // Stack frames — Pop closes the most recent Push.
    PushTransform(transform: Transform): void;
    PushClip(geometry: Geometry): void;
    PushOpacity(opacity: number): void;
    Pop(): void;
}
```

Design points:

- **DC is transient.** Created by the renderer per `OnRender` call, discarded after. Not a Model — no binding, no listeners. The *output* of the DC (SVG nodes, command list) is what's retained by the renderer.
- **Brush and Pen are separate arguments**, mirroring WPF, so a primitive can be fill-only, stroke-only, or both. Both nullable. (Alternative: a `Brush` arg that's a `LinearGradient` + a `Pen` arg that's a different brush. Treating them as separate parameters keeps the call sites symmetric and matches WPF's `DrawRectangle(Brush, Pen, Rect)` exactly.)
- **Geometry is the escape hatch.** Anything not expressible by `DrawRectangle` / `DrawEllipse` / `DrawLine` is a `DrawGeometry(brush, pen, PathGeometry)`. Cheap to add primitives later — they're conveniences that lower to geometry under the hood.
- **Push/Pop stack** maps natively to SVG (`<g transform=...>`/`<clipPath>`/`opacity`) and to Canvas (`save()` / `restore()` + matrix multiply + `clip()` + `globalAlpha`). No abstraction leak.

## 6. Brush, Pen

Brushes are Models so they participate in binding / animation / property inheritance.

```ts
abstract class Brush extends Model
{
    static {
        Model.RegisterProperty(Brush, 'Opacity', 1.0, MetaData.Render);
        Model.RegisterProperty(Brush, 'Transform', Transform.Identity, MetaData.Render);
    }
}

class SolidColorBrush extends Brush
{
    static {
        Model.RegisterProperty(SolidColorBrush, 'Color', Color.Transparent, MetaData.Render);
    }
}

class LinearGradientBrush extends Brush { /* GradientStops, StartPoint, EndPoint */ }
class RadialGradientBrush extends Brush { /* GradientStops, Center, RadiusX, RadiusY */ }
class ImageBrush          extends Brush { /* ImageSource, Stretch, AlignmentX/Y */ }
```

`Pen` is the stroke spec — also a Model:

```ts
class Pen extends Model
{
    static {
        Model.RegisterProperty(Pen, 'Brush',      undefined,        MetaData.Render);
        Model.RegisterProperty(Pen, 'Thickness',  1.0,              MetaData.Render);
        Model.RegisterProperty(Pen, 'DashStyle',  DashStyle.Solid,  MetaData.Render);
        Model.RegisterProperty(Pen, 'LineCap',    LineCap.Flat,     MetaData.Render);
        Model.RegisterProperty(Pen, 'LineJoin',   LineJoin.Miter,   MetaData.Render);
    }
}
```

Why Models, concretely:
- A `Border` with `Background="{Binding Theme.Accent}"` works the moment Brush is a Model — `Background` is a `Brush`-typed property, the binding swaps the entire brush, and the owning Visual's `OnPropertyChanged` fires `MarkRenderDirty`.
- A `SolidColorBrush` with an animated `Color` would push notifications down the binding chain just like any other Model property. The owning Visual subscribes to the brush's `Color` changes via the same listener machinery (no new path).
- Listener registration on a sub-Model property is the established mechanism — when a Visual takes a Brush, it adds a listener on the brush's relevant properties so a brush mutation re-renders the owner without replacing the whole Brush. (See §11 for the open question on automating this.)

## 7. Geometry

```ts
abstract class Geometry extends Model { /* Transform, Bounds (computed) */ }

class RectangleGeometry extends Geometry { /* Rect, RadiusX, RadiusY */ }
class EllipseGeometry   extends Geometry { /* Center, RadiusX, RadiusY */ }
class LineGeometry      extends Geometry { /* StartPoint, EndPoint */ }
class PathGeometry      extends Geometry { /* Figures: Move/Line/Bezier/Arc */ }
class GeometryGroup     extends Geometry { /* Children, FillRule */ }
```

PathGeometry needs a small command stream (Move, Line, CubicBezier, QuadBezier, Arc, Close). This matches both SVG's `d` attribute and Canvas's `Path2D` directly — the SVG DC stringifies the commands; the Canvas DC plays them into a `Path2D`.

Geometries are Models so they can be data-bound and animated. A `PathGeometry` whose `Figures` change pushes a notification through the binding system, the holder Visual hears it, fires `MarkRenderDirty`.

## 8. FormattedText

```ts
class FormattedText
{
    constructor(
        public text: string,
        public fontFamily: string,
        public fontSize: number,
        public fontWeight: FontWeight,
        public fontStyle: FontStyle,
        public foreground: Brush,
        public maxWidth?: number,
        public textWrapping?: TextWrapping,
        public textAlignment?: TextAlignment,
    ) {}

    // Computed lazily by the renderer; cached.
    get Width(): number;
    get Height(): number;
    get Baseline(): number;
}
```

Not a Model — it's a value snapshot. `TextBlock` is the Model; `FormattedText` is what `TextBlock.OnRender` constructs from its own properties and hands to `dc.DrawText`. Measurement is the renderer's job (SVG: `getComputedTextLength` / `getBBox`; Canvas: `ctx.measureText`).

## 9. Coordinate system and transforms

- **Top-left origin, y-down, DIPs (device-independent pixels).** Matches WPF, maps cleanly to SVG and Canvas, handles DPI scaling at the renderer boundary.
- **Two transform slots on Visual:**
  - `RenderTransform: Transform` — paint-only, applied after layout. Starts simple — implement first.
  - `LayoutTransform: Transform` — affects measure/arrange. Add after the layout pass exists.
- Both end up as `PushTransform(transform)` calls the renderer wraps around `OnRender`. Visuals don't push their own transforms — the renderer does, so Visuals don't have to remember to Pop on early return.

```ts
abstract class Transform extends Model
{
    public abstract get Matrix(): Matrix;
    public static Identity: Transform; // shared singleton, IsFrozen
}
class TranslateTransform extends Transform { /* X, Y */ }
class ScaleTransform     extends Transform { /* ScaleX, ScaleY, CenterX, CenterY */ }
class RotateTransform    extends Transform { /* Angle, CenterX, CenterY */ }
class MatrixTransform    extends Transform { /* Matrix (the escape hatch) */ }
class TransformGroup     extends Transform { /* Children */ }
```

`Matrix` itself is a plain value (six numbers), not a Model.

## 10. SVG renderer concretely

`SvgRenderer` is the rendering strategy, not the user entry point. It's instantiated and owned by `HtmlTarget` (or any subclass with an SVG backend). It takes an already-mounted `<svg>` element and a PresentationTarget, walks the dirty Visual tree, and emits SVG nodes. It knows nothing about DOM hosting, event routing, or resize observation — those are HtmlTarget's job.

```ts
class SvgRenderer
{
    private svg_root: SVGSVGElement;
    private slot_for: WeakMap<Visual, SVGGElement> = new WeakMap();
    private dirty: Set<Visual> = new Set();
    private target: PresentationTarget;

    constructor(svgRoot: SVGSVGElement, target: PresentationTarget)
    {
        this.svg_root = svgRoot;
        this.target = target;
        // Subscribe to target.{Width,Height,Content,Background,DeviceScale}.
        // If target.Content !== undefined, allocate slots and schedule render.
    }

    MarkDirty(visual: Visual): void { this.dirty.add(visual); scheduleFrame(); }

    private renderFrame(): void
    {
        for (const v of this.dirty) {
            const slot = this.slot_for.get(v)!;
            const dc = new SvgDrawingContext(slot);
            v['OnRender'](dc); // bracket-access through Visual's protected hook
            dc.commit(); // diffs slot's children against the new primitive list
        }
        this.dirty.clear();
    }
}
```

`SvgDrawingContext` is the concrete DC. Each `DrawRectangle(brush, pen, rect)` either creates a fresh `<rect>` element or reuses the next existing child in the slot if its shape matches (cheap structural diff — most re-renders are attribute changes, not element churn). Push/Pop methods wrap children in temporary `<g>` elements until `Pop`.

The hook into the existing dirty-flag system: `Visual.MarkRenderDirty()` (currently a no-op) becomes `this.renderer?.MarkDirty(this)`. The renderer pointer is set when the Visual's owning PresentationTarget mounts.

PresentationTarget observation:
- `target.Width` / `target.Height` change → resize `<svg>` viewBox + width/height attrs.
- `target.Content` change → tear down old slot tree, allocate new slots for the new root, mark every Visual dirty, schedule render.
- `target.Background` change → repaint the root fill.
- `target.DeviceScale` change → no SVG action (browser handles DPI); Canvas renderer would resize backing store.

## 11. Open questions to defer

Tracked in [current-backlog.md](https://github.com/pragmatic-tech-ai/mural/blob/main/current-backlog.md):

- **Sub-Model listener automation (Freezable-equivalent).** Backlog § 5.2.
- **Hit testing for Canvas/WebGL renderers.** Backlog § 5.13. Pairs with `CanvasRenderer` (§ 9.1).
- **`Visual.FindAncestorPresentationTarget()`.** Backlog § 5.12.
- **Render-thread vs UI-thread.** Not yet backlogged — single-threaded model holds today; compositing / async commits would land at the renderer layer without touching the Visual API.

## 12. Build order

In rough order of "smallest unblocking move":

12.1. `Rect`, `Point`, `Size`, `Color`, `Matrix` — plain value types, not Models.

12.2. `Transform` hierarchy with `Identity` + `TranslateTransform` + `MatrixTransform`. Skip scale/rotate/group for v1.

12.3. `Brush` + `SolidColorBrush`. `Pen` with just `Brush` + `Thickness`. Skip gradients, dashes, line caps.

12.4. `Geometry` + `RectangleGeometry`. `PathGeometry` later when something needs it.

12.5. `DrawingContext` interface — start with `DrawRectangle`, `DrawText`, `PushTransform`/`Pop`. Add the rest as concrete Visuals need them.

12.6. `PresentationTarget` — abstract base Model with Width/Height/Content/Background/DeviceScale. No host wiring; pure data so concrete subclasses' renderers can observe it via `AddPropertyChangedListener`.

12.7. `HtmlTarget extends PresentationTarget` — owns the DOM mount, the `ResizeObserver`, the delegated pointer/keyboard handler, and reads `window.devicePixelRatio` into `DeviceScale`. Instantiates an `SvgRenderer` internally (with a `{ backend: 'canvas' }` opt-in for later). This is the user entry point — the first object a consumer constructs.

12.8. `SvgRenderer` + `SvgDrawingContext`. Constructor takes `(svgRoot: SVGSVGElement, target: PresentationTarget)`; subscribe to target properties; wire `Visual.MarkRenderDirty` into the renderer's dirty set. Used internally by `HtmlTarget`, not by user code.

12.9. One concrete Visual: `Rectangle extends Visual` whose `OnRender` calls `dc.DrawRectangle(this.Fill, this.Stroke, this.Bounds)`. **Stop here and demo a red rectangle on screen.**

12.10. `FormattedText` + `TextBlock extends Visual`.

12.11. `Border extends Single` — uses `OnRender` for background/stroke and lets its child Visual render normally.

12.12. Layout pass skeleton — `Measure(availableSize): Size` / `Arrange(finalRect): void` on Visual. Renderer calls Measure → Arrange → walk dirty → OnRender each frame.

12.13. `StackPanel`, `Grid` extending `Panel`.

At 12.9 we have a working pipeline. At 12.11 we have enough to build real UI. The layout pass (12.12) is the bigger next chunk.

## 13. What NOT to do

- **Don't put draw methods directly on Visual** (`this.DrawRectangle(...)`). That couples every Visual to a hidden renderer bound to `this`. The DC parameter is the seam — keep it explicit.
- **Don't make `DrawingContext` a Model.** It's transient — no binding, no listeners, no inheritance.
- **Don't make `OnRender` return a tree of primitives.** We already have a declarative tree — the Visual tree. `OnRender` is the imperative leaf-level contribution per node. Two declarative layers stacked is the kind of architecture that makes `Border` take 200 lines.
- **Don't paint children from a parent's `OnRender`.** Composition is the renderer's tree walk. A parent only contributes its own background / chrome / stroke.
- **Don't add primitives speculatively.** Start with `DrawRectangle` + `DrawText` + `DrawGeometry`. Everything else lowers to geometry. Add the convenience primitives (Ellipse, Line, RoundedRectangle) when the first concrete Visual actually needs one.
- **Don't make `PresentationTarget` a Visual.** It's not in the tree — it's the description of the tree's host. Conflating them complicates parent walks, inheritance, and the "what's my PresentationTarget?" lookup we deferred.
