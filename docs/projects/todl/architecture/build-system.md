# The build system

This page is the deep-dive companion to section 10 of the [Architecture overview](../architecture.md).
It walks through both layers of the build system: the generic action/artifact engine in
`src/solution-services/build-system-core/`, which names zero TODL types, and its
TODL-coupled realization in `src/solution-services/todl-build-system/`, which ships two
build systems — npm-package (publishable package layout) and html-bundle (a runnable
single-page app). Every type and file path below is taken directly from the real code in
the TODL package (`@pragmatic-tech-ai/todl`) — treat this as a map, not a paraphrase.

## The generic engine: build-system-core

A build is a pipeline of small, typed steps run against a project. `build-system-core`
defines that shape once, generically, so it can be reused for outputs that have nothing
to do with TODL's own concepts — it never imports a compiler type, a manifest type, or
anything else that names a `.todl` construct. A host binds the generics to its own
types; `todl-build-system` is that binding for TODL.

### The unit of work: IBuildAction

Everything a build system does is a list of actions implementing one interface,
`src/solution-services/build-system-core/build-action.ts`:

```ts
export interface IBuildAction<C extends CoreBuildContext = CoreBuildContext>
{
    readonly Name: string;
    readonly Consumes: readonly ArtifactKey<unknown>[];
    readonly Produces: readonly ArtifactKey<unknown>[];
    Execute(ctx: C): Promise<void>;
}
```

An action declares, up front and statically, what typed artifacts it reads
(`Consumes`) and what it writes (`Produces`); `Execute` does the actual work against a
context `C`. File I/O inside `Execute` stays imperative — the interface does not try to
model reads and writes of arbitrary project files, only the small set of hot values
actions pass to each other.

### The hot-value bag: ArtifactKey and BuildArtifacts

`ArtifactKey<T>` (`artifact-key.ts`) is a typed, identity-based key, modeled on the
service-key pattern used elsewhere in the codebase: identity is the object itself, not
its description string, so two keys that happen to share a description are still
distinct slots. `BuildArtifacts` (`build-artifacts.ts`) is the map keyed by those
objects:

```ts
export class BuildArtifacts
{
    private readonly values = new Map<ArtifactKey<unknown>, unknown>();

    public Set<T>(key: ArtifactKey<T>, value: T): void { this.values.set(key, value); }
    public Get<T>(key: ArtifactKey<T>): T | undefined { return this.values.get(key) as T | undefined; }
}
```

The design intent is explicit in the source comment: an action must be correct reading
only files from `Project`/`Sandbox`; the artifact bag is an optimization that lets a
downstream action skip re-reading and re-parsing a file a prior action already produced
in memory — never the sole channel of truth. `CompiledModel` (a `CompiledPackage`) is
the clearest example: the compiler already holds it in memory after `CompileModelAction`
runs, so later actions read it straight off the bag instead of re-parsing `model.json`
off disk.

### The context: CoreBuildContext, and the Project-versus-Sandbox convention

`CoreBuildContext` is what every action's `Execute` receives:

```ts
export interface CoreBuildContext
{
    readonly Project: IStorage;
    readonly Sandbox: IStorage;
    readonly Artifacts: BuildArtifacts;
    readonly Options: BuildOptions;
    readonly Diagnostics: DiagnosticSink;
}
```

Two storages, not one, is the load-bearing design decision here. `Project` is the
project's own directory — persistent, under source control, exactly what the developer
sees in their editor. `Sandbox` is a scratch directory provisioned fresh for this one
build and discarded afterward (or promoted, see below). The convention the whole build
system follows is: **an action that writes into `Project` is a persistent content
generator** — its output is meant to sit alongside the hand-authored `.todl`, be
diffed, committed, and optionally hand-edited; **an action that writes into `Sandbox`
is staging output for this build only**, promoted to the final output directory
exclusively when every action in the pipeline succeeds. The html-bundle actions below
split cleanly along this line: the three generators that produce TypeScript/markup
source (`generated/model.ts`, `generated/app.mu`, `generated/entry.ts`) all write into
`Project`; the two actions that produce actual build artifacts (compiled JS, the final
`index.html`) write into `Sandbox`.

### The registry: consume-before-produce at registration time

`BuildSystemRegistry<C, TProject>` (`build-system-registry.ts`) holds the set of build
systems a host has assembled and enforces one guarantee at `Register` time, before any
build ever runs: every action's `Consumes` keys must already have been `Produces`d by
an earlier action in the same flavor's list.

```ts
private static Validate<C extends CoreBuildContext, TProject>(system: IBuildSystem<C, TProject>): void
{
    for (const flavor of system.Flavors())
    {
        const produced = new Set<ArtifactKey<unknown>>();
        for (const action of flavor.Actions())
        {
            for (const key of action.Consumes)
            {
                if (!produced.has(key))
                {
                    throw new Error(
                        `invalid build system "${system.Id}": action "${action.Name}" consumes ` +
                        `${key.Description} before any earlier action produces it`,
                    );
                }
            }
            for (const key of action.Produces) produced.add(key);
        }
    }
}
```

This is deliberately a static, structural check over the declared `Consumes`/`Produces`
arrays — it never executes an action to find out. The payoff is that a pipeline-ordering
bug (someone reorders two actions, or forgets to append a new action to the end of the
list) fails the moment the build system is registered — typically at process startup, or
in a unit test that constructs the registry — rather than three actions deep into a real
build, with a half-populated sandbox and a confusing "undefined" artifact to debug. It
is the build system's equivalent of a compile-time type error for pipeline shape.

### Build flavors: the selectable output variant

A **build flavor** is the unit the consume-before-produce check above iterates over, and
it is worth understanding on its own because it is what a build request actually selects.

The design starts from a question: a single build system applies to a project type (via
`AppliesTo`), but should it be able to produce that project in more than one shape? A
library might build a normal publishable package, or a debug variant, or a
documentation-only layout. Rather than force each variant to be its own top-level build
system, the system exposes a list of **flavors**, and the caller picks one. A flavor owns
exactly the two things that used to live directly on the system: the name of the output
directory it writes to, and the ordered action pipeline that fills it.

`BuildFlavor<C>` (`build-flavor.ts`) is that abstraction:

```ts
export interface BuildFlavor<C extends CoreBuildContext>
{
    readonly Id: string;
    readonly DisplayName: string;
    readonly OutputName: string;
    Actions(): readonly IBuildAction<C>[];
}
```

- `Id` is the stable selector a build request names to choose this flavor.
- `DisplayName` is the human label (for a build-target picker in a UI).
- `OutputName` is the output directory the manager opens and promotes the sandbox into —
  so two flavors of one system land in two different output directories and never clobber
  each other.
- `Actions()` is the ordered pipeline itself, the same list the registry validates and the
  manager runs.

`IBuildSystem<C, TProject>` exposes them through a single method:

```ts
Flavors(): readonly BuildFlavor<C>[];
```

#### StaticBuildFlavor: the fixed-pipeline common case

Most systems know their pipeline at construction time — they do not need to compute the
action list dynamically. For them, `StaticBuildFlavor<C>` is a ready-made implementation
that simply holds the four values and returns the action list it was given:

```ts
export class StaticBuildFlavor<C extends CoreBuildContext> implements BuildFlavor<C>
{
    constructor(
        public readonly Id: string,
        public readonly DisplayName: string,
        public readonly OutputName: string,
        private readonly actions: readonly IBuildAction<C>[],
    ) {}

    public Actions(): readonly IBuildAction<C>[]
    {
        return this.actions;
    }
}
```

A system with a single output wraps its one pipeline in a single `StaticBuildFlavor`. The
`BuildFlavor` interface is nonetheless the seam that keeps the door open for a flavor that
builds its action list on the fly, without changing anything that consumes flavors.

#### How a flavor is selected, validated, and run

Three consumers close the loop around a flavor, and they map one-to-one onto the three
core types already described:

1. **Selection.** A `ProjectBuildRequest` carries an optional `BuildFlavorId`.
   `BuildSystemRegistry.SelectFlavor(system, flavorId?)` resolves it: the flavor whose
   `Id` matches, or — when no id is given — the system's first flavor. That default is a
   deliberate backward-compatibility affordance for callers that name only a build system
   and expect its single flavor. It returns `undefined` when the id matches nothing (or
   the system exposes no flavors), and `ProjectBuildManager.Build` turns that into an
   `unknown build flavor:` error rather than silently building the wrong thing.
2. **Validation.** The registry's consume-before-produce check runs **per flavor**, not
   per system — each flavor's action list is validated independently at `Register` time,
   because each is an independently runnable pipeline.
3. **Execution.** `ProjectBuildManager.Run(flavor, request)` reads exactly two things off
   the flavor: it calls `storage.OpenOutput(flavor.OutputName, options)` to open the
   right output directory, and `flavor.Actions()` to get the pipeline it sequences,
   checkpoints, and promotes. The manager never looks at the system again once the flavor
   is chosen — the flavor is the complete description of what to build and where to put it.

#### Where flavors stand today

Both TODL build systems currently expose **exactly one** flavor each — `npm-package` and
`html-bundle` — whose `Id` and `OutputName` match the system id. The multi-flavor
capability is a designed-in extension seam, not yet exercised by a second variant, and
the `build-flavor.test.ts` suite pins both the `StaticBuildFlavor` value contract and the
"each built-in system exposes a single, non-empty-pipeline flavor" invariant. The type
and `StaticBuildFlavor` were introduced in commit `a623b50` ("feat(build): add BuildFlavor
+ StaticBuildFlavor, expose Flavors() on systems") as part of the build-system spec, which
generalized the earlier design where a system carried its output name and pipeline
directly.

### The manager: sequencing, diagnostics, and promotion

`ProjectBuildManager<C, T>` (`project-build-manager.ts`) is where a build actually runs.
`Build(request)` looks up the requested system and flavor by id, checks `AppliesTo`, and
calls `Run`. `Run` does the following, in order:

1. Provisions a fresh sandbox (`storage.CreateSandbox()`) and opens the output location
   (`storage.OpenOutput(...)`), both through the injected `IBuildStorageProvider`.
2. Builds the host context via the injected `BuildContextFactory<C, T>` — this is how
   `CoreBuildContext`'s five fields become `TodlBuildContext`'s seven without
   `build-system-core` ever importing a TODL type.
3. Runs the flavor's actions sequentially. Before each action it checkpoints
   `diagnostics.Count`; after it returns (or throws — a thrown error is caught and
   reported as an error diagnostic under the action's name, so a misbehaving action can
   never escape as an uncaught exception) it checks `diagnostics.HasErrorsSince(checkpoint)`.
   Any error reported during that action's window marks it `Failed` and **stops the
   pipeline** — every remaining action is recorded as `Skipped` rather than run.
4. Only if every action succeeded does it call `StorageTree.CopyAll(sandbox, output.Storage)`
   — the sandbox-to-output promotion. A partially-succeeded build promotes nothing; the
   caller gets a `Failed` result and the sandbox is deleted either way.
5. Writes `report.json` into the output directory unconditionally — on success or
   failure — with the per-action outcomes, the full diagnostic list, the artifact file
   list, and the duration.

The upshot: a build either lands a complete, consistent output directory, or it lands
nothing at build-output level (just the report), never a half-written mix of old and
new files. `DiagnosticSink` (`diagnostic-sink.ts`) is the small accumulator behind all
of this — `Report`, a running `Count`, and `HasErrorsSince(checkpoint)` — reusing the
compiler's `Severity` enum but defining its own lightweight `BuildDiagnostic` shape
(`severity`, `message`, an optional `source`) rather than the compiler's span-carrying
`Diagnostic`, since build-level problems ("action failed", "unresolved base") have no
source span to attach.

## The TODL-coupled realization: todl-build-system

`src/solution-services/todl-build-system/` is where the engine gets its TODL teeth.
`TodlBuildContext` (`todl-build-context.ts`) is the host's binding of `C`:

```ts
export interface TodlBuildContext extends CoreBuildContext
{
    readonly Manifest: ProjectManifest;
    readonly Source: IPackageSource;
}
```

`Manifest` is the project's `project.plexus` (base bindings, id, type); `Source` is the
composite package-resolution chain (§8 of the overview) that turns a base binding into an
actual compiled document. `TodlBuildSystemRegistry` (`todl-build-system-registry.ts`)
is a `BuildSystemRegistry<TodlBuildContext, ProjectManifest>` that registers both build
systems in its constructor, so a host resolves one populated registry rather than
hand-assembling it:

```ts
export class TodlBuildSystemRegistry extends BuildSystemRegistry<TodlBuildContext, ProjectManifest>
{
    constructor()
    {
        super();
        this.Register(new NpmPackageBuildSystem());
        this.Register(new HtmlBundleBuildSystem());
    }
}
```

Two artifact-key classes carry the hot values each system's actions pass around:
`NpmArtifacts` (`ResolvedBases: TodlDocument[]`, `CompiledModel: CompiledPackage`,
`CompiledMural: readonly string[]`) is shared by both systems, since both start the
same way; `HtmlArtifacts` (`CompiledUi`, `AppEntry`, `AppBundle` — `ArtifactKey<string>`
or `ArtifactKey<readonly string[]>`) is html-bundle's own.

### npm-package: the publishable package layout

`NpmPackageBuildSystem` (`npm/npm-package-build-system.ts`) applies to any publishable
project — `MetaModel`, `Library`, or `Architecture` (each carries a graph fragment worth
packaging, even though only meta-models and libraries are meant to be *depended on*).
Its constructor takes an optional host `IPresentationBaker`; the headless pipeline runs
with none supplied. The pipeline is six actions:

```ts
constructor(baker?: IPresentationBaker)
{
    this.actions = [
        new ResolveBasesAction(),
        new CompileModelAction(),
        new CompileMuralAction(),
        new StampResourceKeysAction(),
        new BakeResourcesAction(baker),
        new EmitPackageLayoutAction(),
    ];
}
```

**1. ResolveBasesAction** reads the manifest's `metaModels`/`libraries`/`architectures`
bindings and runs `RecursiveProjectReferencesResolver.Resolve(ctx.Source, bindings)`
(the same base-closure resolver behind [Projects and solutions](projects-and-solutions.md)),
reporting each unresolvable binding as an error diagnostic rather than throwing — which
is what stops the pipeline on a missing dependency.

**2. CompileModelAction** collects the project's `.todl` sources
(`TodlProjectSourceFiles.Collect(ctx.Project)`), builds a `PackageIdentity` from the
manifest, and calls the pure `compilePackage(bases, sources, identity, dependencyRefs)`
from `src/publish/`; a failing compile reports the compiler's own diagnostics and
produces no `CompiledModel` artifact, which — by the consume-before-produce contract —
means every later action's `Consumes` check is unsatisfied and the pipeline has already
stopped.

**3. CompileMuralAction** reuses the same shared `MuralCompiler` html-bundle's own
action wraps, compiling every `.mu` file under the project — hand-authored or
generator-produced, this action doesn't distinguish — to `compiled/*.mu.js` in the
**sandbox**. A project with no `.mu` files at all yields an empty `CompiledMural`
artifact and no diagnostic: nothing to compile is not an error.

**4. StampResourceKeysAction** writes a resource key onto every own annotation
application that inherits (transitively) from the prelude's `MuralResource`
annotation, mutating the shared `CompiledPackage.document` in place so the stamped
keys reach `model.json` when it is later serialized. It is gated on
`PresentationResourceEmitter.DeclaresResources(document, fullDocument)`: a project with
no MuralResource-derived annotation applications has nothing to stamp, and the action
is a no-op.

**5. BakeResourcesAction** bakes `presentation/presentation.compiled.json` and
`presentation/icon-index.json` through the constructor-injected `IPresentationBaker`.
It runs only when the project `DeclaresResources`, a baker was actually supplied, *and*
the project is a MetaModel or Library (`OptionsFor` has no bake options for any other
project type, so an Architecture project never bakes even if it declares resources) —
any of those conditions failing is a clean skip, not a failure, since the concrete
baker is mural-coupled and lives host-side (Plexus): the headless todl pipeline never
requires one to exist. A referenced icon with no readable project file is reported as
an error and stops the pipeline before promotion.

**6. EmitPackageLayoutAction** is the terminal action, writing everything into the
**sandbox**: `package.json` (via `toPackageJson(manifest)`, which pins every base as an
exact scoped npm dependency), `model.json` (the compiled package's own-nodes-only
`document` — now carrying any resource keys action 4 stamped onto it — plus its recorded
`dependencies`), the raw `.todl` text under `src/`, a browser-safe handle module
(`index.js`/`index.d.ts` — the compiled `model.json` inlined as an ES module export, so
importing the published package yields its document with zero I/O), and every
non-`.todl`, non-`.mu`, non-manifest project file packed verbatim under `resources/`
(excluding `dist/`, `node_modules/`, and `.git/`). Raw `.mu` is excluded from
`resources/` alongside raw `.todl`: action 3 already compiled it into
`compiled/*.mu.js`, so shipping the source too would double-ship the same view.

Presentation resources, resource keys, and compiled `.mu` are therefore npm-package
**build artifacts**: the build produces them when a project declares resources or ships
`.mu`, it does not require them to exist beforehand, and the former user-driven
`regeneratePresentation` project-factory capability that used to refresh them by hand is
gone. See [Project content generators](content-generators.md) for how this line sits
next to the two files that *are* generator-owned.

### html-bundle: the per-project application compiler

`HtmlBundleBuildSystem` (`html-bundle/html-bundle-build-system.ts`) applies only to
`Architecture` projects and produces something categorically different from
npm-package's output: not a package another project depends on, but a runnable,
self-contained `index.html` a browser can open directly.

`generated/model.ts` (the typed DTO) and `generated/app.mu` (the default view) used to
be written by actions in this very pipeline. They no longer are. Both are now **project
content generators** — see [Project content generators](content-generators.md) for the
full subsystem — that run off project lifecycle events (creation, a changed base
reference, opening a project that is missing them) independent of any build. This
pipeline does not create either file; it **requires** them. `HtmlBundleBuildSystem`
declares that requirement declaratively, on its flavor:

```ts
private static readonly RequiredContent: readonly RequiredContent[] = [
    { Path: "generated/model.ts", GeneratorId: "model-dto" },
    { Path: "generated/app.mu", GeneratorId: "app-ui" },
];
```

`ProjectBuildManager.CheckRequirements` walks that list before provisioning a sandbox or
running a single action — before anything else happens — and fails the build with an
error naming each missing path plus the generator that owns it, rather than fabricating
a placeholder or silently proceeding. This is the "require, never create" boundary: a
project that has never had its generators run (or whose generated files were deleted)
fails a build with a clear, actionable message instead of a confusing failure several
actions deep, or a build action quietly recreating content the generators are supposed
to own.

With that precondition satisfied, the pipeline itself is now six actions, not eight:

```ts
private readonly actions: readonly IBuildAction<TodlBuildContext>[] = [
    new ResolveBasesAction(),
    new CompileModelAction(),
    new EmitEntryAction(),
    new CompileMuralAction(),
    new BundleAppAction(),
    new EmitBundledHostAction(),
];
```

**1. ResolveBasesAction** and **2. CompileModelAction** are exactly the two shared
actions described above — the same classes, imported from `npm/`. What matters for
everything downstream is which of `CompiledPackage`'s two documents html-bundle reads:
not `.document` (own nodes only, base references left dangling — what npm-package
writes as `model.json`), but `.fullDocument`, the full transitive closure. A runnable
app has no base packages to resolve at load time, so it needs the whole graph, not a
package fragment.

**3. EmitEntryAction** (`html-bundle/emit-entry-action.ts`) writes `generated/entry.ts`
— but into the **sandbox**, not the project, by filling a small template:

```ts
import { app } from "../compiled/app.mu.js";
import { {{PkgClass}} } from "./model.js";
import { TodlAppBootstrap } from "@pragmatic-tech-ai/todl";
const dto = {{PkgClass}}.fromJSON((window as any).__TODL_APP__);
TodlAppBootstrap.Mount(app, dto);
```

`{{PkgClass}}` is `pascalCase(manifest.id ?? manifest.name)` — the same DTO class name
the `DtoGenerator` project content generator already wrote into `generated/model.ts`
before this build ever started (that is exactly what the `model-dto` requirement above
guarantees). `entry.ts` is fixed build glue: it does not depend on the compiled model's
shape, only on the manifest's id or name, and it is never hand-edited — which is why it
belongs in `ctx.Sandbox`, regenerated fresh every build, rather than in `ctx.Project`
alongside the two generator-owned files. This is the wiring: rehydrate the model data
that will be inlined into the final page, import the mural `Application` the compiler
will have produced from the project's `generated/app.mu`, and mount one against the
other.

**4. CompileMuralAction** (`html-bundle/compile-mural-action.ts`) is the first action
that writes into the **sandbox** rather than the project — its output is compiled JS,
build output, never something a developer edits directly. It walks every `.mu` file
under the project (`StorageTree.Files`, filtered by extension) — hand-authored ones and
the project's own `generated/app.mu` alike (already required to exist, per above), since
downstream stages are provenance-blind by file type — and compiles each through mural's
own `compile()` to `compiled/<basename>.mu.js`. Before compiling anything, it
precomputes every source's output path and checks for collisions: two `.mu` files in
different folders that share a basename (`a/app.mu` and `b/app.mu`) would both target
`compiled/app.mu.js`, silently clobbering one with the other. That is reported as an
error and the pipeline stops before any file is written, rather than emitting a bundle
built from whichever file happened to compile last. Any compile error (mural's
`ParseError`/`EmitError`, or anything else) is likewise reported by source file name and
stops the pipeline.

**5. BundleAppAction** (`html-bundle/bundle-app-action.ts`) is the most involved action
in the pipeline. It runs esbuild over the staged entry point with:

```ts
{
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    keepNames: true,
    conditions: ["development"],
}
```

`format: "iife"` and `platform: "browser"` produce a single self-executing script safe
to inline into a static page with no module loader; `target: "es2020"` matches the
runtime environments the app targets. `keepNames: true` is not cosmetic — mural relies
on name-keyed lookups internally, so allowing esbuild's minifier/bundler to rename
bindings would silently break resolution at runtime. `conditions: ["development"]` tells
esbuild's resolver to honor the `development` export condition in
`@pragmatic-tech-ai/*` packages' `package.json`, which maps those bare specifiers to
their raw TypeScript `src/` entry points rather than a compiled `dist/`.

The hard part, spelled out at length in the source comments, is module resolution
across storages that aren't necessarily one real filesystem: `generated/entry.ts` lives
in `ctx.Project`, the compiled `.mu.js` modules live in `ctx.Sandbox`, and neither
`IStorage` is guaranteed to sit next to a `node_modules` directory esbuild can walk up
to. The action's answer is to materialize both trees into one real, on-disk temp
directory — created with `mkdtempSync` **inside the TODL repo/source-checkout root**
(found by walking up from the action module's own file location until a `node_modules`
folder turns up) — so that from that staging directory, esbuild's normal upward
`node_modules` walk finds the real one, and the `@pragmatic-tech-ai/todl` package
resolves by self-reference against its own exports map. A regex,
`/\bexport const app\b/`, is used to find exactly one compiled module among
`HtmlArtifacts.CompiledUi` that is the application root — the binding mural emits for an
`Application` carrying an `x:root` visual — with a word-boundary check so a sibling
export like `appBar` or `appTheme` is not misread as a second root; more than one match
is reported as an unsupported ambiguity, and `compiled/app.mu.js` is hard-required as
that root's expected path.

This staging-in-the-repo-root approach is also the source of a deliberate, documented
gotcha: because it resolves `@pragmatic-tech-ai/*` packages through the `development`
condition against their TypeScript `src`, `BundleAppAction` currently only works for an
in-repo or source-checkout TODL — a published, installed TODL package ships only
`dist` (its `src` is absent per the package's `files` allow-list), so bundling against an
installed dependency is not yet supported. The class doc calls this out explicitly as a
known, deferred follow-up: making it work would mean resolving the `default` (built
`dist`) condition instead of `development`, and no consumer builds against an installed
`todl` yet, so the gap has not needed closing.

**6. EmitBundledHostAction** (`html-bundle/emit-bundled-host-action.ts`) is the final
step, writing into the **sandbox**. It reads `NpmArtifacts.CompiledModel.fullDocument`
and `HtmlArtifacts.AppBundle` and calls `HtmlShell.Render(JSON.stringify(payload),
appBundle)`. `HtmlShell` (`html-bundle/html-shell.ts`) is a small, string-constant-only
class that emits a page with a `todl-app-root` mount div, a script tag assigning the
JSON-stringified full document to `window.__TODL_APP__`, and a second script tag holding
the bundled IIFE verbatim — no resource inlining beyond that (a noted, separate deferred
follow-up), and no shard/root payload assembly, since `ModelDataSource.fromJSON` already
accepts exactly the `TodlDocument` shape being inlined.

### What HtmlArtifacts carries

The three keys in `HtmlArtifacts` (`html-bundle/html-artifacts.ts`) are the thread that
ties the html-bundle-specific actions together: `AppEntry` (the path to
`generated/entry.ts`, produced by action 3), `CompiledUi` (the list of compiled `.mu.js`
sandbox paths, produced by action 4), and `AppBundle` (the finished bundle string,
produced by action 5 and consumed by action 6). Action 5 (`BundleAppAction`) is the
pipeline's busiest consumer, declaring `Consumes: [AppEntry, CompiledUi]` — it needs the
entry point to bundle and the compiled UI modules to find the app root among. There is
no `GeneratedDto` key any more: `generated/model.ts` is produced before this pipeline
ever runs, by the `DtoGenerator` project content generator, so nothing inside html-bundle
needs to pass its path around as a hot value — the build only reads it transitively,
through the entry point's `import { {{PkgClass}} } from "./model.js"`.

### History note: from a frozen bundle to a compiled app, to a generator-owned one

The current design has gone through two shapes. It started by inlining a single frozen,
committed 3.5 MB runtime bundle into every build and injecting only the model's *data*
into it — one shared, static piece of view logic for every project. That gave way to the
per-project compiler described above: view logic moved into the project's own generated
`app.mu`, and the mural runtime that renders it is compiled fresh on every build rather
than reused verbatim. A second change then moved `generated/model.ts` and
`generated/app.mu` generation out of this pipeline entirely, into the project content
generators (see [Project content generators](content-generators.md)) — the build now
requires both files rather than creating either, and what used to be a build-time clobber
guard on `generated/app.mu` is now simply `UiPlaceholderGenerator`'s `WriteOnce` policy,
enforced once, outside any build. The trade is a heavier, more moving-parts build (a real
mural compile plus a real esbuild bundle per project) in exchange for a per-project,
per-model view that a developer can actually read, diff, and hand-edit — and, now, edit
independently of ever running a build at all.

## Summary: what to remember

The generic engine's whole job is to make a pipeline's shape checkable before it runs
(consume-before-produce at registration, plus a declarative `Requires` precondition for
project content a generator must have already produced) and its output atomic once it
runs (sandbox-then-promote, only on full success). TODL's two build systems both start
the same way — resolve bases, compile the closure — and then diverge based on what they
are building: npm-package stages a package fragment (`.document`) plus source for
publication; html-bundle requires a typed DTO and a default UI that already live in the
project (written by generators, not by this pipeline), emits the fixed entry-point glue
into its sandbox, compiles and bundles all of it, and emits one file a browser can open
with nothing else installed.

---

[← Back to the Architecture overview](../architecture.md)

See also: [Project content generators](content-generators.md) · [The runnable app](runnable-app.md) · [Consuming a model](consuming-a-model.md) · [Publish and packages](publish-and-packages.md)
