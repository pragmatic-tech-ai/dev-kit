# Diagram control

Promote the diagrammer demo's VM-side infrastructure into framework
primitives. The demo's `DiagramVM` (1483 LOC), `GroupVM`,
`ShapeNodeVM`, three behaviors, two adorners, and the demo-side
selection-bridge are essentially **a working diagrammer control
authored in the wrong directory** — the `commands` demo already
extends them as if they were framework infra. This doc consolidates
the refactor target: what moves, what stays, what shape the new
framework surface takes.

Sibling spec to [connectors.md](connectors.md) — both target
`src/framework/diagram/`. Lands stage-by-stage so the demo never
breaks (per § 4 sequencing).

See also: [connectors.md](connectors.md) for the connector subsystem
(separate work, same directory), [marquee-selection.md](marquee-selection.md)
for the Selector-side marquee already shipped, [behaviors.md](behaviors.md)
for the Behavior framework that alignment-guides + selection-resize
attach through, [items-and-scrolling.md](items-and-scrolling.md) for
ItemsControl recycling the Figure / Group containers use,
[adorners.md](adorners.md) for the AdornerLayer surface the resize +
guide adorners ride on.

## 1. Scope locks (decided)

1. **`Figure` and `Group` are container controls, not data classes.**
   Modeled on `ListBoxItem` and the ListBox grouping primitive. `Figure`
   is today's `DiagramNode` renamed and promoted; `Group` is new —
   like a ListBox GroupItem but for the diagram surface. Both live
   under `src/framework/diagram/`. The framework does NOT ship a Figure
   or Group data class — consumers bring their own VMs that satisfy
   small duck-typed interfaces (`IFigure` / `IGroup`). Naming chosen
   over `Node` to avoid the DOM `Node` global collision.
2. **Diagram absorbs every command + selection-bounds + behavior
   opt-in that lives on `DiagramVM` today.** 14 commands (5 align + 2
   distribute + 2 group/ungroup + 4 combine + 1 selection-resize), 5
   selection-bounds DPs, 3 behavior opt-ins (alignment guides,
   selection resize, elevation selection), 2 multi-target format DPs.
3. **Collaborator pattern for Diagram internals.** Mirrors the
   recently-completed `Element` split that extracted `StyleApplicator`
   / `TriggerHost` / `ResourceResolver`. Three collaborators:
   `DiagramCommands` (owns the 14 commands + their implementations),
   `SelectionBoundsTracker` (owns the 5 selection-bbox DPs),
   `FormatMirror` (owns the 2 multi-target format DPs and the seed +
   broadcast machinery). Diagram retains public DP surfaces but
   delegates implementation.
4. **Per-feature staged refactor.** Phases A-N below. Each phase
   produces a self-contained commit; the demo continues to work
   between phases through parallel surfaces (old VM-side machinery
   stays until Phase L flips the demo to the new framework surface).
5. **Save/Load + Status + seed nodes stay in the demo.** Persistence
   format is per-demo (this demo's "Kind → SHAPE_CATALOG entry"
   serialization is meaningless to other consumers); Status text is a
   per-demo UI affordance; seed-on-open is per-demo content. Nothing
   else stays.

## 2. Module layout

```
src/framework/diagram/
  diagram.ts                       (modify — gains 14 commands + 5 selection-bound DPs + 3 opt-in DPs + 2 format DPs)
  diagram-node.ts                  (rename → figure.ts, class DiagramNode → Figure; re-export alias for 1 release)
  figure.ts                        (renamed from diagram-node.ts)
  group.ts                         (NEW — ItemsControl-shaped container for grouped Figures/Groups)
  contracts/
    i-figure.ts                    (NEW — IFigure duck-typed interface)
    i-group.ts                     (NEW — IGroup duck-typed interface)
    top-level-of.ts                (NEW — Parent-walk helper, moved from diagram-vm.mjs)
  collaborators/
    diagram-commands.ts            (NEW — 14 command implementations + CanExecute predicates)
    selection-bounds-tracker.ts    (NEW — derives SelectionLeft/Top/Width/Height/Count from SelectedItems)
    format-mirror.ts               (NEW — seeds FormatFill/Stroke from selection, broadcasts edits)
  commands/
    align.ts                       (NEW — pure functions: alignLeft(items), alignRight(items), ...)
    distribute.ts                  (NEW — pure functions: distributeHorizontal(items), ...)
    group-ops.ts                   (NEW — group(items), ungroup(group))
    combine.ts                     (NEW — wraps §19 boolean ops: combine(items, mode))
  behaviors/
    alignment-guides-behavior.ts   (NEW — promoted from demo/.../behaviors/align-edges-behavior.mjs)
    alignment-guides-adorner.ts    (NEW — promoted from demo/.../alignment-guides-adorner.mjs)
    selection-resize-adorner.ts    (NEW — promoted from demo/.../selection-resize-adorner.mjs)
    elevation-selection-behavior.ts (NEW — the "click member → select root" rule, promoted from demo/.../diagram.mjs attachSelectionBridge)
  toolbox.ts                       (NEW — palette control with drag-source items)
  toolbox-drop-behavior.ts         (NEW — promoted from demo/.../behaviors/canvas-drop-behavior.mjs)
  tests/
    (existing + new per-feature tests)
```

`src/framework/diagram/index.ts` re-exports public surface. The
internal `contracts/` / `collaborators/` / `commands/` / `behaviors/`
directories are organizational — consumers import from the package
barrel.

## 3. Type sketches

### 3.1 IFigure / IGroup — the duck-typed contracts

Framework operations (align, distribute, group, ungroup, combine,
bbox tracking) read these shapes from the items in
`Selector.SelectedItems`. Consumers bring their own VMs that satisfy
them; the framework doesn't require inheritance from a specific class.

```ts
// src/framework/diagram/contracts/i-figure.ts
export interface IFigure {
    // Position in diagram-host coordinates. Required.
    X:      number;
    Y:      number;
    Width:  number;
    Height: number;
    // Selection chrome flag. Read + written by the framework's
    // selection bridge (elevation behavior).
    IsSelected: boolean;
    // Parent group, or undefined if top-level. Optional —
    // consumers without grouping leave this absent.
    Parent?: IGroup | undefined;
}

// src/framework/diagram/contracts/i-group.ts
export interface IGroup extends IFigure {
    // Members collection. Type bound is IFigure (group can contain
    // nodes AND nested groups since IGroup extends IFigure).
    Members: ObservableCollection<IFigure> | readonly IFigure[];
}
```

`topLevelOf(entity: IFigure): IFigure` walks the `Parent` chain to the
outermost ancestor. Pure helper, no class dependency.

**Why duck-typed, not abstract base classes.** Consumers may already
have a domain VM hierarchy (`UmlClassVM`, `FlowchartNodeVM`,
`CircuitComponentVM`) — forcing them to extend a framework `Figure`
class chains their hierarchy to ours. The interface contract is
minimal (5-6 properties), satisfiable by any Model, and survives the
consumer's own class evolution. Matches the WPF precedent of
`IInputElement` as the duck-typed contract over the
`UIElement`/`ContentElement` split.

A consumer who wants the contract-satisfying behavior for free can
extend the demo-side `ShapeNodeVM`-style class without that becoming
a framework dependency — the framework operations type-check on the
interface, not on any specific class.

### 3.2 Figure control — promoted from DiagramNode

Today's [diagram-node.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/framework/diagram/diagram-node.ts) is
already 95% of the desired shape: ContentControl with X / Y DPs,
drag-to-move with click-vs-drag distinction, group-drag partners,
scroll-aware drag compensation, position snap callback integration.
The refactor renames it and adds two small things:

```ts
// src/framework/diagram/figure.ts
export class Figure extends ContentControl
{
    // Left / Top / drag-to-move / group-drag / scroll-aware — all
    // present today. No behavior change.
    public static readonly LeftKey = Model.RegisterProperty<number>(
        Figure, 'Left', 0, MetaData.Arrange | MetaData.BindsTwoWayByDefault);
    public static readonly TopKey = Model.RegisterProperty<number>(
        Figure, 'Top', 0, MetaData.Arrange | MetaData.BindsTwoWayByDefault);

    // Width / Height are INHERITED from Visual (visual.ts:191-192,
    // default NaN). No need to register them on Figure — the existing
    // markup pattern `Width=$Width` binds the DataContext's data-side
    // Width onto Visual.Width directly. SelectionBoundsTracker reads
    // Width / Height from the SELECTED DATA ITEMS (IFigure-typed
    // entries in Diagram.SelectedItems), not from the Figure container,
    // so the container doesn't need its own Width/Height DPs.

    // ... drag-to-move logic unchanged from current DiagramNode ...
}
```

**Compatibility shim.** The `DiagramNode` name is re-exported as an
alias for one release window after the rename so the
`commands`-demo's `import { DiagramNode }` paths don't break
mid-refactor. Alias removed in Phase N.

### 3.3 Group control — new

Like `ListBoxItem` for the diagram surface. A container that wraps a
set of grouped Figures (and nested Groups), renders shared chrome
(default: dashed border when selected), and translates its members
en bloc when dragged. Modeled on the ListBox grouping primitive (`GroupItem`).

```ts
// src/framework/diagram/group.ts
export class Group extends ContentControl
{
    // Left / Top / Width / Height are READ-ONLY-from-outside on a Group
    // — they're derived from the union bbox of Members and propagated
    // outward. Writes go through Members manipulation, not direct DP
    // writes.
    public static readonly LeftKey   = Model.RegisterReadOnlyProperty<number>(Group, 'Left',   0, MetaData.Arrange);
    public static readonly TopKey    = Model.RegisterReadOnlyProperty<number>(Group, 'Top',    0, MetaData.Arrange);
    public static readonly WidthKey  = Model.RegisterReadOnlyProperty<number>(Group, 'Width',  0, MetaData.Measure);
    public static readonly HeightKey = Model.RegisterReadOnlyProperty<number>(Group, 'Height', 0, MetaData.Measure);

    // Drag-to-move on a Group writes the delta to every member's
    // Left / Top. Implemented in OnPointerMove via the same Visio /
    // PowerPoint rigid-translate semantics today's GroupVM uses.
    // Members inherit the press capture; per-member drag listeners
    // don't fire while the Group's gesture is active.
    protected override OnPointerDown(args: PointerEventArgs): void { /* ... */ }
    protected override OnPointerMove(args: PointerEventArgs): void { /* ... */ }
    protected override OnPointerUp  (args: PointerEventArgs): void { /* ... */ }
}
```

Default template: a dashed-border chrome around the `Content`
(which is itself an ItemsControl over the Members). Visible only
when `IsSelected`; otherwise the chrome paints transparently so
member visuals dominate.

**Why ContentControl, not ItemsControl directly.** Group's selectable
surface is the bbox-bordered region as a whole (clicking it selects
the Group). An ItemsControl base would let each member be clicked
independently, defeating the Group's chrome-as-selectable-surface
purpose. Wrapping an inner ItemsControl inside the Content (via the
default template) gives the Group a single hit target on the outside
plus per-member layout on the inside.

The "elevation" rule (clicking a member → selects the topmost Group
ancestor) is implemented separately by `ElevationSelectionBehavior`
(§ 3.7) so consumers without grouping needs don't pay for the walk.

### 3.4 Diagram changes — the kitchen-sink surface

```ts
export class Diagram extends Selector {
    // ---- Existing (already shipped) -------------------------------
    public static readonly PositionSnapKey = ...;

    // ---- From this refactor: selection bounds ---------------------
    // Derived. Read-only-from-outside. SelectionBoundsTracker owns
    // the recompute when SelectedItems / member positions change.
    public static readonly SelectionLeftKey   = Model.RegisterReadOnlyProperty<number>(Diagram, 'SelectionLeft',   0, MetaData.None);
    public static readonly SelectionTopKey    = Model.RegisterReadOnlyProperty<number>(Diagram, 'SelectionTop',    0, MetaData.None);
    public static readonly SelectionWidthKey  = Model.RegisterReadOnlyProperty<number>(Diagram, 'SelectionWidth',  0, MetaData.None);
    public static readonly SelectionHeightKey = Model.RegisterReadOnlyProperty<number>(Diagram, 'SelectionHeight', 0, MetaData.None);
    public static readonly SelectionCountKey  = Model.RegisterReadOnlyProperty<number>(Diagram, 'SelectionCount',  0, MetaData.None);

    // ---- From this refactor: behavior opt-ins ---------------------
    public static readonly AlignmentGuidesEnabledKey  = Model.RegisterProperty<boolean>(Diagram, 'AlignmentGuidesEnabled',  false, MetaData.None);
    public static readonly SelectionResizeEnabledKey  = Model.RegisterProperty<boolean>(Diagram, 'SelectionResizeEnabled',  false, MetaData.None);
    public static readonly ElevationSelectionEnabledKey = Model.RegisterProperty<boolean>(Diagram, 'ElevationSelectionEnabled', false, MetaData.None);

    // ---- From this refactor: 14 commands --------------------------
    // Default impls owned by DiagramCommands collaborator. Consumers
    // OVERRIDE by writing their own RelayCommand to the DP (matches
    // how the commands demo customizes today by subclassing DiagramVM).
    public static readonly AlignLeftCommandKey            = ...;
    public static readonly AlignRightCommandKey           = ...;
    public static readonly AlignTopCommandKey             = ...;
    public static readonly AlignMiddleCommandKey          = ...;
    public static readonly AlignCenterCommandKey          = ...;
    public static readonly DistributeHorizontalCommandKey = ...;
    public static readonly DistributeVerticalCommandKey   = ...;
    public static readonly GroupCommandKey                = ...;
    public static readonly UngroupCommandKey              = ...;
    public static readonly CombineUnionCommandKey         = ...;
    public static readonly CombineIntersectCommandKey     = ...;
    public static readonly CombineSubtractCommandKey      = ...;
    public static readonly CombineExcludeCommandKey       = ...;
    public static readonly SelectionResizeCommandKey      = ...;   // for the resize-adorner handle to invoke

    // ---- From this refactor: multi-target format mirror -----------
    public static readonly SelectionFormatFillKey   = Model.RegisterProperty<Brush | undefined>(Diagram, 'SelectionFormatFill',   undefined, MetaData.None);
    public static readonly SelectionFormatStrokeKey = Model.RegisterProperty<Pen   | undefined>(Diagram, 'SelectionFormatStroke', undefined, MetaData.None);
}
```

Constructor instantiates the three collaborators and wires their
listeners. Collaborator references stored on private fields (not
DPs) — they're framework-internal, not consumer-facing.

```ts
constructor() {
    super();
    this._commands       = new DiagramCommands(this);
    this._boundsTracker  = new SelectionBoundsTracker(this);
    this._formatMirror   = new FormatMirror(this);
}
```

### 3.5 DiagramCommands collaborator

Owns the 14 command implementations + their CanExecute predicates.
Constructed with a back-ref to the Diagram so it can read
`SelectedItems` + write to the public Command DPs.

```ts
// src/framework/diagram/collaborators/diagram-commands.ts
export class DiagramCommands {
    constructor(private readonly diagram: Diagram) {
        this.installAll();
    }

    private installAll(): void {
        const canAlign      = () => this.countSelected() >= 2;
        const canDistribute = () => this.countSelected() >= 3;
        const canGroup      = () => this.countSelectedTopLevel() >= 2;
        const canUngroup    = () => this.countSelectedGroups() >= 1;
        const canCombine    = () => this.countSelectedWithGeometry() >= 2;

        // Write to the Diagram's Command DPs through the privileged
        // set_property_value_with_key — these are read-only-with-default
        // (consumers can OVERRIDE by writing their own RelayCommand,
        // which clobbers the default).
        this.diagram._setCommandDefault(Diagram.AlignLeftCommandKey,
            new RelayCommand(() => alignLeft(this.collectSelected()), canAlign,
                { Text: 'Align Left', Description: '...' }));
        // ... and 13 more
    }

    private collectSelected(): IFigure[] { /* duck-type filter on SelectedItems */ }
    private countSelected(): number    { ... }
    // ...
}
```

The command implementations are pure functions in
`src/framework/diagram/commands/{align,distribute,group-ops,combine}.ts`
operating on `IFigure[]`. Same math as today's `DiagramVM.AlignLeft()`
etc., extracted from the kitchen-sink VM into pure helpers.

### 3.6 SelectionBoundsTracker collaborator

Subscribes to `Diagram.SelectionChanged` and to each selected item's
`Left` / `Top` / `Width` / `Height` PropertyChanged. Recomputes
`(SelectionLeft, Top, Width, Height, Count)` and pushes to the Diagram's
read-only DPs via the privileged-set hatch.

```ts
// src/framework/diagram/collaborators/selection-bounds-tracker.ts
export class SelectionBoundsTracker {
    private readonly memberListeners = new Map<IFigure, () => void>();

    constructor(private readonly diagram: Diagram) {
        diagram.AddSelectionChangedListener(() => this.resubscribe());
    }

    private resubscribe(): void {
        // Detach old listeners
        for (const detach of this.memberListeners.values()) detach();
        this.memberListeners.clear();
        // Attach to current selection's geometry DPs
        for (const item of this.diagram.SelectedItems) {
            if (!isIFigure(item)) continue;
            // Left / Top / Width / Height — recompute on any change
            const recompute = () => this.recomputeBounds();
            const k1 = (item as Model).AddPropertyChangedListener('Left', recompute);
            // ... etc., bundle into a single detach thunk per item
            this.memberListeners.set(item, () => { k1(); /* ... */ });
        }
        this.recomputeBounds();
    }

    private recomputeBounds(): void {
        const items = [...this.diagram.SelectedItems].filter(isIFigure);
        if (items.length === 0) {
            this.diagram._setSelectionBounds(0, 0, 0, 0, 0);
            return;
        }
        const minLeft = Math.min(...items.map(i => i.Left));
        const minTop  = Math.min(...items.map(i => i.Top));
        const maxRight  = Math.max(...items.map(i => i.Left + i.Width));
        const maxBottom = Math.max(...items.map(i => i.Top  + i.Height));
        this.diagram._setSelectionBounds(minLeft, minTop, maxRight - minLeft, maxBottom - minTop, items.length);
    }
}
```

`isIFigure(x)` is a duck-type guard: returns true iff `x` has all five
of `Left` / `Top` / `Width` / `Height` / `IsSelected` as DPs (or own
properties on Model).

### 3.7 FormatMirror collaborator

Seeds `Diagram.SelectionFormatFill` / `SelectionFormatStroke` from the
first selected item's Fill / Stroke on selection change; broadcasts
edits made to those DPs back to every selected item. Same machinery
as today's `DiagramVM.FormatFill` / `FormatStroke` but extracted.

The "fill" side is straightforward (Brush replacement). The "stroke"
side is Pen-shaped — broadcast COPIES the Pen's property values onto
each member's own Pen (preserving per-item Pen identity, per the
demo's existing comment at `diagram-vm.mjs:524-535`).

Duck-types on a `IFillable { Fill: Brush }` / `IStrokable {
Stroke: Pen }` interface so consumers whose VMs don't have a
fill/stroke skip the broadcast silently.

### 3.8 ElevationSelectionBehavior

The "clicking any entity walks the Parent chain to the topmost
ancestor and only THAT becomes IsSelected=true" rule. Promoted from
the demo's `attachSelectionBridge` in `diagram.mjs:63-118`.

Auto-attached when `Diagram.ElevationSelectionEnabled = true`.
Listens to `Diagram.SelectionChanged`; for each item, walks
`Parent`-chain via `topLevelOf()`; sets `IsSelected = true` on the
root, `IsSelected = false` on everything else in the same root's
subtree.

Visio / PowerPoint parity. Off by default (consumers without
grouping don't pay for the Parent walk).

### 3.9 Toolbox + drop receiver

Promotes the `attachCanvasDropBehavior` from
[demo/.../behaviors/canvas-drop-behavior.mjs](https://github.com/pragmatic-tech-ai/mural/blob/main/demo/demos/diagram/behaviors/canvas-drop-behavior.mjs):

```ts
class Toolbox extends ItemsControl {
    // ItemsSource = ObservableCollection<ToolboxItem>
    // Each item materialized as a draggable tile via ItemTemplate
}

class ToolboxItem extends ContentControl {
    static DragDataKey = ...;   // what gets put on the DataObject during drag
}

// Behavior: Diagram + Toolbox become a pair. The Toolbox's drag-source
// items emit a DataObject; the Diagram (when its DropReceiver attached
// property is true) consumes the drop and invokes Diagram.OnItemDropped
// callback so the consumer can materialize a new entity.
function attachToolboxDropBehavior(diagram: Diagram, onDrop: (data, point) => void): () => void;
```

Per-demo wiring stays trivial: consumer provides the `onDrop`
callback that knows how to translate the toolbox item's drag-data
into their own VM's shape.

### 3.10 Adorners

Both adorners promote essentially as-is, just with the demo-side
"reach into DiagramVM" patterns replaced with "read framework-side
DPs on Diagram":

- **`SelectionResizeAdorner`** — 8-handle bbox resize. Reads
  `Diagram.SelectionLeft/Top/Width/Height` for bbox position; writes back
  via `Diagram.SelectionResizeCommand` (which delegates to a per-item
  resize on the selected IFigures). Auto-mounted into the SCP's
  `AdornerLayer` when `SelectionResizeEnabled = true`.
- **`AlignmentGuidesAdorner`** + **`AlignmentGuidesBehavior`** —
  guides during drag. Behavior subscribes to Figure drag pulses,
  computes guide lines, pushes an array of guides onto a
  framework-internal slot the adorner reads. Auto-mounted when
  `AlignmentGuidesEnabled = true`.

## 4. Refactor sequencing — staged phases

Each phase produces a self-contained commit. Demo continues to work
between phases through PARALLEL surfaces: framework-side gains the
new shape; demo-side keeps its old shape until Phase L flips the
demo bootstrap. Phase N deletes the old VMs.

| Phase | What lands | Demo state | Verification |
|---|---|---|---|
| **A** | Rename `DiagramNode` → `Figure` + file `diagram-node.ts` → `figure.ts`. Re-export `DiagramNode` alias for back-compat. (Width/Height NOT added — Visual already provides them; spec correction noted in § 3.2.) | Untouched (uses alias) | All `framework/diagram/tests/*` pass + diagram demo runs visually |
| **B** | New `Group` control with bbox-derive + rigid translate. No demo use yet. | Untouched | `group.test.ts` — synthetic 3-member Group, drag, bbox follows |
| **C** | `SelectionBoundsTracker` collaborator + `SelectionLeft/Top/Width/Height/Count` DPs on Diagram | Untouched | `selection-bounds.test.ts`: synthetic 3-node selection, assert bbox math |
| **D** | `commands/align.ts` pure helpers + `Diagram.AlignLeft/Right/Top/Middle/CenterCommand` DPs + `DiagramCommands` collaborator skeleton | Untouched (`DiagramVM.AlignLeftCommand` still runs) | `align-commands.test.ts`: 3-node fixtures × 5 alignments |
| **E** | `commands/distribute.ts` + `Diagram.DistributeHorizontal/Vertical` DPs | Untouched | `distribute-commands.test.ts` |
| **F** | `commands/group-ops.ts` + `Diagram.Group/UngroupCommand` DPs | Untouched | `group-ops.test.ts`: synthetic group/ungroup; nested-group invariants |
| **G** | `commands/combine.ts` + `Diagram.CombineUnion/Intersect/Subtract/ExcludeCommand` DPs (wraps §19 boolean ops) | Untouched | `combine-commands.test.ts` |
| **H** | `AlignmentGuidesBehavior` + `AlignmentGuidesAdorner` promoted. `Diagram.AlignmentGuidesEnabled` DP. Auto-mount logic. | Untouched | `alignment-guides.test.ts`: synthetic drag, assert guide positions |
| **I** | `SelectionResizeAdorner` promoted. `Diagram.SelectionResizeEnabled` DP. `SelectionResizeCommand`. | Untouched | `selection-resize.test.ts`: synthetic resize, assert bbox + per-item scale |
| **J** | `FormatMirror` collaborator + `Diagram.SelectionFormatFill/Stroke` DPs | Untouched | `format-mirror.test.ts`: selection seed + edit broadcast |
| **K** | `Toolbox` control + `ToolboxDropBehavior` promoted. | Untouched | `toolbox-drop.test.ts`: simulated drop, callback fires with correct data |
| **L** | **Diagram demo flips to new surface.** Delete demo-side `attachSelectionBridge`, behaviors/adorners, align/distribute/group/combine/resize/format methods on DiagramVM. Markup switches to `Diagram.AlignLeftCommand=$Diagram.AlignLeftCommand` etc. | DiagramVM shrinks from 1483 LOC to ~80 (Save / Load / Status / seed) | Diagram demo runs identically; all framework tests still pass |
| **M** | **Commands demo migrated.** `CommandsVM` no longer extends `DiagramVM`. Brings its own VM with Status + custom command overrides written to `Diagram.AlignLeftCommand` etc. | `commands` demo runs identically | Commands demo tests pass; framework tests pass |
| **N** | Delete `diagram-vm.mjs`'s legacy classes (`ShapeNodeVM`, `GroupVM`, `topLevelOf` re-export). Remove `DiagramNode` alias from `figure.ts`. | Demo files trimmed; no residual cruft | Build clean; no broken imports |

Phases A-K are pure additions (framework surface grows; demo
unaffected). Phase L is the demo flip (the satisfying "delete 1400
LOC" commit). Phases M-N are cleanup of the consumer demo + the
legacy aliases.

Each phase ≈ 1-3 hours of work. Phases can split further if
individual commits get big (e.g., D might split into "align-left
only" → "remaining 4 align commands" if the pure-function extraction
is gnarlier than expected).

## 5. Consumer migration — what commands demo loses

The `commands` demo today does three things with `DiagramVM` /
`ShapeNodeVM` that need rewriting at Phase M:

1. **Subclasses `ShapeNodeVM` to override default Fill / Label.** With
   `ShapeNodeVM` gone (framework only provides the control + interface,
   not the data class), the commands demo brings its own VM. The
   pattern stays similar — `OverrideMetadata` on the demo's own VM class
   for default-value overrides — just no framework superclass.
2. **Subclasses `DiagramVM` as `CommandsVM`.** With `DiagramVM` gone,
   the commands demo brings its own VM with whatever per-demo state
   it needs (Status text, custom command implementations). The
   custom Align commands (which today override the inherited
   `_align(mode)` method) become: the demo creates its own
   RelayCommand instances and writes them to
   `Diagram.AlignLeftCommandKey` etc., shadowing the framework's
   defaults.
3. **Reads `DiagramVM.StatusKey`.** Status text was demo affordance;
   stays on whatever the consumer's VM exposes. Markup binding
   `Status=$Status` re-points to the demo's own DP, not a framework
   one.

Net effect on `commands-vm.mjs`: shrinks from 235 LOC to ~80, in
roughly the same shape as the (post-refactor) diagram-vm.mjs.

## 6. Test plan

Per-phase test files listed in § 4. Cross-cutting fixtures + tests:

- **Pure math tests** are the bulk. `align.test.ts`,
  `distribute.test.ts`, `group-ops.test.ts`, `combine.test.ts` all
  run against synthetic `IFigure[]` records — no Visual, no DOM,
  fast. Same shape as the §19 boolean-ops harness tests.
- **Integration tests** in `diagram.test.ts` exercise the full
  collaborator pipeline: create a Diagram with synthetic IFigure
  items, select some, invoke a command via the Diagram's
  `AlignLeftCommand` DP, assert positions changed correctly +
  SelectionBoundsTracker recomputed correctly.
- **Demo smoke tests.** Both the diagram demo and the commands demo
  should have a one-shot smoke test that materializes the VM,
  invokes a few commands, asserts no exceptions. Lives outside
  `src/framework/diagram/tests/` since it's demo-coupled.

## 7. Open questions

### 7.1. Where does Diagram._setCommandDefault() come from?

The Diagram's Command DPs need a "default writer" path that
`DiagramCommands` uses at construction, and a "consumer override"
path that wins when a consumer writes their own RelayCommand. Two
shapes:

- **(a)** Standard DP write from `DiagramCommands` (uses public
  `set_property_value` like any other writer). Consumer writes also
  use `set_property_value`. Whoever writes last wins. The defaults
  get set in the Diagram constructor; consumer code that runs
  later overrides cleanly.
- **(b)** A separate "default" tier in `EffectiveValueDescriptor`
  that's lower priority than Local. Defaults sit at default-tier;
  consumer Local-tier writes naturally shadow them. Requires a new
  tier in EVD or a registered-default mechanism.

Recommendation: **(a)** for simplicity. The Diagram constructor
runs before any consumer code that might override, so the
last-writer-wins ordering naturally produces the right result.

### 7.2. Group selection chrome — fixed template vs configurable?

Today's `GroupVM` bbox visual is a dashed border defined inline in
the diagram demo's markup. The framework `Group` ships a default
template (dashed border via the standard `Border` chrome), but
consumers may want different chrome (solid colored bbox, drop
shadow, animated dash march).

Recommendation: `Group.Template` is a normal `ControlTemplate` DP
with a sensible default. Consumers override via Style or
DataTemplate just like any other Control. No special API surface.

### 7.3. SelectionBoundsTracker subscription cost

For a 100-node selection, the tracker installs 4 PropertyChanged
listeners × 100 items = 400 listeners. Each node drag fires
~4 callbacks. Recompute is O(N) over the bbox math. For typical
diagram sizes this is fine. For 10k-node selections it might bite.

Recommendation: ship the naive O(N) version. Add a rAF-coalesce
gate if profiling shows the bbox recompute is hot during drag.

### 7.4. Resize adorner — uniform scale vs free-form aspect

Today's resize adorner stretches the bbox freely (changing aspect
ratio mid-drag) and broadcasts the new dimensions to each member
via per-member scale math. WPF / PowerPoint default to free-form;
holding Shift constrains to uniform scale. Implement both?

Recommendation: ship free-form first (matches today's demo
behavior); add Shift-constrains-uniform as a follow-up that's
purely additive (one modifier check in the adorner's PointerMove).

### 7.5. Should Diagram expose IFigure-typed SelectedFigures separately from SelectedItems?

`Selector.SelectedItems` returns `unknown[]`. Most diagram
operations want `IFigure[]`. Options:

- **(a)** Add `Diagram.SelectedFigures: readonly IFigure[]` (derived)
  that filters `SelectedItems` through `isIFigure()`.
- **(b)** Consumers filter inline.

Recommendation: **(a)** — slight memory cost (one derived list)
for a cleaner API surface that pairs naturally with the duck-type
contract.

### 7.6. Re-export alias lifetime

Phase A keeps `DiagramNode` as a re-export alias for `Figure`.
Phase N removes it. Window between them = duration of phases B-M
= probably 1-2 weeks of work. Acceptable transitional window for
a private (in-tree) consumer. Alternative: remove the alias
immediately and update the commands demo's import to `Figure` in
Phase A. Pragma: cleaner imports vs slightly more code per
phase.

Recommendation: keep the alias (cheap, isolates risk).

## 8. Explicitly out of scope

- **Connector integration.** Framework Diagram with connectors is
  designed separately in [connectors.md](connectors.md). The two
  refactors are independent; they both land in
  `src/framework/diagram/` but don't touch each other's surface.
- **Save / Load / serialization.** Per-demo. The
  framework provides operations that mutate data; persistence is the
  consumer's job. (No `Diagram.Serialize()` method.)
- **Undo / redo.** Out of scope for v1; ICommand-based undo stack is a
  separate cross-cutting concern.
- **The `commands` demo's status-bar pattern.** Status text remains
  per-demo. Framework doesn't expose a `Diagram.Status` DP.
- **Programmatic batched node-creation API.** Today's
  `vm.CreateNode(kind, x, y)` is per-demo (it knows about Kinds).
  Framework provides the container controls + commands; consumers
  decide how their data layer materializes new entities.
- **Hit-testing precision.** Already shipped (Selector + Figure
  containers handle hit-testing through standard input-manager
  pipeline). No changes from this refactor.
