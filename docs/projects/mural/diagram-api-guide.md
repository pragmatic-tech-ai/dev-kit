# Diagram Subsystem — API Guide

The diagram subsystem is mural's Visio-/drawio-style diagramming layer: a
canvas of movable **shapes** joined by routed **connectors**, with grouping,
boolean combine, alignment, rich text, and persistence. This guide is the
developer reference — the classes, dependency properties (DPs), methods,
enums, and helper functions you wire together. For the end-user gesture
reference, see [diagram-user-manual.md](diagram-user-manual.md).

Everything documented here is exported from
`mural/framework`.

---

## 1. Architecture at a glance

The subsystem separates the **model** (data you own and persist) from the
**view** (the control that renders and edits it):

| Layer | Type | Role |
|-------|------|------|
| Model | `DiagramDocument` | Owns the `Nodes` / `Connectors` collections, the mutation methods (`CreateNode`, `Group`, …) and `Save` / `Load`. (The palette lives in the framework `ToolboxRepository`, not the document.) |
| View | `Diagram` | An `ItemsControl`/`Selector` that renders the nodes on a `Canvas`, handles selection, drag, resize, connector interaction, and raises gesture events. |
| Items | `Figure`, `Group` | The canvas items themselves — visuals **and** data fused (no data/visual split, no per-item `DataTemplate`). |
| Edges | `Connector` | Self-drawing routed lines mounted as siblings behind the figures. |

A key design choice: **items in a `Diagram` are the `Figure`/`Group`
instances directly.** `GetContainerForItemOverride` returns each item
unchanged, so a node is its own container. This is why you set `Left`,
`Fill`, `LabelText` etc. straight on the `Figure`.

The view is glued to the model by **collaborators** (internal helpers the
`Diagram` constructs) and by **mutation wiring** you attach once
([§11](#11-mutation-wiring)). The `Diagram` never mutates data itself — it
raises events (`ItemDropped`, `DeleteRequested`, `GroupRequested`, …) and a
`DiagramMutator` (satisfied structurally by `DiagramDocument`) does the work.

### Rendering layers

Nodes and connectors live in a two-layer panel (`DiagramLayersPanel`):
connectors render first (behind), figures second (in front). The
`DiagramLayer` attached property (`Connectors` / `Figures`) routes a child to
the right layer.

---

## 2. Getting started

### 2.1 Minimal bootstrap (imperative)

```ts
import { Application } from '@pragmatic-tech-ai/mural/runtime';
import {
    DiagramDocument, DiagramStorageKey, ConnectorEndpoint,
} from '@pragmatic-tech-ai/mural/framework';

// Storage is optional — omit it to run without persistence.
const doc = new DiagramDocument(Application.current?.Services.get(DiagramStorageKey));

const start = doc.CreateNode('rectangle', 60, 60);   // → Figure | null
const end   = doc.CreateNode('ellipse',  240, 60);
start.LabelText = 'Start';
end.LabelText   = 'Process';

doc.CreateConnector(
    new ConnectorEndpoint({ Node: start }),
    new ConnectorEndpoint({ Node: end }));
```

Hand `doc` to the view via `DataContext`. In markup the `Diagram` binds its
`ItemsSource` to `Nodes` and `Connectors` to `Connectors`.

### 2.2 Wiring the view in `.mu`

The `Diagram` control needs its `ItemsSource`, a `Canvas`-based `ItemsPanel`,
and whichever feature toggles you want on. It **auto-wires its `Mutator`**
from the `DataContext` when the context structurally implements
`DiagramMutator` — `DiagramDocument` does, so no explicit `Mutator` binding is
needed.

```
Diagram x:name="nodes"
    [ ItemsSource                  = $Nodes,
      Connectors                   = $Connectors,
      ItemsPanel                   = @DiagramCanvasPanel,   // a Canvas ItemsPanelTemplate
      SelectionMode                = Extended,
      AllowMarqueeSelection        = true,
      AlignmentGuidesEnabled       = true,
      SelectionResizeEnabled       = true,
      TextBlockAdornerEnabled      = true,
      ConnectorInteractionsEnabled = true,
      ReflectSelectionToItems      = true,
      DropReceiver                 = $Self,                 // relative-source-self
      Focusable                    = true ]
```

`DropReceiver = $Self` binds the drop target to *this* `Diagram` (the internal
`ScrollViewer` is on the bubble path of every canvas drop). See the demo
[diagram.mu](https://github.com/pragmatic-tech-ai/mural/blob/main/demo/demos/diagram/diagram.mu) for a full workspace (toolbox,
command toolbars, and format pane).

---

## 3. `DiagramDocument` — the model

`extends Model`, and structurally satisfies `DiagramMutator`, `IDocument`, and
`ICommandTarget`.

```ts
new DiagramDocument(storage?: DiagramStorage)
```

Wires the `SaveCommand` / `LoadCommand` relay commands. The palette is no
longer owned by the document — the `Diagram` control first-inits a
`ToolboxRepository` (a `Services` singleton) with a built-in Shapes page; see
**Palette drops** below.

### Dependency properties

| Property | Type | Default | Notes |
|----------|------|---------|-------|
| `Id` | `string` | `'diagram-<seq>'` | Document identity. |
| `Title` | `string` | `'Diagram'` | |
| `IsDirty` | `boolean` | `false` | Set on mutation, cleared by `Save`/`Load`. |
| `ActiveView` | `Diagram \| undefined` | `undefined` | Published so shell regions can bind the view's commands. |
| `Inspector` | `DiagramInspector` | instance | Format-Shape inspector panel. |
| `Nodes` | `ObservableCollection<Figure \| Group>` | empty | The canvas items. |
| `Connectors` | `ObservableCollection<Connector>` | empty | The edges. |
| `Status` | `string` | `''` | Status-strip text. |
| `Storage` | `DiagramStorage \| undefined` | ctor arg | Persistence backend. |
| `SaveCommand` / `LoadCommand` | `RelayCommand \| undefined` | instances | Bind to Save/Load buttons. |

### Methods

| Method | Returns | Purpose |
|--------|---------|---------|
| `CreateNode(kind, x, y)` | `Figure \| null` | Instantiate a catalog shape at `(x, y)`; `null` if `kind` is unknown. Marks dirty. |
| `CreateConnector(source, target)` | `Connector \| null` | Materialize and add a connector between two `ConnectorEndpoint`s. |
| `DeleteNodes(items)` | `void` | Remove figures/groups; cascades to delete connectors orphaned by the removal. |
| `DeleteConnectors(connectors)` | `void` | Remove connectors and detach their host subscriptions. |
| `Group(items)` | `void` | Wrap ≥2 top-level entries in a new `Group` (inserted at the lowest member index so it renders behind). |
| `Ungroup(items)` | `void` | Dissolve each `Group`; members lift to the group's parent. |
| `CombineSelection(items, mode)` | `void` | Boolean-merge ≥2 figures' geometries via `GeometryCombineMode`; replace inputs with one combined `Figure`. |
| `Save()` | `void` | Serialize `Nodes` + `Connectors` to `Storage` (key `mural-diagram-state-v1`); clears `IsDirty`. |
| `Load()` | `void` | Deserialize from `Storage`; repopulates the collections; clears `IsDirty`. |

Because `DiagramDocument` *is* a `DiagramMutator`, binding it as the
`Diagram`'s `DataContext` is all it takes for toolbar/keyboard gestures to
flow into these methods.

---

## 4. `Diagram` — the control

`extends Selector` (which extends `ItemsControl`). Construct it via markup
(it has a default style); most of its surface is DPs you set once.

### 4.1 Feature toggles

All default to `false` (or `undefined`) — opt in per feature:

| Property | Type | Enables |
|----------|------|---------|
| `AllowMarqueeSelection` | `boolean` | (inherited) Rubber-band selection on empty canvas. |
| `AlignmentGuidesEnabled` | `boolean` | Snap-to-guide lines while dragging. |
| `SelectionResizeEnabled` | `boolean` | Resize handles around the selection bounds. |
| `TextBlockAdornerEnabled` | `boolean` | Move/rotate grips on a selected figure's label. |
| `ConnectorInteractionsEnabled` | `boolean` | Drag-to-create and endpoint/waypoint editing of connectors. |
| `ReflectSelectionToItems` | `boolean` | Mirror selection onto each item's `IsSelected` DP. |

### 4.2 Data & template DPs

| Property | Type | Notes |
|----------|------|-------|
| `Connectors` | `ObservableCollection<Model> \| undefined` | Bound to `DiagramDocument.Connectors`. |
| `ConnectorTemplate` | `DataTemplate \| undefined` | Optional template if connector items aren't `Connector`s already. |
| `DropReceiver` | `Visual \| undefined` | The visual that accepts palette drops (usually `$Self`). |
| `Mutator` | `DiagramMutator \| undefined` | Auto-wired from a structurally-matching `DataContext`. |
| `PositionSnap` | `DiagramPositionSnap \| undefined` | `(rect) => rect` drag-snap callback (installed by the guides behavior). |

### 4.3 Read-only selection state

`SelectionLeft`, `SelectionTop`, `SelectionWidth`, `SelectionHeight`,
`SelectionCount` — the live bounding box + count of the current selection,
for binding into an inspector or status strip.

### 4.4 Format-mirror DPs

When figures/connectors are selected these seed from the first leaf; writing
them broadcasts the edit to every selected leaf (see
[FormatMirror](#collaborators)):

`SelectionFormatFill` (`Brush`), `SelectionFormatStroke` (`Pen`),
`SelectionFormatSourceCap` / `SelectionFormatTargetCap` (`DataTemplate`),
`SelectionFormatSourceCapScale` / `SelectionFormatTargetCapScale` (`number`),
`SelectionIsConnector` (`boolean`), `ConnectorCapOptions` (`readonly
CapOption[]`, from `connectorCapOptions()`).

### 4.5 Commands

Editing commands are exposed as `RelayCommand` DPs so a toolbar can bind them
directly (see the demo's four toolbars):

- **Align:** `AlignLeftCommand`, `AlignRightCommand`, `AlignTopCommand`,
  `AlignMiddleCommand`, `AlignCenterCommand` — enabled for ≥2 selected.
- **Distribute:** `DistributeHorizontalCommand`, `DistributeVerticalCommand`
  — enabled for ≥3 selected.
- **Group:** `GroupCommand` (≥2), `UngroupCommand` (≥1 group).
- **Combine:** `CombineUnionCommand`, `CombineIntersectCommand`,
  `CombineSubtractCommand`, `CombineExcludeCommand` (≥2).

Each command's `CanExecute` re-evaluates on selection change. The stable
string ids for these commands are in `DiagramCommandId`
([§13](#13-enums)).

### 4.6 Events (listener add/remove pairs)

The `Diagram` raises gestures; a mutator (or your own code) subscribes:

| Add / Remove | Args | Fired when |
|--------------|------|-----------|
| `…ItemDroppedListener` | `ItemDroppedArgs { Data, Position }` | A palette tile drops on the canvas. |
| `…DeleteRequestedListener` | `DeleteRequestedArgs { Items, Connectors }` | Delete/Backspace with a non-empty selection. |
| `…GroupRequestedListener` | `GroupRequestedArgs { Items }` | Ctrl+G / Group command. |
| `…UngroupRequestedListener` | `UngroupRequestedArgs { Groups }` | Ctrl+Shift+G / Ungroup command. |
| `…CombineRequestedListener` | `CombineRequestedArgs { Items, Mode }` | A Combine command. |
| `…ConnectorCreatedListener` | `ConnectorCreatedArgs { Source, Target }` | A drag-create gesture completes over a target. |

Normally you don't subscribe by hand — `attachStandardDiagramMutations`
([§11](#11-mutation-wiring)) wires all six to a `DiagramMutator`.

### 4.7 Connector selection

Connectors carry their own selection track (separate from figure selection):
`SelectConnector`, `DeselectConnector`, `ClearConnectorSelection`,
`IsConnectorSelected(c)`, `SelectConnectorRange(from, to)`, the
`SelectedConnectors` getter, and
`Add/RemoveConnectorSelectionChangedListener`.

### <a id="collaborators"></a>Collaborators (internal)

The `Diagram` constructs several internal helpers you don't call directly but
should know exist: **SelectionBoundsTracker** (maintains the read-only
`Selection*` DPs), **FormatMirror** (seeds/broadcasts the format DPs),
**SelectionReflector** (`ReflectSelectionToItems`), and
**`DiagramConnectorsMaterializer`** (mounts each `Connector` — plus its caps
and label — into the connectors layer, keeping them in sync with the
collection). Its only public surface is the `MaterializedVisuals` map.

---

## 5. `Figure` and `Group`

### 5.1 `Figure`

`extends ContentControl`. A single positioned shape: a geometry, a fill/stroke,
and a text label. Default size is `FIGURE_DEFAULT_SIZE` (80 dp).

| Property | Type | Default | MetaData |
|----------|------|---------|----------|
| `Left` | `number` | `0` | Arrange, TwoWay |
| `Top` | `number` | `0` | Arrange, TwoWay |
| `Kind` | `string` | `''` | None |
| `Geometry` | `PathGeometry \| undefined` | `undefined` | None |
| `Fill` | `Brush \| undefined` | default fill | None |
| `Stroke` | `Pen \| undefined` | per-instance clone | None |
| `Text` | `ShapeText` | instance | Measure |
| `Id` | `string \| undefined` | `undefined` | None |
| `IsSelected` | `boolean` | `false` | None |
| `PortProvider` | `IPortProvider \| undefined` | `undefined` | None |
| `ExplicitPorts` | `readonly Port[] \| undefined` | `undefined` | None |

**Sugar:** `LabelText` (get/set) proxies `Text.Content`.

**Factories:**

```ts
Figure.fromKind(kind, left, top, options?: { width?, height? }): Figure
Figure.fromSource(source, left, top, options?: { width?, height?, kind? }): Figure
```

**Geometry / ports:**

- `ApplyCatalogKind(kind)` — set `Kind` and load the unit-1 catalog geometry.
- `get Ports(): readonly Port[]` — unified port list (`ExplicitPorts` wins,
  then `PortProvider`, then a default box of ports).
- `GetSideSlot`, `GetSideEndpointCount`, `SlotIndexForPosition`,
  `MoveSideEndpoint`, `ReorderSideEndpoint` — the side-slot machinery that
  lets multiple connectors share an edge without overlapping.
- `Add/RemoveSideEndpointsChangedListener(listener)`.

### 5.2 `Group`

`extends ContentControl`. A container whose `Left`/`Top` you move as a unit;
`Width`/`Height` are read-only (computed from members).

```ts
new Group(initialMembers?: readonly (Figure | Group)[])
```

- `Members: ObservableCollection<Figure | Group>`
- `Parent: Group | undefined` — enclosing group, `undefined` at top level.
- `Translate(dx, dy)` — shift every member, coalescing recomputes.
- `EnumerateLeaves(): Iterable<Figure>` — recursive leaf figures.
- `EnumerateSubGroups(): Iterable<Group>` — recursive descendant groups.

---

## 6. Shape catalog & geometry

The catalog is the registry of built-in shape *kinds* (35 of them:
rectangle, ellipse, squircle, arrow, diamond, heart, …). Each entry provides a
**unit-1** geometry (a 1×1 path) that gets scaled to the node's size.

```ts
SHAPE_CATALOG:     readonly ShapeCatalogEntry[]          // ordered list
SHAPE_CATALOG_MAP: ReadonlyMap<string, ShapeCatalogEntry> // by kind
```

```ts
interface ShapeCatalogEntry { kind: string; label: string; unit(): PathGeometry }
interface NormalizedGeometry { source: PathGeometry; x: number; y: number; w: number; h: number }
interface CombinableShape { Geometry: PathGeometry | undefined; Left: number; Top: number }
```

**Helpers:**

| Function | Purpose |
|----------|---------|
| `buildNodeGeometry(kind, w, h)` | Scale the cached unit-1 geometry of `kind` to `w×h`. |
| `scaleGeometry(source, w, h)` | Point-wise scale a unit-1 geometry via a matrix. |
| `translateGeometry(geom, dx, dy)` | Translate a geometry in diagram space. |
| `normalizeToUnit(geom)` | Reduce an arbitrary geometry to unit-1 form + bbox/position. |
| `mergeShapes(nodes, mode)` | Boolean-combine N shapes (`GeometryCombineMode`) into one `NormalizedGeometry`. |

---

## 7. Text — `ShapeText`

Every `Figure` and `Connector` owns a `ShapeText` (`Figure.Text`,
`Connector.Text`). It's a `Control` with its own template and can carry either
a plain string (`Content`) or a rich `FlowDocument` (`Document`).

### 7.1 Core DPs

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `Content` | `string` | `''` | Plain text. |
| `Document` | `FlowDocument \| undefined` | `undefined` | Rich content (overrides `Content` when set). |
| `HasRichContent` | `boolean` | `false` | True while a `Document` is displayed. |
| `IsEditing` | `boolean` | `false` | True during in-place edit. |
| `IsEmpty` (getter) | `boolean` | — | Nothing to paint. |

Typography: `FontSize` (12), `FontWeight`, `FontStyle`, `Foreground`,
`TextAlignment` (Center), `TextWrapping` (Wrap), `Padding` (`Thickness(2)`).

### 7.2 Placement & transform

The text block can sit anywhere relative to its shape and be offset, resized,
and rotated:

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `Placement` | `TextPlacement` | `Center` | One of 13 anchors — inside (`Center`, `Top`, `TopLeft`, …) or outside (`Above`, `Below`, `LeftOf`, `RightOf`). |
| `Offset` | `Point` | `(0,0)` | Nudge from the anchor. |
| `Angle` | `number` | `0` | Rotation in degrees (centre pivot). |
| `BlockWidth` / `BlockHeight` | `number` | `NaN` | Explicit block size; `NaN` = auto. |
| `VerticalTextAlignment` | `VerticalAlignment` | `Center` | Vertical align within the block. |
| `AutoFit` | `TextAutoFit` | `None` | `ShrinkText` scales text to fit; `GrowShape` grows the shape to the text. |

**Helpers:** `isOutsideTextPlacement(p)` and
`computeTextBlockAnchor(placement, fw, fh, bw, bh)` (top-left anchor of a
`bw×bh` block within an `fw×fh` footprint).

### 7.3 In-place editing

- `BeginEdit()` — enter edit mode (seeds a `RichTextBox` from current content).
- `CommitEdit()` — commit; promotes to rich if formatting was applied, else
  collapses back to plain `Content`.
- `CancelEdit()` — discard the working copy.
- `GetBlockRect(): Rect` — the block rect in the control's frame.

Inside the editor, Ctrl+B/I/U toggle bold/italic/underline.

### 7.4 Rich-content helpers (`FlowDocument`)

Serialize, clone, and convert documents:

```ts
serializeFlowDocument(doc): SerializedDoc
deserializeFlowDocument(data): FlowDocument
cloneFlowDocument(doc): FlowDocument
flowDocumentToPlainText(doc): string
flowDocumentFromPlainText(text, align?): FlowDocument
isEffectivelyPlainDocument(doc): boolean   // no formatting beyond plain string
```

```ts
type SerializedRun       = { t: string; b?: boolean; i?: boolean; u?: boolean; f?: FieldKind }
type SerializedParagraph = { align?: TextAlignment; runs: readonly SerializedRun[] }
type SerializedDoc       = readonly SerializedParagraph[]
```

Author a rich label imperatively:

```ts
ellipse.Text.Document = deserializeFlowDocument([
    { runs: [{ t: 'Pro' }, { t: 'cess', b: true }] },   // "Process" with bold "cess"
]);
```

### 7.5 Fields — live tokens

A `Field` is an inline element (`extends Run`) whose text is *computed* from
the owning shape/connector. Because it's a `Run`, the whole text pipeline
treats it as text; only serialization special-cases it (the key persists, the
value recomputes).

```ts
enum FieldKind { Width, Height, Left, Top, Kind, Id, Length, SourceId, TargetId }
new Field(key = FieldKind.Width, initial = '')
```

| Helper | Purpose |
|--------|---------|
| `documentWithFields(template)` | Parse `{Token}` markers in a string into `Field`s (or literal runs). |
| `resolveFields(doc, resolve)` | Push resolved values into every `Field` via a `FieldResolver`. |
| `isFieldKind(s)` | Type guard for a known field key. |

```ts
type FieldResolver = (key: FieldKind) => string | undefined
```

```ts
// "Decision" over its own live dimensions — updates as the shape resizes.
squircle.Text.Document = documentWithFields('Decision\n{Width}×{Height}');
// A connector label with its live route length.
edge.Text.Document = documentWithFields('flows to · {Length}px');
```

Figures resolve `Width/Height/Left/Top/Kind/Id`; connectors additionally
resolve `Length/SourceId/TargetId`.

---

## 8. Text shapes — `TextShape` & `Callout`

Preconfigured figures whose reason for being *is* their text.

**`TextShape`** `extends Figure` — a rectangular box with a transparent (but
hit-testable) fill and a light outline, `AutoFit = GrowShape` (the box grows to
its text). No new DPs; `Kind = 'text'`. It drags, edits, formats, and persists
like any figure.

**`Callout`** `extends TextShape` — adds a leader line to a target:

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `LeaderTargetNode` | `Figure \| undefined` | `undefined` | The figure the leader points at; tracked live. |

`Kind = 'callout'`. The leader is a self-drawn `Shape` injected into the
figure's template canvas, drawn from the box edge toward the target's centre;
it re-draws whenever the callout or target moves. Setting `LeaderTargetNode =
undefined` removes the leader.

```ts
const note = new TextShape();
note.Left = 380; note.Top = 210;
note.LabelText = 'Free-floating note';
doc.Nodes.Add(note);

const callout = new Callout();
callout.Left = 40; callout.Top = 320;
callout.LabelText = 'Points at the heart ↘';
callout.LeaderTargetNode = heart;
doc.Nodes.Add(callout);
```

On load, `kind` reconstructs the class (`'text'` → `TextShape`, `'callout'` →
`Callout`), and the leader target is re-wired by node id in a second pass.

---

## 9. Connectors

### 9.1 `Connector`

`extends Shape` — a self-drawing routed line.

| Property | Type | Default | Purpose |
|----------|------|---------|---------|
| `Source` / `Target` | `ConnectorEndpoint \| undefined` | `undefined` | The two ends. |
| `Waypoints` | `readonly Point[] \| undefined` | `undefined` | User-placed intermediate points. |
| `RoutingMode` | `string` | `RoutingMode.Orthogonal` | `Straight` / `Orthogonal` / `Bezier`. |
| `AnchorClip` | `AnchorClip` | `Bbox` | Clip anchors to bounding box or true geometry. |
| `SourceCapTemplate` / `TargetCapTemplate` | `DataTemplate \| undefined` | `undefined` | Arrowhead/cap templates. |
| `SourceCapScale` / `TargetCapScale` | `number` | `1` | Cap size multiplier. |
| `Text` (read-only) | `ShapeText` | instance | The connector label. |
| `LabelPosition` | `number` | `0.5` | Label position along the route (0–1). |

**Read-only getters:** `LabelInstance`, `SourceCapInstance` /
`TargetCapInstance`, `SourceCapContext` / `TargetCapContext`,
`CurrentSourceAnchor` / `CurrentTargetAnchor`, `CurrentRoutePoints`
(the rendered polyline). **Sugar:** `LabelText` proxies `Text.Content`.

**Methods:** `DetachFromHosts()`, `IsPortAnchored(end)`,
`GetPortSlotIndex(end)`, `ReorderPortSlot(end, cursor)`,
`MovePortSlotToIndex(end, index)`. **Static:** `GetCapInset(v)` /
`SetCapInset(v, value)` (a cap attached property).

### 9.2 `ConnectorEndpoint`

`extends Model` — the address of one end: a node + port, or a free point.

```ts
new ConnectorEndpoint(init?: ConnectorEndpointInit)
interface ConnectorEndpointInit {
    Node?: Model; PortName?: string; PortSide?: PortSide;
    PortIndex?: number; FreePoint?: Point;
}
```

DPs mirror the init fields: `Node`, `PortName`, `PortSide`, `PortIndex`,
`FreePoint`.

### 9.3 Ports

A `Port` (`extends Model`) describes an attachment point in shape-local terms.

```ts
new Port(init?: PortInit)
enum PortCoordSpace { Bbox, Outline }
enum PortSide { N, S, E, W, Auto }
type ResolvedPortSide = Exclude<PortSide, PortSide.Auto>
```

DPs: `Name` (`''`), `CoordSpace` (`Bbox`), `X`/`Y` (`0`), `OutlineT` (`0`),
`Side` (`Auto`).

**`PortResolver`** (static): `resolve(port, host): ResolvedAnchor` lowers a
port into an anchor; `locate(ports, host, port)` returns its positional
`{ side, index }`. Hosts implement `IPortHost { ArrangedRect; Geometry? }`.

### 9.4 Routing

```ts
enum ConnectorEnd { Source, Target }
const RoutingMode = { Straight, Orthogonal, Bezier } as const
```

```ts
interface ResolvedAnchor { x; y; side: ResolvedPortSide; laneOffset? }
interface RouteSpec { sourceRect; sourceAnchor; targetRect; targetAnchor; waypoints }
interface IRouter {
    compute(spec: RouteSpec): PathGeometry;
    tangentAt(spec: RouteSpec, end: ConnectorEnd): number;  // radians
}
```

Routers are registered in a process-wide `RouterRegistry` (`register(name,
router)` / `resolve(name)`). Register a custom `IRouter` to add a routing mode.

### 9.5 Polyline geometry helpers

For laying things out *along* a route (labels, decorations):

```ts
polylineLength(points): number
pointAlongPolyline(points, t): RoutePoint          // t ∈ [0,1] by arc length
nearestTOnPolyline(points, p): number              // fraction nearest to p
interface RoutePoint { point: Point; tangent: number }   // tangent in radians
```

### 9.6 Caps

`connectorCapOptions(): CapOption[]` builds the standard cap dropdown (None,
Arrow, Filled Arrow, Open/Filled Circle, Diamond) — bind it to a
`ShapeFormatControl`'s `CapOptions`.

---

## 10. Connector behaviors

Attach these to a `Diagram` for interactive connector editing (they're driven
automatically when `ConnectorInteractionsEnabled = true`, but the classes are
public if you drive them yourself).

### 10.1 Create

```ts
const { behavior, detach } = attachConnectorCreate(diagram);
```

`ConnectorCreateBehavior(diagram)` — a drag-create state machine.
`IsActive`, `TransientConnector` (getters). `BeginCreate(sourceFigure,
sourceSide, cursor)`, `UpdateCursor(cursor)`, `EndCreate(targetFigure,
targetSide)` (fires `ConnectorCreated`), `Abort()`.

### 10.2 Edit

```ts
const { adorner, detach } = attachConnectorEditAdorner();
```

`ConnectorEditAdorner()` — endpoint/waypoint/segment drag state machine.
`IsActive`, `ActiveConnector` (getters). `BeginEndpointDrag(connector, end,
cursor)`, `BeginWaypointDrag(connector, index)`, `BeginSegmentDrag(connector,
index)`, `InsertWaypointAndDrag(connector, index, point)`,
`UpdateCursor(cursor)`, `EndDragOverTarget(figure, side)`,
`EndDragOverEmpty()`, `Abort()`, `RemoveWaypoint(connector, index)`. Free
helper: `segmentIsHorizontal(a, b)`.

---

## 11. Mutation wiring

The `Diagram` never edits data; it raises events and a `DiagramMutator`
mutates. Wire the two together once:

```ts
import { attachStandardDiagramMutations } from '@pragmatic-tech-ai/mural/framework';
const detach = attachStandardDiagramMutations(diagram, doc);   // doc is a DiagramMutator
```

This subscribes all six gesture events (`ItemDropped`, `DeleteRequested`,
`GroupRequested`, `UngroupRequested`, `CombineRequested`, `ConnectorCreated`)
to the matching mutator methods and returns a detach thunk.

```ts
interface DiagramMutator {
    Group(items): void;
    Ungroup(items): void;
    CombineSelection(items, mode): void;
    DeleteNodes(items): void;
    DeleteConnectors?(connectors): void;                       // optional
    CreateNode(kind, x, y): unknown | null | undefined;
    CreateConnector?(source, target): Connector | null | undefined;  // optional
    readonly NodeDropOffset?: { dx: number; dy: number };      // default (40, 40)
}
```

`DiagramDocument` implements this surface, so the `Diagram` **auto-wires** its
`Mutator` from the `DataContext` — you often don't call
`attachStandardDiagramMutations` explicitly at all.

### Palette drops

`attachCanvasDropBehavior(receiver, diagram)` attaches a drag-drop listener to
`receiver` (a `Border`/`ScrollViewer`), translating host coordinates to
canvas-local, accepting data that carries `TOOLBOX_ITEM_FORMAT`, and firing
`Diagram.ItemDropped`. Returns a detach thunk. The drag payload carries the
dropped **item id**; `attach-standard-mutations` looks the id up in the
`ToolboxRepository` and calls the item's registered `IToolboxDropFactory` (the
shape factory delegates to `mutator.CreateNode`). The dropped node lands offset
by `NodeDropOffset` (default `(40, 40)` — half the default node size — so the
cursor maps to the node centre).

```ts
const TOOLBOX_ITEM_FORMAT = '@pragmatic-tech-ai/mural/toolbox-item';   // drag-data format key (item id)
interface ItemDroppedArgs { Data: DataObject; Position: Point }  // Position is canvas-local
```

### Toolbox repository

The palette is a framework subsystem, resolved from `Application.current.Services`:

- `ToolboxRepository` (`ToolboxRepository.Key`) holds `ToolboxPage`s of
  `ToolboxItem`s. The `Diagram` control first-inits it (idempotent) with a
  built-in **Shapes** page from `SHAPE_CATALOG`.
- Each `ToolboxItem` carries a `ToolboxVisualDescriptor` (`{ ResolverKey, Key }`)
  and a `FactoryKey`. A per-kind `IToolboxVisualResolver` turns the descriptor
  into a `Visual` (`VisualContext.Tile` | `Figure`) and signals when a
  not-yet-loaded visual arrives; a per-kind `IToolboxDropFactory` materializes
  the dropped node.
- `ToolboxVisualPresenter` is the shared `ContentControl` every surface (palette
  tile, canvas node, preview) mounts to resolve a descriptor and re-host on the
  resolver's change signal — so the surfaces can't drift.
- Apps register additional pages/items/resolvers/factories against the same
  repository.

---

## 12. Persistence

```ts
interface DiagramStorage {
    GetItem(key: string): string | null;
    SetItem(key: string, value: string): void;
}
const DiagramStorageKey: ServiceKey<DiagramStorage>;   // DI token
```

Any `localStorage`/`sessionStorage`-compatible object satisfies
`DiagramStorage`. Register your implementation on
`Application.current.Services` under `DiagramStorageKey`, or pass one straight
to the `DiagramDocument` constructor. `Save`/`Load` round-trip every node
(position, geometry kind, fill/stroke, the full text spine — placement,
transform, rich content, fields, auto-fit — and callout leader targets) and
every connector (endpoints, waypoints, routing mode, label + position) under
storage key `mural-diagram-state-v1`.

---

## 13. Enums

| Enum | Members |
|------|---------|
| `TextPlacement` | `Center`, `Top`, `Bottom`, `Left`, `Right`, `TopLeft`, `TopRight`, `BottomLeft`, `BottomRight`, `Above`, `Below`, `LeftOf`, `RightOf` |
| `TextAutoFit` | `None`, `ShrinkText`, `GrowShape` |
| `FieldKind` | `Width`, `Height`, `Left`, `Top`, `Kind`, `Id`, `Length`, `SourceId`, `TargetId` |
| `AnchorClip` | `Bbox`, `Geometry` |
| `PortCoordSpace` | `Bbox`, `Outline` |
| `PortSide` | `N`, `S`, `E`, `W`, `Auto` |
| `ConnectorEnd` | `Source`, `Target` |
| `RoutingMode` (const obj) | `Straight`, `Orthogonal`, `Bezier` |
| `DiagramCommandId` | `AlignLeft/Right/Top/Middle/Center`, `DistributeHorizontal/Vertical`, `Group`, `Ungroup`, `CombineUnion/Intersect/Subtract/Exclude` |
| `DiagramLayer` | `Connectors`, `Figures` |

Members carry explicit string values (e.g. `TextPlacement.Bottom ===
'bottom'`) so the wire form is stable. `TextPlacement`, `TextAutoFit`,
`FieldKind` etc. are markup-facing where used in `.mu`.

---

## 14. Free-function index

| Function | Area |
|----------|------|
| `isOutsideTextPlacement`, `computeTextBlockAnchor` | Text placement |
| `serializeFlowDocument`, `deserializeFlowDocument`, `cloneFlowDocument`, `flowDocumentToPlainText`, `flowDocumentFromPlainText`, `isEffectivelyPlainDocument` | Rich text |
| `documentWithFields`, `resolveFields`, `isFieldKind` | Fields |
| `buildNodeGeometry`, `scaleGeometry`, `translateGeometry`, `normalizeToUnit`, `mergeShapes` | Geometry |
| `polylineLength`, `pointAlongPolyline`, `nearestTOnPolyline` | Route geometry |
| `connectorCapOptions` | Caps |
| `attachConnectorCreate`, `attachConnectorEditAdorner`, `segmentIsHorizontal` | Connector behaviors |
| `attachStandardDiagramMutations`, `attachCanvasDropBehavior` | Mutation wiring |

---

*See also:* [diagram-user-manual.md](diagram-user-manual.md) for the
end-user gesture and keyboard reference, and the working
[diagram demo](https://github.com/pragmatic-tech-ai/mural/blob/main/demo/demos/diagram/) for a complete wiring.
