# Core concepts

This page is the deep-dive companion to section 4 of the [Architecture overview](../architecture.md).
It walks through the vocabulary the rest of the TODL codebase assumes you already
know: the typed graph, the declaration kinds, the type-directed fields-vs-relationships
rule, namespaces and bound vocabulary, classes and instanceof, and bases and the
prelude. Every type and file path below is taken directly from
`src/compiler-services/` in the TODL package (`@pragmatic-tech-ai/todl`) — treat this
as a map of the real code, not a paraphrase of it.

## The typed graph

Everything TODL compiles down to is one graph: a set of `Node`s connected by typed
`Edge`s. This is defined in `src/compiler-services/model/graph.ts`, and it is the
hub the compiler, the validator, the emitters, and the reflection API all read and
write.

A `Node` looks like this:

```ts
export interface Node {
  id: NodeId;
  tier: Tier;
  type: NodeId | null;        // instance tier: the concept this node instantiates
  metaKind: MetaKind | null;  // ontology tier: the construct this node IS
  namespace: string | null;
  localId: string | null;
  isClass: boolean;
  class: NodeId | null;       // instance tier: the term/class this node instantiates
  storageId: string | null;   // reserved, not yet used
  fields: FieldDecl[];        // declared scalar/field schema (concepts, annotations)
  attrs: Map<string, Scalar>; // user-supplied scalar VALUES only
}
```

A node is *either* an ontology declaration (a concept, a taxonomy term, an
annotation, …) or a concrete instance — never both at once, which is why `type`
and `metaKind` are mutually exclusive: `type` is populated on instance-tier nodes
(it names the concept the instance is typed by), `metaKind` is populated on
ontology-tier nodes (it names the language construct the node *is*). Note that
`fields` carries a concept's *declared* schema (name, type, cardinality), while
`attrs` carries only the scalar *values* a particular instance holds — enum
selections and references are never stored in `attrs`, they are edges.

All structure — inheritance, containment, typing, classification — is expressed as
an `Edge`:

```ts
export interface Edge {
  kind: EdgeKind;
  via: NodeId | null; // for Relationship/Derived: which member this edge realises
  from: NodeId;
  to: NodeId;
}
```

`EdgeKind` enumerates the *structural* kinds: `TypeOf`, `Extends`, `Contains`,
`HasRelationship`, `HasInvariant`, `Relationship`, `Derived`, `Narrower` (taxonomy
hierarchy), `InstanceOf` (leaf → class), `Represents` (taxonomy → concept),
`Annotated`, `Frames` (viewpoint → concept), and `Targets` (relationship member →
one of its target concepts). Domain-specific relationship *names* — `calls`,
`contains`, whatever a meta-model author declares — are not baked into the enum at
all; they are data, carried on `Edge.via` for the generic `Relationship` and
`Derived` kinds. That is a deliberate design choice: the enum only needs to grow
when the *language* grows a new structural concept, not every time someone
authors a new meta-model.

Three more enums round out the vocabulary:

- **Tier** — `Meta`, `Ontology`, or `Instance`. Ontology is the type/definition
  layer (concepts, taxonomies, viewpoints, …); Instance is the data layer (the
  concrete objects a model constructs).
- **MetaKind** — for ontology-tier nodes only: `Concept`, `Primitive`, `Taxonomy`,
  `Term`, `Viewpoint`, `Field`, `Relationship`, `Model`, `Annotation`, `Package`,
  `Operator` (`src/compiler-services/model/kinds.ts`). This is a *string* enum,
  independent of the numeric `MetaKind` the on-disk manifest format defines in
  `src/manifest/enums.ts` — the two are bridged deliberately rather than shared,
  so the in-memory compiler model and the frozen binary wire format can evolve on
  separate schedules.
- **Scalar** — `string | number | boolean`. This is the entire type of a field
  *value*. There is no array-of-scalar storage today: a many-valued primitive
  field (`tags : string[]`) keeps only its *last* assigned value in `attrs`. This
  is a known, documented limitation, not an oversight — keep it in mind if you're
  modeling something that wants a genuine multi-valued scalar list; reach for a
  taxonomy or a set of reference edges instead.
- **Cardinality** — `One` / `Optional` (`?`) / `Many` (`[]`) / `OneOrMore` (`[+]`).
  Unlike `MetaKind`, this enum is *shared*: it is canonically owned by
  `src/manifest/enums.ts` (frozen numeric codes, append-only) and the compiler
  model re-exports the same enum from `graph.ts` rather than declaring its own,
  so the in-memory and on-disk tiers can never disagree about what a cardinality
  code means.

## Graph, GraphStore, Repository, EntityBase — four layers, one graph

These four types are easy to conflate because they all "are" the graph in some
sense, but each has a distinct job:

- **`GraphStore`** (`model/graph-store.ts`) is the storage seam: it holds nodes,
  dual edge adjacency (forward `out` + reverse `in`, so reverse traversal is
  free), and a type/metaKind index. It knows nothing about change notification or
  derived traversals. `InMemoryGraphStore` is the only implementation today, but
  the seam exists so a graph-database-backed store could be swapped in later
  without touching anything above it.
- **`Graph`** (`model/graph.ts`) wraps a `GraphStore` and adds the parts a store
  shouldn't own: a `changed: Signal<GraphChangeArgs>` mutation bus (one event per
  applied change — node added/removed, edge added/removed, attr set), plus
  derived traversal helpers (`related`, `closure`) built on top of the store's
  adjacency. This is the level at which "is my structure sound" queries like
  `instancesOf`/`nodesOfMetaKind` live.
- **`Repository`** (`model/model.ts`) is the public façade — the type most code
  actually talks to. It wraps a `Graph` and adds everything an agent or a
  downstream stage needs: `resolve(id)`, `instancesOf(concept)`,
  `effectiveSchema(concept)`, `supertypesOf`/`subtypesOf`, `represents`/
  `representedBy`, `termsOf`, `attr`/`ref`/`refs`/`referrers`, a staging
  `Builder`, a reactive `ReactiveNode` view, invariant/derived-member
  registration, and `validate()`. If you're writing compiler or tooling code
  against the graph, `Repository` is almost always the entry point, not `Graph`.
- **`EntityBase`** (`model/entity.ts`) is a *lazy, per-node read lens*, one level
  further from the raw graph. `repo.entity(id)` returns a memoized `EntityBase`
  (same id → same instance, so references resolve to shared handles and cycles
  are safe to walk). Its reads — `field`, `ref`, `refs`, `referrers`, `is()` — all
  delegate live to the `Repository`, so an entity is never a snapshot/copy; it
  stays current as the graph mutates. This is the base every generated,
  per-concept entity class ultimately extends on the compiler side (the runtime
  analog on the consumption side is `ReflectedEntity` in `src/reflection-client/`
  — see [Consuming a model](consuming-a-model.md)).

The layering, outside-in: `GraphStore` (bytes and indexes) → `Graph` (mutation +
traversal + change bus) → `Repository` (the construct/query façade compiler
passes and validators actually call) → `EntityBase` (a typed, cached, per-node
view for read-oriented consumers).

## Declaration kinds

A `.todl` meta-model is built from five kinds of ontology-tier declaration, each
stamped with its own `MetaKind`:

- **Concept** — a type. It declares named **fields** (`label : string`) and
  **relationships** (`calls -> Service`, or with a member-name form:
  `relationship in -> location?`). A concept may `extends` another concept; a
  concept declared with no explicit parent virtually extends the prelude's root
  concept, `Element` (more on this under Bases below).
- **Primitive** — a scalar refinement of a built-in type, e.g.
  `primitive slug : string { regex = "^[a-z0-9]+(?:-[a-z0-9]+)*$"; }`. Primitives
  are what make a field value-like rather than reference-like (see the
  fields-vs-relationships rule next).
- **Taxonomy + Term** — a classification of a concept:
  `taxonomy technologies : represents technology { term aws {} term azure {} }`.
  Terms form a `Narrower` hierarchy (broader term → narrower term) and can fix
  field values that instances inherit — see Classes and instanceof below. Term is
  a first-class node kind (`MetaKind.Term`), not a bare string label.
- **Annotation** — typed metadata attached to concepts, members, terms, or
  instances: `annotate icon { path = "…" }`. A handful of annotations are
  well-known and drive behavior elsewhere in the pipeline: `icon` and `label`
  drive presentation, `entrypoint` marks an application's root model, `materialize`
  drives deterministic taxonomy-term-drop into diagrams. The prelude
  (`stdlib/prelude.todl`) declares the baseline set: `icon`, `label`, `toolbox`,
  `instance`, `iconSource`, `wiki`, `entrypoint`, `has_children`, `containment`.
- **Operator** — an author-defined infix glyph, e.g. `a --> b`, that materialises
  into an edge when used as a value — either a plain relationship edge or a
  reified edge node, depending on how the operator is declared. See
  [The TODL language](../todl-language.md) for operator declaration syntax.

## Fields vs relationships: the type-directed rule

This is one of the most load-bearing rules in the whole language, and it is easy
to get wrong intuitively because the *surface syntax* for setting either one looks
identical: `member = value;`.

The rule: whether `x = foo` becomes a scalar **attr** (stored in `Node.attrs`) or a
graph **edge** (an `EdgeKind.Relationship`) is decided entirely by the *declared
type* of member `x` on the owning concept's schema — never by how the value `foo`
happens to be written. Concretely:

- if `x`'s declared type resolves to a **primitive** (or is an unresolved/unknown
  type), the value is value-like → a scalar attr.
- if `x`'s declared type resolves to a **concept or a taxonomy**, the value is
  reference-like → an edge.

So the same bare identifier `foo` on the right-hand side means two completely
different things depending on what type the meta-model gave the field:

```todl
namespace demo {
  concept Api { label : string?; }

  concept Service {
    calls : Api;   // reference-like: Api is a concept
    name  : string;  // value-like: string is a primitive
  }

  model M : demo {
    api = Api { id = "billing-api"; }
    svc = Service { calls = api; name = "billing"; }
    //              ^^^^^^^^^^^^   a Relationship edge Service --calls--> Api
    //                            name = "billing" ^^^^^^^^^^  a scalar attr
  }
}
```

`calls = api` compiles to a `Relationship` edge (`via: "calls"`) precisely
*because* `calls` was declared as `Api`-typed, not because `api` looks like an
identifier rather than a string literal — a bare identifier is always parsed as a
`NameValue` regardless of what it means; the parser makes no attr-vs-edge decision
at all. References may point forward: `api` can be declared later in the same
file or even a later file, because name resolution happens in a dedicated
pre-pass before instances are materialised.

Why design it this way instead of a distinct syntax at the use site (`calls ->
api`)? Because the *member* already carries that information once, in the
concept schema — repeating it at every assignment would be redundant and a source
of drift. Type-directedness keeps the schema the single source of truth for "is
this a value or a link," the same way a statically-typed language decides `x = y`
based on `x`'s declared type rather than a different operator per type.

The oracle that implements this lives in `src/compiler-services/parse/loader.ts`:
`isReferenceType(model, type)` asks whether a type id resolves to a `Concept` or
`Taxonomy` node; `isReferenceMember(model, concept, name)` reads the concept's
*effective* (inherited) schema and asks whether member `name` is a declared
relationship, or a field whose declared type is reference-like;
`realizeValue(...)` is the function that actually branches on that answer while
materialising a value — a `NameValue` becomes `builder.addRelationship(...)` when
the member is reference-like, or `builder.setField(...)` otherwise. Because this
oracle reads the *effective* schema, Pass 2a (member/schema commit) must have run
before Pass 2b (instance materialisation) — which is exactly the staged-pass
ordering the loader uses (see [The compiler](compiler.md)).

## Namespaces, models, viewpoints, and bound vocabulary

Every `.todl` file declares a namespace: `namespace a.b.c { … }`. A namespace
gates *visibility* — what an author is even allowed to reference — and qualified
names (`ns.x`) resolve down to flat node ids during the resolve pre-pass. The
prelude's `todl` namespace is implicitly visible everywhere, which is how every
file gets `identifier`, `slug`, `icon`, `Element`, and friends without importing
anything.

A **model** is the container for concrete instances, and it is also where a
project declares which vocabulary it is allowed to use:

```todl
model X : <metaModel> uses <taxonomy1>, <taxonomy2> conforms <Viewpoint> {
  …
}
```

- `: <metaModel>` binds the meta-model namespace the model's concepts come from.
- `uses <taxonomies>` binds one or more taxonomy namespaces the model may
  classify instances against.
- `conforms <Viewpoint>` declares which **viewpoint** frames this model block's
  entities. A **viewpoint** is itself a declaration (`MetaKind.Viewpoint`) that
  frames a subset of concepts via `Frames` edges; `conforms` is how a model block
  says "every entity I declare here belongs to this viewpoint." If a model is
  split across several files (a common pattern for a large architecture project —
  one file per concern), **every block must declare its own `conforms`**, because
  each entity carries its own home viewpoint; there is no block-spanning default.

The validator enforces **bound vocabulary**: a model may only construct instances
of concepts drawn from its bound namespaces — its own namespace, the meta-model
namespace, and the namespace of each `uses` taxonomy. Constructing something
outside that set fails with `constructor.out-of-scope`. This has bitten real
migrations: a model split across files, where one block happened not to
reference any term from a given taxonomy, still needed that taxonomy's `uses`
clause on *that specific block* — a `uses` on a sibling block does not carry
over. Every split block must declare the `uses`/`conforms` its own constructors
require.

## Classes and instanceof (clabjects)

A node with `isClass: true` is a *clabject* — simultaneously a class (a
type-like thing other nodes can instantiate) and an instance (it has its own
field values, just like a leaf would). Taxonomy terms are the most common source
of classes: `term azure { tier = "cloud"; }` inside a taxonomy makes `azure` a
class node with `tier` fixed to `"cloud"`.

A concrete instance opts into inheriting those fixed values with `instanceof`:

```todl
model M : demo uses technologies {
  svc = Technology { instanceof azure; label = "Azure Functions"; }
}
```

`Repository.classOf(leaf)` returns the class a leaf instantiates (or `null`), via
the `InstanceOf` edge kind. The two methods that make "what does this instance
actually see" a well-defined question are:

- **`effectiveFields(leaf)`** — the leaf's own `attrs`, overlaid with its class's
  fixed `attrs`. This is deliberately **class-wins**: if both the leaf and its
  class set the same field, the class's value takes precedence for the ontology
  read view (`svc.tier` reads `"cloud"` even if the leaf tried to override it —
  and the validator separately rejects a leaf trying to override a class-fixed
  scalar at all).
- **`effectiveSchema(concept)`** — a concept's own declared fields/relationships
  merged with everything it transitively `extends`, subtype-members-win (a
  redeclaration in a subtype shadows the same-named member from a supertype).
  This is the schema `isReferenceMember` reads when deciding attr-vs-edge, and
  it's also what a generated entity class's typed getters are built from.

Note the emit side runs the *opposite* merge policy on purpose:
`emit/manifest.ts`'s flattening for the binary format is **instance-wins** — the
manifest wants "what does this specific object actually hold," not "what does
the ontology view resolve to." The two merges answer different questions; don't
assume one implies the other. The manifest's `FieldView` type separately tracks
`definitionOrigin` (which type declared a field) and `valueOrigin` (whether a
value came from the instance itself or a fixing term), so a reflection consumer
can recover both answers without recomputing them — see
[Manifest and reflection](manifest-reflection.md).

## Bases, closure, and the prelude

A **base** is a compiled model (a `TodlDocument`, the `{ nodes, edges }`
interchange form produced by `emit/json.ts`) that a project builds on top of. A
meta-model project's compiled output can be a base for architecture projects; a
library project's compiled output (a taxonomy, typically) can be a base too.
Bases are how the compiler seeds the graph with everything a project's sources
are allowed to reference without redeclaring it: `checkAgainst(bases, sources)`
does `new Repository(mergeBases([preludeDocument(), ...bases]))` before loading
the project's own sources, so references in those sources resolve straight to
base nodes already sitting in the graph.

`mergeBases(bases)` deserialises every base into one shared graph with
**first-wins deduplication** — if two bases both happen to carry the same node id
(for instance, a library that embeds its own meta-model's nodes and the
meta-model base is *also* passed explicitly), the graph ends up with one node, not
two colliding copies. This is what lets a library "carry its meta-model with it"
and still compose cleanly with the meta-model supplied directly.

The **prelude** (`src/compiler-services/stdlib/prelude.ts`, backed by the actual
source text in `stdlib/prelude.todl`, namespace `todl`) is the implicit base in
*every* compile — you never opt out of it, and `check(sources)` is defined as
`checkAgainst([], sources)`, i.e. no explicit bases, prelude still included. It
supplies:

- the baseline primitives: `identifier`, `slug`, `resourceKey`.
- the well-known annotations listed in Declaration kinds above.
- the root concept `Element` (just `label`/`description`), which every
  parent-less concept virtually extends. This virtual-root rule is resolved at
  query time by `Repository.supertypesOf`/`schemaOf`, not by a stored `Extends`
  edge — `rootsAtElement()` checks "is this a concept, is it not `Element`
  itself, does `Element` exist in this graph" and splices `Element` into the
  answer, rather than the loader writing an explicit edge for every concept in
  existence.

The prelude is compiled with the *raw* loader rather than `check` (it would
otherwise need to reference itself), and its source is embedded as a generated
constant (`prelude.generated.ts`) rather than read from disk at runtime, so it
survives being bundled into a single file — important for the
[runnable app](runnable-app.md) build, which inlines the whole compiled runtime.

**Closure** is the transitive set of bases a project actually depends on — not
just its direct `metaModels`/`libraries`/`architectures` bindings, but everything
those bindings themselves recorded as dependencies. Resolving it is a job for the
build's package-source chain (`RecursiveProjectReferencesResolver`, walked BFS
over recorded package dependencies), not for `compiler-services` — the compiler's
job stops at "here are some already-compiled bases, seed the graph with them."
See [Projects and solutions](projects-and-solutions.md) and
[Publish and packages](publish-and-packages.md) for how a closure is resolved.

---

[← Back to the Architecture overview](../architecture.md)

See also: [The compiler](compiler.md) · [Manifest and reflection](manifest-reflection.md) · [Consuming a model](consuming-a-model.md)
