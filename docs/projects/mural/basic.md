# basic

The user-facing widgets — `Border`, `TextBlock`, layout panels
(`Canvas`), content / item hosts (`ContentControl`, `ItemsControl`),
scrolling (`ScrollViewer`, `VirtualizingStackPanel`), and the
templating primitives that knit them together (`ControlTemplate`,
`ContentPresenter`, `ItemsPresenter`, `DataTemplate`).

**Implemented in:**
- [basic/border.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/border.ts) — `Border`
- [basic/text-block.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/text-block.ts) — `TextBlock`
- [basic/panels/canvas.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/panels/canvas.ts) — `Canvas` + `Left` /
  `Top` attached properties
- [basic/content-control.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/content-control.ts) —
  `ContentControl`
- [basic/templates/content-presenter.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/templates/content-presenter.ts) —
  `ContentPresenter`
- [basic/templates/control-template.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/templates/control-template.ts) —
  `ControlTemplate`, `TemplateBinding`
- [basic/templates/data-template.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/templates/data-template.ts) —
  `DataTemplate`
- [basic/items-control.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/items-control.ts) —
  `ItemsControl`
- [basic/templates/items-presenter.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/templates/items-presenter.ts) —
  `ItemsPresenter`
- [basic/collections/item-container-generator.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/collections/item-container-generator.ts) —
  `ItemContainerGenerator`
- [basic/panels/virtualisation/virtualizing-panel.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/panels/virtualisation/virtualizing-panel.ts) —
  `VirtualizingPanel` (abstract)
- [basic/panels/virtualisation/virtualizing-stack-panel.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/panels/virtualisation/virtualizing-stack-panel.ts) —
  `VirtualizingStackPanel`
- [basic/scroll-viewer.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/scroll-viewer.ts) —
  `ScrollViewer`

See [layout.md](layout.md) for the underlying `Visual` properties every
control inherits (Width / Margin / alignment), [drawing.md](drawing.md) for
the Brush / Pen / Color types these controls accept,
[templating.md](templating.md) for the deep dive on `ContentControl` /
`ControlTemplate`, [items-and-scrolling.md](items-and-scrolling.md) for
`ItemsControl` and friends.

## `Border`

A `Single` (one-child container) that paints a background, optionally
strokes an outline, and pads its child inward. Modeled on WPF
`System.Windows.Controls.Border` — the canonical "first useful container".

### Properties

| Property | Type | Default | MetaData |
|---|---|---|---|
| `Background` | `Brush \| undefined` | `undefined` | Render |
| `BorderBrush` | `Brush \| undefined` | `undefined` | Render |
| `BorderThickness` | `Thickness` | `Thickness.Zero` | Measure \| Arrange \| Render |
| `Padding` | `Thickness` | `Thickness.Zero` | Measure \| Arrange |
| `CornerRadius` | `number` | `0` | Render |

Plus everything from `Visual`: `Width` / `Height` / `MinWidth` / `MaxWidth` /
`MinHeight` / `MaxHeight`, `HorizontalAlignment` / `VerticalAlignment`,
`Margin`.

### Constructor

```ts
new Border(child?: Visual)
```

The optional child is wired via `SetChild` (inherited from `Single`).
Equivalent to `const b = new Border(); b.SetChild(child);`.

### Layout

`Border.MeasureOverride`:
1. Shrinks the child's available size by `(BorderThickness + Padding)` on
   each axis (clamped to 0 — never negative).
2. Measures the child against that reduced size.
3. Returns `child.DesiredSize + insets`.

`Border.ArrangeOverride`:
1. Positions the child at `(BorderThickness.Left + Padding.Left,
   BorderThickness.Top + Padding.Top)`.
2. Sizes the child to `finalSize - insets` (clamped to 0).

The child receives a layout rect inset from the Border's edge by border +
padding on each side. Border + Padding compose additively.

### Rendering

`Border.RenderOverride`:
1. Fills the entire Border rect with `Background` (if set).
2. Draws a stroked rect inset by half the thickness so the stroke sits
   inside the layout rect.

```ts
const b = new Border();
b.Background      = new SolidColorBrush(Color.White);
b.BorderBrush     = new SolidColorBrush(Color.Black);
b.BorderThickness = new Thickness(2);
// Renders: white fill at (0, 0, w, h), then 2px black stroke at (1, 1, w-2, h-2)
```

### Limitations

Tracked in [current-backlog.md § 13](https://github.com/pragmatic-tech-ai/mural/blob/main/current-backlog.md):
- **Non-uniform `BorderThickness`** rendered as uniform via `.Top` — § 13.1.
- **`CornerRadius`** not yet honored by the drawing context — § 13.2.

### Usage

**Solid background + uniform stroke**:
```ts
const card = new Border(content);
card.Background      = new SolidColorBrush(Color.FromHex('#1e40af'));
card.BorderBrush     = new SolidColorBrush(Color.Black);
card.BorderThickness = new Thickness(3);
card.Padding         = new Thickness(20);
```

**Just padding** (no background, no stroke):
```ts
const inset = new Border(content);
inset.Padding = new Thickness(10);
```

**Asymmetric padding** (typical for UI rows):
```ts
const row = new Border(label);
row.Padding = new Thickness(12, 4, 12, 4);   // L T R B — 12 horizontal, 4 vertical
```

**Border without a child** (a colored rectangle):
```ts
const rect = new Border();
rect.Background = new SolidColorBrush(Color.Red);
rect.Width = 100;
rect.Height = 50;
```

### Composition with alignment

Border passes through alignment to the underlying Visual machinery. To
position the Border within its own parent slot, use Border's own
HorizontalAlignment / VerticalAlignment / Margin properties — the child
inside the Border is laid out by Border itself, but Border-as-a-child is
laid out by its parent.

```ts
const card = new Border();
card.Width  = 200;
card.Height = 100;
card.HorizontalAlignment = HorizontalAlignment.Center;   // center the card in its parent slot
card.VerticalAlignment   = VerticalAlignment.Top;
card.Margin              = new Thickness(20);            // 20px gap from parent edges
```

---

## `TextBlock`

A leaf `Visual` that renders a single run of text. The simplest visible
control — exercises text measurement (`MeasureOverride` via the host's
`TextMeasurer`), drawing (`RenderOverride` via `dc.DrawText`), and property
inheritance for font properties.

### Properties

| Property | Type | Default | MetaData |
|---|---|---|---|
| `Text` | `string` | `''` | Measure |
| `FontFamily` | `string` | `'system-ui, sans-serif'` | Measure \| Inherits |
| `FontSize` | `number` | `14` | Measure \| Inherits |
| `FontWeight` | `FontWeight` | `Normal` | Measure \| Inherits |
| `FontStyle` | `FontStyle` | `Normal` | Measure \| Inherits |
| `Foreground` | `Brush \| undefined` | `undefined` (→ black) | Render \| Inherits |

Plus all `Visual` layout properties.

### Constructor

```ts
new TextBlock(text?: string)
```

The optional text is assigned to `Text`. Equivalent to `const t = new TextBlock(); t.Text = text;`.

### Layout

`TextBlock.MeasureOverride`:
1. Returns `Size.Zero` when `Text` is empty.
2. Otherwise calls `this.target?.TextMeasurer.Measure(...)` — the host's
   text measurer. Falls back to `APPROXIMATE_TEXT_MEASURER` when the
   TextBlock isn't attached to a host (e.g., measured in isolation in
   a test).
3. Caches the returned `TextMetrics` internally so RenderOverride can use
   the real `Ascent` for SVG baseline placement.

### Rendering

`TextBlock.RenderOverride`:
1. Skips entirely when `Text` is empty.
2. Builds a `FormattedText` from the current font properties + cached
   metrics + Foreground.
3. Calls `dc.DrawText(formatted, Point.Zero)` — origin (0, 0) in local
   coordinates. Alignment and arranged offset are applied by `Visual.Arrange`
   and the host's tree walk.

### Font property inheritance

All five font properties are flagged `MetaData.Inherits`. An ancestor can
set them once and every TextBlock in the subtree picks them up via the
cross-class explicit-owner overload + composite-key storage.

```ts
const inner = new TextBlock('Inherits font from outer');
const outer = new Border(inner);

// outer is a Border, not a TextBlock. But TextBlock.FontSize is registered
// with MetaData.Inherits — setting it on outer via the explicit-owner
// accessor stores it under composite key 'TextBlock.FontSize' on outer.
// Inheritance walks up from inner, finds it, caches as InheritedValue.
outer.set_property_value(TextBlock, 'FontSize', 24);

inner.FontSize;                              // 24
inner.GetValueSource('FontSize');            // PropertyValueSource.InheritedValue

// Local override on the child shadows the inherited value:
inner.FontSize = 11;
inner.GetValueSource('FontSize');            // PropertyValueSource.LocalValue
```

This matches the WPF "TextElement.FontSize on a Window cascades to every
TextBlock inside" pattern.

### Foreground default

`Foreground = undefined` lets the renderer fall back to its default
(black in `SvgDrawingContext`). Set explicitly for any color:

```ts
text.Foreground = new SolidColorBrush(Color.White);
```

### Font weight / style enums

```ts
import { FontWeight, FontStyle } from '../visual-engine/index.js';

FontWeight.Normal     // 'normal'
FontWeight.Bold       // 'bold'

FontStyle.Normal      // 'normal'
FontStyle.Italic      // 'italic'
```

Numeric weights (100–900) and additional styles (oblique, condensed)
aren't supported yet — the enum keeps the WPF set tight.

### Measurement accuracy

By default, TextBlock uses the approximate measurer that ships with the
runtime (`glyphCount × fontSize × 0.6`). For accurate widths and baseline,
install a `FontMetricsMeasurer` on the target:

```ts
import { FontMetricsMeasurer, loadGoogleFontInto } from '../visual-engine/index.js';

target.TextMeasurer = new FontMetricsMeasurer();
await loadGoogleFontInto(target.TextMeasurer, 'Inter', { weights: [400, 700] });

text.FontFamily = 'Inter, sans-serif';     // now measured with real Inter metrics
```

See [text-measurement.md](text-measurement.md) for the full text-measurement story.

### Usage

**Simple label**:
```ts
const label = new TextBlock('Submit');
```

**Styled heading**:
```ts
const h1 = new TextBlock('Welcome');
h1.FontSize = 32;
h1.FontWeight = FontWeight.Bold;
h1.Foreground = new SolidColorBrush(Color.FromHex('#1e40af'));
```

**Italic emphasis**:
```ts
const em = new TextBlock('Important');
em.FontStyle = FontStyle.Italic;
```

**Inside a Border with centered alignment**:
```ts
const text = new TextBlock('Hello, Mural!');
text.HorizontalAlignment = HorizontalAlignment.Center;
text.VerticalAlignment   = VerticalAlignment.Center;

const card = new Border(text);
card.Background      = new SolidColorBrush(Color.White);
card.BorderBrush     = new SolidColorBrush(Color.Black);
card.BorderThickness = new Thickness(1);
card.Padding         = new Thickness(16);
```

### Limitations

Tracked in [current-backlog.md § 13](https://github.com/pragmatic-tech-ai/mural/blob/main/current-backlog.md):
- **Single line only** (no `TextWrapping`) — § 13.3.
- **No `TextAlignment`** within the block — § 13.4.
- **No selection or caret** — pure display today; use `TextBox` for
  editable text.

---

## Combining controls — the demos

The three demo scripts under [basic/tests/](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/tests/) show
the controls in action:

- **[border-render.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/tests/border-render.ts)** (`npm run demo:border`) —
  100×100 Border with blue background, 3px black stroke, centered in a 300×300 target.

- **[text-render.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/tests/text-render.ts)** (`npm run demo:text`) —
  Bold "Hello, Mural!" TextBlock inside a styled Border, with approximate
  text metrics.

- **[google-font-render.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/tests/google-font-render.ts)** (`npm run demo:gfont`) —
  Same scene as text-render.ts but with Inter fetched live from Google Fonts
  and a `FontMetricsMeasurer` installed, so the text width and baseline are
  the real Inter metrics.

Each demo writes an SVG to `basic/tests/output/`. Open in a browser to
inspect.

---

## `Canvas`

A `Panel` that places children at absolute (x, y) coordinates read from
`Canvas.Left` / `Canvas.Top` attached properties. WPF-parity Canvas.
Sizes itself to the union bounding box of all placed children — paired
with `HeadlessTarget`'s auto-mode, the surface fits the contents.

```ts
import { Canvas } from '../basic/index.js';

const c = new Canvas();
const child = new Border();
Canvas.SetLeft(child, 20);
Canvas.SetTop(child, 30);
c.AddChild(child);
```

`Left` / `Top` are registered with `MetaData.None` — changing them on a
child doesn't auto-invalidate; the Canvas re-reads on its next Arrange
pass. With `HeadlessTarget`'s always-fresh measure/arrange this works
for the static-experiment flow. Incremental layout (when SvgRenderer
lands) will need the Canvas to subscribe to its children's Left/Top.

Used by the `ge` graph viz framework — see
[../applications/ge/scene.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/applications/ge/scene.ts).

## `ContentControl`

Templated single-content host. See the full story in
[templating.md](templating.md). API summary:

```ts
const cc = new ContentControl();
cc.Template = someControlTemplate;     // ControlTemplate with a ContentPresenter
cc.Content  = anyVisual;               // logical child; visually slotted into the presenter
cc.GetTemplateChild('PART_X');         // look up by name within the applied template
```

Re-templating preserves Content; setting Template = undefined detaches
the template.

## `ItemsControl`

Data-driven collection display. See [items-and-scrolling.md](items-and-scrolling.md).
API summary:

```ts
const ic = new ItemsControl();
ic.ItemsPanel   = () => new Canvas();
ic.ItemTemplate = new DataTemplate(d => new TextBlock(`${d}`));
ic.Items        = ['a', 'b', 'c'];     // or an ObservableCollection
ic.Template     = wrappingTemplate;    // optional ControlTemplate with an ItemsPresenter
ic.Generator;                          // ItemContainerGenerator — item ↔ container mapping
```

Mutations on an ObservableCollection dispatch incrementally — adding
one item splices in one container, not a full rebuild.

## `ScrollViewer`

A scrolling viewport. See [items-and-scrolling.md §9](items-and-scrolling.md#9-scrollviewer).
Two modes (auto-detected):
- **Delegate** — Content implements `IScrollInfo` (typically a
  `VirtualizingStackPanel`). ScrollViewer drives the panel's
  viewport.
- **Clip-and-translate** — anything else. Measures with Infinity,
  arranges at `(-offset)`, clips to viewport.

```ts
const sv = new ScrollViewer();
sv.Content = someContent;
sv.VerticalOffset = 200;        // programmatic only — no input events yet
sv.ScrollToBottom();
```

## `VirtualizingStackPanel`

Vertical stack with uniform item height that only realizes containers
inside the Viewport. See [items-and-scrolling.md §7](items-and-scrolling.md#7-virtualization).

Properties: `Viewport: Rect`, `ItemHeight: number`. Realizes via
`owner.Generator.Realize`; recycles via `Recycle`. Implements
`IScrollInfo` so a wrapping `ScrollViewer` delegates to it
automatically.

## What's still coming

Shipped since this list was first written: `Ellipse`, `Line`,
`StackPanel`, `Grid`, `WrapPanel`, `DockPanel`, `UniformGrid`,
`Button`, `ScrollBar`, `TextBox`, `ComboBox`, `ListBox`, `TreeView`,
`Slider`, `SpinEdit`, `Drawer`, `PageView`, `Diagram`.

Still on the [backlog](https://github.com/pragmatic-tech-ai/mural/blob/main/current-backlog.md):
- **`Rectangle`** shape primitive — § 13.5.
- **`Image`** control wrapping `ImageBrush` — § 13.6.

The framework primitives are in place — adding any of these is overriding
`MeasureOverride` / `ArrangeOverride` / `RenderOverride` and registering
properties. See [visual-tree.md](visual-tree.md) §7 for the "implementing
a new container" pattern and [layout.md](layout.md) §10 for a complete
custom-container example.
