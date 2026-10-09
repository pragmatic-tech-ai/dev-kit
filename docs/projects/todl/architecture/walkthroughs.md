# End-to-End Walkthroughs

The other pages describe subsystems one at a time. This page traces four complete
journeys through the pipeline, so you can see how the pieces connect in practice.
Each walkthrough links to the deep-dive page for any stage you want to explore
further. These expand the compressed walkthroughs in the
[architecture overview](../architecture.md).

## A. A .todl file becomes a validated graph

The most fundamental journey: text in, checked graph out. It is what
`check(sources)` does.

1. **Seed the prelude.** A fresh `Repository` is created seeded with the prelude
   (namespace `todl`): the primitives (`identifier`, `slug`, `resourceKey`), the
   well-known annotations, and the root concept `Element`. Every compile starts
   from this base, so those names always resolve. See
   [Core concepts](core-concepts.md) for bases, closure, and the prelude.
2. **Parse.** Each source is parsed into an AST — a flat list of declarations that
   mirrors the syntax verbatim, with no name resolution and no decisions about
   what anything means yet. A bare identifier is just a name at this stage.
3. **Resolve names.** A resolve pre-pass walks every reference, gated by namespace
   visibility, and rewrites qualified and bare names to flat node ids. References
   that point nowhere are collected so their edges can be dropped cleanly.
4. **Stage types, then members, then instances.** The loader runs in dependency
   order through a `Builder`, committing each pass before the next reads it: type
   shells first (concepts, taxonomies, terms, viewpoints, annotations, operators),
   then members (fields and relationships), then instances and models. During the
   instance pass, each value is classified **attr-vs-edge from its declared member
   type** — a primitive-typed member becomes a scalar attr, a concept- or
   taxonomy-typed member becomes an edge.
5. **Apply annotations and validate.** Annotation applications are attached,
   application roots resolved, invariants registered, and then `validate` walks the
   committed graph and returns diagnostics — cardinality, reference integrity,
   model binding and bound vocabulary, `conforms`, class rules, invariants,
   annotation correctness.

Out comes a populated `Repository`, a spanned `Diagnostic[]`, and a `provenance`
map. You can query it via the entity read lens or emit it. Full detail:
[The compiler](compiler.md).

## B. A meta-model or library becomes a published package

Meta-models and libraries are *base-producing* projects: their job is to compile
their own base document and publish it so downstream projects can build on it.

1. **Resolve bases.** `TodlProjectBuildManager.Build({ …, BuildSystemId: "npm-package" })`
   runs the `ResolveBasesAction`, which reassembles the project's base closure by
   walking its manifest bindings and each dependency's recorded dependencies
   through the package-source chain. See
   [Projects and solutions](projects-and-solutions.md).
2. **Compile.** `CompileModelAction` calls `compilePackage`, which runs the
   compiler against those bases and gates on errors. The result is a
   `CompiledPackage` with two documents: `document` (own nodes plus recorded
   dependencies — this becomes `model.json`) and `fullDocument` (the whole
   closure, used by generators). A failing compile produces no package.
3. **Compile the mural and bake presentation, conditionally.** `CompileMuralAction`
   compiles any `.mu` the project has to `compiled/*.mu.js` (a no-op if it has
   none). If the project declares at least one annotation application that
   inherits the prelude's `MuralResource` annotation, `StampResourceKeysAction`
   stamps a resource key onto each one — landing in `model.json` — and
   `BakeResourcesAction` bakes `presentation.compiled.json` + `icon-index.json`
   into the package. The baker is always present: TODL ships its own
   `DefaultPresentationBaker`, so this bake is fully self-contained and runs
   identically headless — a CLI or smoke test needs nothing host-side. The bake
   skips cleanly only when the project declares no resources, or is an
   architecture (which has no bake options). See
   [Project content generators](content-generators.md) for why this is a build
   artifact rather than generator-owned content.
4. **Emit the bundle and the layout.** `EmitBundleAction` writes `bundle.json` —
   the index a host's meta-model browser reads to mount the package, keyed on a
   `'meta-model'`/`'library'` discriminator — for producer projects only.
   `EmitPackageLayoutAction` then stages the publishable layout into the sandbox:
   `package.json` (transformed from the authored `project.plexus`, pinning each
   base as an exact scoped dependency), `model.json` (now carrying any stamped
   resource keys), generated `src/`, a browser-safe handle module, and
   `resources/` (raw `.todl` and raw `.mu` excluded — the latter because step 3
   already compiled it).
5. **Promote, and optionally publish.** If every action succeeded, the sandbox is
   promoted to the build output — a complete package. Publishing is a *second
   flavor*, `npm-publish`: the same pipeline plus a terminal `PublishPackageAction`
   that tars the staged layout (`IStorage`-based, browser-safe) and pushes it to
   the registry threaded onto the build context from the solution manager. A
   solution with no registry associated fails fast — "no registry associated with
   this solution" — and writes nothing. See
   [Publish and packages](publish-and-packages.md).

## C. An architecture project becomes a runnable single-page app

This is the `html-bundle` build — the per-project *application compiler*. An
architecture project is a terminal consumer: it publishes nothing, it produces an
app.

By the time this build runs, the project's editable `src/app.mu` and `src/main.ts`
and its `generated/model.ts` and `generated/data.ts` already exist — scaffolded
once and regenerated off project lifecycle events by the content generators, not by
this build. See [Project content generators](content-generators.md). The build
**requires** all four and fails fast, before doing anything else, if any is missing.

1. **Resolve and compile** the closure, exactly as in walkthrough B's first two
   steps, but keeping `fullDocument` (the whole closure) for later stages.
2. **Emit the entry.** `EmitEntryAction` writes `entry.ts` — into the build
   **sandbox root**, not the project, since it is a fixed template with nothing
   project-specific to commit. It imports the compiled app (constructing the mural
   `Application`), instantiates the view-model with `new <App>()` so it registers
   into the service container, and calls the bootstrap with the rehydrated `model`.
3. **Compile the mural, bundle, and emit.** Every `.mu` under the project
   (including its own `src/app.mu`) is compiled to a sibling `<path>.mu.js`; the
   staged source is bundled through the `IBundler` into a single IIFE (`keepNames`,
   browser target); and `EmitBundledHostAction` renders one self-contained
   `index.html` that inlines the model as `window.__TODL_APP__` and the app as a
   script. Full detail: [The build system](build-system.md).

## D. What happens when someone opens that index.html

The output of walkthrough C is a file you can double-click. At runtime, with no
server:

1. **Construct and wire, in order.** The page holds `<div id="todl-app-root">`, the
   inlined `window.__TODL_APP__` payload, and the app bundle. Evaluating the bundle
   runs `entry.ts`: the compiled `src/app.mu.js` constructs the mural `Application`,
   `generated/data.ts` rehydrates the DTO as `model`, and `new <App>()` registers
   the view-model into the Application's service container.
2. **Mount.** `TodlAppBootstrap.Mount(app, model)` finds `#todl-app-root` and calls
   `app.initialize` with an `HtmlTarget`, the Pragmatic theme, an auto light/dark
   scheme, and `model` as the root DataContext. The bootstrap carries no view
   knowledge — the view is entirely the project's `src/app.mu`.
3. **Render.** mural resolves control styles from the Pragmatic theme; the `x:root`
   `ContentPresenter` resolves its `$service(<App>)` content, the key-less
   `DataTemplate` typed to the view-model is auto-selected, and `$HelloText` /
   `$ConceptSummary` paint the view-model's state, live against the model. Full
   detail: [The runnable app](runnable-app.md).

## Seeing the seams

Notice what recurs across all four journeys: the compiler runs the same
`check`/`checkAgainst` core every time (A directly, B and C via `compilePackage`);
every hand-off between stages is a serialised form of the one graph, never a
private back-channel; and provenance-blindness means the generated `.ts` and `.mu`
files in walkthrough C are compiled by exactly the same machinery as
hand-authored ones. That uniformity is the point — it is what keeps a system this
layered predictable.

---

[← Back to the Architecture overview](../architecture.md)

**See also:** [The compiler](compiler.md) · [The build system](build-system.md) · [Project content generators](content-generators.md) · [The runnable app](runnable-app.md)
