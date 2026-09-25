# Visual Tree

The structural side of the framework: `Visual` is the base of every
rendered element, `Single` is a one-child container, `Panel` is a
many-child container. Every Visual carries **two parent links** — one
for the visual tree (what the renderer walks) and one for the logical
tree (what property inheritance and named-element lookup walk) — plus
a back-pointer to the host, and participates in the layout / render
lifecycle.

**Implemented in:**
- [runtime/visual.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/visual.ts) — `Visual`, `Single`, `Panel`,
  `VisualHost`, `HorizontalAlignment`, `VerticalAlignment`

See also: [layout.md](layout.md) for the Measure / Arrange / Render
lifecycle and sizing/alignment/margin properties, and [targets.md](targets.md)
for how Visual trees connect to a `PresentationTarget`.

## 1. The three classes

```
Model                ← base property/binding bag (storage only)
  └─ Visual          ← + visualParent + logicalParent + target + layout/render lifecycle
       ├─ Single     ← exactly one child (Border, future Decorator, …)
       └─ Panel      ← ordered children (Canvas, future StackPanel, Grid, …)
```

| Class | Role |
|---|---|
| `Visual` | The base. Any node in the rendered tree extends Visual directly (leaf) or via Single/Panel (container). Owns layout cache, both parent links, host back-pointer, and the `OnRender` hook. |
| `Single` | Container that owns at most one child. `SetChild(child)` attaches; `SetChild(undefined)` detaches. Replacing the existing child first detaches the previous one. Used by Border. |
| `Panel` | Container with ordered children. `AddChild` / `RemoveChild`. The basis for layout panels (Canvas, future StackPanel / Grid). |

A bare `Visual` is a renderable leaf — override `RenderOverride` to draw,
and the layout system handles the rest.

## 2. Two trees: visual and logical

WPF runs two parallel hierarchies over the same set of elements. Mural
follows the same model.

| Tree | What it's for | API surface |
|---|---|---|
| **Visual** | Rendering, hit-testing, host (`target`) propagation, layout cascading | `visualParent`, `visualChildren`, `AttachVisual` / `DetachVisual` |
| **Logical** | Property value inheritance, future named-element scoping, future resource lookup, future routed event paths | `logicalParent`, `logicalChildren`, `AttachLogical` / `DetachLogical` |

The two trees exist because of **control templating**. When a `ControlTemplate`
is applied to a control, the template's generated visuals become visual
descendants of the control, but the consumer's content stays a logical child
of the control — even though visually it's slotted several levels deep into a
`ContentPresenter` inside the template. The two parent pointers let consumer-
facing code (`RelativeSource.FindAncestor`, property inheritance) walk the
authored structure, while the renderer walks the rendered structure.

### Today's invariant: the trees coincide

For every Visual added through `Single.SetChild` or `Panel.AddChild`,
the visual and logical parents are the **same instance** —
`visualParent === logicalParent`, and `visualChildren` returns the
same array as `logicalChildren`. No current Visual diverges them.
That happens when control templates land (Phase 2 work).

The split is in place so the divergence is a localized change in the
templating code, not a system-wide refactor.

### Convenience vs explicit attach

```
Attach(child)         ← wires BOTH trees       ← default for user-supplied children
  ├─ AttachVisual     ← visual-tree only       ← used by template machinery
  └─ AttachLogical    ← logical-tree only      ← used by ContentPresenter slotting

Detach(child)         ← unwires both
  ├─ DetachLogical    ← logical-tree only
  └─ DetachVisual     ← visual-tree only
```

`Panel.AddChild` and `Single.SetChild` call the convenience `Attach` — adding
a child to both trees with the same parent. Templated controls (when they
land) will call `AttachVisual` and `AttachLogical` independently so the trees
can diverge.

## 3. Building a tree

```ts
import { Border, TextBlock } from '../basic/index.js';

const label = new TextBlock('Hello');
const card  = new Border(label);    // Single.SetChild → Attach → both trees wired

// Multi-child via Panel subclass:
class Stack extends Panel { /* … */ }
const stack = new Stack();
stack.AddChild(label);
stack.AddChild(new TextBlock('World'));
```

A Visual can have at most one visual parent and at most one logical parent.
Re-parenting requires explicit detach:

```ts
parentA.RemoveChild(child);
parentB.AddChild(child);

// Or for Single:
oldOwner.SetChild(undefined);
newOwner.SetChild(child);
```

Attempting to attach a child that already has a parent throws:

```ts
otherPanel.AddChild(child);
// Error: "Visual already has a visual parent; detach it from the current parent first."
```

(The mirror message for the logical tree appears if the visual side succeeded
but the logical side had a stale parent — only possible when low-level
`AttachVisual` / `AttachLogical` are mixed; never happens when going through
the `Attach` convenience.)

## 4. The parent links

`Visual.visualParent` and `Visual.logicalParent` are `protected` getters —
Visuals can walk up but external code can't. The links are set automatically
on Attach / Detach and aren't user-settable.

Which one to walk:

- **`visualParent`** — when you need rendering / hit-testing context. "What's
  the nearest ancestor that clipped me?" "What's my position in the rendered
  hierarchy?" Used by the renderer and by transforms / clipping when those
  land.
- **`logicalParent`** — when you need consumer-authored context. "What's the
  nearest `Button` I'm inside?" (for `RelativeSource.FindAncestor`-style
  lookups). Property value inheritance walks this internally.

```ts
class MyVisual extends Visual {
    private findCard(): Border | undefined {
        let v: Visual | undefined = this.logicalParent;
        while (v !== undefined) {
            if (v instanceof Border) return v;
            v = (v as MyVisual).logicalParent;
        }
        return undefined;
    }
}
```

Self-attachment is rejected:

```ts
panel.AddChild(panel);
// Error: "A Visual cannot be its own child."
```

## 5. The host back-pointer

Every Visual carries a `_target: VisualHost | undefined` pointer to the
`PresentationTarget` that owns its tree. This is what makes layout / render
invalidation O(1) — when a property changes, the Visual notifies its host
directly instead of walking up to find the root.

`target` propagates down the **visual** tree (rendering is a visual-tree
concern, and the host is reachable for any visible element). The pointer is
set automatically:

- When `PresentationTarget.Content = visual` is set, the new root and every
  descendant get `target` pointing to the target.
- When a Visual is `Attach`-ed (or `AttachVisual`-ed) under a mounted parent,
  it inherits the parent's `target` (and cascades to its own visual children).
- When detached, `target` clears down the visual subtree.

You shouldn't ever set `target` yourself — the framework does it. Subclasses
read it via the `protected get target` accessor:

```ts
class MyVisual extends Visual {
    protected override RenderOverride(dc: DrawingContext): void {
        const measurer = this.target?.TextMeasurer;
        // …
    }
}
```

### Dual-mount protection

Attaching a Visual that already has a non-undefined `target` to a different
host throws:

```ts
target1.Content = visual;
target2.Content = visual;
// Error: "Visual is already attached to a host; detach from the current host first."
```

Move via:
```ts
target1.Content = undefined;
target2.Content = visual;
```

## 6. VisualHost interface

The contract a host must satisfy. `PresentationTarget` is the only public
implementation, but Visual itself only sees the four methods on the interface.

```ts
interface VisualHost {
    OnMeasureInvalidated(visual: Visual): void;
    OnArrangeInvalidated(visual: Visual): void;
    OnRenderInvalidated(visual: Visual): void;
    readonly TextMeasurer: TextMeasurer;
}
```

The three `OnXxxInvalidated` hooks fire when a Visual's property change
invalidates the corresponding lifecycle phase. `TextMeasurer` is the service
text-bearing Visuals use during `MeasureOverride` — defaults to the stateless
approximation, swappable to a `FontMetricsMeasurer` with loaded fonts.

The full host hooks-and-lifecycle story is in [targets.md](targets.md).

## 7. Single vs Panel — which to extend

| Pattern | Extends |
|---|---|
| Wrapper around exactly one child (Border, Decorator, ScrollViewer's outer shell, …) | `Single` |
| Layout container with any number of children (Canvas, StackPanel, Grid, …) | `Panel` |
| Leaf with no children of its own (TextBlock, NodeVisual, EdgeVisual, Rectangle, Ellipse, …) | `Visual` directly |

`Single.child` returns `Visual | undefined`; `Panel.children` returns
`ReadonlyArray<Visual>`. Both are the typed container-specific surfaces.
Generic tree-walking code uses the tree-axis-explicit getters:

- `visual.visualChildren: readonly Visual[]` — for renderer / hit-test walks
- `visual.logicalChildren: readonly Visual[]` — for inheritance / FindAncestor walks

For `Single` and `Panel` today, both arrays contain the same elements
(`[child]` or `children`). Templated containers will populate them differently.

```ts
// HeadlessTarget walks the visual tree like this:
function walkTree(v: Visual): void {
    v.Render(dc);
    for (const c of v.visualChildren) walkTree(c);
}
```

## 8. Implementing a new container

To build a custom container, extend `Single` or `Panel` and override
`MeasureOverride` / `ArrangeOverride` to lay out children.

```ts
class HorizontalStack extends Panel {
    protected override MeasureOverride(availableSize: Size): Size {
        let width = 0, height = 0;
        for (const child of this.children) {
            child.Measure(availableSize);
            width  += child.DesiredSize.Width;
            height = Math.max(height, child.DesiredSize.Height);
        }
        return new Size(width, height);
    }

    protected override ArrangeOverride(finalSize: Size): Size {
        let x = 0;
        for (const child of this.children) {
            child.Arrange(new Rect(x, 0, child.DesiredSize.Width, finalSize.Height));
            x += child.DesiredSize.Width;
        }
        return finalSize;
    }
}
```

The full Measure/Arrange/Render contract — what to call, what to return —
is in [layout.md](layout.md).

## 9. Tree-walking helpers (internal pattern)

Subclasses of `Single` / `Panel` are responsible for propagating tree-walks
(inheritance refresh, target updates) to their children. The hook names
encode which tree they walk:

| Method | Tree | When it runs |
|---|---|---|
| `propagate_target_to_visual_children` | visual | When this Visual's `target` changes — cascade the new target down the visual subtree |
| `propagate_inheritance_to_logical_children` | logical | When any inheritable property on this Visual changes — refresh all logical descendants |
| `propagate_inheritance_for_logical_children(descriptor)` | logical | When a specific inheritable property changes — refresh just that property in logical descendants |

`Single` and `Panel` override each to walk their `_child` / `_children`
(which today serve both axes). New container subclasses get this for free
by extending Single or Panel; bespoke containers would override all three.

Templated containers (`ContentControl`, `ItemsControl`) do exactly that
— see [templating.md](templating.md) and
[items-and-scrolling.md](items-and-scrolling.md). Their override of
`visualChildren` returns template-generated visuals; their
`logicalChildren` returns consumer-supplied content.

## 10. TemplatedParent — third back-pointer

Every Visual carries a third reference alongside the two parent links:

```ts
public get templatedParent(): Visual | undefined
public SetTemplatedParent(p: Visual | undefined): void
```

Set by the template-apply pipeline ([basic/templates/control-template.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/templates/control-template.ts))
on every node in a `ControlTemplate`'s generated subtree. Distinct
from both parents — visual / logical ancestry walks past it; this is
a single-hop back-pointer to "the control whose template generated
me." Read by:

- `TemplateBinding` — to dereference back to the templated control's
  properties.
- `walk_inherited` — template internals have no `logicalParent`, so
  their inheritance walk falls through `templatedParent` to reach the
  templated control's logical ancestry.
- `TryFindResource` — same fallback so template internals find
  resources in the templated control's chain.
- `FindName` — same fallback so namescope lookups can reach the
  templated control's enclosing scope.

User-supplied content (slotted into a `ContentPresenter` /
`ItemsPresenter`) does NOT have `templatedParent` set — only template-
generated visuals do.

## 11. Name + FindName — named-element scoping

`Visual.Name: string | undefined` is the x:Name analogue. Set on a
Visual to make it locatable by name within an enclosing `NameScope`.

```ts
const border = new Border();
border.Name = 'PART_Background';
```

`Visual.FindName(name)` walks up logical ancestors (with
`templatedParent` fallback) looking for a `NameScope`, then resolves
within it. `NameScope` is a per-instance map; each `ControlTemplate`
instance gets its own at Apply time so the same name in two template
instances doesn't collide.

For consumers, the typical entry point is
`ContentControl.GetTemplateChild(name)` which looks up a named template
part within the applied template's scope. Full story in
[templating.md](templating.md).

## 12. Clip — render-time clipping

`Visual.Clip: unknown | undefined` holds an optional Geometry. The
renderer pushes the clip via `DC.PushClip` before RenderOverride and
before walking visual children, pops after children. Geometry is in
the Visual's local coord space (applied after the translate-to-
arranged-position).

```ts
import { RectangleGeometry } from '../visual-engine/index.js';
visual.Clip = new RectangleGeometry(new Rect(0, 0, 100, 100));
```

Used by `ScrollViewer` to constrain its clip-and-translate mode to the
viewport. `MetaData.Render` so changes re-render but don't re-measure.

Supported shapes (in `SvgDrawingContext`): `RectangleGeometry`,
`EllipseGeometry`. Path / line / group geometries throw — a clip
needs an enclosed region.

## 13. What lives on Visual

A quick map of what comes from each base class — for reference when reading
the source.

**From `Model`:** property storage, `AddPropertyChangedListener`,
`get_property_value` / `set_property_value` / `ClearValue` /
`GetValueSource`, `OnPropertyChanged` (overridden to dispatch invalidation).

**Added by `Visual`:** visual + logical parent links, `templatedParent`
back-pointer, target back-pointer, layout state cache (`DesiredSize` /
`RenderSize` / `ArrangedRect`), Measure / Arrange / Render lifecycle,
`visualChildren` / `logicalChildren` getters, Width / Height / MinWidth
/ MinHeight / MaxWidth / MaxHeight, HorizontalAlignment /
VerticalAlignment, Margin, `Clip`, `Style`, `Name`, lazy `Resources`,
`TryFindResource` / `FindResource` / `FindName`,
`InvalidateMeasure` / `InvalidateArrange` / `InvalidateVisual` (which
cascade UP the visual tree so ancestor caches don't short-circuit a
needed re-pass).

**Added by `Single`:** `child` getter, `SetChild`, child-targeted
propagation overrides, `visualChildren` / `logicalChildren` returning
`[child]` (or empty).

**Added by `Panel`:** `Children` getter (typed as
`IReadOnlyObservableCollection<Visual>` — iterate, count, lookup,
subscribe, but not mutate directly), `AddChild` / `InsertChild` /
`RemoveChild` (full Attach, both trees), `AddVisualChild` /
`InsertVisualChild` / `RemoveVisualChild` (visual-only — used by
ItemsControl-style hosts), multi-child propagation overrides,
`visualChildren` / `logicalChildren` returning a lazily-cached snapshot.

The full layout API is documented in [layout.md](layout.md).
