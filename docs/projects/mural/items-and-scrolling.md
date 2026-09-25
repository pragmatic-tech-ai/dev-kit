# Items, Data-Binding, Virtualization, Scrolling

Data-driven UI: a collection of items (data, not visuals) drives a
collection of visuals (containers, produced by a `DataTemplate`).
Scrolling and virtualization layer on top so large collections render
without paying for every off-screen item.

**Implemented in:**
- [runtime/observable-collection.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/observable-collection.ts) —
  `ObservableCollection<T>`, `CollectionChange<T>`,
  `IReadOnlyObservableCollection<T>`
- [runtime/scroll-info.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/scroll-info.ts) — `IScrollInfo` +
  `isScrollInfo`
- [basic/templates/data-template.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/templates/data-template.ts) —
  `DataTemplate`
- [basic/collections/item-container-generator.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/collections/item-container-generator.ts) —
  `ItemContainerGenerator`
- [basic/items-control.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/items-control.ts) —
  `ItemsControl`
- [basic/templates/items-presenter.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/templates/items-presenter.ts) —
  `ItemsPresenter`
- [basic/panels/virtualisation/virtualizing-panel.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/panels/virtualisation/virtualizing-panel.ts) —
  `VirtualizingPanel` (abstract)
- [basic/panels/virtualisation/virtualizing-stack-panel.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/panels/virtualisation/virtualizing-stack-panel.ts) —
  `VirtualizingStackPanel`
- [basic/scroll-viewer.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/scroll-viewer.ts) —
  `ScrollViewer`

See also: [templating.md](templating.md) for `ContentControl` /
`ContentPresenter` (the single-content analogue of ItemsControl /
ItemsPresenter).

## 1. `ObservableCollection<T>`

Live-updating list with per-mutation change notifications. The high-
level UI layer (`ItemsControl`) reacts to these incrementally — adding
an item splices in one container rather than rebuilding everything.

```ts
import { ObservableCollection } from '../runtime/index.js';

const items = new ObservableCollection<string>(['a', 'b', 'c']);
items.Add('d');               // 'inserted' event with index = 3
items.Insert(1, 'X');         // 'inserted' event with index = 1
items.RemoveAt(0);            // 'removed' event with index = 0
items.SetAt(1, 'Y');          // 'replaced' event with index = 1
items.Clear();                // 'cleared' event

items.Count;                  // 0
items.Get(0);                 // undefined
items.IndexOf('Y');           // -1
[...items];                   // [] (Iterable)
items.ToArray();              // []

const unsub = items.Subscribe(change => {
    switch (change.kind) {
        case 'inserted': /* change.index, change.items */ break;
        case 'removed':  break;
        case 'replaced': /* change.oldItem, change.newItem */ break;
        case 'cleared':  break;
    }
});
```

`CollectionChange<T>` is a discriminated union. Subscribers receive
events synchronously during the mutation call. Listeners are snapshotted
before iteration so an `unsub` mid-notify doesn't disrupt the others.

`IReadOnlyObservableCollection<T>` is the typed view interface — same
shape minus the mutators. Used as the public type when a container owns
the collection and routes mutation through its own API. `Panel.Children`
is the prime example.

## 2. `Panel.Children` is observable

```ts
const panel = new MyPanel();
panel.Children.Subscribe(change => {
    // any AddChild / InsertChild / RemoveChild on the panel fires
});

panel.AddChild(a);
panel.InsertChild(1, b);    // insert at index 1 (b is now between existing children)
panel.RemoveChild(a);
```

Mutation goes through the public methods (which do the proper
Attach/Detach to wire both trees). Reading `Children` returns a
read-only observable view — Count, Get, IndexOf, iteration,
subscription. `visualChildren` and `logicalChildren` continue to return
`readonly Visual[]` snapshots (materialized lazily, invalidated by an
internal subscription).

## 3. `DataTemplate`

A factory that turns one data item into a Visual:

```ts
import { DataTemplate } from '../basic/index.js';

const personTemplate = new DataTemplate(data => {
    const person = data as { name: string };
    const text = new TextBlock(person.name);
    text.FontSize = 14;
    return text;
});
```

Data is `unknown` — the factory knows what shape it expects. No
DataTypeSelector (which template for which type) in this cut; a single
template per `ItemsControl`.

### Template triggers — `when()` and `on Event { … }`

A `DataTemplate` carries three trigger lists, all attached to the
freshly-built root on every `Apply`:

| List | Source | Fires when | Authoring syntax |
|---|---|---|---|
| `Triggers` | A registered DP on a named source visual inside the template (default: the root) | The watched DP equals the declared value. | _(not exposed in markup yet — Property triggers inside DataTemplate are emit-time errors today)_ |
| `DataTriggers` | A `DataContextBinding` path on the bound data item | The resolved path equals the declared value. | `when( $IsSelected ) { chrome.BorderBrush = #f97316; }` |
| `EventTriggers` | A routed event raised at the template root | The event fires (per instance — every Apply gets its own registration). | `on Click { BeginStoryboard { DoubleAnimation[…] } }` |

```mu
DataTemplate [DataType=ButtonVM] {
    Border x:root [Padding=(8), Background=#ffffff]
    on Click {
        BeginStoryboard {
            DoubleAnimation[TargetProperty=Opacity, From=1, To=0.6, Duration=120, AutoReverse=true]
        }
    }
    when( $IsSelected ) {
        Border.Background = #fde68a;
    }
}
```

EventTriggers reuse the Style EventTrigger action vocabulary —
`BeginStoryboard`, `StopStoryboard`, `PauseStoryboard`,
`ResumeStoryboard`, `InvokeCommand` — and the same lowering. At Apply
time the template root receives the trigger via
`Visual.AddEventTrigger`; the routed event is matched by name (e.g.
`Click` resolves to `Button.AddClickHandler` for Button-rooted
templates and warns-and-no-ops for visuals that don't expose that
hook).

## 4. `ItemsControl`

```ts
import { ItemsControl, DataTemplate } from '../basic/index.js';
import { Canvas } from '../basic/index.js';

const ic = new ItemsControl();
ic.ItemsPanel   = () => new Canvas();          // panel factory
ic.ItemTemplate = personTemplate;              // DataTemplate
ic.Items        = [{name: 'A'}, {name: 'B'}];  // array, OR ObservableCollection
```

When all three are set, ItemsControl materializes one container per
item via the `ItemContainerGenerator`, attaches each into:
- The items panel — **visual** parent
- The ItemsControl — **logical** parent

This divergence (visual under panel, logical under ItemsControl)
mirrors WPF and is the headline reason for the two-tree split:
`DataContext` / inheritable properties set on the ItemsControl flow
through to each container, NOT through the panel.

### Reacting to collection changes

If `Items` is an `ObservableCollection`, the ItemsControl subscribes
and dispatches per-mutation:
- `inserted` → realize a new container at the index, `InsertVisualChild`
  into the panel at that position, `InsertContainer` into the logical
  list.
- `removed` → look up the container by index, `RemoveVisualChild`,
  `DetachContainer`, `Recycle` in the generator.
- `replaced` → tear down the old + bring in the new at that index.
- `cleared` → tear down everything, clear the generator.

Other already-realized containers are preserved across mutations — same
Visual instances, no rebuild churn.

## 5. `ItemContainerGenerator`

Bridge between items and containers. Owned by the ItemsControl,
exposed via `ic.Generator`.

```ts
ic.Generator.ContainerFromItem('a');     // → the Visual produced for 'a'
ic.Generator.ItemFromContainer(visual);  // → the data item that visual represents
ic.Generator.IsRealized('a');            // → true
ic.Generator.Realize('b');               // idempotent — returns cached or creates fresh
ic.Generator.Recycle(visual);            // drops the mapping
ic.Generator.Count;                      // realized count
```

Virtualizing panels use the generator to realize / recycle on demand
based on viewport. The default non-virtualizing flow realizes
everything once and recycles in lockstep with collection changes.

## 6. `ItemsPresenter` + `Template`

ItemsControl gets an optional `Template: ControlTemplate` that wraps
the items panel in surrounding chrome (header, footer, scrollbar). The
template must contain an `ItemsPresenter` — a Visual slot. When the
template is applied:

```ts
ic.Template = new ControlTemplate(_tp => {
    const border = new Border();
    border.Padding = new Thickness(8);
    border.SetChild(new ItemsPresenter());
    return border;
});
```

The items panel ends up as a visual descendant of the `ItemsPresenter`
(not a direct child of the ItemsControl). Re-templating preserves the
items panel instance and all its containers — the panel is unparented
from the old presenter and re-attached to the new one.

Without a `Template`, the items panel is the ItemsControl's direct
visual child (legacy behavior, no chrome).

## 7. Virtualization

For long lists, allocating every container is wasteful. A
`VirtualizingPanel` realizes containers only for items currently
visible and recycles those that leave.

### `VirtualizingPanel` (abstract base)

The marker. When the ItemsControl's `ItemsPanel` factory produces a
`VirtualizingPanel` subclass, ItemsControl skips its bulk realization
and hands the panel a back-pointer (`SetItemsOwner`). The panel then
decides when to realize / recycle by calling `owner.Generator.Realize`
/ `Recycle`.

### `VirtualizingStackPanel`

Concrete implementation. Vertical stack with uniform item height.
Properties:
- `Viewport: Rect` — the visible region (in panel coords). Position +
  size.
- `ItemHeight: number` — uniform height per item.

```ts
const panel = new VirtualizingStackPanel();
panel.ItemHeight = 28;
panel.Viewport   = new Rect(0, 0, 300, 200);    // visible area
```

`MeasureOverride` computes which items intersect the viewport, calls
`owner.Generator.Realize(item)` for those not already realized,
`owner.Generator.Recycle(container)` for those leaving the viewport.
Reports `DesiredSize.Height = itemCount × ItemHeight` (full extent, so
a host ScrollViewer knows the scrollable range).

`ArrangeOverride` places each realized container at
`Rect(0, index * ItemHeight, width, ItemHeight)`.

`RealizedIndices` is a read-only view of currently-live indices for
tests / tooling.

## 8. `IScrollInfo`

Contract exposed by panels that handle their own scrolling extent —
typically VirtualizingStackPanel:

```ts
interface IScrollInfo {
    readonly ExtentWidth: number;       // total content size
    readonly ExtentHeight: number;
    readonly ViewportWidth: number;     // visible area
    readonly ViewportHeight: number;
    readonly HorizontalOffset: number;  // current scroll position
    readonly VerticalOffset: number;
    SetHorizontalOffset(value: number): void;
    SetVerticalOffset(value: number): void;
}
```

`VirtualizingStackPanel` implements it: ExtentHeight is computed from
itemCount × ItemHeight, ViewportWidth/Height mirrors Viewport.W/H,
offsets mirror Viewport.X/Y. `isScrollInfo(v)` is a duck-type guard
(checks for `SetHorizontalOffset` / `SetVerticalOffset` methods).

## 9. `ScrollViewer`

```ts
import { ScrollViewer } from '../basic/index.js';

const sv = new ScrollViewer();
sv.Content = someContent;          // any Visual
sv.VerticalOffset = 200;           // scroll
```

Properties:
- `Content: Visual | undefined` — what to scroll.
- `HorizontalOffset` / `VerticalOffset: number` — current scroll
  position (programmatic only; no input events yet).
- `ExtentWidth` / `ExtentHeight` (read-only) — full content size,
  computed during Measure.
- `ViewportWidth` / `ViewportHeight` (read-only) — visible area.
- `ScrollableWidth` / `ScrollableHeight` (read-only) — `max(0, Extent -
  Viewport)`. Max useful offsets.
- `ScrollToTop / Bottom / Left / Right()` — convenience.

### Two layout modes (auto-detected)

**Delegate mode** — Content implements `IScrollInfo` (typically a
`VirtualizingStackPanel`). The ScrollViewer reads ExtentWidth /
ExtentHeight from the IScrollInfo, clamps the offsets, drives the
panel's Viewport (position + size) directly. No clip needed — the panel
only emits visible items.

```ts
const sv = new ScrollViewer();
const panel = makeVirtualizingPanel(longItemList);
sv.Content = panel;
sv.VerticalOffset = 500;
sv.Measure(new Size(300, 200));
// panel.Viewport is now (0, 500, 300, 200); the panel realized the
// items intersecting that range and recycled others.
```

**Clip-and-translate mode** — Content is anything else. ScrollViewer
measures Content with `Infinity` available size (so it reports its
natural extent), arranges it at `(-HorizontalOffset, -VerticalOffset)`,
installs a `RectangleGeometry` clip on itself so off-viewport content
doesn't paint past the viewport.

### Offset clamping

Offsets are NOT clamped on assignment — the raw user-set value stays
queryable. The effective offset (clamped to `[0, ScrollableWidth]` /
`[0, ScrollableHeight]`) is computed at use time during
ArrangeOverride. Out-of-range writes snap into range as soon as the
extent permits.

## 10. `Visual.Clip`

ScrollViewer's clip-and-translate mode uses a general clip
mechanism. Any Visual can set `.Clip` to a `RectangleGeometry` or
`EllipseGeometry`; the renderer pushes the clip before
RenderOverride + the children walk, pops after.

```ts
visual.Clip = new RectangleGeometry(new Rect(0, 0, 100, 100));
```

Geometry is in the Visual's local coordinate space (after the
translate-to-arranged-position has been pushed). `MetaData.Render` on
Clip so changes trigger a re-render but not a re-measure.

## 11. End-to-end example

```ts
import { Color } from '../runtime/index.js';
import { HeadlessTarget, SolidColorBrush, SvgDrawingContext } from '../visual-engine/index.js';
import {
    DataTemplate,
    ItemsControl,
    ScrollViewer,
    TextBlock,
    VirtualizingStackPanel,
} from '../basic/index.js';

// 10,000 items
const items = Array.from({ length: 10000 }, (_, i) => `Row ${i}`);

const sv = new ScrollViewer();
const panel = new VirtualizingStackPanel();
panel.ItemHeight = 24;

const ic = new ItemsControl();
ic.ItemTemplate = new DataTemplate(d => {
    const tb = new TextBlock(d as string);
    tb.FontSize = 14;
    return tb;
});
ic.Items = items;
ic.ItemsPanel = () => panel;   // routes through panel.SetItemsOwner

sv.Content = panel;            // delegate mode — sv drives panel.Viewport

const target = new HeadlessTarget(300, 200, sv);
const dc = new SvgDrawingContext();

sv.VerticalOffset = 4000;       // scroll to item 166-ish
target.Render(dc);
// SVG output contains only the ~9 realized text blocks visible in the viewport
```

## 12. Limitations

Most roadmap items here are tracked in
[current-backlog.md § 10](https://github.com/pragmatic-tech-ai/mural/blob/main/current-backlog.md):
- Variable item heights in VirtualizingStackPanel — § 10.1.
- Horizontal-orientation virtualization — § 10.2.
- `ItemTemplateSelector` / `DataTemplateSelector` — § 10.3.
- Incremental items-change handling — § 10.4.
- `HierarchicalDataTemplate` — § 10.9.
- `MultiBinding` for data items — § 11.1 (template) covers the
  template-side gap; data-side MultiBinding is the same shape.

Built since this doc was first written:
- **Container recycling** — virtualizing panels now pull from a
  recycle pool via `Generator.ClaimRecycled`.
- **Item-based selection** — `Selector` ships (`ListBox` / `TreeView` /
  `Diagram` extend it), with multi-select + marquee.

### Scroll-specific limitations

Built since this doc was first written:
- **Input events** — mouse / wheel / keyboard route through the visual
  tree via the routed-event system.
- **ScrollBar visual control** — concrete `ScrollBar` ships; bound by
  the default `ScrollViewer` template.

Still gaps (tracked in
[current-backlog.md § 10](https://github.com/pragmatic-tech-ai/mural/blob/main/current-backlog.md)):
- **Smooth scrolling / animation** — § 10.5 (waiting on animation
  system § 16.1).
- **`ScrollViewer` descendant walk for `IScrollInfo`** — § 10.6.
- **Cross-axis virtualization** — `VirtualizingWrapPanel` covers the
  2D wrap case; a 2D scrolling grid would be a separate panel.
</content>
