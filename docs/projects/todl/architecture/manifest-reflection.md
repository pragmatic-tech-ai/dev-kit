# Manifest and reflection

Section 6 of the [architecture overview](../architecture.md) compresses a whole
subsystem into a few paragraphs: once a `.todl` source compiles, it is serialised
into a compact binary **manifest** and read back through a **reflection** API that
never touches the compiler. This page is the deep dive — why that split exists, what
the binary format actually looks like, how the reflection handles work, and the
guarantee that keeps the two worlds honest with each other.

Everything here lives under `src/manifest/` (the format) and
`src/manifest/reflection/` (the read API), bridged from the compiler side by
`src/compiler-services/emit/manifest.ts`, and hosted for multi-package scenarios by
`src/domain/`.

## Two worlds, one bridge

TODL has two independent representations of a compiled model, and it is worth being
precise about why neither one is allowed to collapse into the other.

The **Repository** (`src/compiler-services/model/model.ts`) is the live authoring and
compile-time graph. It wraps a mutable `Graph`/`GraphStore`, supports incremental
construction through a `Builder`, resolves references, walks `extends` chains, and
answers validation queries like `effectiveSchema` and `effectiveFields`. It is the
thing the parser, loader, and validator all mutate and query directly. It is not
something you want to ship to a browser: it carries the whole compiler's object graph,
has no stable on-wire shape, and its resolution semantics (`effectiveFields` is
**class-wins** — a class's fixed value overrides an instance's own, because that is
the correct view for validating a model against its own class) are tuned for
authoring-time correctness, not for a lean runtime read.

The **Manifest**, reached through the `Manifest`/`TypeInfo`/`InstanceMirror` family in
`src/manifest/reflection/reflection.ts`, is the opposite: a packed, read-only,
serialisable snapshot. It is what a published package actually ships, what a browser
bundle embeds, and what `src/model-data/` and `src/reflection-client/` read at
runtime with zero compiler dependency. Its flattening rule is deliberately the
opposite of the Repository's: **instance-wins** — an instance's own value overrides
its class's fixed value, and the class only fills fields the instance leaves unset.
That is the only flattening under which "did this value come from me or from my
class" (Axis 2, below) is even a meaningful question to ask of a single node.

The bridge between the two is `ManifestEmitter`
(`src/compiler-services/emit/manifest.ts`). Given a `Repository` plus a model
identity, it emits two artifacts in one pass:

```ts
export class ManifestEmitter
{
    constructor(
        private readonly repo: Repository,
        private readonly model: string,
        private readonly version: string,
    ) {}

    emit(): { manifest: LogicalManifest; graph: DataGraph }
    {
        return { manifest: this.emitManifest(), graph: this.emitDataGraph() };
    }
    ...
}
```

`emitManifest()` walks `repo.nodesOfMetaKind(MetaKind.Concept)`, `repo.schemaOf(id)`,
`repo.allNodes()` (for classes/terms), and `repo.nodesOfMetaKind(MetaKind.Taxonomy)`
to produce a `LogicalManifest` — the declared-only ontology tier: concepts, their
own fields/relationships/annotations, the `extends` parent, classes and their fixed
values, and taxonomies. `emitDataGraph()` walks the same repository's instance tier
and produces a `DataGraph`: flattened, self-contained `DataNode`s (instance-wins
`attrs`, no class references baked in beyond a `class` pointer) plus relationship-only
`DataEdge`s, both pinned to the manifest identity via `manifestRef`. The comment at
the top of that file is explicit about the asymmetry: "Flattening is INSTANCE-WINS...
It deliberately differs from `Repository.effectiveFields` (class-wins), which stays
the resolution used by validation / typed clients."

## The binary format: tables and heaps

`src/manifest/` (SPEC-04) is a MoF-style metadata container — the same family of idea
as a .NET assembly's metadata tables or a compiled protobuf descriptor: fixed-width
row tables that reference each other by row index, plus a couple of variable-length
heaps that tables point into.

`enums.ts` freezes the numeric vocabulary the whole format is built on. `MetaKind`
(`Concept`, `Primitive`, `Taxonomy`, `Term`, `Annotation`, `Relationship`, `Operator`,
`Viewpoint`, `Model`, `Package`) and `Cardinality` (`One`, `Optional`, `Many`,
`OneOrMore`) are **canonically owned here** — `src/compiler-services/model/graph.ts`
re-exports `Cardinality` from this module rather than declaring its own, so the
in-memory and on-disk tiers can never disagree about what "many" means. `TableId`
enumerates eleven tables (`TypeInfo`, `Field`, `Rel`, `Target`, `Class`, `Fixed`,
`Taxonomy`, `Imports`, `TypeRef`, `Annotation`, `AnnotationArg`), and `HeapId`
enumerates two heaps (`Strings`, `Const`). Every one of these is append-only by
convention — the doc comment is blunt: "DO NOT renumber."

`schema.ts` (`ManifestSchema`) is the single source of truth for column layout, so
the writer and reader can never drift apart: `ManifestSchema.columns(table)` returns
the ordered `Column[]` for a table, and each `Column` knows its own on-wire width
(`ColKind.U8`/`U16` are fixed widths; `Str`/`Const`/`Coded`/`Row` are width-flagged
against the resolved `IndexWidths`, so a small manifest packs 1-byte indices and a
large one grows to 2 or 4 bytes without changing the schema). The `TypeInfo` table's
columns are a good example of the table+heap shape in miniature: `name`/`ns` are
string-heap indices, `kind` is a `MetaKind` byte, `extends` is a coded `TypeDefOrRef`
reference, and `fieldStart`/`fieldCount`/`relStart`/`relCount`/`annotStart`/
`annotCount` are contiguous-slice pointers into the `Field`, `Rel`, and `Annotation`
tables — a type's members are not stored inline, they are a `[start, count)` run
that the owning row points at.

Two addressing primitives make the cross-references work, both in `token.ts`:

- **Token** — a `(table, row)` pair, the address of one row in one manifest. Row 0 is
  the reserved null slot in every table.
- **TypeDefOrRef** — a coded index over the `{TypeInfo, TypeRef}` pair (the low bit
  tags which table, the row is arithmetically encoded as `row * 2 + tag` rather than
  bit-shifted, specifically so rows near the u32 boundary don't overflow signed
  32-bit math). This is how a field's declared type, a relationship's target, or a
  concept's `extends` parent can point either at a `TypeInfo` row defined in *this*
  manifest or — once `Imports`/`TypeRef` come into play — at a type defined in
  another manifest entirely (see the Domain section below).

The two heaps are simpler: `StringsHeap` interns every name/string constant once and
hands back a stable index (0 reserved for the empty string), and `ConstHeap` does the
same for scalar constant values used as fixed field values or annotation arguments.
Interning is idempotent — writing the same string twice returns the same index — which
is what keeps the format compact.

## Writing and reading a manifest

`ManifestWriter` (`src/manifest/manifest-writer.ts`) is a pure packer. Callers intern
their own strings/consts and append rows table by table; slice columns like
`fieldStart`/`fieldCount` are the caller's responsibility to compute (add the member
rows contiguously, capture `[start, count]`, then add the owning row). Its three
output methods are `toJSON()` (a positional debug view — same column order, same
numeric indices as the binary, used for round-trip tests and, notably, as the actual
runtime load path in most of this codebase today), `toBinary()` (the shipped SPEC-04
container, via `BinarySerializer`), and the important bridge method:

```ts
static fromLogical(m: LogicalManifest): ManifestWriter
```

`fromLogical` lowers a `LogicalManifest` (the JSON-shaped, human-readable sidecar
`ManifestEmitter.emitManifest()` produces) into the packed tables. It is careful about
one thing in particular: any type id referenced by a coded column that is *not* one of
the manifest's own declared concepts — a primitive like `string`, or (in the current
single-manifest world) an annotation type — gets synthesized as a local `TypeInfo` row
of kind `Primitive` or `Annotation` with no members, purely so every coded reference
resolves within the manifest. Cross-manifest lowering through real `Imports`/`TypeRef`
rows is explicitly called out as "a SPEC-06/Domain concern" — deferred to the
multi-manifest host described later.

`ManifestReader` (`src/manifest/manifest-reader.ts`) is the mirror image:
`fromBinary(bytes)` parses the container's magic (`"TODM"`), directory, heaps, and
table rows back into a `Map<TableId, number[][]>`; `fromJSON(json)` rebuilds the same
structure from the debug view. Row decoding is purely positional against
`ManifestSchema` — the reader has no independent knowledge of column meaning, which is
exactly what guarantees it can never drift from the writer. Typed accessors like
`typeInfo(row)`, `field(row)`, `rel(row)`, `class_(row)` turn a raw `number[]` back
into a named record, and slice iterators (`fieldsOf`, `relsOf`, `targetsOf`,
`fixedOf`, `representsOf`, `annotationsAt`) walk a `[start, count)` run one row at a
time.

A gotcha worth flagging: `ManifestReader` and `ManifestWriter` both expose a `toJSON`
that round-trips through `Base64`-encoded const blobs and a flat `strings` array —
this JSON form is not a public interchange format, it is a debug/round-trip seam
(SPEC-04 §8 explicitly says "never shipped"). The `Manifest.load()` reflection entry
point (next section) accepts either shape.

## Reflection: a System.Reflection analog

`src/manifest/reflection/reflection.ts` is deliberately modelled 1:1 on .NET's
`System.Reflection`: every handle is a lazy `(Manifest, row)` pair — nothing is
eagerly materialised into an object graph, and nothing here can mutate anything.

`Manifest` is the `Assembly` analog and the handle factory:

```ts
static load(source: Uint8Array | ManifestJson): Manifest
{
    const reader = source instanceof Uint8Array
        ? ManifestReader.fromBinary(source)
        : ManifestReader.fromJSON(source);
    return new Manifest(reader);
}
```

From a loaded `Manifest` you get `root()` (the virtual root `Element`), `types()`,
`getType(name)` (by simple name, falling back to full namespaced name),
`taxonomies()`/`getTaxonomy(name)`, `getTerm(id)`, and the payoff method,
`reflect(node: ReflectedNode): InstanceMirror`.

The handle classes:

- **TypeInfo** — the `Type` analog, one `TypeInfo` table row. `baseType` resolves the
  coded `extends` reference; `getDeclaredFields()`/`getDeclaredRelationships()` are
  declared-only (this type's own rows), while `getFields()`/`getRelationships()`
  walk the whole `extends` chain and merge with "nearest declarer wins" — the
  effective, inherited view. `isSubtypeOf`/`isAssignableFrom` give you .NET-style
  type-compatibility checks over that chain.
- **MemberInfo** — an abstract base shared by `FieldInfo` and `RelationshipInfo`,
  carrying `name`, `token`, `declaringType` (Axis 1, see below), and `reflectedType`
  (the type you actually asked through — the receiver, which may be a subtype of
  `declaringType`).
- **FieldInfo** — a scalar member (`getValue(node)` reads `node.attrs[name]`, falling
  back to a fixing term's pinned value; see the two-axis section).
- **RelationshipInfo** — a reference member (`targets` are the allowed target
  `TypeInfo`s; `getTargets(node)` reads `node.refs?.[name]`).
- **TermInfo** — the `Class` table row analog for a taxonomy term or clabject class:
  `concept`, `taxonomy`, `broader`/`narrower()`, and the Axis-2 machinery
  (`fixes(field)`, `getFixedValue(field)`, `findFixing(field)` — walk the `broader`
  chain for the nearest term that pins a given field).
- **TaxonomyInfo** — `represents()` (the concept(s) it classifies), `getTerms()`,
  `roots()`.
- **InstanceMirror** — the entry point returned by `Manifest.reflect(node)`: `type`
  (the node's `TypeInfo`), `class` (its `TermInfo`, if any), `fields()` (one
  `FieldView` per effective field), and `field(name)`.

One shape note worth being explicit about: reflection reads a **`ReflectedNode`**
(`{ id, type, class?, namespace?, attrs, refs? }`) — the flattened, self-contained
node shape `ManifestEmitter.emitDataGraph()` produces — never the compiler's graph
`Node` from `src/compiler-services/model/graph.ts`. The compiler's `Node` has no
single "my type" / "my class" field at the node root (fields, relationships, and
class membership are all edges in that graph); reflection deliberately works over a
pre-flattened, denormalised shape so it never needs a live `Repository` to answer a
query.

## The two-axis field view

`FieldView`, obtained from `InstanceMirror.field(name)` or `.fields()`, is where the
two provenance questions the whole subsystem exists to answer come together on one
object:

```ts
export class FieldView
{
    get value(): Scalar | undefined { return this.field.getValue(this.node); }

    /** AXIS 1 — where the field was DEFINED. Identity: field.declaringType. */
    get definitionOrigin(): TypeInfo { return this.field.declaringType; }

    /** AXIS 2 — where the VALUE came from: the term that fixes it, or "self". */
    get valueOrigin(): TermInfo | "self" { ... }
}
```

These two axes are independent and easy to conflate if you have not seen them laid
out side by side:

- **Axis 1 — definitionOrigin.** Which *concept in the extends hierarchy* declared
  this field. If `Component extends Element` and `Component` declares `tier`, then
  for any `Component` instance, `field("tier").definitionOrigin` is `Component`,
  regardless of what value that instance actually holds. This answers "where does
  this member come from in the type system," and it travels the `extends` chain.
- **Axis 2 — valueOrigin.** Whether the *runtime value* the field currently holds is
  the instance's own, or was inherited by pinning through a taxonomy term / clabject
  class. This answers "why does this instance have this value," and it travels the
  `class`/`instanceof`-then-`broader` chain, which is a completely different axis
  from `extends`.

The test fixture in `src/manifest/reflection/tests/repository-parity.test.ts` is the
clearest worked example. It defines `Element` with an optional `label`, `Component
extends Element` with a required `tier`, and a taxonomy `Kinds` with one term `ui`
that fixes `tier = "ui"`. An instance `app.home` is `instanceof Kinds.ui`, sets its
own `label = "Home"`, and never sets `tier` at all:

```ts
repo
  .defineConcept("Element").addField("Element", "label", "string", Cardinality.Optional)
  .defineConcept("Component", "Element").addField("Component", "tier", "string", Cardinality.One)
  .defineTaxonomy("Kinds", ["Component"], [
    { id: "ui", concept: "Component", attrs: new Map([["tier", "ui"]]) },
  ])
  .assertInstance("Component", "app.home")
  .setField("app.home", "label", "Home")
  .addInstanceOf("app.home", "Kinds.ui"); // inherits tier="ui"; does NOT override it
```

Reflecting `app.home` and reading both fields:

- `field("label")` — `definitionOrigin` is `Element` (declared there, inherited by
  `Component`); `valueOrigin` is `"self"` (the instance set it); `value` is `"Home"`.
- `field("tier")` — `definitionOrigin` is `Component` (declared there, not
  inherited); `valueOrigin` is the `TermInfo` for `Kinds.ui` (the value came from the
  fixing term, not the instance); `value` is `"ui"`.

Same object, same API, two completely different answers depending on which axis you
ask about — and neither axis by itself would tell you both "what field is this,
type-wise" and "why does it have this value."

## The repository↔manifest parity guarantee

Because the Repository (class-wins) and the Manifest (instance-wins) use opposite
flattening rules, they can only be expected to agree where an instance does not
actually override its class's fixed value — which is exactly the scenario the parity
test is built around (`app.home` never sets `tier` itself, so both resolutions land
on `"ui"`).

`src/manifest/reflection/tests/repository-parity.test.ts` asserts this cross-check
directly: it builds a `Repository`, runs it through `ManifestEmitter` →
`ManifestWriter.fromLogical` → `Manifest.load`, then compares the reflected view
against the live Repository on the same fixture. Two assertions matter:

```ts
const reflected = new Set(manifest.getType("Component")!.getFields().map((f) => f.name));
const fromRepo = new Set(repo.effectiveSchema("Component").fields.map((f) => f.name));
assert.deepEqual(reflected, fromRepo);
```

confirms the *shape* agrees — reflection's effective field set for a type matches
the Repository's `effectiveSchema`. And:

```ts
for (const name of ["label", "tier"])
  assert.equal(mirror.field(name)!.value, repo.attr("app.home", name));
```

confirms the *values* agree — `FieldView.value` for each field matches
`Repository.attr` for the same node. This is the guarantee that lets everything
downstream (typed codegen, the model browser, the app bootstrap) trust that what it
reads off a published manifest is the same model the compiler validated, not a
lossy or reinterpreted copy of it — as long as no instance in the model overrides a
value its class fixes, which non-overriding is itself enforced separately by the
validator's classes rule ("no leaf overriding a class-fixed scalar," §6 of the
[architecture overview](../architecture.md)).

## Domain: hosting many manifests

A single `Manifest` only resolves references within itself. Real solutions are
multi-package: an architecture project depends on a library, which depends on a
meta-model, each compiled and published as its own versioned manifest. `src/domain/`
is the host for that world.

`FrozenGraph` (`src/domain/graph.ts`) is the substrate: it owns a registry of loaded
`Manifest`s keyed by `model@version` identity, a single shared `Heap` of flattened
`ReflectedNode`s (one heap across every loaded package, not one per manifest), and it
implements `ManifestHost` — the interface a `Manifest` calls back into whenever it
needs to hop a `TypeRef` coded reference into a dependency manifest:

```ts
export interface ManifestHost
{
    getManifest(model: string, version?: string): Manifest | undefined;
}
```

Recall from the token section that `TypeDefOrRef` can point at either a local
`TypeInfo` row or a `TypeRef` row; `Manifest.resolveTypeRef` decodes the tag, and for
a `TypeRef` it reads the `Imports` table for the target model/version and calls back
into its `host` — the `FrozenGraph` — which looks up the dependency manifest and asks
it for the named type. This is exactly how a field typed by a concept declared in a
different, already-loaded package resolves.

`Domain` (`src/domain/domain.ts`) wraps `FrozenGraph` and adds package loading: given
an injected `PackageSource` (resolve a `PackageRef` to manifest bytes + declared
dependencies + optional seed data), `load(ref)` pins a version, dedups against
already-loaded manifests, pre-registers the manifest (wiring the host back-link
*before* recursing into its dependencies, which is the cycle guard), loads
dependencies depth-first, then finalizes registration in deps-first order and merges
any seed instance data into the shared heap via `BindSeed`. `tryUnload` is the
mirror operation, gated by two refcounts: an import refcount (a manifest can't unload
while something still depends on it) and a graph refcount (a foreign node still
binding to one of its types or terms also blocks the unload).

Two things worth flagging as open edges rather than stable contracts:

- The heap currently holds the flattened `ReflectedNode` family reflection already
  uses, not `src/compiler-services/model/graph.ts`'s `Node` — the code comment notes
  this is a deliberate stand-in "until SPEC-01 lands" (a node-root type/class shape
  that graph.ts's `Node` does not yet have).
- The `RegistryPackageSource` adapter that would let a `Domain` resolve packages
  straight out of an npm registry is deferred: it needs published packages to ship
  SPEC-04 manifest bytes alongside `model.json`, which the publish pipeline
  (`src/publish/`) does not emit yet.

---

[← Back to the Architecture overview](../architecture.md)

See also:
- [The compiler](compiler.md)
- [Consuming a model](consuming-a-model.md)
- [Core concepts](core-concepts.md)
