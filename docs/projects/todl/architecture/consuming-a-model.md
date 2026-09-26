# Consuming a model

Section 7 of the [architecture overview](../architecture.md) names four
packages under this one heading: `model-data`, `reflection-client`, `codegen`,
and `authoring`. They form a single pipeline — read a compiled model at
runtime with no compiler in the bundle, generate a typed TypeScript surface
over it at build time, and, when a project needs to write, stage new
instances and serialise them back to `.todl`. This page walks the pipeline
end to end, with real types and file paths from
`@pragmatic-tech-ai/todl` v0.36.x.

The one thing to hold onto throughout: everything here reads the **manifest
and reflection** layer described in
[section 6](../architecture.md#6-manifest-and-reflection), never the
compiler's live `Repository`. That is what makes it safe to ship in a
browser bundle — no parser, no loader, no validator, just a packed binary (or
its JSON form) and a thin typed lens over it.

## model-data: browser-safe access with no compiler dependency

`src/model-data/` is the runtime data layer. Its center is
`ModelDataSource` (`src/model-data/model-data-source.ts`), an abstract typed
façade over a single package's reflection graph. It is not a document parser
— it wraps a `FrozenGraph` and a `GraphQuery` (from `src/domain/` and
`src/graph-api/`), both built from a `Manifest` the class loads via
`Manifest.load(resolved.manifest)`. The compiler proper never enters this
path.

A source materialises in one of two ways:

- **Synchronously**, via the protected `loadDocument(doc: TodlDocument)`,
  which bridges the document into a resolved manifest and seed
  (`PackageManifestBridge.toResolvedJsonDocument`), loads it, and builds the
  `FrozenGraph`. Generated clients expose this as a static `fromJSON(doc)` —
  see the codegen section below.
- **Asynchronously at application startup**, via `Prepare(services)`, which
  pulls the document from an injected `IModelDataConnector`
  (`src/model-data/model-data-connector.ts`) and then calls `loadDocument`
  internally. `Prepare` is idempotent by contract and throws
  `ModelDataSource.NoConnectorMessage` if the source was constructed without
  a connector but `Prepare` is called anyway — the synchronous and
  connector-fed paths are mutually exclusive by construction, not by a runtime
  flag.

Two connectors ship today, both trivial by design (the interesting work is
elsewhere): `BundledModelDataConnector` (`bundled-model-data-connector.ts`)
wraps a document that was embedded into the build artifact at compile time —
no I/O, `Prepare` just resolves it — and `DocumentModelDataConnector`
(`document-model-data-connector.ts`) wraps a document handed in at runtime
(for example, one fetched over the network by the host application before
construction). Both exist so `ModelDataSource` itself never has to know
whether its data came from a bundle, a fetch, or a test fixture; a consumer
that needs real I/O and authentication implements `IModelDataConnector`
itself, resolving credentials from the `IServiceProvider` passed to
`Prepare`.

`ModelRegistry` (`model-registry.ts`) is a small service-keyed lookup —
`ServiceKey<ModelRegistry>` — that indexes many `ModelDataSource` instances
by model id and designates one as the root
(`SetRoot`/`RootModel`/`Root`). Its `PrepareAll(services)` is the startup
fan-out: it awaits every registered source's `Prepare` before any synchronous
accessor is used, so a multi-model application (a meta-model shard plus
several library shards) comes up as one coordinated unit rather than each
model racing to load independently.

`GenericModelDataSource` (`generic-model-data-source.ts`) is the one
concrete, non-generated subclass in the tree — a thin constructor over
`ModelDataSource(connector)` with `modelName` set, and nothing else. It is
what the built-in model browser reads (§11's "legacy path"): it only needs
`ConceptNames()` and `Instances(concept)`, both already public on the base
class, so it adds no typed accessors. Every other consumer works through a
generated subclass instead (see codegen below), which is `ModelDataSource`
directly subclassed rather than composed — codegen does not use
`GenericModelDataSource` as a base.

A gotcha worth flagging: the `TodlDocument` type that flows through this
whole layer is imported from `compiler-services/emit/json.js`, which can
read as though `model-data` depends on the compiler. It only depends on the
**shape** — the `{ nodes, edges }` interchange format — not on any of the
compiler's parse/load/validate code. Nothing in `src/model-data/` imports
`api.ts`, the parser, or the loader; the manifest and `FrozenGraph` are all
it touches at runtime.

## reflection-client: the typed read lens and identity-mapped references

`src/reflection-client/ReflectedEntity` (`reflected-entity.ts`) is the
runtime analog of the compiler-side `EntityBase` — a typed read lens over one
reflected instance or taxonomy term. It exposes exactly three protected
primitives that generated subclasses build typed getters on top of:

```ts
protected field(name: string): Scalar | undefined
protected ref(member: string): ReflectedEntity | undefined
protected refs(member: string): readonly ReflectedEntity[]
```

`field` reads a scalar value from an `EntityReader`. `ref`/`refs` resolve
reference members by asking the reader for target ids and then asking an
`EntityHost` — implemented by `ModelDataSource` — to turn each id back into a
`ReflectedEntity`. That host is where identity mapping happens:
`ModelDataSource` keeps a private `entities: Map<string, ReflectedEntity>`
and its `entityFor`/`entity` methods always return the cached instance for a
given id rather than constructing a fresh wrapper. The practical
consequence: if two different entities both reference the same target, `===`
holds between the two `ref()` results — you can safely use entities as map
keys or compare them by reference, the way you would compiled objects in an
ORM's identity map.

Two `EntityReader` implementations feed `ReflectedEntity`. `MirrorReader`
wraps an `InstanceMirror` from the reflection layer (`src/manifest/reflection/`)
and is the ordinary case — one instance in the heap. Its `targets(member)`
reads `this.mirror.node.refs?.[member]` directly rather than going through
`getRelationships()`; the comment in the source explains why: both true
relationships and concept-typed reference *fields* flatten into `node.refs`
in the reflected node, and only some of them are declared via
`getRelationships()`, so `node.refs` is the one source that is uniform across
both origins. `TermReader` wraps a `TermInfo` — a taxonomy term — and answers
`field()` by looking up the term's fixed value for that field
(`term.getFixedValue(field)`); `targets()` is stubbed to return nothing,
since term ref-fixing is explicitly out of scope for this reader today.

`ModelDataSource.instancesOf(concept)` and `.termsOf(taxonomy)` are the two
places these readers get constructed — instances wrap `MirrorReader`, terms
wrap `TermReader` — and both route through the same `entityFor` cache, so a
term and an instance never collide in identity even though they share the
`ReflectedEntity` base.

## codegen: turning a compiled model into deterministic typed TypeScript

`src/codegen/read-client.ts`'s `generateReadClient(repo, options)` is the
generator. It reflects a resolved `Repository` — concepts, taxonomies,
`effectiveSchema` — and emits one `.ts` source file containing:

- **One package class** — `class <Name> extends ModelDataSource` — with a
  constructor that sets `modelName`/`modelVersion`, a `static
  fromJSON(doc: TodlDocument)` factory (this is the entry point mentioned
  above for the synchronous load path), an overridden `protected
  createEntity(reader)` that switches on `reader.concept` to construct the
  right typed subclass, one collection getter per concept, one getter per
  taxonomy, and one authoring-constructor method per concept (covered under
  authoring, below).
- **One entity class per concept** — `class <Concept> extends
  ReflectedEntity` — with a typed getter per scalar field and per reference
  member, each a one-line call into the protected `field`/`ref`/`refs`
  primitives.

Everything is sorted by id before emission, so the output is deterministic
byte-for-byte across runs — useful for diffing generated code in review, and
required for the build's clobber-guard behaviour described in section 10.
Here is a trimmed excerpt from the read-client test fixture
(`src/codegen/tests/fixtures/tech-catalog.generated.ts`), showing the shape
for a `technology` concept that has a scalar `label`, a many-valued
reference `availableIn`, and an optional reference `billing`:

```ts
export class TechCatalog extends ModelDataSource {
  constructor(connector?: IModelDataConnector) {
    super(connector);
    this.modelName = "tech-catalog";
    this.modelVersion = "0.0.0";
  }

  static fromJSON(doc: TodlDocument): TechCatalog {
    const client = new TechCatalog();
    client.loadDocument(doc);
    return client;
  }

  protected override createEntity(reader: EntityReader): ReflectedEntity {
    switch (reader.concept) {
      case "billing": return new Billing(this, reader);
      case "location": return new Location(this, reader);
      case "technology": return new Technology(this, reader);
      default: return super.createEntity(reader);
    }
  }

  get technologies(): readonly Technology[] {
    return this.instancesOf("technology") as readonly Technology[];
  }
}

export class Technology extends ReflectedEntity {
  get label(): string { return this.field("label") as string; }
  get availableIn(): readonly Location[] { return this.refs("availableIn") as readonly Location[]; }
  get billing(): Billing | undefined { return this.ref("billing") as Billing | undefined; }
}
```

`naming.ts` supplies the identifier machinery: `pascalCase`/`camelCase` split
an id on hyphens, underscores, and case boundaries (so both kebab-case and
already-C-like identifiers normalise the same way), `pluralize` is a small
deterministic heuristic (`-y` → `-ies`, `s|x|z|ch|sh` → `+es`, else `+s`),
and `allocateNames` maps a list of ids through a transform and throws on any
collision — `generateReadClient` calls it once up front across every concept
name specifically to fail generation early rather than emit two classes with
the same name.

### Why the naming contract matters

The generated collection getter name is `pluralize(camelCase(conceptId))` —
for concept `technology` that is `technologies`; for a taxonomy, the
collection getter uses the taxonomy's represented concept
(`repo.represents(t)[0]`) rather than the taxonomy id itself. This is called
out in the architecture overview as **load-bearing**, and reading the
[project content generators](content-generators.md) story makes clear why:
`UiPlaceholderGenerator` renders a `ListBox` per concept in `generated/app.mu`
with `ItemsSource = $<collection>`, where `<collection>` is computed by the
exact same `pluralize(camelCase(conceptId))` formula, independently, in the
mural-template generator. The DTO class and the generated view are two
separate generators agreeing on a naming contract with no shared runtime
check between them, and the two sides are not kept in lockstep the same way:
`DtoGenerator` regenerates `generated/model.ts` on every reference change, so
its collection getters always track the current concept set, but
`UiPlaceholderGenerator` only ever writes `generated/app.mu` once, at project
creation (`WritePolicy.WriteOnce`) — hand-edited or not, the file is never
regenerated afterward. Rename a concept later and the DTO's accessor renames
with it, while `app.mu`'s `ItemsSource = $<old-name>` keeps pointing at the
old one and silently binds to nothing, since mural does not error on an
unresolved binding path by default. This is the one place in the whole
consuming layer where a naming heuristic, not a type, is the contract.

`model-package.ts`'s `ModelPackageGenerator.Generate` wraps
`generateReadClient` into a larger, runnable single file: it reuses the
generated DTO class verbatim (`omitHeader: true`), embeds each model's
document shard as a `JSON.parse(...)`-initialised constant, and emits an
`AppRegistry.Create(): ModelRegistry` factory that registers one DTO instance
per shard behind a `BundledModelDataConnector` and calls `SetRoot` on the
application's root model id. This is the multi-model analog of the
single-model `fromJSON` path above, and it is what a compiled application
package actually ships as its data-access surface.

## authoring: the write path back to source

`src/authoring/ModelDraft` (`model-draft.ts`) is the mutable counterpart to
the read-only surfaces above: a delta-based overlay over frozen bases. The
source of truth is an own `TodlDocument` (`{ nodes, edges }`) that mutators
edit directly; the combined working `Repository` (bases ∪ own) is derived on
demand and cached, invalidated on every mutation. A draft opens over a set of
compiled base repositories — `ModelDraft.on(bases, { namespace })` for a
blank draft, or `ModelDraft.fromSource`/`fromSources` to reopen an existing
`.todl` model (single- or multi-file) as an editable overlay, recompiling it
against the bases and stripping the base nodes and the synthesized `model`
container back out so only the genuinely "own" instances remain in the
overlay.

The write entry point is `add(descriptor: InstanceDescriptor)`:

```ts
export interface InstanceDescriptor {
  concept: string;
  id: string;
  scalars?: ReadonlyMap<string, Scalar>;
  refs?: ReadonlyMap<string, readonly NodeId[]>;
}
```

`add` is fail-fast: before it stages anything, it walks every reference
target in `descriptor.refs` and throws if any target id is not already known
(base or own) — no dangling reference is ever staged, even transiently. Note
the comment at `emitAuthoringConstructor` in `read-client.ts`: this is
exactly the record codegen's own per-concept authoring methods build and
return. That earlier `technology(id, fields)` example above has a sibling on
the generated `TechCatalog` class — a `technology(id, fields): InstanceDescriptor`
method with the same shape, one required/optional parameter per scalar
field and per reference member, `readonly Technology[]` for the many-valued
reference and a bare `Billing` for the optional one. A caller typically
writes `draft.add(dto.technology("svc-1", { label: "...", billing:
someBillingEntity }))` — the codegen-emitted constructor and `ModelDraft.add`
are two ends of the same contract, so a change to a concept's schema updates
both sides together the next time codegen runs.

One documented gap: many-valued **scalar** fields (for example an
`identifier[]`) are not authorable today. `Scalar` and
`InstanceDescriptor.scalars` are single-valued
(`Map<string, Scalar>`), so `emitAuthoringConstructor` deliberately skips
emitting a constructor parameter or assignment for any such field — there is
nowhere to stage an array scalar without widening the core `Scalar` type,
which is called out as a deferred decision rather than an oversight. Reading
a many-valued scalar back (via the generated entity's getter) is unaffected;
only writing one through `ModelDraft` is not yet supported.

Once staged, `toTodl()` serialises the overlay delta back to `.todl` model
source (`emitModelTodl` from `compiler-services/emit/todl.ts`, with bindings
derived by `deriveBindings`), and `toTodlByFile()` does the same per home
file for the multi-file case — each own node's "home" is recorded either
explicitly (the `home` parameter to `create`) or, for a draft reopened via
`fromSources`, from the loader's own provenance map, so a model spread across
several `.todl` files round-trips node-for-node back to the file it came
from rather than collapsing to one file. `TodlFileStore`
(`src/authoring/file-store.ts`) is the thin save/load seam over an injected
`FileIO` (`{ read(): Promise<string>; write(content): Promise<void> }`) —
TODL owns only the interface; the concrete `node:fs` or Plexus `IStorage`
adapter is a host concern, keeping the authoring package itself
environment-agnostic, matching the same seam discipline the storage
abstraction elsewhere in the codebase uses.

## Upstream and downstream

Upstream, this whole layer sits on top of
[manifest and reflection](../architecture.md#6-manifest-and-reflection):
`ModelDataSource.loadDocument` bridges a `TodlDocument` into a
`PackageManifestBridge`-resolved manifest, calls `Manifest.load`, and reads
through `FrozenGraph`/`GraphQuery` — the same packed, read-only view that
`Manifest.reflect(node)` and `TypeInfo`/`InstanceMirror` expose elsewhere.
Nothing in `model-data`, `reflection-client`, or the generated codegen output
re-parses or re-validates `.todl` text; that work already happened when the
model was compiled and emitted (`emit/manifest.ts`, `emit/json.ts`).

Downstream, this is the layer the runnable app and the build system are
built on. `DtoGenerator` (see
[Project content generators](content-generators.md)) reflects the project's
full compiled closure and runs `generateReadClient` to write
`generated/model.ts` into the project ahead of any build; the html-bundle
build (section 10) only requires that file be present and never writes it
itself. At build time, `EmitEntryAction` writes `generated/entry.ts` into the
build's sandbox, which calls `<Pkg>.fromJSON(window.__TODL_APP__)` — the
exact synchronous `fromJSON` path described above — to build the DTO that
becomes `TodlAppBootstrap.Mount(app, dto)`'s `dataContext`. The generated
`app.mu`'s `ListBox`es bind to that DTO's collection getters by the naming
contract discussed above. `authoring`'s `ModelDraft` is the one piece of
this section that is not part of that generated-app path at all — it backs
interactive editing tools (project authoring UIs, agent-driven model
construction) that write `.todl` source, not the runtime read path a shipped
application uses.

---

[← Back to the Architecture overview](../architecture.md)

**See also:** [Manifest and reflection](manifest-reflection.md) · [The build system](build-system.md) · [Project content generators](content-generators.md) · [The runnable app](runnable-app.md)
