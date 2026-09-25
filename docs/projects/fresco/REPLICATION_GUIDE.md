# Building a Hierarchical Layout Engine — Implementation Guide

Companion document to [HIERARCHICAL_LAYOUT_NOTES.md](HIERARCHICAL_LAYOUT_NOTES.md).
That document describes how yFiles' hierarchical layout works; this one is
about how to **build something similar from scratch**.

Goal: give an engineer enough context, references, and decision-points to
start a serious implementation, not just a toy. By the end of an MVP you'd
have a tool that produces clean, readable, top-to-bottom diagrams of moderate-
sized DAGs (≤ a few thousand nodes). Reaching feature parity with yFiles is a
multi-person-year project — the reasons why are documented at the end.

---

## 1. Scope: pick your target

The single most important decision before you start. The Sugiyama framework
is a Swiss-army knife — every additional feature multiplies the implementation
complexity. Concrete tiers, in increasing order of difficulty:

| Tier | Capability | Effort estimate |
|---|---|---|
| **MVP** | Top-to-bottom layered drawing of an acyclic directed graph. Longest-path layering. Barycenter sequencing. Brandes-Köpf coordinate assignment. Straight-line edges. Single connected component. | 2–4 person-weeks for a clean reference impl |
| **v1** | Add: cycle removal (so any digraph works), multi-component support, configurable spacing, orthogonal edge routing, optional layer/sequence constraints, partial-orientation support (left-to-right) | +4–8 person-weeks |
| **v2** | Add: nested groups (grouped layering), labels (placement after layout), incremental updates ("from-sketch" mode), port placement | +3–6 person-months |
| **v3** | Add: edge bundling, bus-style routing, critical-edge alignment, symmetry detection, swimlanes / layout grid, time-bounded fast mode | +6–12 person-months |
| **v4** | Match yFiles' polish: subcomponent embedding, tabular groups, every routing style, every layering strategy, all the small heuristics for tricky cases | 1+ person-year |

**Recommendation:** ship MVP, get real users, then prioritize v1/v2 based on
what they actually ask for. Most diagram-drawing apps never need anything
past v2.

If you only need acyclic dag drawing (org charts, build pipelines, ETL),
**MVP is usually enough.** Don't underestimate it though — even MVP is
genuinely tricky to get right because of the coordinate assignment phase.

---

## 2. Prerequisite knowledge

- **Graph theory basics** — DAGs, topological order, BFS/DFS, strongly
  connected components. *Introduction to Algorithms* (CLRS) chapters 22–25
  cover everything you need
- **Linear programming** — only required if you implement the optimal
  network-simplex layering. The simplex method itself is described in any
  OR textbook; for the layering-specific specialization, read the dot paper
- **Computational geometry** — sweep-line algorithms, polygon offsetting.
  Needed for edge routing. *Computational Geometry: Algorithms and
  Applications* (de Berg et al.) covers it
- **The 1981 Sugiyama paper** — read it first. It's old and short and
  pictures the whole pipeline cleanly
- **The 1993 Gansner-Koutsofios-North-Vo "dot" paper** — the most
  important reference for a real implementation; covers all four phases
  in depth and is implementation-oriented
- **The 2002 Brandes-Köpf paper** — the basis of any modern coordinate
  assignment. It's also surprisingly readable (~10 pages)

Read those four papers before writing a line of code. They'll save you
weeks of dead-ends.

---

## 3. Core data structures

Get these right and the rest follows. Get them wrong and you'll rewrite.

### 3.1 The graph

You need a directed multigraph with stable identifiers, fast neighbor
iteration in both directions, and the ability to add/remove nodes and edges
during the algorithm (the layering phase may insert dummy nodes for
long edges).

Minimum interface:

```typescript
interface LayoutGraph {
  nodes: Iterable<Node>;
  edges: Iterable<Edge>;
  addNode(): Node;
  removeNode(n: Node): void;
  addEdge(src: Node, tgt: Node): Edge;
  removeEdge(e: Edge): void;
  inEdges(n: Node): Iterable<Edge>;
  outEdges(n: Node): Iterable<Edge>;
  source(e: Edge): Node;
  target(e: Edge): Node;
}
```

Plus property maps (attach arbitrary data to nodes/edges without baking it
into the structures). yFiles calls these "data keys" / "mappers". Use a
`Map<Node, T>` per attribute.

### 3.2 The layering result

After phase 1, you need a way to say "node X is in layer L". A simple
`Map<Node, number>` is fine for MVP. For v1+, you want a `Layer` object
that holds an ordered list of nodes, since phase 2 will repeatedly reorder
those lists.

```typescript
class Layer {
  index: number;
  nodes: Node[];  // ordered left-to-right after sequencing
}
```

`Layer` should also know about **dummy nodes** — synthetic nodes inserted
to split long edges. After phase 1, every edge should span exactly two
adjacent layers (its source's layer and its target's layer differ by 1).
For an edge `(A in layer 2) → (B in layer 5)`, you insert two dummies
`D3 in layer 3, D4 in layer 4` and replace the edge with `A→D3, D3→D4,
D4→B`. The original edge keeps a list of its dummies for later
reconstruction.

This dummy-node trick is **non-negotiable.** Every later phase assumes
edges span exactly one layer.

### 3.3 The sequencing result

After phase 2, each layer's `nodes` array is in final left-to-right order.
You may also store a `Map<Node, number>` of position-within-layer for fast
lookup.

### 3.4 The coordinate result

After phase 3, each node has `(x, y)`. Y is determined by layer; X by
sequence + coordinate assignment. Edges get a list of bend points (for
edges that pass through dummies, the dummies' coordinates become bends in
the original edge).

---

## 4. Implementing the phases

### 4.1 Phase 0: Preprocessing (cycle removal)

The layering phase assumes a DAG. If the input has cycles, you need to
**reverse** a minimum set of edges to break them, then remember which
edges were reversed so you can reverse them back at the end.

**Algorithm:** *Greedy cycle removal* by Eades, Lin, Smyth (1993):

```
1. Find sources (in-degree 0). Move to front of order.
2. Find sinks (out-degree 0). Move to end.
3. Repeat until only "internal" nodes remain.
4. Among internal nodes, pick one with maximum (out-degree - in-degree).
   Place it next at the front.
5. Final order is a vertex ordering. Edges going backward in this order
   are the cycle-breaking set — reverse them.
```

This is O(V+E) and produces near-optimal feedback edge sets in practice.

**Self-loops** can't be broken by reversal — handle them as a special case
in the edge router.

### 4.2 Phase 1: Layering

#### MVP: Longest-path layering

```
for each node n in topological order:
  layer(n) = max(layer(predecessor) + 1 for predecessor in in-neighbors)
            (or 0 if no predecessors)
```

O(V+E). Produces compact layouts. Tends to be top-heavy (many nodes in
upper layers, few at the bottom) which can look ugly for some graphs.

#### After MVP: Network simplex (optional but worth it)

This is the **Gansner-Koutsofios-North-Vo** algorithm. It minimizes
Σ |layer(target) − layer(source)| over all edges, which directly minimizes
total edge length. Implementation is non-trivial — read sections 2-3 of
the dot paper carefully. Reference code: Graphviz's `lib/common/ns.c`.

The key insight: the layering problem is an integer linear program, but
the constraint matrix is totally unimodular, so LP relaxation gives integer
solutions. Network simplex specializes the LP simplex method for this
constraint structure and runs in practice in O(E) time per pivot, very
few pivots.

If you're using a language with a good LP solver available (Python +
`scipy.optimize.linprog`), you can implement layering as a plain LP and
skip network simplex. Slower, but much less code.

#### Constraint handling

If users want "place A in same layer as B" or "A above B":

```
- "same layer A, B"        : add edges A→B and B→A with length-0 weights
                              (or post-process: take max of layers)
- "A above B"              : add edge A→B with length-1 weight
- "A at top"               : add edges from a synthetic source to A
                              with weight 1, and from A to all other
                              "internal" nodes with weight 0
```

Adding constraint edges to the network simplex formulation is clean. For
longest-path layering, post-processing is easier.

#### Dummy node insertion

After layering, walk every edge and insert dummies for each layer it
spans. Implementation detail: dummies need to be **flagged** so the
sequencer treats them differently (they're constrained to be visually
straight — they should appear roughly in line with their two real
endpoints — but they're not "real" nodes).

### 4.3 Phase 2: Sequencing (crossing minimization)

#### MVP: Barycenter heuristic

```
function barycenter(graph, layers, iterations=24):
  for i in 0..iterations:
    if i is even:
      // top-down sweep
      for each layer L from 1 to last:
        for each node n in L:
          x(n) = average of position(neighbor) for neighbor in L-1
        sort L by x(n)
    else:
      // bottom-up sweep
      for each layer L from last-1 down to 0:
        // mirror of above but using L+1 as reference
```

A few things to get right:

1. **Tie-breaking.** When two nodes have the same barycenter, sort by
   their existing position to maintain stability. Otherwise you'll get
   chaotic flipping
2. **Save the best.** Count crossings after each sweep; keep the best
   ordering, not the final one. Crossings can temporarily go up before
   improving
3. **Iteration count.** 24 is the dot paper's recommendation. Diminishing
   returns past that
4. **Crossing counting.** O(E²) naive. Use the **Barth-Mutzel-Jünger**
   bilayer crossing count algorithm (O(|E| log |V|)) for any graph beyond
   a few hundred nodes. The algorithm uses a Fenwick tree to count
   inversions

#### After MVP: Median heuristic

The "median" variant uses the median position of neighbors instead of the
average. Generally a bit better than barycenter at the cost of more
careful edge-case handling. Eiglsperger et al. 2005 has the canonical
implementation.

In practice: implement both, run both, pick the better result by crossing
count. The extra cost is negligible compared to the rest of the layout.

#### After MVP: Weighted crossings

If you want to support "this edge should preferably not be crossed",
your crossing-counting routine needs weights. Instead of `count += 1`
per crossing, do `count += cost(edge_A) * cost(edge_B)`. The barycenter
and median computations need to weight neighbors by edge weight too.

#### Constraints

"Sequence constraint A left of B in their shared layer" — easiest way is
to add B's barycenter contribution toward "right of A" via a soft penalty
in the median calculation, then apply a post-sort to fix any remaining
violations. For hard constraints, do a topological sort within each
layer using the constraint edges as additional precedence relations.

### 4.4 Phase 3: Coordinate assignment

This phase is the **hardest part of the whole algorithm.** Get it wrong
and your layouts look amateurish even when layering and sequencing are
correct.

#### MVP: Brute-force placement

For your absolute MVP, place node `i` in layer `L` at:

```
x(i) = i * nodeWidth + i * horizontalSpacing
y(L) = L * (layerHeight + verticalSpacing)
```

This is awful — nodes aren't aligned vertically across layers, edges
zigzag — but it works.

#### Real implementation: Brandes-Köpf

Read the [2002 paper](https://www.inf.uni-konstanz.de/algo/publications/bk-fshca-01.pdf)
straight through before coding.

Algorithm in one paragraph:

> Mark certain edges as "type-1 conflicts" (where two inner segments would
> cross). For each of 4 combinations of (top-or-bottom alignment, left-or-
> right alignment), run a *vertical alignment* pass that builds chains of
> nodes that want to share an x-coordinate, then a *horizontal compaction*
> pass that assigns coordinates to each chain. You get 4 candidate
> layouts. Average them (after centering on the widest one). Done.

Implementation references:

- **Eclipse ELK's Java implementation:** [`org.eclipse.elk.alg.layered.p4nodes.bk`](https://github.com/eclipse-elk/elk/tree/master/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p4nodes/bk).
  This is the cleanest open-source reference. Read it
- **Dagre's JS implementation:** [`lib/position/bk.js`](https://github.com/dagrejs/dagre/blob/master/lib/position/bk.js).
  Shorter than ELK's but less documented
- **Graphviz's `lib/dotgen/position.c`** has the dot-paper version which
  uses a quadratic program rather than Brandes-Köpf. Implementable but
  harder than BK

Common bugs to watch for:

1. **Inner segments vs. outer segments.** An inner segment is one between
   two dummy nodes. The four-alignment trick aligns chains of inner
   segments. Make sure your conflict detection treats them correctly
2. **Block compaction.** The horizontal compaction step is a longest-path
   problem on a DAG of blocks; implement it iteratively, not recursively
   (recursion blows the stack on large graphs)
3. **Direction symmetry.** The four passes should be symmetric. If they're
   not, your output will be biased. Test on a manually drawn graph that
   should have a perfectly symmetric layout and check the result

#### After MVP: Node compaction

Brandes-Köpf places nodes assuming they're points. For real (variable-width)
nodes, you need a post-pass that **shifts nodes within their layer** to
take advantage of slack. The post-pass treats each layer as a 1D
arrangement problem with minimum-distance constraints — solve as a
longest-path problem on a DAG.

### 4.5 Phase 4: Edge routing

Once nodes have coordinates, you need to draw the edges.

#### MVP: Straight lines

Connect node centers. Looks bad when edges pass through node bodies; works
if your node spacing is generous.

#### v1: Routing through dummy nodes

Each dummy node's coordinate becomes a **bend** in the original edge.
Draw the edge as a polyline through its source, all dummies' coordinates,
and its target. This is a HUGE quality improvement over MVP and costs
almost nothing.

#### v2: Orthogonal routing

Only horizontal and vertical segments. Algorithm:

```
for each edge (src → tgt) passing through layers L_src..L_tgt:
  - leave src vertically (down for top-to-bottom)
  - if next dummy/target is offset, go horizontally to its x
  - go vertically through layer
  - repeat
```

Add port-distribution at each node so edges don't all stack on one point.
This is also where edge thickness, minimum distances, and conflict resolution
come in. A good orthogonal router is its own multi-week project.

Reference: ELK's [`p5edges.orthogonal`](https://github.com/eclipse-elk/elk/tree/master/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p5edges/orthogonal).

#### v3+: Polyline, curved, octilinear

Mostly the same skeleton as orthogonal, but with different segment
constraints. Once you have a working orthogonal router, the others are
variations.

---

## 5. Pipeline architecture

You'll want a clean stage-based pipeline from day 1, even if you only have
4 stages. Trust me on this — every other layout algorithm uses the same
shape and the abstraction pays for itself when you add stages later.

```typescript
interface LayoutStage {
  apply(graph: LayoutGraph, context: LayoutContext): void;
}

class LayoutPipeline {
  stages: LayoutStage[] = [];
  apply(graph: LayoutGraph, data: LayoutData): void {
    const context = new LayoutContext(graph, data);
    for (const stage of this.stages) stage.apply(graph, context);
  }
}
```

The `LayoutContext` is the per-run state holding:
- Layer assignments
- Sequence orderings
- Coordinate results
- Per-node and per-edge intermediate data
- A reference to the input `LayoutData` (user constraints)

This is yFiles' `HierarchicalLayoutContext` pattern. Steal it.

Your MVP pipeline:

```
1. CycleRemovalStage         (reverses cycle-breaking edges)
2. LayeringStage             (assigns layers, inserts dummies)
3. SequencingStage           (orders nodes within layers)
4. CoordinateAssignmentStage (Brandes-Köpf)
5. EdgeRoutingStage          (build polyline routes via dummy nodes)
6. CycleRestorationStage     (restores reversed edges' direction)
```

For v1, you add:
- `ComponentSplittingStage` before layering, `ComponentMergingStage` after
- `OrientationStage` at the end (rotates output for left-to-right etc.)
- `LabelPlacementStage` at the end

For v2+:
- `GroupHandlingStage` (recursive layering within groups)
- `PortAssignmentStage`
- `ConstraintApplicationStage`

This is exactly the shape yFiles uses. There's a reason: it works.

---

## 6. Performance considerations

**Don't optimize early.** Profile first.

That said, four chokepoints to anticipate:

1. **Crossing counting.** Quadratic in edges per bilayer comparison is fine
   for hundreds of edges; fatal at thousands. Implement the Barth-Mutzel-
   Jünger O(E log V) algorithm as soon as your test graphs exceed ~500
   nodes
2. **Network simplex layering.** If you go this route, the pivot selection
   strategy matters enormously. Read the dot paper's section on pivot
   rules
3. **Coordinate assignment block compaction.** Use a topological-sort-
   based longest-path computation, not iterative relaxation
4. **Edge routing for orthogonal/polyline edges.** This is often the
   slowest phase in production. Profile early; cache distance calculations

For sub-second layout of ≤ 1k nodes, none of this matters in MVP. For
sub-second of ≤ 10k nodes, all four matter.

---

## 7. Testing strategy

This is the part most people get wrong, and the place where yFiles' decades
of experience really show.

### 7.1 Property tests

For every phase, define **invariants** that must hold after the phase runs:

- *After layering:* every edge spans exactly 1 layer (after dummy insertion)
- *After sequencing:* no node appears twice in a layer; every layer is fully
  populated
- *After coordinate assignment:* every pair of same-layer nodes has at least
  `nodeDistance` horizontal separation; node centers exactly at their
  computed coordinates
- *After edge routing:* every edge's polyline starts at its source's port,
  ends at its target's port, all segments are non-degenerate

Write these as test assertions. Run them on every test graph after every
phase. They catch 90% of bugs.

### 7.2 Reference graphs

Build a fixture set of small graphs (≤ 20 nodes each) covering:

- Single chain (A → B → C → D)
- Tree (binary, ternary, n-ary)
- Lattice (rectangular grid)
- DAG with multiple sources/sinks
- Cyclic graph (tests cycle removal)
- Disconnected components
- Single node, two nodes, empty graph
- Graph with a "long" edge spanning many layers (tests dummies)
- "Hourglass" — wide top, narrow middle, wide bottom (tests symmetry)
- Adversarial cases:
  - K_{3,3} (tests crossing minimization)
  - Complete graph K_5 (tests routing density)
  - Caterpillar (tests layering quality)

For each graph, save the layered output as a *golden file*. Re-run on every
change and diff. If the diff looks worse subjectively, debug; if it looks
better, update the golden.

### 7.3 Visual regression

For non-trivial changes, **look at the output.** Many layout bugs produce
technically valid layouts that look terrible. Render each test graph to
SVG/PNG and review on big changes. Tools: `puppeteer` to screenshot SVG,
diff with `pixelmatch`.

### 7.4 Stress tests

A pipeline of randomly generated graphs (varying size, density, cycles):

- Erdős–Rényi random DAGs
- Random trees
- Random layered graphs (sample nodes per layer, random edges between
  adjacent layers)

Run them through the layout. Property tests should pass on all of them.
This catches edge cases your hand-crafted fixtures miss.

### 7.5 Property metrics

Define **quality metrics** that you can measure and trend:

- Total crossings (lower is better)
- Total edge length (lower is better)
- Aspect ratio deviation from target (depends on target)
- Number of bends (lower is better)
- Layer balance: stddev of nodes-per-layer (depends; sometimes lower is
  better, sometimes equality)

Measure these on your fixture set. They should never get worse after a
"refactor" — if they do, you broke something.

---

## 8. Tools, libraries, and starting points

### Reference implementations to read

| Project | Language | Best for |
|---|---|---|
| [dagre](https://github.com/dagrejs/dagre) | JS | The shortest readable implementation. Read this first |
| [Graphviz](https://gitlab.com/graphviz/graphviz) (`dot`) | C | The canonical full-featured impl. Read for the hard parts |
| [Eclipse ELK](https://github.com/eclipse-elk/elk) | Java | The cleanest modern code; modular, well-commented. Read for Brandes-Köpf especially |
| [Cytoscape.js dagre extension](https://github.com/cytoscape/cytoscape.js-dagre) | JS | A wrapper around dagre, useful for studying integration patterns |
| [yWorks demos](demos-js/) (in this repo) | JS | Reference for how the API gets used in apps; great for inspiration |

Don't rewrite without first reading at least dagre's source end-to-end. It's
< 5,000 lines and covers MVP + most of v1. You'll absorb a lot of design
patterns by osmosis.

### Useful libraries

| Library | Use |
|---|---|
| `graphlib` (or your language's equivalent) | Generic directed graph data structure, BFS/DFS, topological sort |
| LP solver (`scipy.optimize.linprog`, `glpk`, `lp_solve`) | If implementing network-simplex layering as an LP |
| Geometry library (`flatten-js`, `JTS Topology Suite`, `boost.polygon`) | For edge routing collision detection |
| Fenwick tree implementation | For Barth-Mutzel-Jünger crossing counting |
| `mocha`/`jest`/`vitest` plus screenshot diff | For testing |

### Decision: roll your own graph type, or use a library?

Use a library for MVP. Once you start adding dummies, mutating during the
algorithm, attaching per-node phase-specific data — you'll want full
control. Plan for a graph type that:

- Stores typed property maps efficiently (don't store everything on the
  node object — use external `Map<Node, T>`)
- Has stable IDs that survive add/remove
- Supports fast in/out iteration both ways
- Can be cloned cheaply (for the symmetric coordinate-assignment passes)

---

## 9. Implementation order

A path that gets you to useful output fastest:

### Week 1: Skeleton + MVP layering

- Set up project structure, testing harness
- Implement minimal `LayoutGraph` (could be a thin wrapper over a library)
- Implement cycle removal (Eades-Lin-Smyth)
- Implement longest-path layering
- Implement dummy node insertion
- Property tests for each
- **Milestone:** can take any directed graph and produce a layered, dummied
  graph. No drawing yet

### Week 2: MVP sequencing + brute-force placement

- Implement barycenter heuristic
- Crossing counter (quadratic is fine here)
- Brute-force placement (x = position-in-layer * spacing)
- Render to SVG (very basic — just circles and lines)
- **Milestone:** can draw a graph. It looks bad but it works

### Week 3-4: Brandes-Köpf coordinate assignment

- Read the paper. Sketch it on paper first
- Implement type-1 conflict detection
- Implement vertical alignment (one pass)
- Implement horizontal compaction
- Run all 4 alignment combinations
- Average + center
- **Milestone:** layouts now look professional. This is when you can
  actually start showing the tool to users

### Week 5: Edge routing through dummies

- Build polyline through dummy coordinates
- Render with bends
- **Milestone:** edges look like proper Sugiyama edges. MVP complete

### From here

- Multi-component support (component split/merge stages)
- Configurable spacing (layer height, node distance, edge distance)
- Orthogonal routing
- Constraint handling
- Network simplex layering (if MVP results aren't good enough)
- Symmetry detection
- Group support
- Incremental layout

Pick by user demand. Don't try to do them all at once.

---

## 10. Pitfalls and learned lessons

Things that I expect you'll trip over.

### 10.1 Dummy nodes everywhere

Once you insert dummies, **every** subsequent phase needs to know they're
dummies. Sequencing must treat them specially (they're highly constrained
to go between their two real endpoints). Coordinate assignment must align
them. Edge routing must collapse them back into bends. Most bugs in
hierarchical layout are about dummy nodes being treated incorrectly.

### 10.2 Cycles get reversed and need restoring

If you reverse edges in cycle removal, you must:
- Reverse them back at the very end (so the final output edge directions
  match the input)
- Remember they were reversed, because edge labels, port assignments, and
  routing decisions all depend on direction

Easy to forget. Test with a graph containing both a simple cycle and a
self-loop.

### 10.3 The crossing-minimization heuristic isn't optimal

This is fine — it's NP-hard. But it means:
- Your test golden files **will** change between heuristic tweaks. Have a
  process for evaluating whether the new result is actually better
- Two runs with identical input must produce identical output. Don't use
  hash-set iteration order anywhere in the algorithm — use deterministic
  comparators
- Users will sometimes complain "this layout has more crossings than my
  hand-drawn one". They're right. Be honest

### 10.4 Coordinate assignment likes large memory

Brandes-Köpf builds 4 alignment graphs internally, each with one node per
input node (real or dummy). For a 10k-node graph (post-dummy expansion that
might be 30k), that's 4 * 30k = 120k temporary nodes. Plan accordingly.

### 10.5 Edge routing is its own world

You'll think edge routing is "just draw a line through the bend points".
It is, for MVP. The instant a user wants orthogonal edges, you've signed
up for collision detection, bend-minimization, port distribution, label
collision avoidance, and edge-bundling. Orthogonal edge routing alone is
probably a third of the total implementation effort of a v2-class layout
engine.

### 10.6 Performance is fractal

You can make every phase 2x faster with another week of work. Don't.
Profile once, find the dominant phase, optimize that, repeat. yFiles is
fast in part because it's been profiled and optimized continuously for 20+
years. You will not match that. Aim for "fast enough" instead of "fast".

### 10.7 Watch out for floating-point determinism

Sort comparators based on `barycenter(a) < barycenter(b)` where both are
floats can produce non-deterministic results due to FP error. Either:

- Round barycenters to integers (multiply by a scale factor first)
- Use strict-equality + tie-break on stable node IDs

Otherwise your output won't be reproducible.

### 10.8 The mystery is in the empirical heuristics

Reading yFiles' deobfuscated code, you'll see hundreds of small "if
this and this then do that" tweaks. These are **not** in any paper.
They're empirical fixes for specific pathological inputs the yWorks
team has hit over the years. You can't reproduce them without hitting
the same pathological inputs.

**Strategy:** ship MVP, collect bug reports, fix the ones you hit. After
3 years you'll have your own empirical heuristics. That's how every layout
engine got good.

---

## 11. What you won't easily replicate

For honesty's sake:

1. **20+ years of empirical tuning.** Every weird-looking graph someone
   reported to yWorks turned into a heuristic. You won't have that history
   on day 1
2. **The bus-routing layout.** Compact bus-style routing for grid
   components is well-engineered. Reproducing it takes serious effort even
   with the paper-level idea
3. **Incremental layout that's genuinely stable.** This is much harder
   than it sounds. The naive approach (place new nodes, freeze old ones)
   produces ugly results when the new nodes cause cascading
   re-positioning. yFiles handles this gracefully; you'll spend months on
   it
4. **Layout grid + swimlanes.** Constraint satisfaction for "node X must
   be in cell (R, C)" while also doing all the regular Sugiyama stages.
   Conceptually clear but engineering-heavy
5. **Bundling adjacent edges into a single visual bus.** Requires changes
   in all four phases. Not just routing
6. **High-quality crossing minimization.** Standard barycenter/median gets
   you ~80% of the way. The last 20% is hundreds of small heuristics for
   specific local patterns

Most of these are pieces you'd add post-MVP only if users push for them.

---

## 12. A pragmatic alternative

If you read this whole document and conclude "this is more work than I
want to take on", consider the pragmatic options:

1. **Use ELK from the JVM, or via [elkjs](https://github.com/kieler/elkjs)
   from JavaScript.** Eclipse-licensed; covers MVP + v1 + most of v2
2. **Use Graphviz via the [graphviz-wasm](https://www.npmjs.com/package/@hpcc-js/wasm)
   package or as a binary.** Battle-tested for 30+ years; covers
   everything except modern UI integration
3. **Use [dagre](https://github.com/dagrejs/dagre).** Lightweight,
   reasonable quality, MIT-licensed; integrates well with web stacks
4. **License yFiles.** Expensive but unmatched in quality

If you have a specific reason to write your own (specific feature, perf
target, license constraint, learning project, custom algorithm research),
go for it. Just go in with eyes open about the scope.

---

## 13. Quick-reference: where to find things in this repo

If you're using this repo as a *learning resource* for how a mature
hierarchical-layout engine is structured, here's where to look:

| Aspect | Location |
|---|---|
| Public API contracts | [lib-dev/package/yfiles.d.ts](lib-dev/package/yfiles.d.ts) lines 47000-48218 (HierarchicalLayout, Core, Data) |
| Layering strategy enum | [yfiles.d.ts:52143](lib-dev/package/yfiles.d.ts#L52143) |
| Stage pipeline construction | [impl/layout-hierarchical.js:20094](lib-dev/package/impl/layout-hierarchical.js#L20094) — constructor with `f.append(new ...)` calls |
| Core algorithm implementations | [impl/layout-hierarchical.js](lib-dev/package/impl/layout-hierarchical.js) — main file |
| Coordinate assignment | search `CoordinateAssigner` in [impl/layout-core.js](lib-dev/package/impl/layout-core.js) |
| Cycle removal / topological logic | [impl/layout-graph.js](lib-dev/package/impl/layout-graph.js) — graph utilities |
| Port assignment | [impl/layout-hierarchical.js](lib-dev/package/impl/layout-hierarchical.js) — search for `PortAssigner` |
| Demos showing API usage | [demos-js/](demos-js/) — pick a few hierarchical-layout demos |
| TypeScript demos | [demos-ts/](demos-ts/) |

The deobfuscated impl files are useful for **studying patterns**, not for
copying — the code is still mangled enough that direct copying isn't
productive. Use them to see *how* the algorithm is structured, then write
your own version from the papers.

---

## 14. References (consolidated)

### Papers (in priority order)

1. **Sugiyama, K., Tagawa, S., Toda, M.** (1981). *Methods for Visual
   Understanding of Hierarchical System Structures.* IEEE Trans. on SMC
2. **Gansner, E.R., Koutsofios, E., North, S.C., Vo, K.P.** (1993). *A
   Technique for Drawing Directed Graphs.* IEEE Trans. on SE — the "dot"
   paper
3. **Brandes, U., Köpf, B.** (2002). *Fast and Simple Horizontal
   Coordinate Assignment.* Graph Drawing — coordinate assignment
4. **Eades, P., Lin, X., Smyth, W.F.** (1993). *A Fast and Effective
   Heuristic for the Feedback Arc Set Problem.* IPL — cycle removal
5. **Barth, W., Mutzel, P., Jünger, M.** (2004). *Simple and Efficient
   Bilayer Cross Counting.* Journal of Graph Algorithms — O(E log V)
   crossing counting
6. **Eiglsperger, M., Siebenhaller, M., Kaufmann, M.** (2005). *An
   Efficient Implementation of Sugiyama's Algorithm for Layered Graph
   Drawing.* J. of Graph Algorithms — the most engineering-focused
   reference; very close to yFiles' design

### Books

- **Di Battista, G., Eades, P., Tamassia, R., Tollis, I.G.** (1999).
  *Graph Drawing: Algorithms for the Visualization of Graphs.* Prentice
  Hall — the textbook
- **Tamassia, R.** (ed.) (2013). *Handbook of Graph Drawing and
  Visualization.* CRC Press — more recent, broader coverage

### Code

- **dagre** — https://github.com/dagrejs/dagre
- **ELK** — https://github.com/eclipse-elk/elk
- **Graphviz** — https://gitlab.com/graphviz/graphviz

### Practical reading

- The deobfuscated yFiles impl in this repo: [HIERARCHICAL_LAYOUT_NOTES.md](HIERARCHICAL_LAYOUT_NOTES.md)
- ELK's documentation site: https://eclipse.dev/elk/documentation.html
- Graphviz's `dot` man page (yes, really — it documents algorithm choices)

---

## 15. Final word

Start with MVP. Read the four key papers. Look at dagre's source. Build a
working layered drawer in 4 weeks. Then decide what to add based on what
your users actually need.

Don't try to be yFiles on day 1. yFiles is yFiles after 20 years. The
right comparison is: how can you ship something useful in a quarter, and
something good in a year?
