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
3. **Emit the layout.** `EmitPackageLayoutAction` stages a publishable layout into
   the sandbox: `package.json` (transformed from the authored `project.plexus`,
   pinning each base as an exact scoped dependency), `model.json`, generated
   `src/`, a browser-safe handle module, and `resources/`.
4. **Promote and publish.** If every action succeeded, the sandbox is promoted to
   the build output. `PackageRegistryClient.publish(dir)` then tars the layout and
   hands it to a registry, from where downstream projects resolve it. See
   [Publish and packages](publish-and-packages.md).

## C. An architecture project becomes a runnable single-page app

This is the `html-bundle` build — the per-project *application compiler*. An
architecture project is a terminal consumer: it publishes nothing, it produces an
app.

1. **Resolve and compile** the closure, exactly as in walkthrough B's first two
   steps, but keeping `fullDocument` (the whole closure) for the generators.
2. **Generate the DTO.** `GenerateModelDtoAction` reflects `fullDocument` and runs
   the code generator, writing `generated/model.ts` into the project — the typed
   client the app programs against. See [Consuming a model](consuming-a-model.md).
3. **Generate the view.** `GenerateAppUiAction` writes `generated/app.mu`: a mural
   `Application` with one section per concept — a header plus a `ListBox` bound to
   the DTO's collection for that concept, with `DisplayMemberPath = "id"`. A
   clobber guard preserves a hand-edited view.
4. **Generate the entry.** `GenerateEntryAction` writes `generated/entry.ts`, which
   imports the compiled app, builds the DTO from `window.__TODL_APP__`, and calls
   the bootstrap.
5. **Compile the mural, bundle, and emit.** Every `.mu` (including the generated
   one) is compiled to `compiled/*.mu.js`; esbuild bundles the entry into a single
   IIFE (`keepNames`, browser target, `development` conditions); and
   `EmitBundledHostAction` renders one self-contained `index.html` that inlines the
   model as `window.__TODL_APP__` and the app as a script. Full detail:
   [The build system](build-system.md).

## D. What happens when someone opens that index.html

The output of walkthrough C is a file you can double-click. At runtime, with no
server:

1. **Rehydrate the data.** The page holds `<div id="todl-app-root">`, the inlined
   `window.__TODL_APP__` payload, and the app bundle. The bundle's generated
   entry rebuilds the DTO from that payload — this is the app's DataContext.
2. **Construct the view.** It imports the mural `Application` exported by the
   compiled `app.mu`.
3. **Mount.** `TodlAppBootstrap.Mount(app, dto)` finds `#todl-app-root` and calls
   `app.initialize` with an `HtmlTarget`, the Material theme, an auto light/dark
   scheme, and the DTO as DataContext. The bootstrap carries no view knowledge —
   the view is entirely the project's `app.mu`.
4. **Render.** mural resolves control styles from the Material theme and the
   per-concept `ListBox`es bind to the DTO collections. `DisplayMemberPath = "id"`
   makes each row show the entity's id, live against the model. Full detail:
   [The runnable app](runnable-app.md).

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

**See also:** [The compiler](compiler.md) · [The build system](build-system.md) · [The runnable app](runnable-app.md)
