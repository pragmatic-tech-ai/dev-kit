# TODL

`@pragmatic-tech-ai/todl` — the typed-object language: a language, meta-model
system, and model compiler over a reflective typed graph (load → validate →
emit). ESM, strict TypeScript.

- **[Architecture](architecture.md)** — how the whole system fits together, in
  fifteen sections. Each section links to a full deep-dive article (see below).
- **[The TODL language](todl-language.md)** — the language reference: types,
  meta-models, taxonomies, operators, and the model compiler.

Built on **[todl-runtime](../todl-runtime/)**.

## Architecture deep dives

The [architecture overview](architecture.md) is the map; these are the detailed
articles behind each section, for engineers who need the full picture of a
subsystem.

- [What TODL is](architecture/what-todl-is.md) — the problem, the workflow, the three defining properties.
- [The two-minute mental model](architecture/mental-model.md) — the pipeline diagram, walked slowly.
- [Repository map](architecture/repository-map.md) — a guided tour of the source tree.
- [Core concepts](architecture/core-concepts.md) — the typed graph, declarations, namespaces, classes, bases.
- [The compiler](architecture/compiler.md) — parse, load, validate, emit, and the public check API.
- [Manifest and reflection](architecture/manifest-reflection.md) — the binary format and the runtime read API.
- [Consuming a model](architecture/consuming-a-model.md) — model-data, reflection-client, codegen, authoring.
- [Publish and packages](architecture/publish-and-packages.md) — the compile-and-persist spine and resolution chain.
- [Projects and solutions](architecture/projects-and-solutions.md) — project types, closure reassembly, solution builds.
- [The build system](architecture/build-system.md) — the generic engine and the two build flavours.
- [The runnable app](architecture/runnable-app.md) — from index.html to a painted UI.
- [Tooling](architecture/tooling.md) — the language server, analysis service, CLI, and migrator.
- [Package surface and dependencies](architecture/package-surface.md) — the export strategy and the dependency graph.
- [Testing and conventions](architecture/testing-and-conventions.md) — the runner, smoke tests, goldens, house style.
- [End-to-end walkthroughs](architecture/walkthroughs.md) — four complete journeys through the pipeline.
