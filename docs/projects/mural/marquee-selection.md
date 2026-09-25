# Marquee selection

Explorer-style rubber-band multi-select on any `Selector` (`ListBox`,
`TreeView`, future `DataGrid`). Drag the pointer on the panel
background and the rectangle's contents become the selection. Plain
click on the background clears it. Modifier keys switch between
replace / add / extend semantics.

**Implemented in:**
- [basic/selector.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/selector.ts) —
  `AllowMarqueeSelection` and `MarqueeBoundsPolicy` DPs, the auto-attach
  hook, and the multi-select machinery the behavior writes into
  (`BeginUpdate` / `EndUpdate`, `ClearSelection`, `setSelectedContainers`,
  `_selectedContainers`)
- [basic/behaviors/marquee-selection-behavior.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/behaviors/marquee-selection-behavior.ts) —
  `MarqueeAdorner` + `attachMarqueeSelection(selector)` factory

See also: [behaviors.md](behaviors.md) for the `Behavior` framework,
[items-and-scrolling.md](items-and-scrolling.md) for `ItemsControl` /
`Selector` recycling, [property-system.md](property-system.md) for the
DP / attached-DP machinery the selection state rides on.

## 1. Opting in

Marquee is a `Selector` feature, not a `ListBox` feature — every
`Selector` descendant gets it.

```mu
ListBox [ItemsSource=$Items,
         SelectionMode=Extended,
         AllowMarqueeSelection=true,
         MarqueeBoundsPolicy=Intersect]
```

```ts
const lb = new ListBox();
lb.SelectionMode          = SelectionMode.Extended;
lb.AllowMarqueeSelection  = true;
lb.MarqueeBoundsPolicy    = MarqueeBoundsPolicy.Intersect; // default
```

Two DPs on `Selector`:

| DP | Default | Meaning |
|---|---|---|
| `AllowMarqueeSelection` | `false` | When `true`, the marquee behavior is wired up; when flipped back to `false` it detaches cleanly. |
| `MarqueeBoundsPolicy` | `Intersect` | How the rect decides which items it covers — see § 4. |

The DP flip is the public API. Internally `Selector.OnPropertyChanged`
calls `attachMarqueeSelection(this)` on `true` and the returned detach
thunk on `false`. Consumers never construct the behavior themselves.

**SelectionMode requirement.** The gesture is a no-op when
`SelectionMode === Single` — single-select is incompatible with rubber-
banding. The DP flip is still honored (no error, no warning), but
pointer drags on the background do nothing. Use `SelectionMode.Multiple`
or `SelectionMode.Extended`.

## 2. Gesture model

Five-state pointer state machine, per session:

```
   PointerDown on background → ARMED (snapshot, capture)
        │
        ├── PointerMove < 4px → stay ARMED
        │
        ├── PointerMove ≥ 4px → ACTIVE (adorner shown, selection live)
        │       │
        │       └── PointerUp → COMMIT (selection final, adorner gone)
        │
        └── PointerUp without ACTIVE → CLICK
                ├── plain (no modifier) → ClearSelection
                └── Ctrl / Shift        → no-op (Explorer parity)
```

### Threshold

`DRAG_THRESHOLD_PX = 4`. Below this, the adorner never materialises and
the gesture is treated as a click. Above it, the marquee realizes and
the selection updates on every subsequent move sample.

### What "on the background" means

`isContainerClick(args.Source, selector)` walks up from the event's
`Source` toward the selector, looking for any visual returned by the
selector's `containerOrderForRange()`. If it hits one, the click is on a
container row — the marquee yields and the row's own click handler
takes over. If it walks all the way to the selector without seeing a
container, the click is on background.

For `ListBox`, `containerOrderForRange()` returns the realized
`ListBoxItem` containers. For `TreeView`, it returns the recursive walk
of `TreeViewItem` containers — so clicking inside a tree row's content
still counts as a row click, not a background click.

## 3. Modifier modes

The modifier active at `PointerDown` decides the mode for the whole
gesture; later modifier changes during the drag are ignored.

| Modifier at PointerDown | Mode | Effect on commit |
|---|---|---|
| _(none)_ | **Replace** | Rect's contents become the new selection. Anything previously selected and not in the rect is dropped. |
| Ctrl | **Add** | Rect's contents are added to the snapshot taken at PointerDown. Previously-selected items outside the rect stay selected. |
| Shift | **Extend** | Same shape as Add — rect's contents layer over the snapshot. Distinct mode only because real Shift-drag-extend can grow to include earlier anchor-relative state in future iterations; today Add and Extend produce the same result. |

### Background click semantics

| Modifier at click | Effect |
|---|---|
| _(none)_ | `ClearSelection()` — every selected row drops, `SelectionChanged` fires once. |
| Ctrl | No-op. Existing selection preserved. |
| Shift | No-op. Existing selection preserved. |

This matches Windows Explorer: a plain click on empty area clears,
modified clicks on empty area leave the selection alone.

## 4. Bounds policy

`MarqueeBoundsPolicy` decides which realized containers count as "inside
the rect":

| Value | Test | Behavior |
|---|---|---|
| `Intersect` (default) | container's arranged rect ∩ marquee ≠ ∅ | An item is in if the marquee touches its rect at all — Explorer's behavior. Easier to flick-select; one pixel of overlap suffices. |
| `Contained` | container's arranged rect ⊆ marquee | The marquee must fully enclose the rect — Finder's behavior. Stricter; useful when rows are tall and partial-overlap is too aggressive. |

The hit test runs against the container's `ArrangedRect` translated
into the panel's coordinate frame (so it's invariant under the
adorner-layer scroll translate).

## 5. Selection state model

Marquee writes through the same plumbing the click-handler does:

1. **`Selector._selectedContainers: Set<Visual>`** — the source of truth
   for which realized containers are selected. Marquee diff-updates
   this via `setSelectedContainers(items)`.

2. **`Selector._selectedData: Set<unknown>`** — mirror keyed by exposed
   value (container `Tag` for ListBox, the bound item for TreeView).
   Used by recycle hooks (`PrepareContainerForItemOverride` /
   `RebindContainerForItemOverride`) to restore selection chrome on
   recycled containers that come back into view.

3. **Attached `Selector.IsSelected` DP** — written via
   `Selector.SetIsSelected(container, true/false)`. Container subclasses
   (`ListBoxItem`, `TreeViewItem`) mirror it to their own instance
   `IsSelected` DP so template triggers (`when(IsSelected) { … }`) fire
   on the templated-parent side.

4. **Public single-row DPs** (`SelectedIndex` / `SelectedItem` /
   `SelectedValue`) get refreshed by `refreshExposedSelection()` to
   point at the first selected container (in `containerOrderForRange()`
   order). Marquee triggers this after each move sample.

## 6. Batching with `BeginUpdate` / `EndUpdate`

A move sample can flip dozens of `IsSelected` attached values when the
rect crosses several rows. Firing `SelectionChanged` per flip would
hammer listeners. The behavior wraps each commit in:

```ts
selector.BeginUpdate();
selector.setSelectedContainers(nextSelection);
selector.refreshExposedSelection();
selector.fireSelectionChanged();
selector.EndUpdate();
```

`BeginUpdate` / `EndUpdate` are public on `Selector` (WPF's
`MultiSelector.BeginUpdateSelectedItems` / `EndUpdateSelectedItems`
under simplified names). Inside a transaction, every per-row
`SetIsSelected` is silent on `SelectionChanged`; the outer
`EndUpdate` flushes a single fire.

Click-on-empty-space uses the same wrap so a coalesced clear isn't
disrupted by a concurrent transaction higher up the stack.

## 7. The adorner

`MarqueeAdorner extends Adorner`. Translucent fill (`#3699cc33`),
1-pixel dashed stroke (`#3699cc`). `IsHitTestVisible = false` so the
adorner never blocks pointer events — receivers under the cursor still
see PointerMove samples during the drag.

### Placement

`AdornerLayer.GetAdornerLayer(panel)` resolves the layer at gesture
time. When the items panel sits inside a `ScrollContentPresenter`, the
SCP provides an inner `AdornerLayer` that shares the scrolled frame
with the content — so the marquee rectangle stays glued to the cells
during auto-scroll, matching what Explorer does.

If no `AdornerLayer` is reachable from the panel (a panel hosted
outside any SCP), the behavior gracefully degrades: the adorner is
skipped, selection still updates, just no rubber-band visual.

### Coordinate frame

The marquee rect is computed in panel-local coordinates. The adorner's
`Placement(adornedRect, desired)` returns the rect verbatim, so the
adorner's own `RenderOverride` paints at `(0, 0, width, height)` and
the placement applies the offset.

## 8. Pointer capture

`onDown` calls `args.CapturePointer(selector)`. This routes every
subsequent `PointerMove` / `PointerUp` to the selector regardless of
what the pointer is actually over — necessary so dragging off the panel
(over a sibling, off the host) keeps the marquee live.

`onUp` calls `args.ReleasePointerCapture()` unconditionally before
running its commit / clear branch. Capture also auto-releases on
`PointerUp` per the InputManager's `setPointerCapture` parity contract,
so the explicit release is defense-in-depth.

## 9. Detach lifecycle

`AllowMarqueeSelection = false` calls the detach thunk
`attachMarqueeSelection` returned. The thunk:

- Removes the three routed listeners (`PointerDown` / `PointerMove` /
  `PointerUp`) from the selector.
- Removes any live adorner from its layer.
- Clears the per-session locals (snapshot, mode, armed flag).

No selection mutation happens on detach — flipping the DP off mid-drag
just cancels the gesture; whatever was selected at the time stays
selected.

The behavior also detaches implicitly through the same Visual unloaded
edge any behavior would, but since `Selector` owns the attachment via
DP write and not via `AddBehavior`, the unloaded path doesn't run.
Consumers can disable cleanly by flipping the DP or by destroying the
selector.

## 10. Worked example — word-toolbox

```mu
ListBox x:name="listBox"
        [ItemsSource=$ListBoxWords,
         ItemsPanel=@ListBoxItemsPanel,
         ItemContainerStyle=@WordTileItemStyle,
         SelectionMode=Extended,
         AllowMarqueeSelection=true] {
    Behaviors {
        ListReorderBehavior x:name="reorder"
            [FromIndexFormat="@pragmatic-tech-ai/mural/reorder/from-index"]
    }
}
```

This combines marquee with `ListReorderBehavior`. The two coexist
because they listen for different events: marquee on `PointerDown` /
`PointerMove` / `PointerUp`; reorder on `DragOver` / `DragLeave` /
`Drop`. The container-drag latch (from `IsDraggable=true` on the
container style) fires on `PointerMove` past the drag threshold — but
only when the pointer-down was ON a container. Marquee fires only when
the pointer-down was ON THE BACKGROUND. The `isContainerClick` check at
each entry point keeps them disjoint.

## 11. Working in tests

The behavior's tests live in
[basic/tests/marquee-selection-behavior.test.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/tests/marquee-selection-behavior.test.ts).
The fixture pattern:

```ts
function buildFixture() {
    const lb = new ListBox();
    lb.SelectionMode = SelectionMode.Extended;
    const a = new ListBoxItem(new TextBlock('A'));
    const b = new ListBoxItem(new TextBlock('B'));
    lb.AddChild(a);
    lb.AddChild(b);
    const target = new HeadlessTarget(200, 400);
    target.Content = lb;
    target.Flush();
    return { lb, a, b, panel: lb.ItemsPanelInstance as Visual, target };
}
```

`HeadlessTarget.Flush()` runs measure + arrange so each container has
an `ArrangedRect` the rect-intersect math can reason about.
`InjectPointerDown(panel, …)` makes the panel the event source —
matching what hit-test would resolve to in the real demo when the
cursor lands in the panel's background area.

Pre-state setup uses the public Selector API, NOT the attached DP
directly:

```ts
lb.SelectedItem = c;   // ✓ updates _selectedContainers + chrome
c.IsSelected     = true; // ✗ flips chrome only; marquee doesn't see it
```

Writing the attached DP bypasses `_selectedContainers` — the marquee
won't include the row in its snapshot, and tests asserting "replace
clears the prior selection" will look like they pass while the prior
"selection" never really existed in the Selector's eyes.

## 12. Limitations and non-goals

Tracked in [current-backlog.md § 10](https://github.com/pragmatic-tech-ai/mural/blob/main/current-backlog.md):
- **Marquee autoscroll** — § 10.7.
- **Marquee keyboard equivalent** — § 10.8.

Non-goals (no backlog entry):
- **No DataGrid / multi-axis hit-tests.** The implementation assumes
  the items panel's coordinate frame matches the rect arithmetic — true
  for `VirtualizingStackPanel`, `VirtualizingWrapPanel`, and the
  non-virtualizing siblings. A `DataGrid` row/column intersection model
  would need a different `computeMarqueeSelection`.
- **`MarqueeBoundsPolicy` per-session is fixed at the DP value.**
  Changing the DP mid-drag won't change the active session's policy
  (the policy is re-read on every move sample, so this is actually
  live — the limitation is that there's no per-gesture override).
