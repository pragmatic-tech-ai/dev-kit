# Process-agnostic builds

Plexus is an Electron app: its UI runs in a sandboxed **renderer** process with no Node
built-ins, while filesystem access and native tooling live in the **main** process. Building
an architecture project needs both worlds — the build engine is pure TypeScript that belongs in
the renderer beside the editors, but esbuild (the one bundling step) needs `node:fs` and a real
`node_modules` tree, which only main has. This page is about how Plexus runs *one* build engine
across that divide by naming only dependency-injection seams, so the same engine code runs
headless in a CLI and split across two processes in the desktop app without changing a line.

The engine is TODL's (`src/solution-services/`); the renderer/main wiring is Plexus's. The
guiding principle: **`BuildService` and every build action run in the renderer; exactly two
seams cross the process boundary** — the bundler and build storage — and both carry only
plain, serializable data.

## The orchestrator: BuildService

`BuildService` (`todl-build-system/build-service.ts`, `Key = ServiceKey('BuildService')`,
`ctor(provider)`) is the single entry point a host calls to build or publish a project. Its two
methods name nothing concrete — only DI keys:

```ts
public async Build(
    project: IStorage, buildSystemId: string, flavorId?: string,
    progress?: IBuildProgress, options?: BuildOptions): Promise<ProjectBuildOutput>
```

`Build` resolves the package store (`PackageStoreKey`), parses the project manifest, resolves the
build-system registry (`BuildSystemRegistryKey`) and the build-storage provider
(`BuildStorageProviderKey`, falling back to an in-memory storage if none is bound), constructs a
`TodlProjectBuildManager`, and runs it. `Publish(project, progress?)` is the same shape pinned to
the `npm-package` system and `npm-publish` flavor, reading the push target from the
[solution manager's](solution-model.md) `PublishRegistry` (falling back to a local on-disk
registry). `static FormatErrors(diagnostics)` renders a build's error diagnostics into one
message a command can throw.

The point is what `BuildService` does *not* reference: no esbuild, no `node:fs`, no Electron. It
names `PackageStoreKey`, `BuildSystemRegistryKey`, `BuildStorageProviderKey`, and — one level
down, inside the html-bundle system — `BundlerKey`. The seams decide where the work physically
runs.

## The four seams

All four are declared in `build-system-core`, the layer that names zero TODL *and* zero host
types.

### IBundler — the one that crosses to another process

```ts
export interface IBundler { BundleApp(request: BundleAppRequest): Promise<BundleAppResult> }
export const BundlerKey = new ServiceKey<IBundler>("Bundler")

interface BundleAppRequest { Entry: string; Files: readonly StagedFile[] }
interface StagedFile       { Path: string; Text: string }
interface BundleAppResult  { Text?: string; Diagnostics: readonly BuildDiagnostic[] }
```

This interface is the whole trick. Its request and result are plain objects — a list of
`{ Path, Text }` files in, a `{ Text?, Diagnostics[] }` out — with no streams, handles, or class
instances. That is deliberate: they are designed to survive `JSON`-style structured-clone across
an IPC channel unchanged. `BundleAppAction` (in the html-bundle pipeline) builds the request and
`await`s `BundlerKey`; it neither knows nor cares whether the bundler runs in-process or in
another one.

### IBuildStorageProvider — the other process-crossing seam

`IBuildStorageProvider` (`build-storage-provider.ts`, `BuildStorageProviderKey`) abstracts where
a build's scratch and output directories live: `CreateSandbox()`, `DeleteSandbox(sandbox)`, and
`OpenOutput(outputName, options): OpenedOutput` (an `{ Storage, Path }` pair). In the renderer it
is backed by the main process's filesystem over the IPC storage bridge, so a build's sandbox and
its promoted `build/` output are real folders on disk even though the engine driving them runs in
the sandboxed renderer.

### IPackageStore and the build-system registry

`IPackageStore` (`package-store.ts`, `PackageStoreKey`) is the resolution source a build reads
bases from — `extends IPackageSource` plus a `Storage` handle; the default `StoragePackageStore`
is a package store over a directory. `BuildSystemRegistry` (`BuildSystemRegistryKey`) holds the
registered build systems and selects a flavor. Neither crosses a process boundary — they live in
the renderer with the engine — but they are seams all the same, so a host supplies the store
implementation it wants (Plexus's is connection-aware; see below).

## The build manager

`BuildService` hands off to `TodlProjectBuildManager` (`todl-build-system/todl-project-build-manager.ts`),
which binds the generic `ProjectBuildManager<TodlBuildContext, ProjectManifest>` to the TODL
context factory (folding `Manifest`, `Source`, and an optional `PublishRegistry` onto the generic
`CoreBuildContext`). `ProjectBuildManager.Run` is the engine heart, and it is entirely
host-agnostic: it checks the flavor's required content (fail-fast "require, never create"), opens
a sandbox and the output directory through the storage provider, runs the flavor's actions over a
shared context — stopping the moment any action reports an error — promotes the sandbox to output
only on full success (`StorageTree.CopyAll`), writes a `report.json`, and deletes the sandbox.
The full mechanics are in TODL's [build system deep-dive](../../todl/architecture/build-system.md);
what matters here is that this code runs unmodified in both hosting modes.

## The renderer/main split, end to end

```
   RENDERER (sandboxed, no node)                        MAIN (node, fs, esbuild)
   ─────────────────────────────                        ────────────────────────
   BuildService
     └─ TodlProjectBuildManager
          └─ ProjectBuildManager.Run
               ├─ HtmlBundleBuildSystem actions
               │   └─ BundleAppAction
               │        └─ IBundler  = IpcBundler ──────────┐
               │                                            │  bundle:app  (BundleIpc)
               │                             window.api.bundle.Bundle(request)
               │                                            │            │
               │                                            └──────────▶ EsbuildBundler.BundleApp
               │                                 BundleAppResult  ◀──────┘   (real esbuild + fs)
               └─ IBuildStorageProvider = RendererBuildStorageProvider ── fs IPC bridge ──▶ disk
```

### Renderer side

`BuildHostModule` (`renderer/modules/build/build-host-module.ts`, a `ShellModule`) composes the
build seams through `BuildComposition.Compose(container)`:

```ts
container.registerInstance(BundlerKey, new IpcBundler());
container.register(BuildStorageProviderKey, (p) =>
    new RendererBuildStorageProvider(env.UserDataDirectory, fs, env.PathSeparator));
HtmlBundleBuildSystem.Register(container);
```

- `IpcBundler` (`ipc-bundler.ts`, `implements IBundler`) forwards `BundleApp(request)` to
  `window.api.bundle.Bundle(request)` — the preload bridge — and throws a clear error if the
  bridge is absent (e.g. in a non-Electron harness).
- `RendererBuildStorageProvider` (`renderer-build-storage-provider.ts`) implements the storage
  seam over `LocalFileStorage` on the IPC filesystem bridge, using `build-sandboxes/sandbox-*`
  and `build-output` directories under the user-data folder. It tolerates a missing
  `OutputRootOverride`, falling back to `<userData>/build-output`.
- `HtmlBundleBuildSystem.Register` adds the html-bundle system to the already-seeded registry,
  resolving `BundlerKey`. It does **not** recompose the project system — the registry and
  generators were already seeded by `TodlProjectSystemModule` earlier in the module order.

The package store is supplied by the app itself:
`ConnectionAwarePlexusPackageStore` (`apps/plexus/.../storage-service-backends.ts`, `static Key =
PackageStoreKey`) wraps a `StoragePackageStore` over `<userData>/packages` with a connection-aware
fallback — a build that needs a base the local store doesn't have resolves it through the
consuming project's effective connection, bridged via
`SolutionWorkspaceService.EffectiveConnectionIdForConsumer`.

### Main side

The main process registers exactly one IPC handler for bundling:

```ts
// shared/bundle-api.ts
export enum BundleChannel { Bundle = 'bundle:app' }

// main/build/bundle-ipc.ts
export class BundleIpc
{
    public static Register(ipc: IpcMain, bundler: IBundler): void
    {
        ipc.handle(BundleChannel.Bundle, (_e, request) => bundler.BundleApp(request));
    }
}

// main/index.ts
BundleIpc.Register(ipcMain, new EsbuildBundler());
```

`EsbuildBundler` (imported from `@pragmatic-tech-ai/todl/project-system`) is the node-only
`IBundler`: it stages the request's `Files` into a temp directory inside the nearest
`node_modules`-bearing root, runs esbuild (`iife` / `browser` / `es2020` / `keepNames`), applies
its `todl-single-mural` dedup plugin and `development`-vs-`dist` condition probe, and returns a
`BundleAppResult`. Because the handler is `IBundler`-typed, the main process depends only on the
engine's interface — the same interface the renderer depends on.

### Why this is "process-agnostic"

The identical `BuildService` → `ProjectBuildManager` → `HtmlBundleBuildSystem` stack runs in
TODL's headless `TodlBuildSystemRegistry` (which binds `BundlerKey` to a direct
`new EsbuildBundler()` and runs everything in one process) and in Plexus's renderer (which binds
`BundlerKey` to `IpcBundler` and pushes the bundle to main). The engine is written once; only the
two seam bindings differ. Nothing in the engine knows a process boundary exists.

## How a build is triggered from the UI

Right-clicking a project row in the [Solution Explorer](solution-explorer.md) builds a context
menu from the registered contributors' `CommandDefinition`s.

**Build ▸** comes from `BuildContributor` (`services/build-contributor.ts`,
`ParentKeys=[NodeKey.Project]`, `Order=20`). Its command ids are `build.menu`, `build.publish`,
and a dynamic `build.run::<systemId>::<flavorId>` per available flavor. `Resolve` maps each to a
`RelayCommand`:

- `build.publish` → `this.mutations.PublishMember(member)`, enabled when
  `IsVersionedMember(member)`.
- `build.menu` → warms the flavor submenu (`BuildFlavorSubmenuContributor.Warm(member)`), which
  reads the member's manifest and enumerates `registry.For(manifest)` × `system.Flavors()` into
  one row per `(system, flavor)` — so the submenu shows exactly the targets that apply to *this*
  project type.
- `build.run::<sys>::<flavor>` → `runBuild(member, sys, flavor)`.

`runBuild` wraps the work in a background task:

```ts
await work.run(`Building ${member}`, async (ctx) =>
{
    await this.mutations.EnsureMemberGenerated(member);
    const options = { OutputRootOverride: `${projectPath}/build` };
    const result = await this.buildService.Build(storage, systemId, flavorId,
        new BuildProgressReporter(ctx), options);
    if (!result.Result.Ok) throw new Error(`Build failed: ${BuildService.FormatErrors(...)}`);
});
```

**Open app / Serve app** come from `HtmlAppContributor` (`html.open` / `html.serve`,
`Order=21`): both call `EnsureMemberGenerated`, then `BuildService.Build('html-bundle',
'html-bundle', …, { OutputRootOverride: <project>/build })`, then either open the produced
`index.html` externally (`fs.OpenExternal`) or start the preview server over the output directory
and open its URL.

The whole flow, once more, as a chain: **menu command → contributor `Resolve` → `RelayCommand` →
`BackgroundWorkService.run` task → `EnsureMemberGenerated` (generators backfill) →
`BuildService.Build`/`Publish` → `TodlProjectBuildManager` → `ProjectBuildManager.Run` (actions
over the seams; `BundleAppAction` crosses IPC to main-process esbuild) → `BuildProgressReporter`
feeds the task row/log → result surfaced (open browser / preview server / Problems dock)**.
`BuildProgressReporter` (`services/build-progress-reporter.ts`) maps the engine's `IBuildProgress`
onto the task progress sink, so a renderer-side build reports live progress even while its
bundling step is executing in another process.

## Gotchas

- **Only the bundler and storage cross the boundary.** Everything else — manifest parsing, base
  resolution, mural compile, host emission — runs in the renderer. If you add a build step that
  needs Node, isolate it behind a new serializable seam the way `IBundler` is; don't move the
  whole build to main.
- **`BundleAppRequest`/`BundleAppResult` must stay plain.** The moment a non-cloneable value
  (a function, a class instance, a stream) leaks into them, the IPC hop fails. Keep them
  `{ Path, Text }` / `{ Text?, Diagnostics[] }`.
- **`HtmlBundleBuildSystem.Register` assumes the registry is already seeded.** The build module
  runs *after* `TodlProjectSystemModule`; registering it into an unseeded container throws on the
  missing registry.
- **Solution-wide Build All / Publish All is deferred.** `SolutionBuildManager` is node-only and
  is deliberately never imported into the renderer; today the explorer builds one project at a
  time. Per-project is the supported path.
- **A build with no bound `BuildStorageProviderKey` still runs** (it falls back to in-memory
  storage) — which means its output is not written to disk. In Plexus the renderer module always
  binds `RendererBuildStorageProvider`; a test harness that forgets to will "succeed" with
  nothing on disk.

---

[← Back to Plexus](../index.md)

See also: [The solution model](solution-model.md) · [The Solution Explorer](solution-explorer.md) · [Build targets](build-targets.md) · [The build system (TODL)](../../todl/architecture/build-system.md)
