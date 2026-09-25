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

`BuildFlavor<C>` (`build-flavor.ts`) is the thing a system's `Flavors()` returns: an id,
a display name, an output directory name, and the ordered `Actions()` list itself.
`StaticBuildFlavor` is the common case — a flavor whose action list is fixed at
construction, which is what both TODL build systems use (each currently exposes exactly
one flavor, matching its system id).

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
`NpmArtifacts` (`ResolvedBases: TodlDocument[]`, `CompiledModel: CompiledPackage`) is
shared by both systems, since both start the same way; `HtmlArtifacts` (`GeneratedDto`,
`CompiledUi`, `AppEntry`, `AppBundle` — all `ArtifactKey<string>` or
`ArtifactKey<readonly string[]>`) is html-bundle's own.

### npm-package: the publishable package layout

`NpmPackageBuildSystem` (`npm/npm-package-build-system.ts`) applies to any publishable
project — `MetaModel`, `Library`, or `Architecture` (each carries a graph fragment worth
packaging, even though only meta-models and libraries are meant to be *depended on*).
Its action list is `ResolveBasesAction → CompileModelAction → [host generators] →
EmitPackageLayoutAction`, where `[host generators]` is a constructor parameter: the
headless pipeline runs with none, while a host that has a mural-aware presentation baker
(Plexus) supplies its own generator (`GeneratePresentationAction`) to slot in after
compile and before emit — after, because it needs the compiled model; before emit,
because it may stamp the document the emit action serializes or stage extra files for
promotion.

`ResolveBasesAction` reads the manifest's `metaModels`/`libraries`/`architectures`
bindings and runs `RecursiveProjectReferencesResolver.Resolve(ctx.Source, bindings)`
(the same base-closure resolver behind §9's project loading), reporting each
unresolvable binding as an error diagnostic rather than throwing — which is what stops
the pipeline on a missing dependency. `CompileModelAction` collects the project's
`.todl` sources (`TodlProjectSourceFiles.Collect(ctx.Project)`), builds a
`PackageIdentity` from the manifest, and calls the pure `compilePackage(bases, sources,
identity, dependencyRefs)` from `src/publish/`; a failing compile reports the compiler's
own diagnostics and produces no `CompiledModel` artifact, which — by the
consume-before-produce contract — means every later action's `Consumes` check is
unsatisfied and the pipeline has already stopped.

`EmitPackageLayoutAction` (`npm/emit-package-layout-action.ts`) is the terminal action,
writing everything into the **sandbox**: `package.json` (via `toPackageJson(manifest)`,
which pins every base as an exact scoped npm dependency), `model.json` (the compiled
package's own-nodes-only `document`, plus its recorded `dependencies`), the raw `.todl`
text under `src/`, a browser-safe handle module (`index.js`/`index.d.ts` — the compiled
`model.json` inlined as an ES module export, so importing the published package yields
its document with zero I/O), and every non-`.todl`, non-manifest project file packed
verbatim under `resources/` (excluding `dist/`, `node_modules/`, and `.git/`).

### html-bundle: the per-project application compiler

`HtmlBundleBuildSystem` (`html-bundle/html-bundle-build-system.ts`) applies only to
`Architecture` projects and produces something categorically different from
npm-package's output: not a package another project depends on, but a runnable,
self-contained `index.html` a browser can open directly. Its action order is fixed by a
controller ruling recorded in the source: it must satisfy consume-before-produce *and*
a file dependency — `generated/app.mu`, written by `GenerateAppUiAction`, must already
exist in the project before `CompileMuralAction` walks the project tree looking for
`.mu` sources to compile.

```ts
private readonly actions: readonly IBuildAction<TodlBuildContext>[] = [
    new ResolveBasesAction(),
    new CompileModelAction(),
    new GenerateModelDtoAction(),
    new GenerateAppUiAction(),
    new GenerateEntryAction(),
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

**3. GenerateModelDtoAction** (`html-bundle/generate-model-dto-action.ts`) is the first
producer specific to this system. It reflects `pkg.fullDocument` back into a `Repository`
via the compiler's own `fromJSON`, then calls `generateReadClient` (§7 of the overview —
the same codegen used for any typed client) to emit a typed DTO source, writing it to
`generated/model.ts` **in the project**. It is a project content generator, not a
sandbox stage, precisely because that file is meant to live under source control next to
the `.todl` it was generated from — a developer can read it, diff it across model
changes, or override it.

**4. GenerateAppUiAction** (`html-bundle/generate-app-ui-action.ts`) generates
`generated/app.mu` — the default view — via `AppUiTemplate.Render(repo)`
(`html-bundle/app-ui-template.ts`). The template is an `Application` with one
`resources:` root visual and one section per concept, sorted by concept id for
determinism. Each section is a header `TextBlock` plus a `ListBox` bound to the matching
DTO collection:

```
Application {
    resources: {
        StackPanel x:root [ Orientation = Vertical, Margin = (12,12,12,12) ] {
            StackPanel [ Orientation = Vertical, Margin = (0,0,0,16) ] {
                TextBlock [ Text = "Technology", FontSize = 15, FontWeight = Bold, Margin = (0,0,0,4) ]
                ListBox [ ItemsSource = $technologies, DisplayMemberPath = "id" ]
            }
        }
    }
}
```

The `$technologies` binding is not a guess — it is `pluralize(camelCase(conceptId))`,
the exact same naming function `generateReadClient` uses to name the collection getter
it puts on the generated DTO class (`get technologies(): readonly Technology[]`). The
two generators never talk to each other directly; they agree on the contract by calling
the identical naming utility (`codegen/naming.ts`) over the identical concept id, which
is why the markup resolves against the DTO instance the bootstrap later assigns as its
`DataContext` with no further wiring. The action also carries a clobber guard: before
writing, it checks whether `generated/app.mu` already exists and, if so, whether its
first line equals `AppUiTemplate.GeneratedMarker` (`// @generated by todl build —
regenerable`). A file that exists but lacks that marker is treated as hand-authored —
the action reports a warning and leaves it untouched rather than discarding a
developer's edits. This is "how entities are shown" moved out of any host and into the
project's own, overridable source.

**5. GenerateEntryAction** (`html-bundle/generate-entry-action.ts`) writes
`generated/entry.ts` — also into the **project** — by filling a small template:

```ts
import { app } from "../compiled/app.mu.js";
import { {{PkgClass}} } from "./model.js";
import { TodlAppBootstrap } from "@pragmatic-tech-ai/todl";
const dto = {{PkgClass}}.fromJSON((window as any).__TODL_APP__);
TodlAppBootstrap.Mount(app, dto);
```

`{{PkgClass}}` is `pascalCase(manifest.id ?? manifest.name)` — the same DTO class
`GenerateModelDtoAction` just generated. This is the wiring: rehydrate the model data
that will be inlined into the final page, import the mural `Application` the compiler
will have produced from `generated/app.mu`, and mount one against the other.

**6. CompileMuralAction** (`html-bundle/compile-mural-action.ts`) is the first action
that writes into the **sandbox** rather than the project — its output is compiled JS,
build output, never something a developer edits directly. It walks every `.mu` file
under the project (`StorageTree.Files`, filtered by extension) — hand-authored ones and
`generated/app.mu` alike, since downstream stages are provenance-blind by file type —
and compiles each through mural's own `compile()` to `compiled/<basename>.mu.js`.
Before compiling anything, it precomputes every source's output path and checks for
collisions: two `.mu` files in different folders that share a basename (`a/app.mu` and
`b/app.mu`) would both target `compiled/app.mu.js`, silently clobbering one with the
other. That is reported as an error and the pipeline stops before any file is written,
rather than emitting a bundle built from whichever file happened to compile last. Any
compile error (mural's `ParseError`/`EmitError`, or anything else) is likewise reported
by source file name and stops the pipeline.

**7. BundleAppAction** (`html-bundle/bundle-app-action.ts`) is the most involved action
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

**8. EmitBundledHostAction** (`html-bundle/emit-bundled-host-action.ts`) is the final
step, writing into the **sandbox**. It reads `NpmArtifacts.CompiledModel.fullDocument`
and `HtmlArtifacts.AppBundle` and calls `HtmlShell.Render(JSON.stringify(payload),
appBundle)`. `HtmlShell` (`html-bundle/html-shell.ts`) is a small, string-constant-only
class that emits a page with a `todl-app-root` mount div, a script tag assigning the
JSON-stringified full document to `window.__TODL_APP__`, and a second script tag holding
the bundled IIFE verbatim — no resource inlining beyond that (a noted, separate deferred
follow-up), and no shard/root payload assembly, since `ModelDataSource.fromJSON` already
accepts exactly the `TodlDocument` shape being inlined.

### What HtmlArtifacts carries

The four keys in `HtmlArtifacts` (`html-bundle/html-artifacts.ts`) are the thread that
ties the seven html-bundle-specific actions together: `GeneratedDto` (the path to
`generated/model.ts`, produced by action 3), `CompiledUi` (the list of compiled `.mu.js`
sandbox paths, produced by action 6), `AppEntry` (the path to `generated/entry.ts`,
produced by action 5), and `AppBundle` (the finished bundle string, produced by action 7
and consumed by action 8). Action 7 is the pipeline's single busiest consumer,
declaring `Consumes: [AppEntry, CompiledUi, GeneratedDto]` — it needs the entry point to
bundle, the compiled UI modules to find the app root among, and (transitively, through
the entry's import of `./model.js`) the generated DTO to exist on disk before it stages
the tree.

### History note: from a frozen bundle to a compiled app

The current design is not the first one. It replaced an earlier approach that inlined a
single frozen, committed 3.5 MB runtime bundle into every build and injected only the
model's *data* into it — one shared, static piece of view logic for every project. View
logic now lives entirely in the project's own generated (and, via the clobber guard,
overridable) `generated/app.mu`, and the mural runtime that renders it is compiled fresh
on every build rather than reused verbatim. The trade is a heavier, more moving-parts
build (a real mural compile plus a real esbuild bundle per project) in exchange for a
per-project, per-model view that a developer can actually read, diff, and hand-edit.

## Summary: what to remember

The generic engine's whole job is to make a pipeline's shape checkable before it runs
(consume-before-produce at registration) and its output atomic once it does
(sandbox-then-promote, only on full success). TODL's two build systems both start the
same way — resolve bases, compile the closure — and then diverge based on what they are
building: npm-package stages a package fragment (`.document`) plus source for
publication; html-bundle reflects the whole closure (`.fullDocument`) into a typed DTO,
a default UI, and wiring that live in the project itself, compiles and bundles all of
it, and emits one file a browser can open with nothing else installed.

---

[← Back to the Architecture overview](../architecture.md)

See also: [The runnable app](runnable-app.md) · [Consuming a model](consuming-a-model.md) · [Publish and packages](publish-and-packages.md)
