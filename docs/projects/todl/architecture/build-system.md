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
exclusively when every action in the pipeline succeeds. The html-bundle target below
splits cleanly along this line: the four files a developer owns or imports
(`src/app.mu`, `src/main.ts`, `generated/model.ts`, `generated/data.ts`) are written into
`Project` by the [project content generators](content-generators.md), never by a build;
everything the build itself produces — the fixed `entry.ts` glue, the compiled `.mu.js`,
the bundled script, the final `index.html` — is written into `Sandbox`.

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

The multi-flavor capability is no longer just a seam: `NpmPackageBuildSystem` exposes
**two** flavors — `npm-package` (the seven-action pipeline above, a complete package) and
`npm-publish` (the same seven actions plus a terminal `PublishPackageAction`) — while
`HtmlBundleBuildSystem` exposes a single `html-bundle` flavor. Each flavor carries its
own selector `Id` — `npm-package`, `npm-publish`, and `html-bundle` respectively — while
the two npm flavors deliberately share one `OutputName` (`npm-package`), since publishing
stages the same layout and only adds a push step on top of it. The
`build-flavor.test.ts` suite pins the `StaticBuildFlavor` value contract, that
`NpmPackageBuildSystem` exposes two non-empty-pipeline flavors, and that `html-bundle`
exposes one. The type and `StaticBuildFlavor` were introduced in commit `a623b50`
("feat(build): add BuildFlavor + StaticBuildFlavor, expose Flavors() on systems") as part
of the build-system spec, which generalized the earlier design where a system carried its
output name and pipeline directly.

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
        this.Register(new HtmlBundleBuildSystem(new EsbuildBundler()));
    }
}
```

The `new EsbuildBundler()` handed to `HtmlBundleBuildSystem` is the node-only default — the
right choice for this headless, in-process registry. But the dependency is an interface,
`IBundler`, not a concrete class, and that one seam is what lets the *same* build system run in a
browser renderer with the actual bundling pushed to another process. That story is told in full in
the html-bundle section below and in Plexus's
[process-agnostic build deep-dive](../../plexus/architecture/process-agnostic-builds.md).

Two artifact-key classes carry the hot values each system's actions pass around:
`NpmArtifacts` (`ResolvedBases: TodlDocument[]`, `CompiledModel: CompiledPackage`,
`CompiledMural: readonly string[]`) is shared by both systems, since both start the
same way; `HtmlArtifacts` (`CompiledUi`, `AppEntry`, `AppBundle` — `ArtifactKey<string>`
or `ArtifactKey<readonly string[]>`) is html-bundle's own.

### npm-package: the publishable package layout

`NpmPackageBuildSystem` (`npm/npm-package-build-system.ts`) applies to any publishable
project — `MetaModel`, `Library`, or `Architecture` (each carries a graph fragment worth
packaging, even though only meta-models and libraries are meant to be *depended on*).
Its constructor takes a **required** `IPresentationBaker` — no longer optional. The
composer always supplies one (TODL's own `DefaultPresentationBaker`, wrapped in a
`ProviderPresentationBaker` so a host can still override it at bake time — see below),
so both the headless and hosted pipelines bake the same way. The pipeline is seven
actions:

```ts
constructor(baker: IPresentationBaker)
{
    this.actions = [
        new ResolveBasesAction(),
        new CompileModelAction(),
        new CompileMuralAction(),
        new StampResourceKeysAction(),
        new BakeResourcesAction(baker),
        new EmitBundleAction(),
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
A baker is always present, so the gate is just two conditions: the project
`DeclaresResources`, *and* the project is a MetaModel or Library (`OptionsFor` has no
bake options for any other project type, so an Architecture project never bakes even if
it declares resources). Either failing is a clean skip, not a failure. The default
baker (`DefaultPresentationBaker`, now living in TODL alongside `PresentationBake`)
reads icons out of the project, resolves them through mural's include resolver, and
writes the two files — so the bake runs identically in the headless todl pipeline and in
a host. The baker reaches the action through `ProviderPresentationBaker`, which resolves
`PresentationBakerKey` *at bake time*, so a host that registers its own baker under that
key after composition still overrides the default. A referenced icon with no readable
project file is reported as an error and stops the pipeline before promotion.

**6. EmitBundleAction** emits `bundle.json` into the **sandbox** — the load-bearing
index a host's meta-model browser reads to discover and mount a published package. It
runs only for a *producer* project (MetaModel or Library); an Architecture project
carries a graph fragment, not an instantiable palette, so `DiscriminatorFor` returns
`undefined` and the action is a clean no-op. The `.type` discriminator it writes stays
exactly `'meta-model'` or `'library'` — the strings the browser keys on. The action
scans the project for each palette class's template/thumbnail/doc plus the
asset/doc/sample listings (`ProducerResources.Scan`), folds them onto the classes, and
writes the assembled `PackageBundle`; an orphan resource file naming no known class is a
non-blocking warning, not a failure. This ports the bundle-building block out of the
retired `ProducerProjectFactory.publish()` path, so the npm-package flavor's output is
now complete without any factory publish step.

**7. EmitPackageLayoutAction** is the terminal action, writing everything into the
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

Presentation resources, resource keys, `bundle.json`, and compiled `.mu` are therefore
npm-package **build artifacts**: the build produces them when a project declares resources
or ships `.mu`, it does not require them to exist beforehand, and the former user-driven
`regeneratePresentation` project-factory capability that used to refresh them by hand is
gone. See [Project content generators](content-generators.md) for how this line sits
next to the two files that *are* generator-owned.

### npm-publish: publishing as a terminal build action

Publishing is no longer a `factory.publish()` call standing outside the build — it is the
`npm-publish` flavor, the same seven actions plus one terminal `PublishPackageAction`
(`npm/publish-package-action.ts`). That action tars the staged sandbox layout through
`StoragePackagePacker.Pack(ctx.Sandbox)` and pushes it to the registry threaded onto the
context as `ctx.PublishRegistry`. The pack path is `IStorage`-based (web streams), so it
is browser-safe: a publish build runs headlessly, in a CLI, or in a renderer alike.

The registry is not a `ServiceKey` seam. It rides the build request as
`PublishRegistry`, which `TodlProjectBuildManager` (and `SolutionBuildManager`) copy onto
`TodlBuildContext.PublishRegistry` only when present. A host sets it from
`SolutionManagerService.PublishRegistry` — the solution's configured registry connection.
A publish build for a solution with no registry associated fails fast: `PublishPackageAction`
reports "no registry associated with this solution" as an error diagnostic and writes
nothing, so a mis-wired publish never half-lands. And because only the `npm-publish`
flavor appends this action, the plain `npm-package` flavor never touches
`ctx.PublishRegistry` at all — building a package and publishing it are now the same
pipeline stopped one action apart.

### html-bundle: the per-project application compiler

`HtmlBundleBuildSystem` (`html-bundle/html-bundle-build-system.ts`) applies only to
`Architecture` projects and produces something categorically different from
npm-package's output: not a package another project depends on, but a runnable,
self-contained `index.html` a browser can open directly.

An architecture project is an **editable `src/` application**, not a frozen view. Its UI
(`src/app.mu`), its paired view-model (`src/main.ts`), the typed DTO (`generated/model.ts`),
and the data bridge (`generated/data.ts`) are all written into the project by the
[project content generators](content-generators.md) — `src/` once, at creation, then yours
to edit; `generated/` regenerated on every model-shape change — independent of any build.
This pipeline creates none of them; it **requires** all four. `HtmlBundleBuildSystem` declares
that requirement declaratively, on its flavor:

```ts
private static readonly RequiredContent: readonly RequiredContent[] = [
    { Path: "generated/model.ts", GeneratorId: "model-dto" },
    { Path: "generated/data.ts",  GeneratorId: "model-data" },
    { Path: "src/main.ts",        GeneratorId: "app-view-model" },
    { Path: "src/app.mu",         GeneratorId: "app-ui" },
];
```

`ProjectBuildManager.CheckRequirements` walks that list before provisioning a sandbox or
running a single action — before anything else happens — and fails the build with an
error naming each missing path plus the generator that owns it, rather than fabricating
a placeholder or silently proceeding. This is the "require, never create" boundary: a
project that has never had its generators run (or whose files were deleted) fails a build
with a clear, actionable message instead of a confusing failure several actions deep, or a
build action quietly recreating content the generators are supposed to own.

The build system's single dependency on anything node-specific is injected, not hard-wired:
its constructor takes an `IBundler`.

```ts
constructor(bundler: IBundler)
{
    this.actions = [
        new ResolveBasesAction(),
        new CompileModelAction(),
        new EmitEntryAction(),
        new CompileMuralAction(),
        new BundleAppAction(bundler),
        new EmitBundledHostAction(),
    ];
}
```

`IBundler` (`build-system-core/bundler.ts`) is a one-method interface —
`BundleApp(request): Promise<BundleAppResult>` — whose request and result are plain,
serializable `{ Entry, Files: { Path, Text }[] }` / `{ Text?, Diagnostics[] }` shapes. That
is the whole reason the request/result carry no handles: they are designed to survive a trip
across a process boundary. `HtmlBundleBuildSystem.Register(container)` wires the class to
resolve `BundlerKey` from DI, so a host chooses the bundler. The headless registry passes the
node-only `EsbuildBundler`; Plexus's renderer passes an `IpcBundler` that forwards the request
to the main process — same six actions, same build system, the one node-only step pushed
elsewhere. See the Plexus
[process-agnostic build deep-dive](../../plexus/architecture/process-agnostic-builds.md).

**1. ResolveBasesAction** and **2. CompileModelAction** are exactly the two shared
actions described above — the same classes, imported from `npm/`. What matters for
everything downstream is which of `CompiledPackage`'s two documents html-bundle reads:
not `.document` (own nodes only, base references left dangling — what npm-package
writes as `model.json`), but `.fullDocument`, the full transitive closure. A runnable
app has no base packages to resolve at load time, so it needs the whole graph, not a
package fragment.

**3. EmitEntryAction** (`html-bundle/emit-entry-action.ts`) writes `entry.ts` — into the
**sandbox root**, not the project — by filling a small template (`{App}` substituted):

```ts
import { app } from "./src/app.mu.js";
import { {App} } from "./src/main.js";
import { model } from "./generated/data.js";
import { TodlAppBootstrap } from "@pragmatic-tech-ai/todl";
new {App}();
TodlAppBootstrap.Mount(app, model);
```

`{App}` is `AppNaming.AppClass(manifest.id ?? manifest.name)` — the same view-model class
`AppViewModelGenerator` already wrote into `src/main.ts`. `entry.ts` is fixed build glue: it
depends only on the manifest's id or name, is never hand-edited, and so lives in `ctx.Sandbox`,
regenerated fresh every build, rather than in `ctx.Project` beside the generator-owned files.

The line **order here is load-bearing, and is the single subtlest thing in the whole target.**
`import { app }` is first because evaluating the compiled `app.mu.js` is what constructs the
mural `Application` and sets `Application.current`. Only *after* that does `new {App}()` run the
view-model's constructor — the one that registers the instance into `Application.current.Services`
so the markup's `$service({App})` binding can resolve it. Reverse those two, and the view-model
would self-register against an `Application` that does not exist yet, leaving `$service` empty and
the page blank. (The view-model class is only *defined* in `src/main.ts`, never instantiated
there, precisely so this entry controls when the one instance is created.) The full boot sequence
and the two blank-page failure modes it guards against are traced in
[The runnable app](runnable-app.md).

**4. CompileMuralAction** (`html-bundle/compile-mural-action.ts`) compiles the project's
`.mu` into JavaScript, writing into the **sandbox** — compiled JS is build output, never
something a developer edits. It delegates to the shared `MuralCompiler`
(`todl-build-system/mural/mural-compiler.ts`), the same class npm-package uses, but hands
it `MuralOutputLayout.Sibling`:

```ts
const written = await new MuralCompiler(MuralOutputLayout.Sibling).Compile(ctx);
```

`MuralOutputLayout` has two members. The default, `CompiledBasename`, flattens every source
to `compiled/<basename>.mu.js` (what npm-package wants for its package layout). `Sibling`
instead keeps each source's own path and just appends `.js`: `src/app.mu` compiles to
`src/app.mu.js`, `src/widgets/card.mu` to `src/widgets/card.mu.js`. The html-bundle target
needs `Sibling` because its entry point imports the app root by its real project path
(`import { app } from "./src/app.mu.js"`), and because a developer's hand-added `.mu` files
can sit in nested folders whose structure must survive into the bundle. The compiler walks
every `.mu` under the project (hand-authored and the required `src/app.mu` alike — downstream
stages are provenance-blind), excluding build output (`dist/`) and presentation sources
(`presentation.generated.mu`, anything under a top-level `presentation/`). It pre-scans for
output-path collisions and reports any as an error that stops the pipeline before a byte is
written; any mural `ParseError`/`EmitError` is likewise reported by source file name and
stops the pipeline. On any failure it records no `CompiledUi` artifact at all, so the
consume-before-produce contract halts the bundle.

**5. BundleAppAction** (`html-bundle/bundle-app-action.ts`) turns the staged modules into
one self-executing script — but it no longer *does* the bundling itself. Its job is now to
**assemble the input and delegate** to the injected `IBundler`. It gathers the staged file
set — the project's own `src/` and `generated/` trees (read from `ctx.Project`, so a
developer's hand-added `.ts`/`.mu` files come along), plus the compiled `.mu.js` modules and
the `entry.ts` glue from `ctx.Sandbox` — with the sandbox winning any path collision, so a
compiled `src/app.mu.js` is never shadowed by the `src/app.mu` source beside it. Before
delegating it hard-requires `src/app.mu.js` among `HtmlArtifacts.CompiledUi` as the app
root (the known path the entry imports), erroring out with a clear message if it is absent.
Then:

```ts
const result = await this.bundler.BundleApp({ Entry: entry, Files: files });
```

Diagnostics from the bundler are reported through `ctx.Diagnostics`; on success the finished
script lands in `HtmlArtifacts.AppBundle`. Any thrown error is caught and reported as an
error diagnostic (honoring the no-throw action contract) rather than escaping the pipeline.

Everything esbuild-specific now lives behind the seam, in the default `IBundler`,
`EsbuildBundler` (`html-bundle/node/esbuild-bundler.ts`). It is the node-only half: it
materializes the staged `Files` into a real temp directory created **inside the nearest
`node_modules`-bearing root** (so esbuild's normal upward resolution finds the real
`node_modules` and `@pragmatic-tech-ai/todl` resolves by self-reference), then runs esbuild
with `format: "iife"`, `platform: "browser"`, `target: "es2020"`, and `keepNames: true`
(not cosmetic — mural's internal lookups are name-keyed, so renaming bindings would break
resolution at runtime). It carries two further subtleties worth knowing:

- A **`todl-single-mural` dedup plugin**: an `onResolve` hook that anchors every
  `@pragmatic-tech-ai/mural` specifier to the consumer's one hoisted copy. Without it a
  nested second mural copy in the module graph yields two `Application.current` cells, and
  the theme manager throws — a failure that once shipped as a blank page.
- A **`development`-vs-`default` condition probe**: it checks whether todl's `src` is present
  and honors the `development` export condition (raw TypeScript) when it is, falling back to
  the built `dist` otherwise — so the same bundler works against an in-repo checkout and an
  installed package alike.

Failures become `Severity.Error` diagnostics, never exceptions. Because this entire class is
isolated behind `IBundler`, a browser host substitutes an `IpcBundler` that ships the plain
`BundleAppRequest` to another process and runs `EsbuildBundler` there — see the Plexus
[process-agnostic build deep-dive](../../plexus/architecture/process-agnostic-builds.md).

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
ties the html-bundle-specific actions together: `AppEntry` (the sandbox path `entry.ts`,
produced by action 3), `CompiledUi` (the list of compiled `.mu.js` sandbox paths, produced
by action 4), and `AppBundle` (the finished bundle string, produced by action 5 and consumed
by action 6). Action 5 (`BundleAppAction`) is the pipeline's busiest consumer, declaring
`Consumes: [AppEntry, CompiledUi]` — it needs the entry point to bundle and the compiled UI
modules to confirm the app root among. There is no DTO key: `generated/model.ts` and
`generated/data.ts` are produced before this pipeline ever runs, by the project content
generators, so nothing inside html-bundle passes their paths around as hot values — the build
only reads them transitively, through the entry point's imports.

### History note: from a frozen bundle, to a compiled app, to an editable source tree

The current design has gone through three shapes. It started by inlining a single frozen,
committed 3.5 MB runtime bundle into every build and injecting only the model's *data* into it
— one shared, static piece of view logic for every project. That gave way to a per-project
compiler: view logic moved into the project's own generated `app.mu`, and the mural runtime
that renders it is compiled fresh on every build rather than reused verbatim. The third and
current shape moved generation out of the build entirely, into the
[project content generators](content-generators.md), and reshaped the output from one machine
`generated/app.mu` into a real **editable `src/` application** — `src/app.mu` plus a paired
`src/main.ts` view-model, with the DTO and data confined to `generated/`. The build now
*requires* those files rather than creating any, and the old build-time clobber guard is simply
the `WriteOnce` policy on the two `src/` generators, enforced once, outside any build. In the
same arc the one node-only step, esbuild, moved behind the `IBundler` seam, making the whole
target host-agnostic. The trade is a heavier, more moving-parts build (a real mural compile plus
a real bundle per project) in exchange for an application a developer can read, diff, hand-edit,
extend with their own files — and run in a browser renderer as readily as a headless CLI.

## Summary: what to remember

The generic engine's whole job is to make a pipeline's shape checkable before it runs
(consume-before-produce at registration, plus a declarative `Requires` precondition for
project content a generator must have already produced) and its output atomic once it
runs (sandbox-then-promote, only on full success). TODL's two build systems both start
the same way — resolve bases, compile the closure — and then diverge based on what they
are building: npm-package stages a package fragment (`.document`) plus source for
publication; html-bundle requires the project's editable `src/` application plus its
`generated/` DTO and data (written by generators, not by this pipeline), emits the fixed
entry-point glue into its sandbox, compiles and bundles all of it through a swappable
`IBundler`, and emits one file a browser can open with nothing else installed.

---

[← Back to the Architecture overview](../architecture.md)

See also: [Project content generators](content-generators.md) · [The runnable app](runnable-app.md) · [Consuming a model](consuming-a-model.md) · [Publish and packages](publish-and-packages.md)
