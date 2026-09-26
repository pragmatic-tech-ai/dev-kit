# Projects and solutions

This page is the deep-dive companion to section 9 of the
[TODL architecture overview](../architecture.md#9-projects-and-solutions). It
walks through the on-disk project model, the three project types, how a
project's base closure is reassembled at open- and build-time, and how a
multi-project solution is built in dependency order. Everything below is
sourced from `src/solution-services/` in
[the TODL package](https://github.com/pragmatic-tech-ai/TODL) — file paths are
called out so you can jump straight to the code.

## What a project is

A TODL project is nothing more than a directory containing a manifest file
named `project.plexus`, plus whatever `.todl` (and, for architectures,
`.diagram`) files the author adds under it. The manifest's `type` field routes
the directory to the factory that owns it; everything after that is
factory-specific.

The generic envelope every manifest satisfies is `ProjectManifestEnvelope`
(`src/solution-services/project-services/core/project-factory.ts`):

```ts
export interface ProjectManifestEnvelope
{
    type: string
    name?: string
    version?: number
    storage?: string   // absent ⇒ the default 'local' backend
}
```

`PROJECT_MANIFEST_FILENAME` is the literal string `'project.plexus'` — note
the extension is `.plexus`, not `.plexus.json`, even though the content is
plain JSON. The `version` field here is the manifest *format* version, not the
package's published version; those are tracked separately (see below).

The richer, canonical shape of a project's identity and base dependencies
lives in `src/solution-services/package-manager/manifest.ts`:

```ts
export enum ProjectType
{
  MetaModel = "meta-model",
  Library = "library",
  Architecture = "architecture",
}

export interface DependencyRef
{
  id: string;
  version: string;
}

export interface ProjectManifest
{
  type: ProjectType;
  name: string;
  version: number;               // project.plexus format version, NOT the package version
  id?: string;                   // package id (meta-model / library)
  packageVersion?: string;       // published version of the package
  metaModels?: DependencyRef[];
  libraries?: DependencyRef[];
  architectures?: DependencyRef[];
}
```

This is the shape `toPackageJson` (`package-manager/package-json.ts`) reads
when it derives the npm `package.json` at pack time — see
[Publish and packages](../architecture.md#8-publish-and-packages) for that
side of the pipeline. `project.plexus` is the *authoring* source of truth;
`package.json` is generated from it, never the other way around.

### A concrete project.plexus

Base dependencies are recorded per project as `ProjectBaseModelBindings`
(`project-services/core/base-binding.ts`):

```ts
export interface PublishedBaseModelReference
{
    id: string
    version: string
}

export interface ProjectBaseModelBindings
{
    metaModels?: readonly PublishedBaseModelReference[]
    libraries?: readonly PublishedBaseModelReference[]
    architectures?: readonly PublishedBaseModelReference[]
}
```

An architecture project's manifest is the union of the generic envelope, the
producer-style version fields, and this binding shape (see
`ArchitectureProjectFactory` below). A representative `project.plexus` for an
architecture that binds one meta-model and two libraries looks like:

```json
{
  "type": "architecture",
  "name": "payments-platform",
  "version": 1,
  "id": "payments-platform",
  "packageVersion": "0.1.0",
  "metaModels": [
    { "id": "cloud-arch-metamodel", "version": "1.4.0" }
  ],
  "libraries": [
    { "id": "aws-technologies", "version": "2.1.0" },
    { "id": "internal-platform", "version": "0.9.3" }
  ]
}
```

Every binding is pinned to an *exact* version — there are no ranges. Both a
meta-model and each library are ordinary `{ id, version }` pairs; the split
into `metaModels` / `libraries` / `architectures` on the manifest is purely a
user-facing distinction (schema vs. content vs. composed sub-architecture),
not a structural one. Internally every binding funnels through the same
resolution path.

## The three project types

`ProjectType` has exactly three members, and the codebase draws one important
line across them: which types *produce* a base other projects can build on,
and which only *consume* bases.

| Type | Produces a base? | What it authors |
|---|---|---|
| Meta model | Yes | Concepts, fields, relationships, taxonomies — the schema layer |
| Library | Yes | A taxonomy of concrete terms/classes authored against a meta-model |
| Architecture | No (terminal) | Instance-tier models — concrete components wired together, conforming to a meta-model and drawing on libraries |

Meta-model and library projects are **base-producing**: they implement
`IBaseProducingProjectFactory.compileToDocument` and their compiled output can
be published as a package other projects bind to. An architecture project is a
**terminal consumer** — it composes bases (a meta-model, libraries, and even
other architectures) but publishes nothing of its own through the ordinary
publish path; it is packaged by the build system instead (an npm package
layout via the npm-package build, or a runnable app via the html-bundle
build — see [The build system](../architecture.md#10-the-build-system)).

### The factory hierarchy

All lifecycle plumbing — create/open/save, the storage-tree walk that builds
the `Project`/`ProjectNode` tree, and the `.claude/` agent scaffold — lives in
one abstract base, `TodlProjectFactory`
(`project-services/core/todl-project-factory.ts`). A concrete subclass
declares only what differs: its type id, its openable file formats, its
manifest shape, and its own scaffold contribution.

```ts
export abstract class TodlProjectFactory extends ServiceBase implements IProjectFactory
{
    public abstract readonly typeId: string
    public abstract readonly title: string
    public abstract readonly description: string
    public abstract readonly formats: readonly ProjectFileFormat[]

    protected abstract buildManifest(name: string, bindings?: ProjectBaseModelBindings): ProjectManifestEnvelope
    protected abstract scaffoldContributions(): readonly ScaffoldFile[]

    public async createProject(storage: IStorage, name: string, bindings?: ProjectBaseModelBindings): Promise<Project> { /* … */ }
    public async openProject(storage: IStorage): Promise<Project> { /* … */ }
    public async saveProject(project: Project, storage: IStorage): Promise<void> { /* … */ }
}
```

`createProject` writes the manifest, ensures the scaffold, and builds the
in-memory `Project` tree; `openProject` reads the manifest back, self-heals
any missing scaffold file, and rebuilds the tree; `saveProject` rewrites only
the `name` field, leaving every other manifest field untouched. Persistence
always flows through the injected `IStorage`, rooted at the project with
project-relative paths — the same seam that makes a local-filesystem project
and a future cloud-backed one indistinguishable to the factory.

Every project — regardless of type — receives the same base scaffold under
`.claude/`: `todl-manual.md` and `todl-rules.md` (baked into
`scaffold.generated.ts` from the `.md` sources under
`project-services/core/scaffold/` via `npm run gen:scaffold`, so they survive
headless bundling). `ensureScaffold` writes each file only if absent, so an
author's edits are never clobbered; `updateScaffold` is the explicit refresh
path that overwrites everything except a hand-edited root `CLAUDE.md`.

Meta-model and library projects share one more concrete layer,
`ProducerProjectFactory`
(`project-services/core/producer-project-factory-base.ts`), which implements
`IPublishableProjectFactory`, `IBaseProducingProjectFactory`, and
`IVersionedProjectFactory`. Because a meta-model and a library are *the same
thing* internally — both are just a set of taxonomy `.todl` sources compiled
against resolved bases — this one class owns manifest shape
(`ProducerManifest`), version get/set, `compileToDocument`, and the
(now-deprecated) legacy `publish()` path. Presentation is no longer generated
here: it is baked conditionally by the npm-package build itself (see
[The build system](build-system.md)), not by any project-factory capability.
The two concrete subclasses differ only in cosmetic, user-facing details:

- `MetaModelProjectFactory` (`project-services/meta-model-project/meta-model-project-factory.ts`) —
  `typeId = 'meta-model'`, no required bases, presentation dictionary name
  `MetaModelPresentation` with icon prefix `mm:`, and an extra scaffold
  contribution (`meta-model-guide.md`, a `/new-concept` command).
- `LibraryProjectFactory` (`project-services/library-project/library-project-factory.ts`) —
  `typeId = 'library'`, `requiresMetaModel = true` (a library must be
  authored against at least one meta-model — enforced at publish time, not at
  resolution time), presentation dictionary `LibraryPresentation` with no icon
  prefix.

`ArchitectureProjectFactory`
(`project-services/architecture-project/architecture-project-factory.ts`) is
the odd one out: it extends `TodlProjectFactory` directly, not
`ProducerProjectFactory`, because it does not produce a base and has no
`compileToDocument`. It declares both `.todl` and `.diagram` file formats
(`ProjectNodeKind.Todl` / `ProjectNodeKind.Diagram`), sets
`requiresMetaModel = true` and `offersLibraries = true` (the New Project
dialog shows both a meta-model picker and a libraries multi-select), and its
manifest additionally carries a per-diagram `diagrams` map recording which
viewpoints each `.diagram` file shows. Its `.todl` files hold the
*instance-tier* architecture model — concrete components, validated live
against the project's bound meta-model and libraries by the same base-aware
validation the compiler exposes through `checkAgainst`.

`IBaseProducingProjectFactory.compileToDocument`
(`project-services/core/producer-project-factory.ts`) is the shared contract
that both publish and other consumers (such as a workspace-wide base
resolver) call through:

```ts
export interface IBaseProducingProjectFactory
{
    compileToDocument(
        storage: IStorage,
        bases: TodlDocument[],
        provider: IServiceProvider,
    ): Promise<{ doc: TodlDocument; problems: string[] }>
}
```

It takes *already-resolved* bases (it does not resolve its own closure) and
returns compile-error messages as `problems` rather than throwing, so a
caller can decide whether to block (publish) or merely surface (a live
validation pass) an unresolved or broken state.

## Closure reassembly: RecursiveProjectReferencesResolver

A published package's `model.json` is **own-nodes-only** — it records the ids
and versions of the bases it was compiled against (via `dependencies`) rather
than inlining them (see
[Publish and packages](../architecture.md#8-publish-and-packages),
`compilePackage`). That means opening or building a project that binds several
levels of libraries requires reassembling the *full* transitive closure before
compiling: the project's own bindings, each of those packages' recorded
dependencies, and so on.

That job belongs to `RecursiveProjectReferencesResolver.Resolve`
(`project-services/core/base-resolver.ts`):

```ts
export class RecursiveProjectReferencesResolver
{
    public static async Resolve(
        source: IPackageSource,
        bindings: ProjectBaseModelBindings,
    ): Promise<{ bases: TodlDocument[]; problems: string[] }>
    {
        const bases: TodlDocument[] = []
        const problems: string[] = []
        const visited = new Set<string>()

        const queue: PackageRef[] = []
        for (const meta of bindings.metaModels ?? []) queue.push({ kind: PackageKind.MetaModel, ...meta })
        for (const lib of bindings.libraries ?? []) queue.push({ kind: PackageKind.Library, ...lib })
        for (const arch of bindings.architectures ?? []) queue.push({ kind: PackageKind.Architecture, ...arch })

        while (queue.length > 0)
        {
            const ref = queue.shift()!
            const key = `${ref.kind}:${ref.id}@${ref.version}`
            if (visited.has(key)) continue
            visited.add(key)

            const pkg = await source.TryGet(ref)
            if (pkg === undefined)
            {
                problems.push(/* "<kind> "<id>@<version>" is not published" */ '')
                continue
            }
            bases.push(pkg.Document)
            for (const dep of pkg.Dependencies) queue.push(dep)
        }
        return { bases, problems }
    }
}
```

A few things worth calling out:

- It is a plain breadth-first walk, seeded with the project's own bindings and
  widened by each fetched package's own `Dependencies`. Cycle-safety comes
  from the `visited` set keyed by `kind:id@version` — a base that (directly or
  transitively) depends on itself is simply not re-queued, not rejected.
- It reads through a single `IPackageSource` seam
  (`todl-build-system/package-source.ts`), so the resolver is completely
  unaware of *where* a package physically lives — a solution's freshly-built
  siblings, the solution cache, or the npm registry are all just
  implementations of `TryGet(ref): Promise<SourcedPackage | undefined>`. In
  practice this is a `CompositePackageSource` chaining
  `CachingPackageSource` → `SolutionCacheSource` → `RegistrySource` (see
  [Publish and packages](../architecture.md#8-publish-and-packages) for the
  chain itself).
- **A missing binding is a collected problem, not a thrown exception.** If a
  library a project depends on hasn't been published yet — a common state
  while co-developing a meta-model and the architecture that will consume
  it — `Resolve` still returns everything it *could* reach, plus a
  human-readable message per gap (`'library "foo@1.0.0" is not published'`).
  Callers decide what to do with `problems`: `ProducerProjectFactory.publish`
  treats any non-empty `problems` as a hard block (`Publish blocked: …`); the
  npm-package build's `ResolveBasesAction` (via the shared
  `ProjectModelProvider` — see
  [Project content generators](content-generators.md)) reports each problem
  as an error diagnostic and stops the pipeline; a live editor-side validator
  would instead surface it as a diagnostic without refusing to open the
  project. This non-throwing design is what lets a project stay open and
  editable while its bases are mid-publish.

`RecursiveProjectReferencesResolver.Resolve` is the one piece of machinery
shared by both halves of this layer: it is what a single project's
`compileToDocument`/`publish` calls to gather its bases, and — reused
unchanged — what a whole-solution build calls per project before compiling it
inside the build pipeline.

## Solutions: building many projects together

A solution is not its own project type — it's an ordered *set* of projects
built together so that a dependent always sees its dependency's freshest
output, not a stale published version. That orchestration is
`SolutionBuildManager`
(`src/solution-services/todl-build-system/solution/solution-build-manager.ts`).

### The dependency graph

`SolutionBuildManager.DependencyEdges` derives a `Map<ProjectId, ProjectId[]>`
purely from the projects' manifests: it builds a lookup from each project's
produced id (`manifest.id ?? manifest.name`) to its `ProjectId`, then for
every project resolves each of its `metaModels` + `libraries` binding ids
against that lookup — a binding that doesn't match a sibling in this batch is
simply not an edge (it resolves through the external package source instead,
untouched by ordering). Callers may add `ExplicitEdges` — `[dependent,
dependency]` pairs — to force additional ordering the manifests don't
otherwise express.

The pure ordering core lives in `SolutionDependencyGraph`
(`build-system-core/solution/solution-dependency-graph.ts`): a depth-first
post-order traversal that naturally yields dependencies-first order, using a
"gray"/`onStack` set to detect a back edge — a node revisited while still on
the current recursion stack is a cycle, and the offending id chain is
returned in `Cycle` rather than throwing. `SolutionBuildManager.Build` checks
this before doing any work:

```ts
const graph = SolutionDependencyGraph.Order(deps);
if (graph.Cycle !== undefined)
{
    diagnostics.Report({ severity: Severity.Error, message: `dependency cycle: ${graph.Cycle.join(" -> ")}` });
    return SolutionBuildManager.Result(false, [], [], diagnostics, start);
}
```

A cycle aborts the whole solution build immediately — no partial build is
attempted. `SolutionDependencyGraph.Closure` supports the `Target`-scoped case:
when a request names a single target project, the build is narrowed to that
target plus everything it transitively depends on, rather than the whole
solution.

### Running the build and feeding siblings forward

Once ordered, `RunProjects` walks the topo-sorted list and, for each project,
invokes `TodlProjectBuildManager.Build` (the same per-project build manager
[The build system](../architecture.md#10-the-build-system) describes) with a
package source built as:

```ts
Source: new CompositePackageSource([buildOutput, request.ExternalSource]),
```

`buildOutput` is a `BuildOutputSource`
(`todl-build-system/solution/build-output-source.ts`) — an in-memory,
solution-build-scoped `IPackageSource` that starts empty. After each project
finishes successfully, `CaptureOutput` reads that project's freshly-staged
`model.json` from its build output, wraps it as a `SourcedPackage`, and
registers it under the id/version `toPackageJson` would compute for it:

```ts
buildOutput.Add(packageJson.todl.id, packageJson.version, pkg);
```

Because `buildOutput` is placed *first* in the `CompositePackageSource` for
every subsequent project's build, and `CompositePackageSource` resolves
first-hit-wins, a project that binds a sibling built earlier in this same
solution run resolves that sibling's just-produced output — not whatever
older version is sitting in the solution cache or registry. This is exactly
the mechanism `RecursiveProjectReferencesResolver.Resolve` (above) rides on
when it's invoked from inside a solution build: same resolver, same
`IPackageSource` contract, just handed a composite whose first source is this
run's own output.

The run is **fail-fast**: the first project whose build fails marks every
project after it in the topo order as `Skipped` (they are never attempted),
and the overall result is not `Ok`.

```ts
if (result.Ok)
{
    await this.CaptureOutput(project, system, options, request.BuildFlavorId, buildOutput);
    outcomes.push({ ProjectId: id, Status: ProjectBuildStatus.Built, Result: result });
}
else
{
    outcomes.push({ ProjectId: id, Status: ProjectBuildStatus.Failed, Result: result });
    stopped = true; // fail-fast
}
```

Only projects whose build system actually applies are included in the run at
all — `SolutionBuildManager.Applies` feature-tests each project's manifest
against `system.AppliesTo` before it's scheduled, so, for example, requesting
an `html-bundle` solution build naturally drops meta-model/library projects
(that build system only applies to architectures) without needing special
casing in the ordering logic.

## How this layer fits together

Picture the full stack top to bottom:

1. **`project.plexus` + `.todl` sources** — the authored, on-disk project. One
   of the three `TodlProjectFactory` subclasses owns create/open/save and the
   `.claude/` scaffold for it.
2. **Publish** (`src/publish/`, §8) — the pure compile-and-persist spine.
   `compilePackage` turns a producer project's sources plus its *resolved*
   bases into a `CompiledPackage`; `publish` persists it through a
   `PackageStore`. This layer never resolves a closure itself — it is handed
   already-resolved bases.
3. **Projects and solutions (this page, §9)** — sits directly above publish.
   `RecursiveProjectReferencesResolver` is what *does* the resolving publish
   depends on, walking recorded package dependencies through the
   `IPackageSource` chain. `SolutionBuildManager` sits one level higher still:
   it orders a batch of projects by their manifest bindings and drives each
   one through the per-project build, threading fresh output forward via
   `BuildOutputSource` so the resolver — called from inside each project's
   own build — sees this run's siblings before anything published earlier.
4. **The build system** (`src/solution-services/build-system-core/` +
   `todl-build-system/`, §10) — the generic action-pipeline engine
   (`IBuildAction`, `BuildSystemRegistry`, `ProjectBuildManager`) and its
   todl-specific realisations, `npm-package` and `html-bundle`.
   `SolutionBuildManager` is a thin orchestration layer *above* this: it does
   not know what `ResolveBasesAction` or `CompileModelAction` do internally —
   it only knows how to order projects and hand each one to
   `TodlProjectBuildManager`, which runs that project's flavor's action list
   unmodified.

In short: publish knows how to persist a compiled package; the resolver knows
how to walk recorded dependencies into a closure; the project factories know
how to read/write a project's own manifest and sources; and
`SolutionBuildManager` is the piece that makes multi-project development feel
coherent — build a whole solution once, in the right order, and every
dependent project sees its sibling's very latest output without a manual
publish step in between.

## Gotchas

- **`project.plexus` has no `.json` suffix** even though its content is JSON —
  don't assume tooling that globs `*.json` will pick it up.
- **The manifest's `version` field is not the package version.** It is the
  `project.plexus` *format* version (currently `1`); the publishable version
  lives in `packageVersion` (producer projects) — track them separately when
  scripting against manifests.
- **Bindings are exact-pinned, never ranged.** `DependencyRef`/
  `PublishedBaseModelReference` are `{ id, version }` with no semver range
  support — a project always points at one specific published version of a
  base, so upgrading is an explicit manifest edit, not an implicit resolve.
- **An unpublished base does not fail resolution — it degrades it.**
  `RecursiveProjectReferencesResolver.Resolve` keeps walking past a miss and
  reports it in `problems`; a caller that ignores `problems` will silently
  compile against a partial closure. Always check `problems.length` before
  trusting `bases`.
- **A solution's own outputs are ephemeral.** `BuildOutputSource` lives only
  for the duration of one `SolutionBuildManager.Build` call — it is not a
  substitute for actually publishing a project; the next solution build
  starts from an empty `BuildOutputSource` again and falls through to
  whatever is in the solution cache or registry for anything it doesn't
  rebuild.
- **Cycle detection covers solutions, not arbitrary base graphs.**
  `SolutionDependencyGraph` only sees edges between projects present in the
  current solution batch; a cycle formed entirely through already-published
  packages outside this batch would have to be caught earlier, at publish
  time, not here.

---

[← Back to the Architecture overview](../architecture.md)

See also:
- [Publish and packages](publish-and-packages.md)
- [The build system](build-system.md)
- [The TODL language](../todl-language.md)
