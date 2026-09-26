# Project content generators

This page is the deep-dive companion to section 10 of the [Architecture overview](../architecture.md).
It covers `src/solution-services/project-services/generators/`: the subsystem that produces
`generated/model.ts` and `generated/app.mu` — files the html-bundle build used to generate itself,
now project content owned by pluggable generators instead. Every type and file path below is taken
directly from the real code in the TODL package (`@pragmatic-tech-ai/todl`).

## The ownership flip

Before this subsystem existed, the html-bundle build's own actions wrote `generated/model.ts` and
`generated/app.mu` into the project as a side effect of building it — a build you never ran meant
those files never existed, and a build was the only way to refresh them after a model change. That
coupled two things that don't belong together: producing project content a developer reads, diffs,
and sometimes hand-edits, and running a build pipeline whose job is to turn already-present content
into a shippable artifact.

The subsystem breaks that coupling. `generated/model.ts` and `generated/app.mu` are now written by
two generators that run off project lifecycle events — creation, a change to the project's base
references, or opening a project that is missing them — independent of any build. The html-bundle
build system, in turn, no longer creates either file: it only *requires* that they already exist,
and fails fast, before doing any other work, if they don't. Generators own project content; the
build requires it.

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
global `{ id → generator }` lookup (`Get(id)`) that rejects a second registration of the same id.
It is assembled once, by `GeneratorRegistryContribution` (`src/application/generator-registry-contribution.ts`),
from two sources: every project factory that implements `IGeneratingProjectFactory` — detected
through the `providesGenerators` type guard, which just checks that `Generators` is a function on
the factory — contributes the generators it returns, keyed under that factory's `typeId`; and any
`Extra` build-registered generators the host supplies on top are layered in the same way. The
registry, once built, is registered into composition under `ProjectGeneratorRegistryKey` so any
part of the host can resolve it.

## The event bus and the scheduler

`ProjectEvents` (`project-events.ts`) is the lifecycle event bus a project factory raises events
through, and generators never see directly. `ProjectEventKind` names the moments: `Created`,
`Opened`, `ReferencesChanged`, `Saved`. A `ProjectEvent` carries the kind plus the project's
storage, type, and manifest. Raising is behind a minimal `IProjectEvents.Raise(event)` interface,
registered under `ProjectEventsKey` — a project factory resolves that key *optionally*: if nothing
is registered, it simply doesn't raise, so a host with no generator subsystem wired up is
unaffected.

`GeneratorScheduler` (`generator-scheduler.ts`) is the one subscriber `GeneratorRegistryContribution`
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

## The two generators

Both ship registered by `ArchitectureProjectFactory.Generators()`, in `Id`, `WritePolicy`,
`Triggers` order — UI placeholder first, DTO second.

### DtoGenerator — generated/model.ts

`DtoGenerator` (`dto-generator.ts`, id `model-dto`) reflects the project's compiled model's full
closure (`model.package.fullDocument`) back into a `Repository` via the compiler's `fromJSON`, then
calls `generateReadClient` — the same codegen used for any typed client (see
[Consuming a model](consuming-a-model.md)) — to produce the DTO source, writing it to
`generated/model.ts` with `WritePolicy.Overwrite`. Its `Triggers` are `ProjectCreated` and
`ReferencesChanged`: the DTO's shape follows the model's shape, so it regenerates both when the
project is first created and whenever the project's base bindings change — a new or updated base
can add, remove, or reshape concepts, and the DTO needs to track that every time.

### UiPlaceholderGenerator — generated/app.mu

`UiPlaceholderGenerator` (`ui-placeholder-generator.ts`, id `app-ui`) reflects the same compiled
closure and hands it to `AppUiTemplate.Render` — the identical template class the old build action
used, one section per concept with a header `TextBlock` and a `ListBox` bound to
`pluralize(camelCase(conceptId))` — writing `generated/app.mu` with `WritePolicy.WriteOnce`. Its
only trigger is `ProjectCreated`. Because `WriteOnce` never touches a path that already exists, the
generator itself needs no clobber-guard marker check to protect a hand edit — the write policy
already guarantees a developer's edited `app.mu` is never overwritten by a later `Created` event
(which in practice only fires once per project anyway) or by a backfill pass. `AppUiTemplate`
still emits its generated-marker first line (`// @generated by todl build — regenerable`) purely as
a human-readable "this was generated" signal; nothing in the generator path reads it back.

## Declaring generators on a project factory

`IGeneratingProjectFactory` (`core/project-factory.ts`) is the one-method interface a project
factory implements to contribute generators:

```ts
export interface IGeneratingProjectFactory
{
    Generators(): readonly IProjectContentGenerator[];
}
```

`providesGenerators(factory)` is the type guard `GeneratorRegistryContribution` uses to detect it
— it just checks that `Generators` is a function on the factory, so a factory that doesn't
implement the interface is skipped rather than erroring. `ArchitectureProjectFactory` is the only
concrete factory that implements it today:

```ts
public Generators(): readonly IProjectContentGenerator[]
{
    return [new UiPlaceholderGenerator(), new DtoGenerator()]
}
```

Meta-model and library projects declare no generators — they are base-producing projects with no
runnable app to generate a DTO or UI for.

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
registered — an existing host that predates the generators subsystem, or one that never wires
`GeneratorRegistryContribution` in, simply never raises and is completely unaffected. Second, the
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

`HtmlBundleBuildSystem`'s single flavor declares two entries, one per generator-owned file:

```ts
private static readonly RequiredContent: readonly RequiredContent[] = [
    { Path: "generated/model.ts", GeneratorId: "model-dto" },
    { Path: "generated/app.mu", GeneratorId: "app-ui" },
];
```

`ProjectBuildManager.CheckRequirements` walks that list before provisioning a sandbox or running any
action — before anything else happens at all — and reports every missing path, each with a hint
naming the generator that owns it, as a build-level error. A project missing `generated/model.ts`
fails immediately with a message pointing at `model-dto`, not several actions deep into a build
with a confusing downstream failure. The html-bundle pipeline itself no longer contains any action
that writes either file: it resolves bases, compiles the model, emits the fixed `entry.ts` build
glue directly into the sandbox (never the project — it is a static template with nothing project-
specific to commit), compiles every `.mu` it finds (including the project's own `generated/app.mu`,
required to already be there), bundles with esbuild, and emits `index.html`. See
[The build system](build-system.md) for the full pipeline.

The result is a clean split of responsibility: this subsystem decides *when* and *whether*
`generated/model.ts` and `generated/app.mu` get (re)written, independent of any build; the build
system decides only whether they are present, and refuses to guess or fabricate them if not.

---

[← Back to the Architecture overview](../architecture.md)

See also: [The build system](build-system.md) · [The runnable app](runnable-app.md) · [Projects and solutions](projects-and-solutions.md) · [Consuming a model](consuming-a-model.md)
