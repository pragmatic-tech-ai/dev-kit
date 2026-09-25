# The Two-Minute Mental Model

If you remember one picture of TODL, make it this one. The whole system is a
pipeline that turns `.todl` text into a graph, serialises that graph a few ways,
and lets consumers read it, publish it, or compile it into an app. This page
walks the picture slowly; the [architecture overview](../architecture.md) shows
the same diagram in compressed form.

## The picture

```
                       .todl sources
                            │
                 ┌──────────▼───────────┐
                 │  compiler-services    │   parse → load → validate
                 │  (the front end)      │
                 └──────────┬───────────┘
                            │ Repository  (the reflective typed graph)
          ┌─────────────────┼──────────────────────────────┐
          │                 │                               │
     emit/json         emit/manifest                    emit/todl
   (TodlDocument)   (binary + logical)                 (.todl text)
          │                 │
          │          manifest + reflection
          │           (browser-safe read API)
          │                 │
   ┌──────▼─────────────────▼───────┐        ┌─────────────────────────┐
   │  consume                        │        │  publish                │
   │  model-data / reflection-client │        │  compilePackage →       │
   │  codegen (typed DTO classes)    │        │  CompiledPackage →      │
   │  authoring (ModelDraft)         │        │  package stores/registry│
   └──────┬──────────────────────────┘        └───────────┬────────────┘
          │            build systems (solution-services)    │
          │        ┌────────────────────────────────────────▼──────────┐
          │        │  npm-package build  →  publishable package layout   │
          │        │  html-bundle build  →  runnable single-page app     │
          │        └───────────────────────┬─────────────────────────────┘
          │                                 │ index.html (self-contained)
          │                                 ▼
          └───────────────────────►  browser: TodlAppBootstrap mounts a
                                      mural Application over the model DTO
```

## Reading it top to bottom

**Text becomes a graph.** At the top, `.todl` source files enter the
compiler front end (`compiler-services`). It parses each file into an AST,
resolves names across namespaces, stages the declarations into a graph in
dependency order, and validates the result. What comes out is a `Repository` — a
read-and-construct façade over the one typed graph — together with a list of
diagnostics. This is the only stage that understands syntax. See
[The compiler](compiler.md).

**The graph is serialised a few ways.** A `Repository` is an in-memory
structure; to travel or persist it must be emitted. There are three emit forms,
and the difference between them matters:

- `emit/json` produces a `TodlDocument` (`{ nodes, edges }`) — the legible
  interchange form used to move a compiled model around and to rebuild it with
  `fromJSON`.
- `emit/manifest` produces the compact binary **manifest** plus its logical
  description — the runtime read format that the browser-safe reflection API
  decodes. See [Manifest and reflection](manifest-reflection.md).
- `emit/todl` re-emits the graph back to `.todl` text — the write path's output.

**Those serialisations are consumed, published, or turned into an app.** The
bottom of the diagram is three fan-outs from the emitted forms:

- **Consume.** The read path (`model-data`, `reflection-client`) and the code
  generator (`codegen`) turn a compiled model into typed objects you program
  against; the write path (`authoring`) stages new instances and serialises them
  back. See [Consuming a model](consuming-a-model.md).
- **Publish.** `compilePackage` produces a `CompiledPackage` that package stores
  and registries persist and resolve, so one project can build on another. See
  [Publish and packages](publish-and-packages.md).
- **Build into an app.** The build systems in `solution-services` drive the whole
  chain: the `npm-package` flavour produces a publishable package layout, and the
  `html-bundle` flavour compiles an architecture project into a single
  self-contained `index.html`. See [The build system](build-system.md).

**A browser runs it.** When someone opens that `index.html`, the page rehydrates
the model, constructs a mural `Application` from the project's compiled view, and
`TodlAppBootstrap` mounts it. See [The runnable app](runnable-app.md).

## Why the shape is worth trusting

Two structural choices make the pipeline predictable.

**One graph in the middle.** Every arrow in the diagram either produces the
`Repository` or reads from a serialisation of it. There is no side channel and no
second source of truth. Adding a new consumer means reading an emitted form; it
never means reaching back into the compiler internals.

**Layers depend downward, not sideways.** The runtime read path
(`model-data`, `reflection-client`) has no dependency on the compiler at all — it
speaks only to the manifest/reflection API. That is what lets a compiled model
run in a browser without shipping the compiler. The build systems sit *above*
everything and orchestrate; they are the only layer that knows about all the
others at once. The generic build engine does not even name a TODL type — it is
bound to TODL by a thin realisation layer, described in
[The build system](build-system.md).

## Where to go next

- For the folders these boxes correspond to, read [Repository map](repository-map.md).
- To watch the pipeline actually run, read [End-to-end walkthroughs](walkthroughs.md).

---

[← Back to the Architecture overview](../architecture.md)

**See also:** [Repository map](repository-map.md) · [What TODL is](what-todl-is.md) · [End-to-end walkthroughs](walkthroughs.md)
