# Behaviors

A `Behavior` is the third leg of the MVVM triangle (View / VM /
Behavior). It's a markup-attachable wiring object that lets a control
host per-instance imperative setup — routed-event listeners, AllowDrop
flips, named-element captures — without forcing the consumer's bootstrap
to reach into the materialized view via `FindName` and `AddListener`.

Mirrors WPF's `System.Windows.Interactivity` / `Microsoft.Xaml.Behaviors`
attached-behavior pattern: each `Behavior` subclass is a small class
with DPs for per-instance configuration and an `OnAttached(visual)` hook
that runs once at materialization.

**Implemented in:**
- [runtime/behavior.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/behavior.ts) — `Behavior` abstract
  base
- [runtime/visual.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/visual.ts) — `Visual.AddBehavior`,
  `Visual.Behaviors`
- [compiler/compiler.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/compiler/compiler.ts) —
  `compileBehaviorsBlock` (the `Behaviors { … }` markup lowering)
- [basic/behaviors/list-reorder-behavior.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/behaviors/list-reorder-behavior.ts) —
  first concrete behavior (drag-to-reorder for `ItemsControl`)

See also: [property-system.md](property-system.md) for the DP system
behaviors register their per-instance config in,
[items-and-scrolling.md](items-and-scrolling.md) for the `ItemsControl`
flow `ListReorderBehavior` plugs into.

## 0. Version scope

The Behaviors framework is staged across three labelled scopes. Each
label is an explicit agreement about what's in and what isn't — a
"Behaviors v1 only" mention in any code comment or doc resolves to
the table below.

| Scope | Shipping? | Includes |
|---|---|---|
| **Behaviors v1** | Yes | `Behavior` abstract `Model` subclass; `OnAttached(visual)` hook; `Visual.AddBehavior` / `Visual.Behaviors` accessor; markup `Behaviors { … }` block lowering to `AddBehavior` calls in source order; DP setters run before `OnAttached`. |
| **Behaviors v2** | Yes (extends v1) | `OnDetached(visual)` hook on `Behavior` (default no-op); `Visual.AddUnloadedListener` / `RemoveUnloadedListener` primitives; `AddBehavior` auto-wires `OnDetached` through the unloaded edge. Fires whenever the host Visual's `visualParent` transitions from defined to undefined — every detach, not one-shot. Detach does NOT cascade down a subtree; only the direct detach point fires. |
| **Behaviors v3** | Planned, not built | DataTrigger-driven conditional attach — behaviors attached only while a `DataTrigger` condition is true. Concrete shape under discussion: `Triggers { DataTrigger { …, Behaviors { X } } }`. Equivalent to backlog item 9.2. |

Anything not in the table above is unscoped — if it comes up, we'd
either fold it into one of the existing versions or open a new label
with a separate agreement.

## 1. The `Behavior` base class

```ts
export abstract class Behavior extends Model
{
    public abstract OnAttached(visual: Visual): void;
}
```

A `Behavior` IS a `Model` — it carries DPs, supports bindings on those
DPs, and participates in change notification the same way controls do.
What makes it a behavior, not a control: it doesn't render, doesn't
appear in the visual tree, and only ever lives inside a host visual's
`AddBehavior` slot.

The subclass implements `OnAttached(visual)` to wire whatever the
behavior does — typically `AddRoutedEventListener` calls, attached
property flips (`AllowDrop = true`), or capturing references to be
re-read from later event handlers. The hook fires AFTER the
behavior's DP setters have run, so by the time the behavior reads its
own configuration it's already populated.

## 2. Authoring a Behavior

```ts
import { Behavior, MetaData, Model, type Visual } from '@pragmatic-tech-ai/mural/runtime';

export class TooltipBehavior extends Behavior
{
    public static readonly TextKey = Model.RegisterProperty<string>(
        TooltipBehavior, 'Text', '', MetaData.None);

    public get Text():  string  { return this.get_property_value(TooltipBehavior.TextKey); }
    public set Text(v:  string) { this.set_property_value(TooltipBehavior.TextKey, v); }

    public override OnAttached(visual: Visual): void
    {
        visual.AddRoutedEventListener('PointerEnter', () => {
            console.log('tooltip:', this.Text);
        });
    }
}
```

The DP shape is identical to a Control's DPs — `RegisterProperty` with a
default value and a `MetaData` flag set, plus a `get`/`set` pair. Most
behavior DPs use `MetaData.None` because the behavior's properties
don't directly drive measure / arrange / render of the host visual;
they only control the behavior's own logic.

`MetaData.BindsTwoWayByDefault` works on behavior DPs the same way it
does on Visual DPs: a `$path` binding to that DP becomes TwoWay
automatically.

## 3. Attaching from markup

The compiler recognises a `Behaviors { … }` block as a special body
item inside any element. Each entry inside is a regular element form
(name + attribute list) for a `Behavior` subclass; the lowering
constructs the behavior, applies its DP setters, and emits a single
`AddBehavior` call on the parent.

```mu
ListBox x:name="left" [ItemsSource=$LeftItems] {
    Behaviors {
        TooltipBehavior [Text="left column"]
        ListReorderBehavior [FromIndexFormat="@pragmatic-tech-ai/mural/reorder/idx"]
    }
}
```

Lowers to (illustrative — variable names will differ):

```js
const _listBox = new ListBox();
_listBox.set_property_value(ItemsControl.ItemsSourceKey, DataContextBinding(_listBox, "LeftItems"));

const _tooltipBehavior = new TooltipBehavior();
_tooltipBehavior.set_property_value(TooltipBehavior.TextKey, "left column");
_listBox.AddBehavior(_tooltipBehavior);

const _listReorderBehavior = new ListReorderBehavior();
_listReorderBehavior.set_property_value(ListReorderBehavior.FromIndexFormatKey, "@pragmatic-tech-ai/mural/reorder/idx");
_listBox.AddBehavior(_listReorderBehavior);
```

The DP setters run **before** `AddBehavior` calls `OnAttached`, so the
behavior's configuration is fully populated by the time it wires
anything up. Multiple behaviors attach in source order.

Composing behaviors and child elements is fine — they live in the same
body:

```mu
StackPanel {
    Behaviors {
        DragSourceBehavior [DataFormat="@pragmatic-tech-ai/mural/toolbox-item"]
    }
    Border [Background=#ffffff]
    Border [Background=#f0f0f0]
}
```

The Borders are added to `StackPanel.Children` via the default slot; the
behavior attaches via `AddBehavior`. The two paths don't interfere.

## 4. Reading attached behaviors

The host visual exposes `Behaviors` as a read-only array:

```ts
const listBox = new ListBox();
listBox.AddBehavior(new TooltipBehavior());
for (const b of listBox.Behaviors) { /* … */ }
```

The slot is lazily allocated — a visual with no behaviors has
`Behaviors === []` (a stable shared empty array).

## 5. Detach lifecycle — `OnDetached`

`Behavior` exposes an `OnDetached(visual)` virtual that fires every
time the host's `visualParent` transitions from defined to undefined
— i.e., every time the host is removed from its parent. The default
is a no-op so behaviors that don't need teardown can ignore it.

```ts
export class CursorListenerBehavior extends Behavior
{
    private _timer: ReturnType<typeof setInterval> | undefined;

    public override OnAttached(visual: Visual): void
    {
        this._timer = setInterval(() => { /* … */ }, 50);
        visual.AddRoutedEventListener('PointerMove', this.onMove);
    }

    public override OnDetached(visual: Visual): void
    {
        if (this._timer !== undefined) clearInterval(this._timer);
        this._timer = undefined;
        visual.RemoveRoutedEventListener('PointerMove', this.onMove);
    }

    private onMove = (_args: unknown): void => { /* … */ };
}
```

### Semantics

- **Fires on each detach edge**, not one-shot. A Visual that's added
  → removed → added → removed gets two `OnDetached` fires. If a
  behavior wants once-only teardown semantics, it can track that with
  a local boolean.

- **Does NOT cascade.** Detaching a panel from its parent fires
  `Unloaded` on the panel itself but NOT on the panel's children —
  the children's `visualParent` still points inside the (now
  unmounted) subtree. Wire a behavior that needs detach to the
  visual it's logically tied to, not to its ancestor.

- **Auto-wired through `AddBehavior`**. The behavior doesn't subscribe
  itself — `Visual.AddBehavior` installs an `Unloaded` listener that
  calls `behavior.OnDetached(this)` on every detach edge. Behaviors
  that bypass `AddBehavior` and wire themselves directly via routed
  events lose this — register `AddUnloadedListener` manually in that
  case.

### `Visual.AddUnloadedListener` — the underlying primitive

The same listener API behaviors get implicitly is exposed publicly:

```ts
visual.AddUnloadedListener(() => console.log('detached'));
visual.RemoveUnloadedListener(listener);
```

Same shape as `AddLoadedListener` with one asymmetry: `Loaded` fires
once per instance on the first attach to a host (matches WPF
FrameworkElement.Loaded); `Unloaded` fires on EVERY detach edge.
The asymmetry is pragmatic — Loaded's one-shot is about
"initialisation ran" semantics; Unloaded's per-edge fires are about
"teardown for THIS detach" semantics, and conflating them would mean
behaviors couldn't re-bind on re-attach.

## 6. `ListReorderBehavior` — a concrete behavior

A receiver-side drag-to-reorder helper for any `ItemsControl`. Marks
the items control as `AllowDrop=true`, signals `DragDropEffects.Move`
on a DragOver carrying the configured format key, computes the
insertion index from cursor host-Y vs. container midpoints, and
mutates the bound items collection on drop.

```ts
public static readonly FromIndexFormatKey = Model.RegisterProperty<string>(
    ListReorderBehavior, 'FromIndexFormat', '@pragmatic-tech-ai/mural/reorder/from-index', MetaData.None);
```

| DP | Default | Meaning |
|---|---|---|
| `FromIndexFormat` | `'@pragmatic-tech-ai/mural/reorder/from-index'` | DataObject key the behavior reads to find the source row's index. |

### What the behavior owns

- **Drop target wire-up.** On `OnAttached`, sets `host.AllowDrop = true`
  and adds DragOver / Drop routed-event listeners.
- **DragOver acknowledgement.** When the dragged data has the
  configured format key, the behavior sets `args.Effect =
  DragDropEffects.Move` so the framework's cursor / chrome reflects
  the move intent.
- **Drop math.** Iterates the host's realised containers
  (`host.logicalChildren`), computes each container's vertical
  midpoint in host coordinates (`hostTop` walks the ArrangedRect
  offsets up to the root), and picks the insertion index as the first
  container whose midpoint sits below the cursor. Past the last row
  falls through to "end of list".
- **Items mutation.** Reads the source index from the DataObject,
  removes the item at that index from the bound collection, and
  inserts it at the calculated target index — adjusting for the
  index shift after the remove.

### What the behavior does NOT own

- **Source-side drag initiation.** The behavior is only the receiver.
  The consumer wires up the source side themselves — typically by
  flipping `IsDraggable = true` on each row's container and providing
  an `OnDragStart` that populates the drag DataObject with the row's
  index:

  ```mu
  Style x:key="RowStyle" [TargetType=ListBoxItem] {
      IsDraggable = true;
      OnDragStart = $StartReorder;
  }
  ```

  with the VM's `StartReorder` returning
  `{ data: new DataObject().Set('@pragmatic-tech-ai/mural/reorder/from-index', index), effects: DragDropEffects.Move }`.

- **Insertion-line visual indicator.** The behavior performs no
  rendering. Consumers that want an insertion line can layer a
  sibling DragOver listener that draws into the canvas. Wiring an
  overlay-layer indicator into the behavior itself would need
  framework support that doesn't exist today (no clean overlay
  primitive exposed to behaviors).

- **Cross-list drops.** The behavior keys off the single
  `FromIndexFormat` against its own `Items`. A drop from a foreign
  source carrying the same key will be misinterpreted as a same-list
  reorder. Supporting cross-list would require the DataObject to also
  carry a source-identity tag (e.g., the originating ItemsControl
  reference) and the behavior to gate the mutation on a match.

### Mutable Items requirement

The behavior requires `host.Items` to be an `ObservableCollection`. A
plain-array `Items` is read-only from the behavior's perspective and
the Drop silently no-ops. Callers who want array-backed reorder
should wrap the array in an ObservableCollection. A VM-side
`OnReorder(from, to)` callback as an alternative isn't wired today —
the contract is currently "the behavior mutates Items directly."

### Markup

```mu
ListBox x:name="leftList" [ItemsSource=$LeftItems,
                            ItemContainerStyle=@RowStyle] {
    Behaviors {
        ListReorderBehavior
    }
}
```

The behavior takes no required arguments — `FromIndexFormat` has a
sensible default and only needs to be set when the consumer's source
side uses a non-default format key.

## 7. Patterns

- **Behaviors live with the visual they target.** A behavior that wires
  pointer events on a Canvas attaches to that Canvas, not to a parent
  panel — the host visual is what `OnAttached` receives, so reaching
  for ancestors via `args.Visual.GetVisualParent()` is the escape
  hatch.

- **Multiple behaviors on one visual compose.** Add two
  `Behaviors { … }` entries and both attach in source order. There's no
  conflict resolution machinery — they're independent observers.

- **Behaviors can hold references to other behaviors on the same host.**
  Read `host.Behaviors` in OnAttached to find a sibling behavior by
  `instanceof`. Useful for coordinating insertion-line drawing with
  reorder logic, for example.

- **Behaviors that need a typed host signal it via runtime checks.**
  `ListReorderBehavior` throws when attached to something that isn't an
  `ItemsControl`; do the same for behaviors that require a specific
  host shape — it catches authoring mistakes at the right time
  (template materialisation, not arbitrary event firing).

## 8. Triggered Behavior attach (Style triggers)

A `Behaviors { … }` block inside a `when()` trigger body attaches
behaviors only while the trigger is active and tears them off on
deactivation. Useful for transient interactions — a Shake behavior on
`IsBusy`, a Tooltip behavior on `IsMouseOver`, etc.

```mu
Style[TargetType=Button] {
    when( IsBusy ) {
        Behaviors { ShakeBehavior [Amplitude=4] }
    }
}
```

The compiler lowers each entry to a paired
[`AttachBehaviorAction`](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/trigger-actions.ts) +
[`DetachBehaviorAction`](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/trigger-actions.ts) in the
trigger's `enterActions` / `exitActions` arrays. The Attach action is
factory-based — each enter invokes the factory to construct a fresh
`Behavior` for the firing Visual. Two Visuals sharing the same Style
each get their own Behavior instance (no cross-target stomping on DPs
or per-instance state). Re-entry of a trigger that's already in the
attached state detaches the prior instance cleanly before installing
the new one.

`Behaviors { … }` at Style body level (outside any `when()`) is
**rejected** at compile time — attaching the same Behavior instances
to every target would have them stomp on each other. Use the
always-on `Behaviors { … }` block at the Visual level (§3 above) for
behaviors that aren't trigger-conditional.

### Imperative companion

`Visual.RemoveBehavior(behavior)` is the imperative analogue. The
trigger machinery uses it via `DetachBehaviorAction`, but consumers
can also call it directly when a behavior needs to be torn off before
the visual unloads. Calling `RemoveBehavior` fires `OnDetached` once
and unsubscribes the auto-wired Unloaded listener, so a later unload
edge doesn't fire `OnDetached` a second time.
