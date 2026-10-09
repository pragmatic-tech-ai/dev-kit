# The solution model

Plexus groups projects into a **solution** — the same organizing idea as a Visual Studio
`.sln`: a named, savable set of projects you open, build, and publish together. This page
covers the engine that owns that model (`SolutionManagerService` and `Solution`), what a
solution and its members actually are, and the host-seam contract that lets an engine type
living *below* the UI drive a desktop workbench without ever depending on it.

Everything structural here lives in **TODL**, under
`src/solution-services/solution-manager/`, and is consumed by Plexus — the engine is the
lower layer, Plexus is the host above it. That split is not an accident of packaging; it is
the whole design, and the [layering rule](../../todl/architecture/projects-and-solutions.md)
it obeys is worth keeping in view as you read.

## What a solution is

`Solution` (`solution-manager/engine/solution.ts`) is an `Observable` — a live object the UI
binds to, not a static manifest. Its shape is small:

- `Name: string` — the solution's display name.
- `Storage?: IStorage` — where it is persisted; **`undefined` means untitled**, a solution
  that exists in memory but has never been saved to disk.
- `Members: ObservableCollection<SolutionMember>` — the projects in the solution. Because it
  is observable, the Solution Explorer's project rows update by subscription, not polling.
- `SettingBags` and live property bags — per-solution settings layered over the global ones.
- `IsDirty: boolean` — whether there are unsaved changes.

A **`SolutionMember`** is one project's slot in the solution. It carries a `Ref { path, type }`
(where the project lives and its project type), a `Status`
(`SolutionMemberStatus.Resolved` / `LoadFailed` / `UnknownType`), and — once resolved — its
`Storage`, its loaded `Project`, a `Title`, and any `Error`. The status field is what lets the
explorer render a project that failed to load as a visible error row rather than silently
dropping it: a member whose `type` matches no registered factory is `UnknownType`, one whose
files could not be read is `LoadFailed`, and only a `Resolved` member has a live `Project`.

`AddMember(path, type)` interns a member; `OpenMembers` / `OpenOne` resolve each member's
factory and storage, load the project, and set its status. `RemoveMember` drops one. None of
this is Plexus code — it is the engine's, and a headless CLI drives the exact same `Solution`.

## The manager: SolutionManagerService

`SolutionManagerService` (`solution-manager/engine/solution-manager-service.ts`,
`extends ServiceBase`, registered under `ServiceKey('SolutionManager')`) is the front door for
every solution-level operation. It owns exactly one piece of mutable UI-facing state and a set
of lifecycle verbs.

### The active solution

```ts
public get ActiveSolution(): Solution | undefined
```

There is at most one active solution at a time. A private `setActive(s)` swaps it and raises
`PropertyChanged('ActiveSolution')`. That single signal is the spine the Solution Explorer
hangs off: the explorer resolves the manager, subscribes to that property, and rebuilds its
whole contributor set whenever the active solution changes (see
[The Solution Explorer](solution-explorer.md)). The manager never calls the explorer — it
raises a signal and the explorer reacts, the only direction a lower layer is allowed to talk
to a higher one.

### Lifecycle verbs

The manager's methods are the solution menu, one method per command:

- `NewSolution(location, name?)` / `NewUntitledSolution(name?)` — create a saved or in-memory
  solution.
- `RestoreSession()` — reopen the remembered solution on launch, falling back to an untitled
  one. The "remembered" slice (`lastSolution`, `recentSolutions`) is a `MapPropertyBag`
  registered with the durable application store, so it survives restarts.
- `OpenSolution(location)` — parse the on-disk manifest (`SolutionManifest.parse`), `AddMember`
  per recorded reference, then `OpenMembers`.
- `OpenProject(location)` / `CloseProject(member)` — add or drop a single *ambient* project
  without a saved solution (the common "just open this folder" case).
- `Save()` / `SaveAs(location)` — write the manifest as `<name>.pksln`.
- `Rename(name)`, `CloseSolution()`.
- `Compose(members)` — build a headless `SolutionSession` (via `SolutionBaseResolver` +
  `ResolverPackageSource`) for cross-project base resolution.
- `BuildVantage(global, member?, storage?)` — assemble the property-bag vantage used to resolve
  a connection in context.

The on-disk format is a `.pksln` manifest; the default solution name is `'Default Solution'`.

### The publish registry

```ts
public PublishRegistry: IPackageRegistry | undefined
```

A plain settable field — the registry a publish build pushes to. It is deliberately *not* an
observable property: nothing re-renders when it changes, it is simply read at publish time.
`BuildService.Publish` reads it as
`provider.getRequired(SolutionManagerService.Key).PublishRegistry ?? new LocalNpmRegistry(...)`
— so a solution with no registry configured still publishes, to a local on-disk registry,
rather than failing. See [Process-agnostic builds](process-agnostic-builds.md) for the publish
path.

## The host-seam contract

`SolutionManagerService` lives in the engine, below the UI — yet it opens files, prompts the
user, and resolves packages, all of which are host concerns. It squares that circle the way the
layering rule permits: it declares its own seam interfaces, free of any UI type, and resolves
them from DI. The host binds concrete implementations; the engine never names them.

The seams it resolves in its constructor:

| Key | Contract | What Plexus binds |
|---|---|---|
| `StorageRegistryKey` (`'SolutionStorageProviderRegistry'`) | `IStorageProviderRegistry` | alias of `StorageService.Key` |
| `ProjectFactoryRegistryKey` | the project-factory registry | the composed factory registry |
| `PromptServiceKey` (`'SolutionPromptService'`) | `IPromptService` | `DialogPromptService(DialogService)` |
| `PackageSourceKey` (`'SolutionPackageSource'`) | `PackageSource` | `RendererPackageSource` over `<userData>/packages` |
| `NotificationServiceKey` (`'SolutionNotificationService'`, optional) | `INotificationService` | the app's notification surface |

Each contract is a host-free interface the engine itself declares (`IPromptService` is an
engine type — a `Confirm`/`Prompt` surface — not a mural dialog handed in). The engine asks for
a prompt; it neither knows nor cares that the answer comes from a mural `DialogService`. This is
the one upward-looking seam the layering rule allows, and it is why there is **no "Plexus
solution manager" class**: Plexus contributes only the bindings, in
`solution-seams/solution-seams.ts` (`SolutionSeams.Register`) and the app-level
`solution-seams-host-module.ts`, and consumes the engine service directly through
`SolutionManagerService.Key`.

### Where it is wired

The Plexus renderer composes these in a fixed module order (in the app's root `app.mu`):

```
SolutionSeamsHostModule  →  SolutionServicesEngine  →  BuildHostModule  →  (language service)
```

`SolutionSeamsHostModule` binds the seams *first*, so that when `SolutionServicesEngine` (the
TODL module that registers `SolutionManagerService`) composes, every `getRequired` seam is
already present. `BuildHostModule` comes after, because building needs a resolved solution.

## Gotchas

- **Untitled is a real state, not an error.** `Solution.Storage === undefined` means the
  solution has never been saved; `OpenProject` creates exactly this — an ambient project with
  no saved `.pksln`. Code that assumes a path exists will crash on the common case.
- **A member can be in the solution without being loaded.** Always check
  `SolutionMember.Status` before touching `.Project`; a `LoadFailed` or `UnknownType` member has
  none.
- **`PublishRegistry` is not observable.** Setting it fires no notification by design — read it
  at publish time, don't bind to it.
- **The manifest extension is `.pksln`, and its content is not the project manifest.** A
  solution manifest records member references; each project still has its own `project.plexus`.
- **There is one active solution.** `ActiveSolution` is a single slot; "open another solution"
  replaces it (and raises `PropertyChanged`), it does not add a second.

---

[← Back to Plexus](../index.md)

See also: [The Solution Explorer](solution-explorer.md) · [Process-agnostic builds](process-agnostic-builds.md) · [Build targets](build-targets.md) · [Projects and solutions (TODL)](../../todl/architecture/projects-and-solutions.md)
