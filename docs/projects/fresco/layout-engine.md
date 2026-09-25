# Fresco Layout Engine — Architecture

Fresco (`@pragmatic-tech-ai/fresco`) is a graph-visualization library built on
Mural. Its core is a **hierarchical (layered) layout engine** in the Sugiyama
tradition: it arranges a directed graph into horizontal layers, orders nodes
within each layer to reduce edge crossings, assigns coordinates, and routes
edges.

The engine is built as a **strategy pipeline**. The orchestrator holds no
algorithm of its own; each concern — layering, crossing reduction, coordinate
assignment, routing — is a small interface with one or more interchangeable
implementations. A configuration selects which implementation fills each slot.

## Public API

The layout entry points are exported from `src/index.ts`:

- **`FlatLayoutPipeline`** (`src/layouts/flat-layout-pipeline.ts`) — the layered
  layout orchestrator.

  ```typescript
  Apply(graph: Graph): LayoutResult
  ```

- **`NestedCompoundLayout`** (`src/compound/nested-compound-layout.ts`) — nested
  container layout that recursively applies the flat pipeline; a safe drop-in
  when the graph has no containers.

  ```typescript
  Apply(graph: Graph): LayoutResult
  ```

- **`ManualLayout`**, **`CircularLayout`**, **`GridLayout`** — simple alternative
  layouts for pinning and experiments (`src/layouts/`).

## Core data structures

Defined in `src/graph.ts` and `src/geometry.ts`; the graph model is plain data
built on Mural's `MuralBase` property/binding system.

- **`Node`** — `Id: string`, optional `Label`. Compound fields for nested
  layout: `ParentId?`, `Size?: { width, height }`, `LocalPosition?`,
  `LayoutContent: boolean`.
- **`Edge`** — `From: string`, `To: string`.
- **`Graph`** — `nodes: Node[]`, `edges: Edge[]`, plus `IsDirectedAcyclic()` and
  `FindCycles()`.
- **`LayoutResult`** (`src/layouts/layout.ts`) — `positions: Map<string, Point>`
  (one per real node), optional `routes?: Map<Edge, EdgeRouting>`, optional
  `boxes?: Map<string, Rect>` (compound layouts), and `crossings?` diagnostics
  (adjacent/geometric, before/after).
- **Geometry** — `Size`, `Rect`, and `boundingBox()`.

Every pipeline strategy implements **`IPipelineElement`**
(`src/pipeline-element.ts`), which surfaces a human-readable `Name`, the
underlying `AlgorithmName`, and its `AcademicReferences`. This metadata is
catalogued in `pipeline-elements.yaml` and validated against the classes at
load time.

## The pipeline

`src/index.ts` labels the stages 1–11. `FlatLayoutPipeline.Apply` runs them in
this order (several are optional and default to off):

### Stage 1 — Graph transforms (preprocessing)

`IGraphTransform` (`src/graph-transforms/`). Composable cleanup passes that each
read a graph and return a new one without mutating the input:
`FilterNodesTransform`, `FilterEdgesTransform`, `DedupEdgesTransform`,
`CollapseAntiparallelEdgesTransform`, `DropIsolatedNodesTransform`,
`MapLabelsTransform`, and **`MakeAcyclicTransform`**, which breaks cycles via a
feedback-arc-set heuristic. The layered pipeline requires a DAG, so cyclic input
must pass through `MakeAcyclicTransform` first.

### Stage 2 — Layer assignment

`ILayerAssigner`. Default **`LongestPathLayerAssigner`**: longest-path layering
by memoized DFS on the reverse adjacency graph. Sources map to layer 0; every
other node to `1 + max(depth(predecessors))`. Requires a DAG (throws on cycles).
An optional `firstLayerNodes` set pins chosen nodes to layer 0.

### Stage 3 — Layer improver (optional, fixpoint)

`ILayerImprover`. Default **`AdjacentLayerMoveImprover`**: sifting-range depth
moves scored by real-edge crossing cost. It runs in an outer fixpoint managed by
the orchestrator — when a node changes layer, the column-ordering stages (4–7)
re-run and the improver is called again, until no depth changes (capped by
`maxPasses`, default 10).

### Stage 4 — First-layer ordering

`IFirstLayerOrderer`. Default **`IdentityFirstLayerOrderer`** (keep insertion
order); alternative **`OutDegreeFirstLayerOrderer`** sorts the source layer by
out-degree. A pluggable seed for the ordering sweep.

### Stage 5 — Dummy insertion

`IDummyInserter`. Default **`SparseDummyInserter`**: linear-segments
normalization (Eiglsperger et al., 2005) that inserts **at most two dummies per
edge** — none for a span-1 edge, one r-vertex for span 2, and a p/q pair for
longer spans with the middle segment drawn as a single vertical line. This keeps
the dummy count O(|V|+|E|) while making multi-layer edges visible to the
adjacent-layer reorderer. Alternative **`ChainDummyInserter`** does classical
one-dummy-per-layer normalization.

### Stage 6 — Within-layer reordering (crossing minimization)

`IReorderer`. Default **`BarycenterReorderer`**: the Sugiyama barycenter
heuristic. Alternating down/up sweeps reorder each layer by the mean index of a
node's neighbours in the adjacent reference layer; nodes with no neighbours stay
put. Iterates until a down+up pair yields no change (cap `iterations`, default
12). Alternative **`MedianReorderer`** uses the median instead of the mean.

### Stage 7 — Local improver (optional)

`ILocalImprover`. Off by default. Variants:
**`TransposeImprover`** (iterated adjacent-pair swaps that reduce local crossing
cost; Gansner et al., 1993), **`GreedySwitchImprover`**, **`SiftingImprover`**,
and **`IlpExactImprover`** (exact single-layer ordering via integer linear
programming).

### Stage 8 — Position computation (coordinate assignment)

`IPositionComputer`. Default **`BrandesKopfPositionComputer`**: the full 4-pass
balanced Brandes–Köpf algorithm (2002). Each pass does a vertical-alignment step
(nodes join a median neighbour's block) and a horizontal-compaction step; the
four passes (down/up × left/right) plus the balanced average give five candidate
x-assignments, and the engine keeps whichever minimizes total horizontal edge
travel. Y is assigned per layer from node heights and `layerSpacingY`, and
horizontal separation grows with node `Size`. Options: `layerSpacingY` (100),
`nodeSpacingX` (110), `padding` (50). Alternative
**`CenteredGridPositionComputer`** places nodes on a uniform grid.

### Stage 9 — Vertical alignment (optional)

`IVerticalAligner`. Off by default (Brandes–Köpf already produces chain-aligned
columns). **`BarycenterVerticalAligner`** iteratively pulls each node's x toward
the mean of its neighbours, clamped by minimum in-layer spacing and an
edge/node clearance test; y stays fixed. Useful when paired with a simpler
position computer.

### Stage 10 — Edge routing (optional)

`IEdgeRouter`. Off by default. **`PolylineEdgeRouter`** follows each edge's chain
through its dummy waypoints as straight segments (a straight line for span-1
edges, layer-following bends for longer ones). Alternatives:
**`OrthogonalEdgeRouter`** (rectilinear), **`StraightLineEdgeRouter`**, and
**`CardinalSideRouter`** (emits source/target side assignments for a host
diagram to route).

### Stage 11 — Port assignment (optional)

`IPortAssigner`. Off by default. **`CardinalPortAssigner`** places connection
points on the nearest of four cardinal boundary points of circular nodes, based
on the dominant direction to the neighbour (`nodeRadius` default 28); edges
sharing a node and direction meet at the same point. Alternative
**`DistributedPortAssigner`** spreads ports along the boundary arc.

## Diagnostics: crossing counters

`src/crossing-counter/` provides two measurements, recorded before and after the
ordering stages in `LayoutResult.crossings`:

- **`AdjacentCrossingCounter`** counts crossings on adjacent-layer pairs in the
  dummy-expanded ordering — the quantity the reorderer and improvers optimize.
- **`GeometricCrossingCounter`** counts real segment-segment intersections on
  the final coordinates (including multi-layer edges) and adds a penalty when an
  edge passes within `nodeRadius` of a non-incident node.

## Compound (nested) layout

`NestedCompoundLayout` lays out nested containers by recursion:

1. **Size bottom-up** — deepest containers first. Each container's interior is
   laid out in isolation with the flat pipeline, then sized into a box (interior
   bounds + `padding`, default 40).
2. **Place top-down** — a rigid translation positions each container's interior
   into its parent frame. A frozen container (`LayoutContent === false`) halts
   recursion and is sized from its manual `LocalPosition`s.
3. **Cross-boundary routing** — once every node and box has a global position,
   boundary-crossing edges are routed through geometric pierce points on the
   container borders, so even frozen containers get connection points for free.

Hierarchy queries live in `src/compound/` (`childrenOf`, `isContainer`,
`ancestors`, `lca`, `globalRank`, `portSideFor`).

## Configuration

A pipeline is assembled from a configuration rather than hand-wired:

- **`pipeline-elements.yaml`** catalogues every strategy implementation with its
  `Name`, `AlgorithmName`, and `AcademicReferences`.
- **`configuration-loader.ts`** — `LoadElementRepository(yaml)`,
  `BuildPipeline(config)`, `ListStrategyNames()`, and
  `ValidateRepositoryAgainstClasses()` (which throws if the catalogue and the
  actual classes disagree). `BuildPipeline` supplies sensible defaults for
  omitted stages.
- **`configuration-loader-node.ts`** holds the Node/CLI-only file loaders and is
  deliberately kept out of the browser-safe barrel.

## References

The engine's algorithms come from the standard layered-graph-drawing literature:

- Sugiyama, K., Tagawa, S., Toda, M. (1981). *Methods for Visual Understanding of
  Hierarchical System Structures.* IEEE Trans. SMC 11(2).
- Gansner, E. R., Koutsofios, E., North, S. C., Vo, K.-P. (1993). *A Technique
  for Drawing Directed Graphs.* IEEE Trans. SE 19(3).
- Brandes, U., Köpf, B. (2002). *Fast and Simple Horizontal Coordinate
  Assignment.* Graph Drawing 2001, LNCS 2265.
- Eiglsperger, M., Siebenhaller, M., Kaufmann, M. (2005). *An Efficient
  Implementation of Sugiyama's Algorithm for Layered Graph Drawing.* J. Graph
  Algorithms Appl. 9(3).
- Eades, P., Lin, X., Smyth, W. F. (1989). *A Fast and Effective Heuristic for
  the Feedback Arc Set Problem.* Information Processing Letters.
- Matuszewski, C., Schönfeld, R., Molitor, P. (1999). *Using Sifting for k-Layer
  Straightline Crossing Minimization.* Graph Drawing '99, LNCS 1731.
