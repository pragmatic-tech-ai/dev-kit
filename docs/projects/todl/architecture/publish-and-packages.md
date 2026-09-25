# Publish and packages

Section 8 of the architecture overview compresses a whole subsystem into a few
paragraphs: a pure compile-and-persist spine, a chain of package sources, and a
registry client that turns a compiled model into something another project can
depend on. This page walks the real code behind that summary — `src/publish/`,
`src/solution-services/todl-build-system/`, and
`src/solution-services/package-manager/` in the `@pragmatic-tech-ai/todl`
repository — and traces one dependency from "an author writes project.plexus"
to "a downstream project resolves it back into a base document."

## The pure compile-and-persist spine

`src/publish/publish.ts` opens with a design decision stated right in the file
comment: compute is I/O-free, and persistence is a seam. `compilePackage`
takes bases, sources, and an identity, and returns a `CompileOutcome` — no
storage, no network, nothing async. Only `publish(...)`, a thin wrapper that
calls `compilePackage` and then hands the result to an injected
`PackageStore`, ever touches I/O.

That split exists for a concrete reason: a build system, a CLI, and a test can
all call `compilePackage` synchronously and get a deterministic answer, and
the only thing that changes between "check this model" and "publish this
model" is whether a store is wired in afterward. The build system's own
`CompileModelAction` (`src/solution-services/todl-build-system/npm/compile-model-action.ts`)
is exactly this shape: it calls `compilePackage`, and on success stores the
resulting `CompiledPackage` as a build artifact — persistence happens two
actions later, in `EmitPackageLayoutAction`, once the whole pipeline has
proven it will succeed.

## The two-document CompiledPackage

Internally, `compilePackage` does what `checkAgainst` always does — seed a
`Repository` with the prelude and the given bases, load the sources, validate
— but it adds one extra step that only publishing needs: separating what the
project just added from what it started with.

```ts
const baseIds = new Set<string>();
for (const b of [preludeDocument(), ...bases]) for (const n of b.nodes) baseIds.add(n.id);
const ownIds = new Set(model.allNodes().map((n) => n.id).filter((id) => !baseIds.has(id)));

const fullDocument = toJSON(model, emit);
const document: PackageDocument = toJSONOwn(model, ownIds, emit);
```

`fullDocument` is the entire compiled closure — prelude, every base, and the
project's own nodes — serialized with `emit/json.ts`'s `toJSON`. `document` is
the own-only slice, produced by `toJSONOwn` against the `ownIds` set, with a
`dependencies` array attached naming the `PackageRef`s (kind + id + version)
the caller resolved into `bases`. `document` is what gets written as
`model.json`; `fullDocument` stays attached to the `CompiledPackage` in
memory for anything that needs the whole graph — annotation baking,
presentation generation, the html-bundle build's DTO codegen (section 10 of
the overview covers that consumer).

The comment on `PackageDocument` is worth reading literally: it is a
`TodlDocument` (`{ nodes, edges }`) plus an optional `dependencies` field, and
that extra field is deliberately ignored by `graphFromJSON` and by the
`bases: TodlDocument[]` parameter every compile function takes — so a
`PackageDocument` can be fed straight back in as a base without any
unwrapping. This is why a published package's `model.json` can be handed
directly to `checkAgainst` as one of `bases` the next time someone compiles
against it.

The error gate is the second half of why this design matters:

```ts
const errors = diagnostics.filter((d) => d.severity === Severity.Error);
if (errors.length > 0) return { ok: false, diagnostics, errors };
```

`CompileOutcome.package` is optional and only set on the `ok: true` branch.
There is no code path that constructs a `CompiledPackage` from a failing
compile — the type system enforces "a failing compile yields no package"
rather than merely documenting it. `publish(...)` inherits the guarantee for
free: it checks `outcome.ok` before calling `store.persist(outcome.package)`,
so nothing ever reaches disk or a registry from a model with compiler errors.

## PackageStore: two backends, one contract

`src/publish/stores.ts` defines the persistence seam as a single-method
interface:

```ts
export interface PackageStore
{
  persist(pkg: CompiledPackage): Promise<void>;
}
```

`BlobPackageStore` is the file-oriented implementation Plexus uses today. It
takes a `PackageSink` (`writeText` required, `writeBytes` optional) and a
layout function that defaults to `` `${id}/${version}` ``. Persisting writes
`<base>/model.json` (the own-only `pkg.document`, pretty-printed), one
`<base>/src/<uri>` file per raw `.todl` source in `pkg.sources`, and — if the
sink supports `writeBytes` — every resource under `<base>/<resource.path>`.
If a package carries resources but the sink has no byte writer, persisting
throws rather than silently dropping bytes.

`GraphPackageStore` is the Cypher/Dgraph-family sibling: it deserializes
`pkg.document` back into a `Graph` via `graphFromJSON`, then walks
`allNodes()`/`outEdges()` and calls `addNode`/`addEdge` on an injected
`GraphStore`, committing at the end. Sources are not written — the graph
itself is the store. TODL owns no concrete storage backend for either path;
both take an injected sink, keeping `src/publish/` free of any filesystem or
network dependency.

`StoragePackageStore` (in `todl-build-system/package-store.ts`) is a third
piece worth knowing about, because it is what the build-system and resolver
actually use day to day. It implements `IPackageStore extends IPackageSource`
— both the write and read side of one `IStorage` — by composing a
`SolutionCacheSource` for reads and relying on `BlobPackageStore`'s
`<id>/<version>/` convention for writes. One store, one `IStorage`, both
directions.

## The package-source resolution chain

Where `PackageStore` is how a package is written, `IPackageSource` (in
`todl-build-system/package-source.ts`) is how one is read back, and it is a
chain, not a single lookup:

```ts
export interface IPackageSource
{
    TryGet(ref: PackageRef): Promise<SourcedPackage | undefined>;
}
```

A `SourcedPackage` is a `Document` (the own-only `TodlDocument`), its
recorded `Dependencies`, and optional `resources`. Every source in the chain
returns `undefined` on a miss so the caller can fall through, and every
source is keyed by `id@version` — `PackageKind` never routes, because package
ids are already globally unique.

Four implementations compose the chain, each with a distinct role:

- `CompositePackageSource` tries its sources in order and returns the first
  hit. It is deliberately a pure fallback — it never mutates anything, so
  reordering or adding sources to it can never introduce a surprising write.
- `CachingPackageSource` is the one place in the chain that writes. It wraps
  an `IWritablePackageSource` cache plus an upstream `IPackageSource`: check
  the cache, and on a miss, delegate upstream and `Put` the result back before
  returning it. Everything else in the chain is read-only by construction;
  this decorator is the only writer, which is the whole point of separating
  it from `CompositePackageSource`.
- `SolutionCacheSource` is the `IWritablePackageSource` that usually backs
  the cache slot: an `IStorage`-backed store laid out as
  `<id>/<version>/model.json`, with everything else under that same
  `<id>/<version>/` prefix — except `src/` — treated as a resource and read
  back on `TryGet`, written back on `Put`.
- `RegistrySource` is the terminal source. It maps a bare todl id to its
  scoped npm name (`` `${scope}/${id}` ``, defaulting to
  `@pragmatic-tech-ai`), fetches the tarball via the injected
  `IPackageRegistry`, and reads it with `TarReader`. It only recognizes a
  `package/model.json` alongside a `package/package.json` inside the tarball
  as a TODL package — anything else (a non-TODL npm dependency, or a fetch
  rejection such as a 404 on an unpublished version) is treated as a miss, so
  a `CompositePackageSource` above it falls through cleanly rather than
  failing the build.

A typical resolution stack, read top to bottom as `TryGet` calls unwind, is a
`CompositePackageSource` over — most specific first — an in-memory
`BuildOutputSource` for a solution's just-built sibling packages (see
`solution-services/todl-build-system/solution/build-output-source.ts`, used
by `SolutionBuildManager` per the overview's section 9), a `CachingPackageSource`
wrapping a `SolutionCacheSource`, and a `RegistrySource` as the final fallback.
The `BuildOutputSource` lets a solution build resolve a dependency that was
compiled two minutes ago in the same run and has never touched a registry;
the cache spares a repeat build a round trip to the registry for an unchanged
version; the registry is the source of truth for everything neither of those
covers.

## Registries and the client surface

`IPackageRegistry` (`package-manager/engine/package-registry.ts`) is the
backend-neutral contract: `ListPackages`, `ListVersions`, `GetManifest`,
`GetContent`, `Publish`, `DeleteVersion`, `Test`. `LocalNpmRegistry`
(`package-manager/registries/npm/local-npm-registry.ts`) is the reference
implementation, built over an `IStorage` directory with the layout
`<name>/<version>/package.tgz` + `package.json`, plus the tarball's
`package/**` payload unpacked alongside so a `StoragePackageSource`-style
reader can serve the same tree without unpacking a tarball itself. `Publish`
writes all three; `GetContent`/`GetManifest` resolve `latest` by comparing
dotted-numeric version segments when no explicit version is given.

Above the raw registry protocol sits `PackageRegistryClient`
(`package-manager/package-registry-client.ts`) — the rich, per-connection
surface that everything else (CLI, host UI, the resolver's registry fallback)
actually calls. It never reads a project directory or invokes the compiler;
that split is explicit in the file's own header comment, which reserves
compiling for a separate `PackageCompiler`. Its surface includes `publish(dir)`
(tar+gzips an already-compiled directory under `package/` and calls
`registry.Publish`), `getPackage`/`getContents` (parse a fetched tarball back
into sources, manifest, compiled document, and dependency list), and
`resolveClosure(rootDeps)` — a registry-only breadth-first walk that fetches
each root dependency and its transitive TODL dependencies before resolving
the closure deps-first. This is the client-side analog of
`RecursiveProjectReferencesResolver` (below), used when the caller has no
build-system `IPackageSource` chain to read through and only a bare
`IPackageRegistry` connection.

## From project.plexus to package.json

Everything above resolves and persists a `PackageDocument`. What actually
gets published as an npm package is generated, not authored: `project.plexus`
(`package-manager/manifest.ts`, `ProjectManifest`) is what a human or an
agent edits — `type`, `name`, an `id` and `packageVersion` for meta-models and
libraries, and dependency lists (`metaModels`, `libraries`, `architectures`,
each a `{ id, version }` `DependencyRef`). `package-json.ts`'s
`toPackageJson` is the one-way transform from that authored manifest to the
npm `package.json` a registry actually stores:

```ts
export interface TodlPackageMeta
{
  kind: ProjectType;
  id: string;
}

export interface PackageJson
{
  name: string;
  version: string;
  dependencies: Record<string, string>;
  todl: TodlPackageMeta;
  main: string;
  types: string;
  files: string[];
}
```

Two things about this transform are load-bearing. First, every declared base
— `metaModels`, `libraries`, and `architectures` alike — becomes an npm
`dependencies` entry pinned to an *exact* version, scoped with the configured
prefix (`@pragmatic-tech-ai` by default): `toPackageJson` writes
`` dependencies[`${scope}/${id}`] = version `` with no range operator, so npm's
own resolver can never silently pick a newer base than the one the package
was compiled against. Second, the generated `todl` block —
`{ kind: manifest.type, id }` — is how the resolve/load side identifies a
TODL package independent of its npm name. `RegistrySource` reads this back
by scoping the bare id with its own configured scope, and
`PackageRegistryClient.manifestKind` reads it straight off a fetched
manifest; neither depends on parsing the npm package name. If the `@pragmatic-tech-ai`
scope were ever renamed, resolution keyed on `todl.kind`/`todl.id` would
still work — only `RegistrySource`'s scope parameter would need to change.

`toPackageJson` throws if `manifest.id` or `manifest.packageVersion` is
missing — which is also how it enforces that only meta-models and libraries
are ever transformed into a publishable `package.json`. An architecture
project is a terminal consumer with no `id`/`packageVersion` pair to publish;
calling `toPackageJson` on one is a caller bug, not a silently-degraded
publish, and both `CompileModelAction` and `EmitPackageLayoutAction` call it
unconditionally on the assumption that the npm-package build system is only
ever registered for a base-producing project type.

The build system's `EmitPackageLayoutAction`
(`todl-build-system/npm/emit-package-layout-action.ts`) is where the generated
`package.json` actually meets disk, alongside `model.json` (the compiled
package's own-only document), every raw `.todl` under `src/`, a generated
browser-safe `index.js`/`index.d.ts` handle module that inlines the compiled
document as a no-I/O ES module import, and every non-`.todl` project file
(excluding `dist/`, `node_modules/`, `.git/`, and the manifest itself) packed
verbatim under `resources/`.

## Tracing a downstream resolve

Put the pieces together end to end, the way section 15.B of the overview
sketches at a higher level:

1. A library project's author edits `project.plexus`, declaring one
   `metaModels` binding.
2. `npm-package` build runs `ResolveBasesAction`, which calls
   `RecursiveProjectReferencesResolver.Resolve(ctx.Source, bindings)`
   (`project-services/core/base-resolver.ts`) against the project's
   `IPackageSource` chain. The resolver BFS-walks the binding, calling
   `source.TryGet(ref)` for the meta-model, pushing every `PackageRef` in the
   *returned* package's own `Dependencies` onto the queue, deduping by
   `` `${kind}:${id}@${version}` ``. A binding the source can't produce is
   collected as a string problem rather than thrown, so a project with one
   unpublished base still reports a clean diagnostic instead of crashing the
   build.
3. `CompileModelAction` calls `compilePackage(bases, sources, identity,
   dependencyRefs)` with the resolved base documents, producing a
   `CompiledPackage` whose own `document.dependencies` records exactly the
   direct bindings (not the whole transitive closure the resolver walked —
   only what was declared).
4. `EmitPackageLayoutAction` stages `package.json` + `model.json` + `src/` +
   the handle module + `resources/` into the sandbox; on pipeline success the
   sandbox is promoted to the project's output directory.
5. `PackageRegistryClient.publish(dir)` reads that directory, tar+gzips it
   under `package/`, and calls `registry.Publish(...)` — for
   `LocalNpmRegistry`, that writes `<name>/<version>/package.tgz` +
   `package.json` plus the unpacked payload.
6. A second project that declares this library as a binding runs its own
   `ResolveBasesAction`. If nothing has cached it yet, the chain's
   `RegistrySource` fetches the tarball, `TarReader` extracts
   `package/model.json`, and the parsed `PackageDocument` — own-only nodes
   plus its own recorded `dependencies` — becomes the `SourcedPackage` the
   resolver folds into `bases`. If that library itself depended on a
   meta-model, the resolver's BFS picks up that meta-model's `PackageRef`
   from the fetched document's `Dependencies` and fetches it too, all without
   the downstream author ever declaring it directly — only the direct
   binding needs to be authored; the transitive closure reassembles itself
   through recorded dependencies at every hop.

## Gotchas

A few details are easy to get wrong when working in this area. The
`dependencies` field on a `PackageDocument` records only *direct* bases —
reassembling the transitive closure is the resolver's job, not something
baked into any one package's `model.json`. `CompositePackageSource` never
writes; if a cache slot needs to be populated, it has to be wrapped in a
`CachingPackageSource`, not simply listed earlier in a composite. `RegistrySource`
treats *any* fetch failure, not just a genuine 404, as a miss — a transient
network error looks identical to "this version was never published," so a
composite chain silently falls through to whatever source comes next rather
than surfacing the real cause; this is deliberate (an unreachable registry
should not, by itself, fail a build that can still resolve from cache) but it
means a persistently-unreachable registry can manifest as "package not
found" diagnostics with no hint that the network, not the package, is the
problem. And `toPackageJson`'s exact-version pinning means bumping a base's
version is never a silent no-op for a dependent — every dependent's
`project.plexus` binding has to be bumped and republished before it will
resolve the new version at all.

---

[← Back to the Architecture overview](../architecture.md)

See also: [Projects and solutions](projects-and-solutions.md) · [The build system](build-system.md) · [The compiler](compiler.md)
