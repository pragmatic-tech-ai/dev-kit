# yFiles HierarchicalLayout — Algorithm Notes

Working notes on how yFiles for HTML 3.1's hierarchical layout algorithm works.
Synthesized from the public TypeScript declarations in
[lib-dev/package/yfiles.d.ts](lib-dev/package/yfiles.d.ts) and the deobfuscated
implementation in [lib-dev/package/impl/layout-hierarchical.js](lib-dev/package/impl/layout-hierarchical.js)
(and its sibling files in `lib-dev/package/impl/`).

The implementation files have been progressively de-minified through four
deobfuscation passes — see the [Deobfuscation notes](#deobfuscation-notes) at
the end. All file/line references below assume the deobfuscated state.

---

## 1. What this is

`HierarchicalLayout` is yWorks' implementation of the **Sugiyama-style layered
graph drawing framework** — the standard approach for drawing directed graphs
where flow direction matters (org charts, dependency graphs, ETL pipelines,
state machines, network diagrams).

The big idea behind Sugiyama, originally from Sugiyama–Tagawa–Toda (1981) and
heavily extended by Gansner–Koutsofios–North–Vo (1993, the *dot* paper) and
Brandes–Köpf (2002), is to compute a drawing in four well-defined phases:

1. **Layering** — assign each node to a horizontal *layer* (an integer rank)
2. **Sequencing** — within each layer, choose a node *order* that minimizes
   edge crossings
3. **Coordinate assignment** — turn layer + sequence indices into concrete
   `(x, y)` positions, optimizing for symmetry and compactness
4. **Edge routing & port assignment** — choose port coordinates on each node
   and route edges through the assigned layers

yFiles wraps that with a configurable **stage pipeline** for pre- and
post-processing (component layout, labelling, orientation, port preparation,
subcomponent handling), and exposes every phase behind an interface so that
each one can be swapped out by a custom implementation.

---

## 2. Top-level architecture

`HierarchicalLayout` is a thin orchestrator over two things:

- **`HierarchicalLayoutCore`** — implements the four-phase core algorithm.
  Lives at [yfiles.d.ts:47985](lib-dev/package/yfiles.d.ts#L47985); declared as
  `[Expert]` and accessed via `HierarchicalLayout.core`.
- **`HierarchicalLayout.layoutStages`** — a `LayoutStageStack` (an
  `ILayoutStage` pipeline) wrapped around the core. Default stages are added
  in the constructor at
  [impl/layout-hierarchical.js:20097](lib-dev/package/impl/layout-hierarchical.js#L20097).

When the user calls `applyLayout(graph)`:

```
HierarchicalLayout.applyLayout(graph)
   ↓ delegates to
LayoutStageStack.applyLayout                       ← the wrapping stages
   ├─→ [prepended] PK   (port preparation)
   ├─→ [prepended] SAA  (subcomponent / layer-constraint setup)
   ├─→ SubgraphLayoutStage (disabled by default)
   ├─→ ComponentLayout    (disabled by default)
   ├─→ GenericLabeling    (label placement, with stopDuration=0)
   ├─→ CL                 (label-spacing / additional labeling)
   ├─→ OrientationStage   (rotates output for non top-to-bottom layouts)
   ├─→ TM                 (port-coordinate transform stage)
   ├─→ MAA                (port assignment stage)
   ├─→ MY                 (layout-grid assignment)
   └─→ HierarchicalLayout.applyLayoutCore ───────→ HierarchicalLayoutCore
                                                       ↓
                                                  1. layering
                                                  2. sequencing
                                                  3. coordinate assignment
                                                  4. port assignment + routing
```

The five short-name stages (`CL`, `TM`, `MAA`, `MY`, `SAA`, `PK`) are
**framework-private** — they're not in the public `.d.ts`. Best guesses from
the deobfuscated implementation:

| Mangled tag | Likely purpose |
|---|---|
| `PK` | Port-candidate preparation (run before everything) |
| `SAA` | Subcomponent / layer-constraint prep |
| `CL` | Inner labelling stage (paired with public `GenericLabeling`) |
| `TM` | Port-coordinate transformation between layer/screen space |
| `MAA` | Automatic port assignment finalization |
| `MY` | Layout-grid cell assignment |

The order is significant: stages are appended **after** the core runs, and
`prepend(...)` calls add to the start of the pipeline. So `PK` and `SAA`
execute before the core's layering; `CL` and `MY` execute after the core has
produced coordinates.

### The Sugiyama core: `HierarchicalLayoutCore`

`HierarchicalLayoutCore` exposes each algorithmic phase behind a swappable
interface. The default implementations are sketched below; users can swap
them out for custom algorithms via the setters.

```
HierarchicalLayoutCore
├─ fromScratchLayerAssigner    : ILayerAssigner    ← phase 1
├─ fixedElementsLayerAssigner  : ILayerAssigner    ← phase 1 (from-sketch)
├─ fromScratchSequencer        : ISequencer        ← phase 2
├─ fixedElementsSequencer      : ISequencer        ← phase 2 (from-sketch)
├─ coordinateAssigner          : ICoordinateAssigner ← phase 3
├─ portAssigner                : IHierarchicalLayoutPortAssigner ← phase 4
├─ drawingDistanceCalculator   : IDrawingDistanceCalculator     ← spacing
└─ portCandidateSelector       : IPortCandidateSelector | null  ← optional
```

Plus `stopAfterLayering` / `stopAfterSequencing` flags for partial-pipeline
runs (useful for tools that only need the layering, like a swimlane
calculator).

---

## 3. Phase 1: Layering

**Goal:** assign each node an integer layer index. The default layout
orientation is top-to-bottom, so layer 0 is at the top.

**Interface:** `ILayerAssigner.assignLayers(graph, resultLayerIds)`.

**Default implementation:** `ConstraintIncrementalLayerAssigner` wrapping a
`TopologicalLayerAssigner`, all of it wrapped again in a
`MultiComponentLayerAssigner` so that disconnected components are layered
independently and then combined.

### Layering strategies (`HierarchicalLayoutLayeringStrategy`)

The user picks a strategy by setting `HierarchicalLayout.fromScratchLayeringStrategy`.
Each strategy is a textbook layering approach:

| Strategy | Algorithm | Notes |
|---|---|---|
| `HIERARCHICAL_TOPMOST` | **Longest-path layering** — each node placed in the highest layer not above its predecessors | Fewest layers; layout tends to be tall and thin |
| `HIERARCHICAL_OPTIMAL` | **Network simplex** (Gansner et al. 1993) minimizing Σ \|layer(target) − layer(source)\| over all edges | Highest quality; expensive on large graphs |
| `HIERARCHICAL_TIGHT_TREE` | Heuristic approximating `OPTIMAL` via a tight spanning tree | Compromise: near-optimal quality, much faster |
| `HIERARCHICAL_DOWNSHIFT` | Fast post-pass over `TOPMOST` shifting nodes down | Cheap; quality below `TIGHT_TREE` |
| `BFS` | Breadth-first layering — edges span ≤ 1 layer | Allows same-layer edges; layers are BFS levels |
| `FROM_SKETCH` | Derive layers from existing y-coordinates | Used implicitly when `fromSketchMode = true` |
| `USER_DEFINED` | User supplies `HierarchicalLayoutData.layerIndicesResult` | Allows pre-computed layering |

### Constraint handling

`ConstraintIncrementalLayerAssigner` respects user constraints from
`HierarchicalLayoutData.layerConstraints`:

- "Place A in the same layer as B"
- "Place A above B"
- "Place A in the topmost / bottommost layer"
- "Place A strictly N layers above B"

The constraint pass runs **before** delegating to the chosen layering
strategy; the strategy then layers the constraint-free residual graph.

### Multi-component handling

`MultiComponentLayerAssigner` runs the inner layerer once per connected
component, then combines the per-component layerings according to the
configured `ComponentLayout`. This is also why `ComponentLayout` is one of
the stages — the actual *positioning* of components happens after the layout
core finishes.

### Grouped graphs

If the graph has group nodes, layering interacts with
`HierarchicalLayout.groupLayeringPolicy`:

- `IGNORE_GROUPS` — group hierarchy ignored for layering
- `RECURSIVE` — group's children get consecutive layers; intervals nest
  cleanly. Wider layouts, but groups are vertically compact
- `COMPACT_RECURSIVE` — like `RECURSIVE` but additionally compacts each
  group's internal layering. Even wider but shorter

Also: `groupAlignmentPolicy` (`TOP` / `CENTER` / `BOTTOM`) controls how
group children align to the group's inner layers.

---

## 4. Phase 2: Sequencing (crossing minimization)

**Goal:** for each layer, decide the left-to-right order of nodes such that
the total number of edge crossings is minimized.

This is **NP-hard for ≥ 2 layers** (Garey & Johnson 1983), so all real
implementations use heuristics. yFiles doesn't publicly document its specific
heuristic — the `.d.ts` just says "a suitable private implementation of
`ISequencer`" — but based on the standard literature and yFiles' published
behavior, this is almost certainly a **multi-pass barycenter / median
heuristic** with weighted crossings:

> Repeatedly sweep up and down the layers. For each layer, set each node's
> x-position to the barycenter (or median) of its neighbors in the adjacent
> layer. Sort nodes by that position. Repeat until convergence or a step limit.

### What yFiles adds on top of standard barycenter

1. **Weighted crossings** via `HierarchicalLayoutData.edgeCrossingCosts`.
   The cost of an `edge_A × edge_B` crossing is `cost(A) * cost(B)`. Default
   cost is 1, so each crossing is a unit. Higher costs make a crossing
   strongly disfavored. ([yfiles.d.ts:47155](lib-dev/package/yfiles.d.ts#L47155))

2. **Group border crossings**, weighted separately by
   `HierarchicalLayoutData.groupBorderCrossingCosts` (default 5, so edge-vs-group-border
   crossings are 5× the cost of edge-vs-edge crossings).
   ([yfiles.d.ts:47181](lib-dev/package/yfiles.d.ts#L47181))

3. **Critical edge alignment** via
   `HierarchicalLayoutData.criticalEdgePriorities`. Edges marked as critical
   are vertically aligned (their endpoints share an x-coordinate where
   possible). Conflicts between multiple critical edges are resolved in
   favor of higher priority. Critical edges don't automatically get
   higher crossing cost — opt in with `reduceCriticalEdgeCrossings = true`,
   which copies priorities to costs.
   ([yfiles.d.ts:47211](lib-dev/package/yfiles.d.ts#L47211))

4. **Sequence constraints** via `HierarchicalLayoutData.sequenceConstraints`
   pin specific relative orderings ("A is left of B in their shared layer").

5. **Bus / grid-component sequencing** — when edges share a
   `GridComponentDescriptor`, their grid nodes get a compact bus-style
   ordering that places out-edges below the root and in-edges above (for
   top-to-bottom orientation). This is handled inside the sequencer, not as
   a separate stage. ([yfiles.d.ts:47259](lib-dev/package/yfiles.d.ts#L47259))

6. **Node-type preference** via `HierarchicalLayoutData.nodeTypes`:
   nodes sharing a type are preferentially placed adjacent in their layer.

7. **Incremental sequencing** — in from-sketch mode, edges marked
   `IncrementalEdgeHint.KEEP_RELATIVE_ORDER` use the existing route to
   decide their position within the layer; others (`INCREMENTAL`) are
   re-sequenced freely.

If `stopAfterLayering = true`, this phase is skipped entirely — useful when
the caller just wants layer indices.

---

## 5. Phase 3: Coordinate assignment

**Goal:** turn `(layer, sequence)` indices into concrete `(x, y)` coordinates,
respecting minimum distances and optimizing for symmetry/compactness.

**Interface:** `ICoordinateAssigner.assignCoordinates(...)`.

**Default implementation:** `CoordinateAssigner` ([yfiles.d.ts:47985-ish; see
SymmetryOptimizationStrategy](lib-dev/package/yfiles.d.ts)).

### What CoordinateAssigner does

The default coordinate assigner is in the lineage of Brandes–Köpf
(*"Fast and Simple Horizontal Coordinate Assignment"*, 2002), which computes
**four candidate alignments** (up/down × left/right) of inner segments,
balances them, and picks coordinates that minimize total edge bend.

yFiles extends this with several stages, visible in the public docs and the
deobfuscated implementation:

1. **Symmetry detection & alignment** (optional — see strategy below)
2. **Brandes–Köpf-style horizontal compaction**
3. **Node compaction** (interleaving nodes within layers to reduce width)
4. **Label compaction**
5. **Optional long-segment subdivision** for more compact routing
6. **Distance enforcement** via `DrawingDistanceCalculator`

### `SymmetryOptimizationStrategy`

Strategy is chosen on `CoordinateAssigner`. Tradeoff is quality vs. cost:

| Strategy | What it does | Cost |
|---|---|---|
| `STRONG` | Detect symmetric substructures (trees, chains) and arrange them symmetrically. Run coordinate assignment **twice** (mirror) and average. | Most expensive (default) |
| `WEAK` | Skip symmetry-substructure detection but still run twice and average. | Middle |
| `NONE` | Single-pass; no symmetry post-processing. | Fastest |

The `.d.ts` explicitly mentions that this is the most likely knob to turn for
performance: switch to `NONE` or `WEAK` if symmetry isn't a priority and you
have a large graph.

### Distance enforcement

`DrawingDistanceCalculator` (the default `IDrawingDistanceCalculator`)
computes minimum gaps between same-layer pairs. The three knobs at the
`HierarchicalLayout` level — `nodeDistance`, `nodeToEdgeDistance`,
`edgeDistance` — all delegate to this. There's also `minimumLayerDistance`
on `HierarchicalLayout` and `minimumLayerHeight` on each
`HierarchicalLayoutNodeDescriptor` for inter-layer spacing.

Per-edge thickness via `HierarchicalLayoutData.edgeThickness` is honored
here — a thicker edge needs more clearance to neighbors.

If `stopAfterSequencing = true`, coordinate assignment is skipped.

---

## 6. Phase 4: Port assignment & edge routing

**Goal:** decide where each edge enters/exits each node (its *port*
coordinate) and route the edge through the assigned layers.

**Interface:** `IHierarchicalLayoutPortAssigner.assignPorts(...)`.

**Default implementation:** `HierarchicalLayoutPortAssigner` (uses
`HierarchicalLayoutPortAssignmentMode` and the per-node `portAssignment`
setting from `HierarchicalLayoutNodeDescriptor`).

### Routing styles (`HierarchicalLayoutRoutingStyle`)

Set per-edge via `HierarchicalLayoutEdgeDescriptor.routingStyleDescriptor`:

| Style | Segment types |
|---|---|
| `ORTHOGONAL` | Only horizontal and vertical |
| `OCTILINEAR` | Orthogonal **plus** diagonals at ±45° |
| `POLYLINE` | Straight segments at any angle |
| `CURVED` | Cubic Béziers with optional control points; integrated labelling |

Each style has its own minimum-segment-length, minimum-slope, and minimum-distance
configuration on the edge descriptor.

### Port assignment modes (`HierarchicalLayoutPortAssignmentMode`)

Set per-node via `HierarchicalLayoutNodeDescriptor.portAssignment`:

| Mode | Behavior |
|---|---|
| `DEFAULT` | Uniform distribution along node border, separated by `minimumPortDistance`, with `borderToPortGapRatio` controlling distance to corners |
| `ON_GRID` | All ports snap to grid lines (requires `gridSpacing > 0`); overlaps possible if not enough grid lines |
| `ON_SUBGRID` | Ports snap to grid **or** sub-grid lines; subdivides as needed to avoid overlaps |

### Port candidates

If `PortData.nodePortCandidates` is set, `IPortCandidateSelector` can pre-
and post-select which `LayoutPortCandidate` each edge uses. This is `null`
by default and only matters for advanced port pinning.

### Edge-route post-processing

- **Bend reduction**: `HierarchicalLayoutCore.reduceBendCount` removes
  collinear bends; called twice during layout
- **Back-loop routing**: enable on a per-edge descriptor for reversed/self-loop
  edges to "loop back" rather than route straight
- **Recursive group edges**: `recursiveEdgePolicy` on the edge descriptor
  controls routing for edges that enter/exit a group
- **Bus routing** for edges sharing a `GridComponentDescriptor`: produces the
  compact bus topology described in phase 2

---

## 7. The `LayoutStageStack` pipeline

Around the core, several stages wrap the algorithm. The class doc at
[yfiles.d.ts:47000](lib-dev/package/yfiles.d.ts#L47000) lists the four public
default stages:

| Stage | Role | Enabled by default? |
|---|---|---|
| `SubgraphLayoutStage` | Layout a subset of nodes while keeping the rest fixed | **No** |
| `ComponentLayout` | Arrange disconnected components | **No** |
| `GenericLabeling` | Place node/edge labels | Yes (with `stopDuration=ZERO`) |
| `OrientationStage` | Rotate/mirror the output for non top-to-bottom orientations | Yes (with `edgeLabelPlacement=IGNORE`) |

`SubgraphLayoutStage` and `ComponentLayout` are disabled by default because
the *core* algorithm handles single-component graphs natively;
`MultiComponentLayerAssigner` is what handles multi-component graphs in
the layering phase. `ComponentLayout` only becomes useful if the user wants
to override the default component-arrangement behavior.

Users add custom stages with:
- `HierarchicalLayout.layoutStages.prepend(stage)` — runs before the core
- `HierarchicalLayout.layoutStages.append(stage)` — runs after the core

This is the supported extension point for custom pre/post processing.

---

## 8. `HierarchicalLayoutData` — the configuration surface

`HierarchicalLayoutData` is the structured input to a layout run. Created via
`layout.createLayoutData()`; supplied to `graph.applyLayout(layout, data)`.

It has 31 input properties and 2 output properties. I'll group them by role.

### Per-item descriptors

| Property | Use |
|---|---|
| `nodeDescriptors` | Per-node `HierarchicalLayoutNodeDescriptor` overriding the layout's `defaultNodeDescriptor` |
| `edgeDescriptors` | Per-edge `HierarchicalLayoutEdgeDescriptor` overriding the layout's `defaultEdgeDescriptor` |
| `nodeMargins` | Per-node `Insets` reserved around the node |
| `nodeTypes` | Tag controlling adjacent-preference in sequencing |

### Crossing minimization (see phase 2)

`edgeCrossingCosts`, `groupBorderCrossingCosts`, `criticalEdgePriorities`,
`reduceCriticalEdgeCrossings`.

### Edge spacing / direction

| Property | Use |
|---|---|
| `edgeThickness` | Per-edge thickness for distance enforcement |
| `edgeDirectedness` | 1 (forward) / −1 (backward) / 0 (undirected); influences layering |

### Constraints

| Property | Use |
|---|---|
| `layerConstraints` | Layer-relative pinning (same layer, above, etc.) |
| `sequenceConstraints` | Within-layer order pinning |
| `givenLayersIndices` | Hard-coded layer indices (used with `GivenLayersAssigner`) |
| `bfsLayerAssignerCoreNodes` | Override "core nodes" for `BFS` strategy |

### Edge grouping / bus routing

| Property | Use |
|---|---|
| `sourceGroupIds` / `targetGroupIds` | Group edges sharing source / target for bundled routing |
| `gridComponents` | Per-edge `GridComponentDescriptor` for compact bus-style layout |
| `gridComponentRootOffsets` | Layer offset for grid nodes relative to root |
| `nodesBeforeBus` | Explicit placement of grid nodes before the common segment |

### Ports

| Property | Use |
|---|---|
| `ports` | Sub-data for `PortData` (port placement hints, port groups, port candidates) |
| `uniformPortAssignmentGroups` | Group nodes wanting uniformly spaced ports |

### Labels

`edgeLabelPreferredPlacements` — per-label `EdgeLabelPreferredPlacement`
controlling where labels go.

### Incremental / from-sketch mode

| Property | Use |
|---|---|
| `incrementalNodes` | Nodes treated as "new" (placed freshly, others fixed) |
| `incrementalNodeHints` | Detailed per-node hints (`INCREMENTAL`, `INCREMENTAL_WITH_LAYERS_FROM_SKETCH`, `EXACT_COORDINATES`, etc.) |
| `incrementalEdges` | Edges to re-route freshly |
| `folderNodes` | Group nodes that are currently collapsed |
| `alternativeEdgePaths` | Edge routes from before collapse/expand for stability |
| `alternativeGroupBounds` | Group bounds from before collapse/expand |

### Subcomponents / nested layouts

| Property | Use |
|---|---|
| `subcomponents` | Per-component sub-layout (e.g., a tree subcomponent inside a hierarchical layout) |
| `tabularGroups` | Group nodes whose children should be arranged in a grid |
| `tabularGroupChildComparators` | Sort order within tabular groups |
| `layoutGridData` | Cell assignments for the layout grid feature |

### Outputs

| Property | What you get |
|---|---|
| `layerIndicesResult` | Per-node layer index after the run |
| `sequenceIndicesResult` | Per-node position within its layer |

(You can also use `stopAfterLayering` / `stopAfterSequencing` to skip later
phases and read just these results.)

---

## 9. Descriptors: per-item configuration

### `HierarchicalLayoutNodeDescriptor`

| Property | Effect |
|---|---|
| `layerAlignment` | Vertical alignment of the node within its layer (0 = top, 0.5 = center, 1 = bottom) |
| `minimumLayerHeight` | Enforce a minimum height for the node's whole layer |
| `minimumPortDistance` | Minimum spacing between adjacent ports on the node's borders (enlarges node if needed) |
| `borderToPortGapRatio` | Ratio of "border to nearest port" gap vs. "between ports" gap. 0 ⇒ ports at corners. ∞ ⇒ ports centered |
| `portAssignment` | `DEFAULT` / `ON_GRID` / `ON_SUBGRID` |
| `gridReference` | Reference point offset (for grid snapping) |
| `minimumDistance` | Clearance for group nodes and grid borders |
| `tabularGroupChildDistance` | Spacing for children when this is a tabular group |

### `HierarchicalLayoutEdgeDescriptor`

| Property | Effect |
|---|---|
| `routingStyleDescriptor` | The `HierarchicalLayoutRoutingStyle` plus its style-specific params |
| `minimumLength` | Total minimum edge length (orthogonal sum / polyline vertical) |
| `minimumFirstSegmentLength` | Minimum length of segment leaving source |
| `minimumLastSegmentLength` | Minimum length of segment entering target |
| `minimumSlope` | For polyline / curved: minimum vertical steepness |
| `minimumDistance` | Preferred clearance from nodes and other edges |
| `minimumOctilinearSegmentLength` | Diagonal-segment minimum (octilinear only) |
| `recursiveEdgePolicy` | How to route edges that cross group boundaries |
| `directGroupContentEdgeRouting` | Route directly to group border when connecting to a descendant |
| `backLoopRouting` | Route reversed edges as back-loops |

These can be supplied on the layout's `defaultEdgeDescriptor` /
`defaultNodeDescriptor`, or per-item via `HierarchicalLayoutData.{edge,node}Descriptors`.

---

## 10. From-sketch mode

`HierarchicalLayout.fromSketchMode = true` switches the algorithm to a
"respect existing layout" mode. Internally:

- Layer assignment is delegated to `fixedElementsLayerAssigner`
  (derives layers from current y-coordinates) instead of
  `fromScratchLayerAssigner`
- Sequencing is delegated to `fixedElementsSequencer`
- Nodes/edges marked **incremental** in `HierarchicalLayoutData` get
  freshly assigned positions; everything else maintains its relative layout
- The `FROM_SKETCH` value of `HierarchicalLayoutLayeringStrategy` is also
  available for use with the from-scratch layer assigner, if you want to
  use sketch as a *starting point* but allow it to be revised

Combined with `incrementalNodeHints`, this is the foundation of yFiles'
support for incremental UI updates — you can re-layout after adding nodes
without disrupting unrelated parts of the existing diagram.

---

## 11. Performance & quality tradeoffs

From the `.d.ts` JSDoc plus the implementation structure, the main knobs are:

1. **`stopDuration`** — soft time limit. When set, the algorithm switches to
   faster heuristics in several places and skips optimization steps. Most
   visible in edge routing quality
2. **`coordinateAssigner.symmetryOptimizationStrategy`** — drop from
   `STRONG` to `WEAK` or `NONE` for a substantial speed-up at the cost of
   layout symmetry
3. **`fromScratchLayeringStrategy`** — `OPTIMAL` is highest-quality but
   slowest; `TIGHT_TREE` is a near-optimal heuristic; `DOWNSHIFT` is
   fastest
4. **`stopAfterLayering` / `stopAfterSequencing`** — skip later phases
   entirely if you only need the layer/sequence indices
5. **`automaticEdgeGrouping`** — if you have many edges sharing endpoints,
   enabling automatic edge grouping reduces visual clutter and tends to
   speed up routing

The documentation explicitly notes that `stopDuration` is **soft**: the
algorithm still has to produce a valid result, so on a complex graph the
real time may exceed the requested duration.

---

## 12. "Expert" data keys

There are a handful of static `EdgeDataKey<number>` / `NodeDataKey<number>`
constants on `HierarchicalLayout` that predate the
`HierarchicalLayoutData`-based API. They're kept for advanced use but
the `.d.ts` recommends the data API in all cases:

| Static key | Equivalent on `HierarchicalLayoutData` |
|---|---|
| `EDGE_CROSSING_COST_DATA_KEY` | `edgeCrossingCosts` |
| `GROUP_BORDER_CROSSING_COST_DATA_KEY` | `groupBorderCrossingCosts` |
| `CRITICAL_EDGE_PRIORITY_DATA_KEY` | `criticalEdgePriorities` |
| `EDGE_THICKNESS_DATA_KEY` | `edgeThickness` |

These get attached to the underlying `LayoutGraph` as raw data keys, the
data API just wraps them. Useful to know if you're reading source that
predates the data-style API.

---

## 13. Putting it together: what a layout run actually does

A small worked example. Given a 12-node 14-edge graph that's a single
connected component, all defaults except `fromScratchLayeringStrategy =
HIERARCHICAL_OPTIMAL`:

```
1. HierarchicalLayout.applyLayout(graph)
2.   → LayoutStageStack.applyLayout(graph)
3.     → PK.applyLayout     : port-candidate preparation
4.     → SAA.applyLayout    : subcomponent setup (no-op here)
5.     → GenericLabeling    : (deferred — applies after core)
6.     → CL.applyLayout     : (deferred — applies after core)
7.     → OrientationStage   : pass-through, default orientation
8.     → TM.applyLayout     : (deferred)
9.     → MAA.applyLayout    : (deferred)
10.    → MY.applyLayout     : (deferred)
11.    → HierarchicalLayout.applyLayoutCore(graph)
12.      → HierarchicalLayoutCore.applyLayoutCore(graph)
13.        → prepare()                         : add temporary structures
14.        → createItemData(graph, ctx)        : attach node/edge contexts
15.        → fromScratchLayerAssigner.assignLayers(...)
              → ConstraintIncrementalLayerAssigner
                → MultiComponentLayerAssigner
                  → TopologicalLayerAssigner   : the actual network simplex
16.        → publishLayers(graph, ctx)         : copies into context.layers
17.        → fromScratchSequencer.sequenceNodeLayers(...)
              → barycenter / median sweeps respecting:
                 - edgeCrossingCosts
                 - groupBorderCrossingCosts
                 - criticalEdgePriorities
                 - sequenceConstraints
                 - nodeTypes preferences
18.        → publishSequences(graph, ctx)
19.        → portCandidateSelector?.selectBeforeSequencing
20.        → coordinateAssigner.assignCoordinates(...)
              → CoordinateAssigner
                → if STRONG: detect symmetries
                → 1st pass: Brandes-Köpf 4-alignment + balance
                → 2nd pass (STRONG/WEAK): mirror & balance
                → node compaction
                → label compaction
                → distance enforcement via DrawingDistanceCalculator
21.        → portAssigner.assignPorts(...)
              → HierarchicalLayoutPortAssigner
                → distribute ports per node (mode + borderToPortGapRatio)
22.        → portCandidateSelector?.selectAfterSequencing
23.        → reduceBendCount(graph)            : 1st pass
24.        → routeEdges(graph)                 : route per edge descriptor's
                                                  routingStyle/distance config
25.        → reduceBendCount(graph)            : 2nd pass
26.        → dispose()                         : remove temp structures
27.    ← back into stage stack post-pass
28.    → TM.applyLayout     : port-coord transformation
29.    → MAA.applyLayout    : auto port assignment
30.    → MY.applyLayout     : layout-grid assignment
31.    → OrientationStage   : (already done in pass 1)
32.    → CL.applyLayout     : label finalization
33.    → GenericLabeling    : place labels
34.  ← graph now has final coordinates on all nodes and edges
```

Stages 3-10 in the first pass are mostly "prepare" calls — the bulk of the
work is in the second pass that runs after the core.

---

## 14. What's still unclear

Even with the deobfuscation and `.d.ts`, some things stay opaque:

1. **The exact sequencing heuristic.** The `.d.ts` says "a suitable private
   implementation". I infer barycenter/median + weighted-crossing from
   yFiles' published descriptions and the field names visible in the
   deobfuscated `fromScratchSequencer` code, but I can't quote the exact
   iteration schedule. yWorks has been working on layout for 20+ years
   and likely has many small empirical tweaks layered in
2. **The exact symmetry detection** in `CoordinateAssigner.STRONG` mode.
   Likely tree-like substructure detection via subtree isomorphism
3. **The exact behavior of `CL`, `TM`, `MAA`, `MY`, `SAA`, `PK`.** These
   are framework-private. The names above are *best guesses* from the
   deobfuscated code's structure and method shapes; treat them as plausible
   rather than confirmed
4. **The exact role of `HierarchicalLayoutContext.itemFactory`.** It's used
   to bind `HierarchicalLayoutNodeContext` / `HierarchicalLayoutEdgeContext`
   to graph items during the run, but the specific factory pattern isn't
   documented in detail

For most users, none of these matter. The public API is well-specified
and the standard knobs (layering strategy, symmetry strategy, stop-duration,
data inputs) cover the vast majority of real-world configuration needs.

---

## 15. References

The yFiles hierarchical layout is built on these classical papers:

- **Sugiyama, Tagawa, Toda** (1981). *Methods for Visual Understanding of
  Hierarchical System Structures.* — the original Sugiyama framework
- **Gansner, Koutsofios, North, Vo** (1993). *A Technique for Drawing
  Directed Graphs.* — the *dot* paper; introduces network-simplex layering
  and the four-alignment idea for coordinate assignment
- **Brandes, Köpf** (2002). *Fast and Simple Horizontal Coordinate
  Assignment.* — the basis of yFiles' default `CoordinateAssigner`
- **Eiglsperger, Siebenhaller, Kaufmann** (2005). *An Efficient
  Implementation of Sugiyama's Algorithm for Layered Graph Drawing.* —
  much of yFiles' engineering style traces back to this paper's authors,
  who worked at yWorks
- **Garey, Johnson** (1983). *Crossing Number is NP-Complete.* — why
  phase 2 is heuristic

yWorks also publishes their own technical notes:
- The "yFiles Layout — Hierarchical Layout" section of the official docs
  ([docs.yworks.com](https://docs.yworks.com/yfileshtml/api/HierarchicalLayout))
- The book *Graph Drawing — Algorithms for the Visualization of Graphs*
  (Di Battista, Eades, Tamassia, Tollis, 1999) — yWorks team members
  contributed and the book covers the algorithms in detail

---

## Deobfuscation notes

The source files in `lib-dev/package/impl/` ship minified. Four
deobfuscation passes were applied to get them to the state described in
this document.

| Pass | Source of names | What changed | Renames |
|---|---|---|---:|
| 1 | Embedded `_$_xxx: ["PublicName", "MangledTag"]` registry | Replaced framework lookup keys with public names | ~25,000 |
| 2 | Same registry's `[publicName, mangledTag]` second element | Renamed non-conflicting (length ≥ 3) internal class tags and method names; e.g., `$.T.WNC` → `$.T.RadialLayout`, `$hsC` → `subgraphEdges`. `KEY:` object-literal positions excluded to protect enum values | ~48,300 |
| 3 | Per-class accessor patterns: `"publicName!": { get: function() { return this.$f } }` | Per-class scope-aware field renaming: `$f` → `_publicName` inside each class's AST subtree, using babel AST analysis | ~22,000 |
| 4 | `yfiles.d.ts` method signatures | Method parameter renaming using babel's `scope.getBinding(...).referencePaths` for scope safety: e.g. `applyLayout: function(f)` → `applyLayout: function(graph)` | ~14,550 |
| **Total** | | | **~110,000** |

All files still parse with `node --check` after each pass. The
deobfuscation is non-destructive at the algorithmic level — only naming
changed — with two known caveats:

1. `impl/lang.js` is a 2-line reconstructed shim (`import lang from "./lang-dev.js"; export default lang;`) because the original 724-byte shim was overwritten during a recovery step and I had no clean source for it
2. `impl/lang-dev.js` was processed before pass 2's `KEY:` safeguard was
   added, so a handful of `EnumValue: 5` style positions in that file
   may have been incorrectly rewritten (`ARC: 5` → `Animator: 5`-type
   corruption). The file still parses but may have wrong enum values. No
   clean source was available to redo it

These caveats only affect runtime correctness, not readability. The class
defs, method bodies, and field names described here are all faithful to
the deobfuscated state of the actual code as of this writing.
