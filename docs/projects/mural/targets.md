# Presentation Targets

The bridge between a Visual tree and a host environment (a DOM element, a
file, an in-memory buffer). Targets host the Visual tree, drive the
layout/render pipeline, and pick the rendering backend.

**Implemented in:**
- [visual-engine/presentation-target.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/visual-engine/presentation-target.ts) — `PresentationTarget` abstract base
- [visual-engine/targets/html-target.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/visual-engine/targets/html-target.ts) — `HtmlTarget`
- [visual-engine/targets/headless-target.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/visual-engine/targets/headless-target.ts) — `HeadlessTarget`
- [visual-engine/targets/file-target.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/visual-engine/targets/file-target.ts) — `FileTarget`
- [visual-engine/svg-drawing-context.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/visual-engine/svg-drawing-context.ts) — `SvgDrawingContext` (the SVG implementation of DrawingContext)

The model follows WPF's `PresentationSource` pattern — one class per host
environment, sharing a common scene description on the Model layer. See
the design rationale in [../../visual-engine-design.md](visual-engine-design.md) §3.

## 1. The hierarchy

```
PresentationTarget               (abstract)
  ├─ HtmlTarget                  ← DOM hosting (browser)
  ├─ HeadlessTarget              ← no host (Node tests, server-side, build-time export)
  └─ FileTarget                  ← file output (scaffold only)
```

| Target | Status | Use case |
|---|---|---|
| `HeadlessTarget` | Works | Tests, demos, server-side rendering, anything where you want to render to a string/buffer without a DOM. |
| `HtmlTarget` | DOM mount works; renderer pending | Browser hosting. Wires up the `<svg>` mount, ResizeObserver, devicePixelRatio. Painting lands with SvgRenderer. |
| `FileTarget` | Scaffold | Future PNG / SVG file / PDF output. `Save()` currently throws. |

## 2. Common API — PresentationTarget

The abstract base carries everything renderer-agnostic. All three concrete
targets inherit:

```ts
abstract class PresentationTarget extends Model implements VisualHost {
    // Scene description (all bindable Model properties)
    Width:        number;
    Height:       number;
    DeviceScale:  number;          // DIP → device-pixel multiplier
    Content:      Visual | undefined;
    Background:   Brush | undefined;

    // Text measurement service (swappable)
    TextMeasurer: TextMeasurer;    // default = APPROXIMATE_TEXT_MEASURER

    // Font loading convenience (delegates to TextMeasurer.LoadFont)
    LoadFont(family, source: ArrayBuffer | Uint8Array, weight?, style?): void;

    // VisualHost contract (overridable by subclass renderers)
    OnMeasureInvalidated(visual: Visual): void;
    OnArrangeInvalidated(visual: Visual): void;
    OnRenderInvalidated(visual: Visual): void;
}
```

Properties are bindable; consumers and renderers subscribe via
`AddPropertyChangedListener`.

## 3. HeadlessTarget

The host-less target. Drives one full pass synchronously when you call
`Render(dc)`. Perfect for tests, command-line tools, and anything where
you want to produce a string/buffer without a browser.

```ts
import {
    HeadlessTarget, SolidColorBrush, SvgDrawingContext,
} from '../visual-engine/index.js';
import { Color } from '../runtime/index.js';
import { Border, TextBlock } from '../basic/index.js';

const scene  = new Border(new TextBlock('Hello'));
scene.Background = new SolidColorBrush(Color.Blue);

const target = new HeadlessTarget(400, 200, scene);
const dc     = new SvgDrawingContext();
target.Render(dc);
const svg    = dc.ToSvg(target.Width, target.Height);
console.log(svg);
```

### Constructor

```ts
new HeadlessTarget(width, height, content?, deviceScale?)
```

`width`, `height` set the scene dimensions. `content` is optional; you can
assign it later. `deviceScale` defaults to 1 (no DPI scaling).

### Render(dc: DrawingContext)

The one driver. Synchronously runs:

1. Paint `Background` (if set) over the full surface rect.
2. `Content.Measure(new Size(Width, Height))`.
3. `Content.Arrange(new Rect(0, 0, Width, Height))`.
4. Walk the tree depth-first via `Single.child` / `Panel.children`, pushing
   a `TranslateTransform` for each Visual whose `ArrangedRect.{X, Y}` is
   non-zero, calling `visual.Render(dc)` at each node, popping on the way
   back up.

After Render returns, the DC holds the complete output. For an
`SvgDrawingContext`, get the result via `dc.ToSvg(w, h)` or `dc.ToFragment()`.

### When to use

- Tests — assert against the rendered SVG string.
- Demos / build-time output — write SVG files (the `demo:*` scripts).
- Server-side rendering — produce SVG to embed in HTTP responses.
- Comparing approximate vs metric-driven text measurement output.

## 4. HtmlTarget

Browser hosting. Owns:

- The host `Element` (a `<div>`, `<section>`, etc. passed at construction).
- An `<svg>` (or `<canvas>`) surface appended inside the host.
- A `ResizeObserver` that translates host size changes into `Width` /
  `Height` updates on the target.
- A one-shot read of `window.devicePixelRatio` into `DeviceScale`.
- (Pending) the `SvgRenderer` / `CanvasRenderer` instance that paints.

### Constructor

```ts
new HtmlTarget(host: Element, options?: HtmlTargetOptions)
```

```ts
interface HtmlTargetOptions {
    backend?: 'svg' | 'canvas';        // default 'svg'; 'canvas' throws (pending)
    devicePixelRatio?: number;          // override window.devicePixelRatio
}
```

### Usage

```ts
import { HtmlTarget } from '../visual-engine/index.js';

const host = document.querySelector('#app')!;
const target = new HtmlTarget(host);
target.Show(myScene);          // sugar for target.Content = myScene
```

`Show(content)` is a convenience that assigns Content and returns `this`,
enabling chained construction.

### Live properties

- `Width` and `Height` update automatically when the host resizes (via
  ResizeObserver).
- `DeviceScale` reflects `window.devicePixelRatio` at construction.

### Dispose()

Disconnects the ResizeObserver and removes the SVG mount from the host.
Call before discarding an HtmlTarget so the host element is left clean.

### What works today vs. what's pending

| Live | Pending |
|---|---|
| Host mount (`<svg>` appended to host) | Painting (SvgRenderer integration) |
| Resize observation → Width/Height updates | `backend: 'canvas'` option |
| `Surface` and `Host` getters for inspection | Pointer / keyboard event routing |
| `Dispose()` cleanup | Dirty-tracking render loop |

Setting `Content` today doesn't paint anything — the SVG mount is empty.
The full render path lands with the SvgRenderer (build-order step 12.8).

## 5. FileTarget

Scaffold only.

```ts
new FileTarget(width, height, options: FileTargetOptions, content?)
```

```ts
interface FileTargetOptions {
    path: string;
    format: 'svg' | 'png' | 'pdf';
    dpi?: number;                       // for raster output
}
```

`Save()` currently returns a rejected Promise with an explicit
"not implemented" message. The API signature is stable; the writers
(SVG serializer, PNG rasterizer, PDF emitter) land later.

## 6. SvgDrawingContext

The SVG implementation of `DrawingContext`. Translates draw calls into SVG
element strings buffered internally.

```ts
import { SvgDrawingContext } from '../visual-engine/index.js';

const dc = new SvgDrawingContext();
target.Render(dc);                                // populates internal buffer

dc.ToSvg(width, height);                          // wraps in <svg> document
dc.ToFragment();                                   // just the inner elements
```

### Implemented draw methods

| Method | Output |
|---|---|
| `DrawRectangle(brush, pen, rect)` | `<rect x y width height fill stroke stroke-width />` |
| `DrawText(text, origin)` | `<text x y font-family font-size font-weight font-style fill>…</text>` (baseline-adjusted) |
| `PushTransform(transform)` | Opens `<g transform="matrix(...)">` |
| `Pop()` | Closes the most recent `<g>` |
| `DrawGeometry(brush, pen, geometry)` | Throws (not implemented) |

### Brush handling

- `SolidColorBrush` → `fill` / `stroke` attribute with the CSS color.
- Other brush types → treated as `fill="none"` (transparent) until support
  lands.

### Text baseline

SVG `<text y="…">` places the baseline at `y`. `DrawText` adds the font's
ascent (`text.Metrics?.Ascent ?? text.FontSize * 0.85`) to `origin.Y` so
callers can pass a top-left origin and get visually-aligned output.

### XML escaping

User-provided text and font-family names are escaped:

- Text content: `& < >` → `&amp; &lt; &gt;`
- Attribute values: `& < "` → `&amp; &lt; &quot;`

## 7. Wiring text measurement

A target's `TextMeasurer` defaults to the stateless `ApproximateTextMeasurer`.
For real font metrics, install a `FontMetricsMeasurer` and load fonts:

```ts
import { FontMetricsMeasurer } from '../visual-engine/index.js';

target.TextMeasurer = new FontMetricsMeasurer();
target.LoadFont('Inter', interTtfBuffer);   // sync, takes already-fetched bytes
```

Or use the Google Fonts loader convenience:

```ts
import { loadGoogleFontInto } from '../visual-engine/index.js';

await loadGoogleFontInto(target.TextMeasurer, 'Inter', { weights: [400, 700] });
```

Full text-measurement story: [text-measurement.md](text-measurement.md).

## 8. The VisualHost interface

`PresentationTarget` implements `VisualHost`, the interface `Visual` sees:

```ts
interface VisualHost {
    OnMeasureInvalidated(visual: Visual): void;
    OnArrangeInvalidated(visual: Visual): void;
    OnRenderInvalidated(visual: Visual): void;
    readonly TextMeasurer: TextMeasurer;
}
```

The three hooks fire when a Visual's property change invalidates the matching
phase. On `HeadlessTarget`, the hooks are no-ops — you drive the render
explicitly via `Render(dc)`. On `HtmlTarget` (once the renderer lands),
they'll push the Visual onto a per-phase dirty queue and schedule a
re-render via `requestAnimationFrame`.

## 9. Common usage patterns

**Headless test render to a string:**
```ts
const target = new HeadlessTarget(800, 600, myVisual);
const dc = new SvgDrawingContext();
target.Render(dc);
expect(dc.ToFragment()).toContain('fill="rgb(255,0,0)"');
```

**Write SVG to a file (Node):**
```ts
import { writeFileSync } from 'node:fs';
const dc = new SvgDrawingContext();
target.Render(dc);
writeFileSync('out.svg', dc.ToSvg(target.Width, target.Height));
```

**Mount in browser (when the renderer lands):**
```ts
const target = new HtmlTarget(document.body);
target.Show(myScene);
```

**Swap measurement strategies:**
```ts
target.TextMeasurer = new FontMetricsMeasurer();
target.LoadFont('Inter', interBuffer);
// Now TextBlock measurements use real Inter metrics.
```

**Resize handling (HtmlTarget):**
```ts
const target = new HtmlTarget(host);
target.AddPropertyChangedListener('Width', (_, _p, _old, w) => {
    console.log('Resized to', w);
});
// ResizeObserver in the target translates host resizes into Width/Height changes.
```

## 10. What's not yet built

`SvgRenderer` is shipped and powers `HtmlTarget`'s real-time scene; event
routing through the visual tree is live. The remaining renderer / target
gaps are tracked in [current-backlog.md § 9](https://github.com/pragmatic-tech-ai/mural/blob/main/current-backlog.md):

- **`CanvasRenderer`** (§ 9.1) — Canvas2D backend for the same Visual
  tree. Pairs with non-SVG hit-testing (§ 5.13).
- **`FileTarget` writers** (§ 9.2) — `Save()` throws today. SVG / PNG /
  PDF are the natural three.

The abstractions are in place — adding a renderer doesn't require
touching the Visual API.
