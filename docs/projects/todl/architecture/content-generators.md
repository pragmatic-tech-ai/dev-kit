# Project content generators

This page is the deep-dive companion to section 10 of the [Architecture overview](../architecture.md).
It covers `src/solution-services/project-services/generators/`: the subsystem that produces an
architecture project's editable `src/` application and its machine-owned `generated/` support files
— content the html-bundle build used to generate itself, now project content owned by pluggable
generators instead. Every type and file path below is taken directly from the real code in the
TODL package (`@pragmatic-tech-ai/todl`, 0.50.7).

## The ownership flip

Before this subsystem existed, the html-bundle build's own actions wrote the project's DTO and UI
into the project as a side effect of building it — a build you never ran meant those files never
existed, and a build was the only way to refresh them after a model change. That coupled two things
that don't belong together: producing project content a developer reads, diffs, and sometimes
hand-edits, and running a build pipeline whose job is to turn already-present content into a
shippable artifact.

The subsystem breaks that coupling. Four generators now write an architecture project's source tree
off project lifecycle events — creation, a change to the project's base references, or opening a
project that is missing them — independent of any build. They split into two ownership tiers that
the layout itself makes visible:

- **`src/` is yours.** `src/app.mu` (the application UI) and `src/main.ts` (a view-model paired with
  it) are scaffolded **once**, at project creation, and never touched again — you edit them freely,
  add your own `.ts` and `.mu` files beside them, and the build bundles whatever is there.
- **`generated/` is the machine's.** `generated/model.ts` (the typed DTO) and `generated/data.ts`
  (the model instance rehydrated from the page) are **regenerated** whenever the model's shape could
  have changed. You import from them; you never edit them.

The html-bundle build system, in turn, creates none of these files: it only *requires* that the four
exist, and fails fast, before doing any other work, if they don't. Generators own project content;
the build requires it.

## The abstraction: IProjectContentGenerator

`project-content-generator.ts` defines the vocabulary every generator and every caller agrees on.

```ts
export enum GeneratorTrigger
{
    ProjectCreated,
    ReferencesChanged,
    OnDemand,
}

export enum WritePolicy
{
    Overwrite,
    WriteOnce,
    PreserveHandEdits,
}

export interface IProjectContentGenerator
{
    readonly Id: string;
    readonly DisplayName: string;
    readonly Produces: readonly string[];
    readonly Triggers: readonly GeneratorTrigger[];
    readonly WritePolicy: WritePolicy;
    Generate(ctx: GeneratorContext): Promise<GeneratorResult>;
}
```

`GeneratorTrigger` names why a run was requested — a fresh project, a base reference that changed,
or an explicit on-demand call (also the trigger a backfill pass uses, see below). `WritePolicy`
names how a generator's output interacts with content already on disk:

- **Overwrite** — regenerate unconditionally, every run.
- **WriteOnce** — write only if the path is absent; never touch a file that already exists.
- **PreserveHandEdits** — write only if the existing file's first line still matches a marker the
  generator supplies; a file without that marker is treated as hand-authored and left alone.

`Produces` is the list of project-relative paths a generator owns — the same list the "require,
never create" build boundary and the backfill scheduler both read to decide whether a generator's
output is already present. `Generate` receives a `GeneratorContext` — `{ Project: IStorage,
Manifest: ProjectManifest, Model: IProjectModelProvider, Diagnostics: DiagnosticSink, Reason:
GeneratorTrigger }` — and returns a `GeneratorResult` — `{ Written: string[], Skipped: string[] }`
— naming exactly which of its owned paths it wrote versus left alone on this run.

`WritePolicyWriter.Write(storage, path, content, policy, marker?)` is the one place a `WritePolicy`
is actually applied to a write, so every generator gets identical write-once/preserve-hand-edits
behaviour without repeating the check:

```ts
public static async Write(
    storage: IStorage, path: string, content: string,
    policy: WritePolicy, marker?: string): Promise<boolean>
{
    if (policy === WritePolicy.WriteOnce && await storage.Exists(path)) return false;
    if (policy === WritePolicy.PreserveHandEdits && await storage.Exists(path))
    {
        const first = (await storage.ReadText(path)).split("\n")[0];
        if (marker !== undefined && first !== marker) return false;
    }
    await storage.WriteText(path, content);
    return true;
}
```

## The shared model provider: IProjectModelProvider

A generator needs to read the project's compiled model — but compiling a project (resolving its
base bindings, then running `compilePackage` against its `.todl` sources) is exactly what the
build's `ResolveBasesAction`/`CompileModelAction` pair already does. `ProjectModelProvider`
(`project-model-provider.ts`) factors that compile path out into its own class so generators and
the build pipeline share one implementation instead of two that could drift:

```ts
export class ProjectModelProvider implements IProjectModelProvider
{
    public async Compile(): Promise<ProjectModel>
    {
        if (this.cached !== undefined) return this.cached;
        const { bases, problems } = await this.ResolveBases();
        const model = problems.length > 0 ? { errors: [...problems] } : await this.CompileWithBases(bases);
        this.cached = model;
        return model;
    }
    // ResolveBases() mirrors ResolveBasesAction; CompileWithBases() mirrors CompileModelAction.
}
```

`Compile()` is memoised per instance — a second call returns the first call's result rather than
re-running the resolve/compile walk — and returns a `ProjectModel`: either `{ package:
CompiledPackage }` on a clean compile, or `{ errors: string[] }` collapsed to plain messages, so
`IProjectModelProvider` stays independent of the compiler's span-carrying `Diagnostic` shape. A
generator that gets no `package` back reports those messages (or a fallback "no compiled model"
message) through `ctx.Diagnostics` and returns an empty `GeneratorResult` rather than writing
anything.

## The registry: which generators apply to which project type

`ProjectGeneratorRegistry` (`project-generator-registry.ts`) is a small two-index structure: a
`{ projectType → generators[] }` map (`For(projectType)`, what the scheduler iterates) and a
global `{ id → generator }` lookup (`Get(id)`). `Register(projectType, generator)` is idempotent
by generator id — a second registration of the same id is a silent no-op, so a generator that a
factory contributes *and* a host layers in on top converges to one entry rather than erroring.
`RegisterDefinition(provider, def)` is the token-based variant: it resolves a `GeneratorDefinition`'s
`Generator` service token through the provider and registers the instance.

It is assembled once, by `ProjectSystemComposer.Compose` (`project-services/composition/project-system-composer.ts`) —
the single unified seeder that superseded the retired `GeneratorRegistryContribution`. The composer
seeds the registry from the resolved built-in factory instances: every factory that implements
`IGeneratingProjectFactory` — detected through the `providesGenerators` type guard, which just
checks that `Generators` is a function on the factory — contributes the generators it returns, keyed
under that factory's `typeId`. It registers the assembled registry as a DI singleton under
`ProjectGeneratorRegistryKey` so any part of the host can resolve it.

## The event bus and the scheduler

`ProjectEvents` (`project-events.ts`) is the lifecycle event bus a project factory raises events
through, and generators never see directly. `ProjectEventKind` names the moments: `Created`,
`Opened`, `ReferencesChanged`, `Saved`. A `ProjectEvent` carries the kind plus the project's
storage, type, and manifest. Raising is behind a minimal `IProjectEvents.Raise(event)` interface,
registered under `ProjectEventsKey` — a project factory resolves that key *optionally*: if nothing
is registered, it simply doesn't raise, so a host with no generator subsystem wired up is
unaffected.

`GeneratorScheduler` (`generator-scheduler.ts`) is the one subscriber `ProjectSystemComposer`
puts on that bus. Its `Handle(event)` does one of two things:

- For `Created` and `ReferencesChanged`, it maps the event kind to the matching `GeneratorTrigger`
  (`ProjectCreated` / `ReferencesChanged`) and runs every generator registered for the event's
  project type whose `Triggers` include that trigger.
- For `Opened`, it runs a **backfill** pass instead: a generator only runs if *every* path in its
  `Produces` is missing from the project —

  ```ts
  private static async AllMissing(generator: IProjectContentGenerator, event: ProjectEvent): Promise<boolean>
  {
      for (const path of generator.Produces)
      {
          if (await event.Project.Exists(path)) return false;
      }
      return true;
  }
  ```

  — so opening an existing project can heal one that predates the generators subsystem (or one
  where a generator's output was deleted) without ever overwriting a file that is already there,
  hand-authored or previously generated. The run it triggers uses `GeneratorTrigger.OnDemand`.
  `Saved` maps to no trigger and is ignored.

`WritePolicy` is a second, independent guard behind this: even when the scheduler decides a
generator *should* run, the generator's own write policy still governs whether any individual
path actually gets overwritten.

## The four generators

All four ship registered by `ArchitectureProjectFactory.Generators()`, in the order **DTO, data,
view-model, UI**. Two write into `generated/` with `WritePolicy.Overwrite` (regenerated on every
model-shape change); two scaffold `src/` with `WritePolicy.WriteOnce` (written once, then yours
forever). A single class, `AppNaming` (`app-naming.ts`), is the one source of the generated class
names every generator agrees on — `AppNaming.DtoClass(name)` is `pascalCase(name)`, and
`AppNaming.AppClass(name)` is that plus an `App` suffix (e.g. a project named `payments-platform`
yields DTO class `PaymentsPlatform` and app class `PaymentsPlatformApp`). None of the four imports
from another; they only ever agree through `AppNaming` and through the member names codegen emits.

### DtoGenerator — generated/model.ts

`DtoGenerator` (`dto-generator.ts`, id `model-dto`) reflects the project's compiled model's full
closure (`model.package.fullDocument`) back into a `Repository` via the compiler's `fromJSON`, then
calls `generateReadClient` — the same codegen used for any typed client (see
[Consuming a model](consuming-a-model.md)) — to produce the DTO source, writing it to
`generated/model.ts` with `WritePolicy.Overwrite`. Its `Triggers` are `ProjectCreated` and
`ReferencesChanged`: the DTO's shape follows the model's shape, so it regenerates both when the
project is first created and whenever the project's base bindings change — a new or updated base can
add, remove, or reshape concepts, and the DTO needs to track that every time. The emitted class is
named `AppNaming.DtoClass(manifest.id ?? manifest.name)`. It compiles the project's *local* model
(`ctx.Model.CompileLocal()`) — an architecture project has no publishable package id, so it compiles
its own `.todl` against resolved bases without demanding one.

### ModelInstanceGenerator — generated/data.ts

`ModelInstanceGenerator` (`model-instance-generator.ts`, id `model-data`) is the one generator that
needs **no** model compile at all — it emits a two-line bridge module that, at runtime in the
browser, rehydrates the model data the page inlined into `window.__TODL_APP__` through the DTO's
`fromJSON`, and exports the result as `model`. Its `Triggers` are `ProjectCreated` and
`ReferencesChanged`, `WritePolicy.Overwrite`. What it writes (with `<Dto> = AppNaming.DtoClass(...)`):

```ts
// Generated by @pragmatic-tech-ai/todl. Do not edit.
import { <Dto> } from "./model.js";
export const model = <Dto>.fromJSON((window as any).__TODL_APP__);
```

This is the file the whole point of which is to hide `(window as any).__TODL_APP__` from the code a
developer writes: `src/main.ts` imports an already-rehydrated `model`, never the raw global.

### AppViewModelGenerator — src/main.ts

`AppViewModelGenerator` (`app-view-model-generator.ts`, id `app-view-model`) scaffolds the paired
view-model — a demonstration of the platform's major seams in one small, editable class. Its only
trigger is `ProjectCreated`, `WritePolicy.WriteOnce`. The class is named `AppNaming.AppClass(...)`,
extends `Observable` (the lightweight INPC root — not `MuralBase`), registers *itself* into the
`Application`'s service container in its constructor so a `$service` binding can resolve it, and
exposes two getters that read the generated `model`:

```ts
import { Application } from "@pragmatic-tech-ai/mural";
import { Observable } from "@pragmatic-tech-ai/mural/runtime";
import { model } from "../generated/data.js";

export class <App> extends Observable
{
    constructor()
    {
        super();
        Application.current?.Services.addInstance(this);
    }

    public get HelloText(): string
    {
        return "Hello from <Project>";
    }

    public get ConceptSummary(): string
    {
        return `The application has access to ${model.ConceptNames().length} concepts`;
    }
}
```

`<App>` is `AppNaming.AppClass(manifest.id ?? manifest.name)`; `<Project>` is the manifest `name`.
The constructor's `Application.current?.Services.addInstance(this)` is the load-bearing line — it is
how the instance becomes resolvable by `$service(<App>)` from the markup. The two getters exist to
demonstrate the two data paths a real view-model uses: a plain computed string (`HelloText`) and one
derived from the compiled model's reflection API (`model.ConceptNames().length`).

### AppGenerator — src/app.mu

`AppGenerator` (`app-generator.ts`, id `app-ui`) scaffolds the application markup through
`AppUiTemplate.Render(manifest.id ?? manifest.name)`. Its only trigger is `ProjectCreated`,
`WritePolicy.WriteOnce`. The template imports the view-model class as a markup symbol, declares the
`Application`'s root as a `ContentPresenter` whose `Content` is a `$service` binding to the
view-model, and declares a key-less `DataTemplate` typed to that same class so the `ContentPresenter`
auto-selects it to paint the instance:

```
// src/app.mu — your application UI. Edit freely; it is never regenerated.
// The view-model class lives in ./main.ts; bind to its members with $Name.
import <App> from "./main.js"

Application
{
    resources:
    {
        ContentPresenter x:root [ Content = $service(<App>) ]

        DataTemplate [ DataType = <App> ]
        {
            StackPanel [ Orientation = Vertical, Margin = (16,16,16,16) ]
            {
                TextBlock [ Text = $HelloText ]
                TextBlock [ Text = $ConceptSummary ]
            }
        }
    }
}
```

Two mural mechanisms carry this. The top-level `import <App> from "./main.js"` directive makes the
user's TypeScript class a markup symbol — the same facility that lets any `.mu` reference a
hand-written class. And the `DataTemplate [ DataType = <App> ]` is *key-less*: a `ContentPresenter`
whose `Content` resolves to an instance of that type auto-selects the matching key-less template by
type, sets it as `DataContext`, and paints it. `$HelloText` / `$ConceptSummary` then bind against the
view-model sitting in that `DataContext`. See [The runnable app](runnable-app.md) for the exact boot
order these pieces depend on — it is subtler than it looks, and getting it wrong renders a blank page.

Because both `src/` generators are `WriteOnce`, neither needs a clobber-guard marker to protect a
hand edit: the policy already guarantees an edited `app.mu` or `main.ts` is never overwritten by a
later `Created` event (which fires once per project anyway) or by an open-time backfill.

## Declaring generators on a project factory

`IGeneratingProjectFactory` (`core/project-factory.ts`) is the one-method interface a project
factory implements to contribute generators:

```ts
export interface IGeneratingProjectFactory
{
    Generators(): readonly IProjectContentGenerator[];
}
```

`providesGenerators(factory)` is the type guard `ProjectSystemComposer` uses to detect it
— it just checks that `Generators` is a function on the factory, so a factory that doesn't
implement the interface is skipped rather than erroring. `ArchitectureProjectFactory` is the only
concrete factory that implements it today:

```ts
public Generators(): readonly IProjectContentGenerator[]
{
    return [new DtoGenerator(), new ModelInstanceGenerator(), new AppViewModelGenerator(), new AppGenerator()]
}
```

Meta-model and library projects declare no generators — they are base-producing projects with no
runnable app to generate a DTO, data bridge, view-model, or UI for.

## Raising Created

`TodlProjectFactory` (the shared base every project type extends, `core/todl-project-factory.ts`)
raises the `Created` event once a new project's manifest has been written:

```ts
private async raiseCreated(storage: IStorage): Promise<void>
{
    const events = this.Provider.get(ProjectEventsKey)
    if (events === undefined) return
    const manifest = parseManifest(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
    await events.Raise({ Kind: ProjectEventKind.Created, ProjectType: manifest.type, Project: storage, Manifest: manifest })
}
```

Two details matter here. First, the event fires only if a `ProjectEventsKey` service happens to be
registered — an existing host that predates the generators subsystem, or one that never composes
`TodlProjectSystemModule` (or the headless `ProjectSystemContribution`), simply never raises and is
completely unaffected. Second, the
manifest on the event is re-parsed through the package-manager's own `parseManifest`, not passed
through from whatever manifest shape the factory itself was working with — the event needs to carry
the package-manager `ProjectManifest` shape, because that is what `ProjectModelProvider` (and, in
turn, every generator) consumes.

## The build boundary: require, never create

The other half of the ownership flip lives in the build system, not this subsystem — but it only
makes sense in light of it. `BuildFlavor.Requires` (`build-system-core/build-flavor.ts`) is a
declarative list of `RequiredContent`:

```ts
export interface RequiredContent
{
    readonly Path: string;
    readonly GeneratorId?: string;
    readonly Description?: string;
}
```

`HtmlBundleBuildSystem`'s single flavor declares four entries, one per generator-owned file:

```ts
private static readonly RequiredContent: readonly RequiredContent[] = [
    { Path: "generated/model.ts", GeneratorId: "model-dto" },
    { Path: "generated/data.ts",  GeneratorId: "model-data" },
    { Path: "src/main.ts",        GeneratorId: "app-view-model" },
    { Path: "src/app.mu",         GeneratorId: "app-ui" },
];
```

`ProjectBuildManager.CheckRequirements` walks that list before provisioning a sandbox or running any
action — before anything else happens at all — and reports every missing path, each with a hint
naming the generator that owns it, as a build-level error. A project missing `src/app.mu` fails
immediately with a message pointing at `app-ui`, not several actions deep into a build with a
confusing downstream failure. The html-bundle pipeline itself contains no action that writes any of
the four: it resolves bases, compiles the model, emits a fixed `entry.ts` build glue directly into
the sandbox (never the project — it is a static template with nothing project-specific to commit),
compiles every `.mu` it finds (including the project's own `src/app.mu`, required to already be
there), bundles with esbuild, and emits `index.html`. See [The build system](build-system.md) for
the full pipeline.

The result is a clean split of responsibility: this subsystem decides *when* and *whether* the
project's `src/` and `generated/` files get (re)written, independent of any build; the build system
decides only whether they are present, and refuses to guess or fabricate them if not.

## Migrating an older project

Projects created before the editable-`src/` layout existed carry their UI at the old path
`generated/app.mu`. `ArchitectureProjectMigration` (`architecture-project/architecture-project-migration.ts`)
heals them on open. Wired into the `ProjectEvents` bus *before* the `GeneratorScheduler`
(`ProjectSystemComposer.Compose` subscribes it first, and `Raise` awaits subscribers in order), its
`Handle` reacts only to an `Opened` event for an architecture project and calls `Run`:

- If `generated/app.mu` does not exist, it returns — nothing to migrate, idempotent on every
  subsequent open.
- If `generated/app.mu` *and* `src/app.mu` both exist, it leaves both untouched and reports a
  `Warning` asking the developer to merge and delete the old file by hand — it never silently
  discards edits.
- Otherwise it **moves** the file: reads `generated/app.mu`, writes the content verbatim to
  `src/app.mu`, and deletes the original. The old markup is still a valid `Application`, so it is
  carried across intact rather than regenerated.

The ordering is the whole point: the migration must run before the scheduler's open-time backfill,
or `AppGenerator` would scaffold a fresh hello-world `src/app.mu` first, and the `WriteOnce` policy
would then refuse to let the moved older UI land.

## Presentation and .mu as build artifacts

This subsystem's ownership is narrower than "everything a project needs to run": it owns exactly
the project's `src/` application (`src/app.mu`, `src/main.ts`) and its `generated/` DTO and data
(`generated/model.ts`, `generated/data.ts`). Presentation resources, the resource keys stamped
onto them, and compiled `.mu` output are a different kind of thing entirely, and they are **not**
generator-owned.

Both are purely derived from whatever `.todl` and `.mu` a project already has — there is nothing to
hand-edit and nothing a developer would ever want to diff against a previous run — so instead of a
generator, they live on the npm-package build itself (see [The build system](build-system.md)) as
conditional build artifacts:

- **CompileMuralAction** compiles every `.mu` file the project has, hand-authored or
  generator-produced alike — the action doesn't care which — into `compiled/*.mu.js`. A project
  with no `.mu` at all produces none; there is nothing to regenerate or require.
- **StampResourceKeysAction** and **BakeResourcesAction** run only when the project declares at
  least one annotation application that inherits (transitively) from the prelude's `MuralResource`
  annotation (`PresentationResourceEmitter.DeclaresResources`). A project that declares no such
  annotation has no icons, so there is nothing to stamp onto `model.json` or bake.
- Baking is gated one more way: on the project being a MetaModel or Library (an Architecture
  project never bakes, even if it declares resources — `OptionsFor` has no bake options for it).
  The baker itself is always present now: TODL ships its own `DefaultPresentationBaker`, which the
  composer registers unconditionally under `PresentationBakerKey`, so the bake runs identically in
  the headless todl package and in a host. A host that needs different behaviour re-registers that
  key and the build resolves the override at bake time (through `ProviderPresentationBaker`). When
  the project declares no resources, or its type doesn't bake, `BakeResourcesAction` skips cleanly
  rather than failing.

That removes the last user-driven step from this corner of the system entirely. There used to be a
`regeneratePresentation` project-factory capability a developer invoked by hand to refresh a
`presentation.generated.mu` inspection artifact on demand. Both are gone. The build now produces
the same presentation output every time it runs — conditionally, deterministically, as ordinary
build output — with nothing to trigger and nothing that can go stale between a model change and the
next build.

---

[← Back to the Architecture overview](../architecture.md)

See also: [The build system](build-system.md) · [The runnable app](runnable-app.md) · [Projects and solutions](projects-and-solutions.md) · [Consuming a model](consuming-a-model.md)
