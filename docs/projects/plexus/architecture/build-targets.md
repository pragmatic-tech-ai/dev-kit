# Build targets

A **build target** in Plexus is a selectable output shape for a project: a publishable npm
package, a published-to-a-registry package, or a runnable single-page app. This page is the
orientation map — what the targets are, what each produces, which project types they apply to,
and when you would reach for each — with pointers to the engine mechanics in TODL and the host
wiring elsewhere in this cluster.

Under the hood a target is a **build flavor** on a **build system**. TODL ships two build
systems and three flavors; Plexus surfaces them as menu commands on a project in the
[Solution Explorer](solution-explorer.md), and runs them through the
[process-agnostic build engine](process-agnostic-builds.md). The flavor machinery itself —
`BuildFlavor`, `StaticBuildFlavor`, selection and validation — is documented in TODL's
[build system deep-dive](../../todl/architecture/build-system.md); here we stay at the level of
"which target, and why".

## The three targets

| Target (flavor id) | Build system | Applies to | Produces |
|---|---|---|---|
| `npm-package` | `NpmPackageBuildSystem` | meta-model, library, architecture | A complete, publishable npm package layout on disk |
| `npm-publish` | `NpmPackageBuildSystem` | meta-model, library, architecture | The same layout, then pushed to a registry |
| `html-bundle` | `HtmlBundleBuildSystem` | architecture only | A single self-contained `index.html` a browser opens directly |

Two build systems, because the two kinds of output are genuinely different work: one stages a
package *fragment* plus source for other projects to depend on; the other compiles a *whole-graph*
runnable application. Both start the same way — resolve the base closure, compile it — and then
diverge.

### npm-package — a package others build on

The `npm-package` target stages everything a published package needs: a `package.json` (with each
base pinned as an exact scoped dependency), the own-nodes-only `model.json`, the raw `.todl`
source, a browser-safe handle module (`index.js`/`index.d.ts` with the compiled document inlined),
every other project file under `resources/`, compiled `.mu`, and — for a producer project that
declares them — baked presentation resources and a `bundle.json` palette index. It is the layout a
*consumer* project resolves when it binds this package as a base.

**When to use it:** whenever you want the package on disk without pushing it — to inspect the
layout, to pack it yourself, or as the build step that `npm-publish` extends.

### npm-publish — package and push in one pipeline

`npm-publish` is `npm-package` plus one terminal action that tars the staged layout and pushes it
to the registry. Publishing is not a separate code path standing outside the build; it is the same
seven actions with an eighth appended. The push target is the
[solution's](solution-model.md) `PublishRegistry` (falling back to a local on-disk registry when
none is configured), and a publish for a solution with a truly misconfigured registry fails fast
rather than half-landing.

**When to use it:** to make a meta-model or library available for other projects — in the same
solution or across the workspace — to depend on. This is the normal "ship my schema / my
technology library" action. In the Solution Explorer it is the **Publish** command
(`build.publish`), enabled only for versioned (producer) projects.

### html-bundle — a runnable app

The `html-bundle` target applies only to architecture projects and produces something categorically
different: not a package, but a runnable `index.html` with everything inlined — the compiled model
data on `window.__TODL_APP__` and the bundled application script, no server, no module loader, no
install. The application itself is the project's **editable `src/` tree** (`src/app.mu` +
`src/main.ts`), compiled and bundled fresh each build. The target and its editable-source model are
covered in depth in TODL's [runnable app](../../todl/architecture/runnable-app.md) and
[content generators](../../todl/architecture/content-generators.md) pages.

**When to use it:** to actually *see and run* an architecture model as an app — during authoring
(**Open app** opens the built `index.html`; **Serve app** starts a preview server over it) or to
hand someone a self-contained artifact they can open in any browser.

## How the targets reach the menu

A project's context menu does not list all three targets unconditionally — it lists exactly the
ones that apply to that project's type. The `BuildFlavorSubmenuContributor` reads the selected
member's manifest and enumerates `registry.For(manifest)` × `system.Flavors()`, so a meta-model
shows `npm-package` and `npm-publish` (no `html-bundle` — it is not an architecture), while an
architecture shows all three. `AppliesTo` on each build system is the gate: `html-bundle`'s is
`type === Architecture`; `npm-package`'s admits all three producer-or-terminal types. The
[Solution Explorer](solution-explorer.md) page covers the contributor plumbing; the
[process-agnostic builds](process-agnostic-builds.md) page covers what happens after you click.

## Choosing a target: a quick decision guide

- **Authoring a meta-model or library, want others to use it?** → `npm-publish` (the **Publish**
  command). Publish to the solution's registry; dependents resolve it by id and version.
- **Want the package files without pushing?** → `npm-package`.
- **Authoring an architecture and want to run or preview it?** → `html-bundle` (**Open app** /
  **Serve app**).
- **Developing a meta-model and the architecture that uses it together?** Build the whole
  [solution](solution-model.md) so a dependent sees its dependency's freshest output — TODL's
  `SolutionBuildManager` orders projects dependencies-first and threads fresh output forward.
  (Note: solution-wide Build All is an engine capability; the Plexus explorer builds one project at
  a time today — see the [process-agnostic builds](process-agnostic-builds.md) gotchas.)

## Gotchas

- **`html-bundle` is architecture-only.** A meta-model or library has no runnable app; the target
  simply won't appear for it.
- **Publish requires a versioned project.** The **Publish** command is disabled for an
  architecture project (a terminal consumer) — only producers (meta-model, library) carry a
  publishable version.
- **The menu reflects the manifest, warmed on open.** `BuildFlavorSubmenuContributor.Warm` reads
  the manifest when the Build ▸ menu opens; a target list can look momentarily "Loading…" and a
  project whose type produces nothing shows "(nothing to build)".
- **Every target backfills generators first.** Each build/publish command calls
  `EnsureMemberGenerated` before building, so a freshly created or cloned project's
  generated/`src/` files exist before the engine's require-never-create check runs.

---

[← Back to Plexus](../index.md)

See also: [The solution model](solution-model.md) · [The Solution Explorer](solution-explorer.md) · [Process-agnostic builds](process-agnostic-builds.md) · [The build system (TODL)](../../todl/architecture/build-system.md) · [The runnable app (TODL)](../../todl/architecture/runnable-app.md)
