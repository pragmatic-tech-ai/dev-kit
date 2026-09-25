# Drawing

The drawing API — `DrawingContext` (what a Visual paints into),
brushes (fills), pens (strokes), geometry (shapes), transforms, and the
geometric primitives they all use.

**Implemented in:**
- [runtime/drawing-context.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/drawing-context.ts) — `DrawingContext` interface (marker)
- [runtime/primitives.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/primitives.ts) — `Point`, `Size`, `Rect`, `Color`, `Matrix`, `Thickness`
- [visual-engine/drawing-context.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/visual-engine/drawing-context.ts) — augments DrawingContext with method signatures
- [visual-engine/brush.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/visual-engine/brush.ts) — `Brush` hierarchy
- [visual-engine/pen.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/visual-engine/pen.ts) — `Pen`, `DashStyle`, `LineCap`, `LineJoin`
- [visual-engine/geometry.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/visual-engine/geometry.ts) — `Geometry` hierarchy + `PathSegment`s
- [visual-engine/transform.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/visual-engine/transform.ts) — `Transform`, `TranslateTransform`, `MatrixTransform`

See also: [targets.md](targets.md) for the concrete `SvgDrawingContext` that
turns these calls into SVG, [layout.md](layout.md) for when `RenderOverride`
is invoked.

## 1. Geometric primitives

Six immutable value types live in [runtime/primitives.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/primitives.ts).
All have `readonly` fields and structural equality via `Equals()`. Construct
new instances rather than mutating; pass them by reference freely.

### Point
```ts
new Point(X, Y)
Point.Zero                                // (0, 0)
p.Add(other) / p.Subtract(other)
p.Equals(other)
```

### Size
```ts
new Size(Width, Height)
Size.Zero                                 // (0, 0)
Size.Empty                                // (NaN, NaN) — "no size assigned"
s.IsEmpty                                 // true when either component is NaN
```

### Rect
```ts
new Rect(X, Y, Width, Height)
Rect.Zero
Rect.FromCorners(a: Point, b: Point)      // normalizes (any two corners)
Rect.FromOriginSize(origin: Point, size: Size)

r.Left / r.Top / r.Right / r.Bottom
r.TopLeft / r.TopRight / r.BottomLeft / r.BottomRight
r.Size

r.Contains(p: Point)
r.Intersect(other) → Rect | undefined     // undefined if no overlap
r.Union(other)
```

### Color
```ts
new Color(R, G, B, A?)                    // channels 0..255; A defaults to 255 (opaque)
Color.Transparent / Color.Black / Color.White / Color.Red / Color.Green / Color.Blue
Color.FromHex('#rgb')                     // also #rrggbb, #rgba, #rrggbbaa, with or without '#'
c.WithAlpha(a)
c.ToCss()                                 // 'rgb(r,g,b)' or 'rgba(r,g,b,a)' as appropriate
```

### Matrix
2D affine matrix in row-vector form:
```
| M11  M12  0 |
| M21  M22  0 |
| OX   OY   1 |
```
The field order `(M11, M12, M21, M22, OffsetX, OffsetY)` matches SVG's
`matrix(a, b, c, d, e, f)` — the SVG and Canvas renderers can pass the
components through without rearrangement.

```ts
new Matrix(M11, M12, M21, M22, OffsetX, OffsetY)
Matrix.Identity
Matrix.Translate(dx, dy)
Matrix.Scale(sx, sy)
Matrix.Rotate(angleRadians)

m.IsIdentity / m.Determinant
m.Multiply(other)                         // (this * other), row-vector convention
m.Transform(p: Point)
m.Invert() → Matrix | undefined           // undefined if singular
```

### Thickness
Per-side inset distances (used for Margin, Padding, BorderThickness):
```ts
new Thickness(5)               // all four sides = 5
new Thickness(5, 10)           // horizontal = 5, vertical = 10
new Thickness(5, 10, 15, 20)   // left, top, right, bottom

Thickness.Zero
t.Horizontal / t.Vertical / t.IsZero
```

## 2. DrawingContext

What `Visual.RenderOverride` paints into. The interface lives in two parts:

- An empty marker interface in [runtime/drawing-context.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/drawing-context.ts)
  so `Visual.Render` can reference the type without runtime importing
  visual-engine.
- The actual method declarations in [visual-engine/drawing-context.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/visual-engine/drawing-context.ts),
  added via TypeScript declaration merging.

The merged surface:

```ts
interface DrawingContext {
    // Primitives — brush is fill, pen is stroke. Either may be undefined.
    DrawRectangle(brush: Brush | undefined, pen: Pen | undefined, rect: Rect): void;
    DrawGeometry(brush: Brush | undefined, pen: Pen | undefined, geometry: Geometry): void;
    DrawText(text: FormattedText, origin: Point): void;

    // Stack frames — apply to every subsequent draw until Pop().
    PushTransform(transform: Transform): void;
    PushClip(geometry: Geometry): void;
    Pop(): void;
}
```

All methods are renderer-agnostic — the same `RenderOverride` works whether
the DC is an `SvgDrawingContext`, future `CanvasDrawingContext`, or any
other concrete implementation. Concrete DCs translate these calls into
renderer-native artifacts.

`DrawGeometry` supports `RectangleGeometry`, `EllipseGeometry`, and
`LineGeometry` in `SvgDrawingContext`; `PathGeometry` and
`GeometryGroup` throw "not implemented yet" until a consumer needs
them. `PushClip` supports `RectangleGeometry` and `EllipseGeometry`
(line / path / group don't enclose a region and aren't valid clips).

The renderer also automatically wraps each Visual with a clip frame
when `Visual.Clip` is set — see [visual-tree.md §12](visual-tree.md#12-clip--render-time-clipping)
for how that hook fits with `RenderOverride` and the children walk.

The surface is still **deliberately small**. More primitives
(DrawEllipse, DrawLine, DrawRoundedRectangle, PushOpacity, DrawImage,
PushOpacityMask) get added when a concrete Visual needs them.

## 3. Brushes (fills)

```
Brush                          (abstract)
  ├─ SolidColorBrush
  ├─ LinearGradientBrush
  ├─ RadialGradientBrush
  └─ ImageBrush
```

All brushes are Models with `Opacity` (0..1) and `Transform` (defaults to
`Transform.Identity`) on the base. Concrete subclasses add type-specific
properties.

### SolidColorBrush
The workhorse:
```ts
const fill = new SolidColorBrush(Color.Red);
fill.Opacity = 0.5;             // bindable
fill.Color = Color.FromHex('#1e40af');
```
`new SolidColorBrush()` (no args) produces a transparent brush. Always pass
a color explicitly.

### LinearGradientBrush
Smooth color blend along a straight axis:
```ts
const grad = new LinearGradientBrush([
    new GradientStop(Color.Red,   0),
    new GradientStop(Color.Blue,  1),
]);
grad.StartPoint = new Point(0, 0);     // top-left of bounding box (defaults)
grad.EndPoint   = new Point(1, 1);     // bottom-right
grad.SpreadMethod = GradientSpreadMethod.Pad;   // | Reflect | Repeat
```
`StartPoint` and `EndPoint` are in [0,1] × [0,1] bounding-box coordinates of
whatever's being painted.

### RadialGradientBrush
Smooth blend outward from a center:
```ts
const grad = new RadialGradientBrush([
    new GradientStop(Color.White, 0),
    new GradientStop(Color.Black, 1),
]);
grad.Center  = new Point(0.5, 0.5);   // bounding-box coords
grad.RadiusX = 0.5;
grad.RadiusY = 0.5;
```

### ImageBrush
Fills with a rastered image:
```ts
const brush = new ImageBrush(new ImageSource('https://example.com/img.png'));
brush.Stretch    = Stretch.Uniform;       // None | Fill | Uniform | UniformToFill
brush.AlignmentX = AlignmentX.Center;
brush.AlignmentY = AlignmentY.Center;
```
`ImageSource` currently wraps a URL string. SvgDrawingContext doesn't yet
render ImageBrush — it falls back to no-fill.

### GradientStop
Plain value type, not a Model:
```ts
new GradientStop(color: Color, offset: number)   // offset in [0, 1]
stop.Equals(other)
```

## 4. Pens (strokes)

`Pen` is a Model. Configure the brush, thickness, dash pattern, line caps and
joins, and miter limit.

```ts
const pen = new Pen(new SolidColorBrush(Color.Black), 2);
pen.DashStyle  = DashStyle.Dash;          // | Solid | Dot | DashDot | DashDotDot
pen.LineCap    = LineCap.Round;            // 'butt' | 'round' | 'square'
pen.LineJoin   = LineJoin.Round;           // 'miter' | 'round' | 'bevel'
pen.MiterLimit = 4;                        // when LineJoin is Miter
```

Convenience constructor: `new Pen()`, `new Pen(brush)`, `new Pen(brush, thickness)`.
Without a brush, the pen produces no stroke. WPF defaults apply (Thickness=1,
DashStyle=Solid, LineCap=Flat, LineJoin=Miter, MiterLimit=10).

### DashStyle
Plain value type with `Dashes: readonly number[]` (multiples of thickness)
and `Offset`. Five built-in singletons:

| Singleton | Pattern |
|---|---|
| `DashStyle.Solid` | `[]` |
| `DashStyle.Dash` | `[2, 2]` |
| `DashStyle.Dot` | `[0, 2]` |
| `DashStyle.DashDot` | `[2, 2, 0, 2]` |
| `DashStyle.DashDotDot` | `[2, 2, 0, 2, 0, 2]` |

Custom patterns: `new DashStyle([3, 1, 1, 1], 0)`.

## 5. Geometry (shapes)

```
Geometry                       (abstract)
  ├─ RectangleGeometry
  ├─ EllipseGeometry
  ├─ LineGeometry
  ├─ PathGeometry
  └─ GeometryGroup
```

All geometries are Models with `Transform` on the base (applies to the
geometry's local coordinate space).

### RectangleGeometry
```ts
const r = new RectangleGeometry(new Rect(0, 0, 100, 50), 8, 8);
//                                                       ^^^^^
// RadiusX, RadiusY — non-zero rounds the corners
```

### EllipseGeometry
```ts
const e = new EllipseGeometry(new Point(50, 50), 40, 30);
//                              center,         rX, rY
// Equal radii → circle
```

### LineGeometry
Stroke-only (no fill):
```ts
const l = new LineGeometry(new Point(0, 0), new Point(100, 100));
```

### PathGeometry
Arbitrary geometry built from one or more `PathFigure`s:
```ts
const path = new PathGeometry([
    new PathFigure(new Point(0, 0), [
        new LineSegment(new Point(100, 0)),
        new LineSegment(new Point(100, 100)),
        new LineSegment(new Point(0, 100)),
    ], /* IsClosed */ true),
]);
path.FillRule = FillRule.EvenOdd;             // | Nonzero (WPF default is EvenOdd)
```

Each `PathFigure` is one continuous run; multiple figures support shapes
with holes.

#### PathSegment subtypes

| Class | Constructor signature |
|---|---|
| `LineSegment` | `new LineSegment(endpoint: Point)` |
| `CubicBezierSegment` | `new CubicBezierSegment(ctrl1: Point, ctrl2: Point, endpoint: Point)` |
| `QuadraticBezierSegment` | `new QuadraticBezierSegment(ctrl: Point, endpoint: Point)` |
| `ArcSegment` | `new ArcSegment(endpoint, size, rotation°, isLargeArc, sweepDirection)` |

`ArcSegment` fields map directly to SVG's `A rx ry rot large sweep x y`.

### GeometryGroup
Composite geometry — multiple child geometries combined under a single
FillRule. Boolean ops (Union/Intersect/Xor/Exclude) are not yet supported.

```ts
new GeometryGroup([rect1, rect2], FillRule.EvenOdd);
```

## 6. Transforms

```
Transform                      (abstract)
  ├─ (private) IdentityTransform — singleton via Transform.Identity
  ├─ TranslateTransform
  └─ MatrixTransform
```

Each transform exposes `Matrix` (a `runtime/primitives.ts` Matrix value).
The renderer pushes Transform via `DrawingContext.PushTransform`; that reads
`.Matrix` and applies it to subsequent draws until `Pop()`.

### Transform.Identity
Shared singleton — `Transform.Identity.Matrix === Matrix.Identity`. Reference
compares are O(1) for the no-op short-circuit case.

### TranslateTransform
```ts
const t = new TranslateTransform(10, 20);   // shift by (10, 20)
t.X = 30;                                    // bindable
```

### MatrixTransform
Escape hatch for arbitrary matrices:
```ts
const t = new MatrixTransform(Matrix.Rotate(Math.PI / 4));
t.Matrix = Matrix.Scale(2, 2).Multiply(Matrix.Translate(50, 0));
```

Scale, Rotate, and TransformGroup classes are intentionally deferred —
compose via Matrix math when needed.

## 7. Painting in RenderOverride

`RenderOverride` runs in the Visual's **local coordinate space**. The host
has already pushed a translate (and any other transforms) to position the
Visual within its parent before calling Render.

```ts
class Card extends Visual {
    protected override RenderOverride(dc: DrawingContext): void {
        const size = this.RenderSize;

        // Background — fill the full local bounds
        dc.DrawRectangle(
            new SolidColorBrush(Color.White),
            undefined,                            // no stroke
            new Rect(0, 0, size.Width, size.Height),
        );

        // Border — half-thickness inset so the stroke sits inside the rect
        const pen = new Pen(new SolidColorBrush(Color.Black), 1);
        dc.DrawRectangle(undefined, pen, new Rect(0.5, 0.5, size.Width - 1, size.Height - 1));

        // Decorative diagonal — push a transform, draw, pop
        dc.PushTransform(new TranslateTransform(size.Width / 2, size.Height / 2));
        dc.DrawGeometry(
            new SolidColorBrush(Color.Red),
            undefined,
            new EllipseGeometry(Point.Zero, 8, 8),
        );
        dc.Pop();
    }
}
```

### Stroke positioning

Strokes are centered on the geometry path. For a `Rect(0, 0, 100, 50)` with
a 2-thickness pen, the stroke covers from -1 to 101 horizontally — half
outside the rect. To keep the stroke inside the rect, inset by half the
thickness:

```ts
const t = pen.Thickness;
const half = t / 2;
dc.DrawRectangle(undefined, pen, new Rect(half, half, w - t, h - t));
```

This is exactly what `Border.RenderOverride` does.

### Push/Pop discipline

`PushTransform` and `PushClip` open frames; `Pop` closes the most
recent open frame. Each push must be balanced by a pop. Imbalanced
push/pop is a programmer error — the concrete DC may throw or
silently leak the frame.

```ts
dc.PushTransform(new TranslateTransform(10, 0));
dc.PushClip(new RectangleGeometry(new Rect(0, 0, 100, 100)));
dc.DrawRectangle(brush, undefined, new Rect(0, 0, 10, 10));
dc.Pop();   // closes the clip
dc.Pop();   // closes the translate
```

Frames compose in order — the clip is in the translate's coordinate
space; subsequent draws inside the clip are translated AND clipped.

## 8. Brush/Pen lifecycle and binding

All brushes, pens, and geometries are Models — their properties bind,
animate, and inherit just like any Visual property. Setting a brush on a
Visual property is a single property assignment; the brush's internals are
free to change without re-assigning.

```ts
const fill = new SolidColorBrush(Color.Red);
border.Background = fill;

// Later — change the brush's color, not the Border's Background:
fill.Color = Color.Blue;
// Caveat: the Border doesn't currently listen to its Brush's sub-property
// changes (see code-review.md's "sub-Model listener automation" note),
// so this won't trigger a re-render automatically. Workaround: replace
// the whole brush.
border.Background = new SolidColorBrush(Color.Blue);
```

The full sub-Model-listener story is documented as a deferred design
question in [../../visual-engine-design.md](visual-engine-design.md).

## 9. What's not yet implemented

`DrawingContext` is intentionally small. These are documented but unimplemented:

- `DrawEllipse`, `DrawLine`, `DrawRoundedRectangle`, `DrawImage` — call
  `DrawGeometry` with the appropriate geometry class instead.
- `PushOpacity(opacity)`, `PushOpacityMask(brush)` — defer until a
  concrete Visual needs them.
- `ScaleTransform`, `RotateTransform`, `TransformGroup` — use
  `MatrixTransform` with composed matrices.
- `CombinedGeometry` (boolean ops Union/Intersect/Xor/Exclude) — compute
  resulting paths at the model layer.

`SvgDrawingContext.DrawGeometry` currently throws `NotImplemented` —
geometries route through `DrawRectangle` for now via the named Visual
classes. Implement when a Geometry-using Visual concretely needs it.
