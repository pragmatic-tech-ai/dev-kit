# The Solution Explorer

The Solution Explorer is the tree on the left of the Plexus workbench: the active solution,
its projects, each project's files and references, and the global connections — plus every
right-click command that acts on them. This page covers how that tree is built (mural's
hierarchy framework, and the keyed-contributor / delta-provider split), how projects and files
appear in it, and the single mutation seam (`IContentMutations`) every command routes through.

The feature lives in Plexus at
`packages/plexus-core/src/renderer/modules/solution-explorer/`. It is pure host code — it binds
to the engine's [solution model](solution-model.md) and drives the engine's build and content
operations, never the other way around.

## The module and its one service

`solution-explorer.module.mu` declares a shell module that registers four services —
`SolutionExplorerService`, `SolutionWorkspaceService`, `ProjectCommandsService`, and
`LiveValidationSync` — and a `Capability [Name="Solution Explorer", Icon=@ProjectExplorer,
ServiceKey=SolutionExplorerService, Order=10]` that places the explorer in the workbench's
activity rail.

`SolutionExplorerService` (`services/solution-explorer-service.ts`,
`extends Observable implements HierarchyHost`, `Key = ServiceKey('SolutionExplorerService')`) is
the feature's root object. Two of its design decisions shape everything else.

**It owns one `Hierarchy` for its whole lifetime.** The `Hierarchy`
(`@pragmatic-tech-ai/mural/framework/hierarchy`) is created lazily, once, in `ensureHierarchy()`:

```ts
this.hierarchy = new Hierarchy(registry, this, { Services: this.menuServices });
// registry = provider.getRequired(HierarchyContributorRegistry.Key)
```

The tree instance never gets swapped — only its *contributors* change when the active solution
changes. Replacing the `Hierarchy` object itself would break mural's
`HierarchyContextMenuBehavior`, which holds a reference to it; so the service mutates the
contributor set in place instead.

**It rebuilds on the active-solution signal.** `Start()` resolves `SolutionManagerService.Key`
and subscribes to `PropertyChanged('ActiveSolution')`; every change calls `rebuild(solution)`.
It also subscribes to `hierarchy.Selection` and opens the selected item on single-click
(`onSelectionChanged` → `onActivate`). The service seeds one **invisible** container root
(`SolutionRootContributor.ContainerKey`, the key `'solution-root-container'` — deliberately not
`NodeKey.Solution`), under which the real tree is contributed.

As the `HierarchyHost`, the service is also where the tree's verbs land: `Activate`,
`CommitRename`, `Delete` (dispatched by node family — a reference leaf, a connection leaf, or a
file), `CanDrop` / `Drop`, and `OnItemRemoved`. `onActivate(item, preview)` reads the item's
`ExtObject` as a `ProjectContentNode`, climbs to its owning member via
`FileTreeContributor.MemberOf(item)`, and calls
`workspace.OpenMemberFile(member, content.Path, content.Kind, preview)` — the one path from a
tree click to an open editor.

## The tree shape

```
(invisible container root)
└─ Solution                      ← SolutionRootContributor (the one visible NodeKey.Solution)
   ├─ <project>                  ← ProjectsProvider (one row per SolutionMember)
   │  ├─ <files / folders>       ← FileTreeContributor → ProjectHierarchyProvider
   │  └─ References              ← reference branch + provider
   ├─ <project> …
   └─ Connections                ← ConnectionsRootContributor (global)
```

`SolutionRootContributor` emits the single visible Solution node (expanded by default).
Everything below is contributed by the contributors `rebuild` registers.

## Two ways to contribute: keyed contributors and delta providers

mural's hierarchy framework offers two contribution interfaces, and the explorer uses both,
each where it fits.

**`IHierarchyContributor` — keyed, declarative.** A contributor declares `ParentKeys:
NodeKey[]` and an `Order`, and implements `Contribute(parent): HierarchyContribution` (returning
a `NodeContribution`, a `ProviderContribution`, or nothing) and `Resolve(commandId, context):
ICommand | undefined` (turning a menu command into a runnable `ICommand`). It is registered with
`HierarchyContributorRegistry.RegisterInstance(contributor, actions?)`, which returns an
`IDisposable` unregister handle; the optional `actions` argument is the contributor's
`CommandDefinition[]` — the menu entries it owns. Keyed contributors are the right tool for
*static structure under a node type*: "every project gets a Build ▸ menu", "every project gets a
References branch".

**`IHierarchyProvider` — delta-pushing.** A provider implements
`Realize(item, context: IRealizeContext): IDisposable`, plus `Integrate`, `GetCanonicalName`,
`ParseCanonicalName`, and `CanAccept`. Instead of returning a contribution once, it holds a live
subscription and pushes `InsertChild` / `RemoveChild` deltas into the tree as the underlying
data changes. This is required wherever rows must refresh in place — because mural's
`reRealize` *skips a keyed contributor once it is present*, so a keyed contributor cannot
re-emit changed children. Project rows and file content are therefore providers, not keyed
contributors.

### What rebuild registers

`rebuild(solution)` disposes the previous handles, then registers, in order:
`SolutionRootContributor`, `ProjectsRootContributor`, `FileTreeContributor` (with its
`.Actions`), `ConnectionsRootContributor`, `ProjectActionsContributor`,
`ReferenceActionsContributor`, `ConnectionActionsContributor`, and — only when `BuildService`
resolves — `BuildContributor` and `HtmlAppContributor` (the two build-related menus; see
[Process-agnostic builds](process-agnostic-builds.md)). Lazy submenu contributors
(`ReferenceSubmenuContributor`, `ConnectionActiveSubmenuContributor`, a transient
`AddNewSubmenuContributor`, and `BuildFlavorSubmenuContributor`) live in a **child**
`ServiceProvider` scope built by `buildMenuServices()`, so their per-invocation state does not
leak into the service's lifetime.

## Projects as rows

`ProjectsProvider` (`services/projects-provider.ts`, `implements IHierarchyProvider`) owns the
project rows directly under the Solution node. It interns one row per `SolutionMember`,
subscribes to both `solution.Members` (rows appear/disappear as members are added/removed) and
each member's `Status` (a row flips to an error state when a project fails to load), and routes
`Realize` by item: the Solution root realizes the row list; a project row realizes its
References node and file content; the content node delegates to the per-member content provider.

It depends on two narrow seams, both declared right here so the provider never reaches into the
rest of the explorer:

```ts
interface IProjectContentSource    { ContentProviderFor(member): IHierarchyProvider | undefined; Release(member): void }
interface IProjectReferencesSource { ReferenceRootNode(member): HierarchyNodeSpec | undefined; ReferenceProviderFor(member): IHierarchyProvider | undefined; Release(member): void }
```

`ProjectsRootContributor` is the keyed contributor that *places* the provider:
`ParentKeys=[NodeKey.Solution]`, `Order=0`, and `Contribute` returns a
`ProviderContribution(this.provider)`.

## Files as a live subtree

`FileTreeContributor` (`services/file-tree-contributor.ts`) is both the keyed contributor under
a project (`ParentKeys=[NodeKey.Project]`, `Order=0`) *and* the `IProjectContentSource` the
project provider asks for content. It caches one `ProjectHierarchyProvider` per member, over a
disk-watched `ProjectContentStore`. Its static `MemberOf(item)` climbs an item's parent chain
until it finds the `SolutionMember` — the utility the explorer host uses to map any tree click
back to its project. It also owns the file context-menu commands: `file.addNew`, `file.newFolder`,
`file.importFile`, `file.importFolder`, `file.rename`, `file.delete`, and a dynamic
`file.addNew::<kind>::<extension>` per registered file type, over the content-node and project
keys.

`ProjectHierarchyProvider` (`services/project-hierarchy-provider.ts`, `ctor(store:
ProjectContentStore)`) is the delta engine: it mints one `HierarchyItem` per store node (interned
by `ContentNodeId`), subscribes to `store.ObserveChildren`, and translates each
`ContentAdded` / `ContentUpdated` / `ContentRemoved` into a `context.InsertChild` /
`RemoveChild` or an in-place mutation. A file created on disk (by a generator, a build, or
another tool) appears in the tree with no refresh, because the store is watching the folder and
the provider is watching the store.

## The mutation seam: IContentMutations

Every command that *changes* a project — rename a file, add a reference, publish, build, close a
project — goes through one interface, `IContentMutations` (`services/content-mutations.ts`),
keyed by `SolutionMember`. It is a deliberately wide but single surface:
`EnsureMemberGenerated`, `PublishMember`, `IsVersionedMember`, the file operations
(`RenameMemberFile`, `DeleteMemberFiles`, `NewFileForMember`, `NewFolderForMember`,
`ImportFilesForMember` / `ImportFolderForMember`, `MoveMemberNodes`), the version operations,
`ManageMemberReferences`, `RefreshMemberBases`, `CloseMember` / `RemoveMember`, and the
capability queries the menus use to enable or disable themselves.

Its one implementation is `SolutionWorkspaceService`
(`services/solution-workspace-service.ts`, `extends ServiceBase implements IContentMutations,
IContentLifecycleGuard, ICloseGuard`, `Key = ServiceKey('SolutionWorkspaceService')`). It is
built over the TODL engine's member operations (`MemberContentOps`, `MemberProjectOps`,
`ReferenceEditor`, `ProjectLifecycle`, `ConnectionSelection`) and resolves its collaborators
lazily — the solution manager, the language service, the dialog, filesystem, and content-host
services. It also exposes the explorer's `References` and `Connections` views. Two of its methods
matter for building:

- `EnsureMemberGenerated(member)` raises a `ProjectEventKind.Opened` event through
  `ProjectEventsKey`, which triggers the TODL
  [content generators](../../todl/architecture/content-generators.md) to **backfill** any missing
  `generated/model.ts`, `src/app.mu`, and the rest — so a build never fails fast on a project
  that simply hasn't had its generators run yet. Every build and publish command calls this
  first.
- `PublishMember(member)` runs `BuildService.Publish` through the background-work service
  (`TaskKind.Publish`), reporting results to the Problems dock.

Routing every mutation through this one seam is what keeps the dozens of menu commands thin: a
contributor's `Resolve` returns a `RelayCommand` that calls one `IContentMutations` method, and
all the engine wiring lives behind the seam.

## Gotchas

- **Never swap the `Hierarchy` instance.** Rebuild contributors in place; a new `Hierarchy`
  object silently breaks the context-menu behavior that holds the old reference.
- **Keyed contributors can't re-emit children.** mural's `reRealize` skips a keyed contributor
  once present — anything whose children change at runtime (project rows, files) must be an
  `IHierarchyProvider`, not a keyed `Contribute`.
- **A tree click maps to a member via `FileTreeContributor.MemberOf`, not via the node itself.**
  Content nodes don't carry their member; you climb the parent chain.
- **Always `EnsureMemberGenerated` before building.** Skipping it surfaces as a confusing
  "required file missing" build failure on a freshly created or freshly cloned project.
- **The invisible container root is not the Solution node.** `'solution-root-container'` exists
  so the single `NodeKey.Solution` node can itself be a contributed, replaceable child; don't
  confuse the two keys.

---

[← Back to Plexus](../index.md)

See also: [The solution model](solution-model.md) · [Process-agnostic builds](process-agnostic-builds.md) · [Build targets](build-targets.md)
