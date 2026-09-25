# Repository Map

This is a guided tour of the TODL source tree — what lives where and why, so you
can find the code behind any part of the pipeline. The [architecture overview](../architecture.md)
gives the same map as a single table; this page adds the reasoning and the
reading order. Everything the package ships lives under `src/`; a few sibling
folders exist only for development.

## The shape of the tree

`src/` is organised by *responsibility in the pipeline*, not by technical layer.
Reading roughly top to bottom follows a model's life: it is compiled, described,
consumed, published, and built.

### The compiler front end

- **`src/compiler-services/`** — the compiler: parse, load (staged passes),
  validate, emit (json / todl / manifest), the standard library and prelude, the
  predicate evaluator for invariants, and the public `check` / `checkAgainst`
  API. If you are chasing "why did my model compile / fail to compile," start
  here. Deep dive: [The compiler](compiler.md). The graph types it builds are in
  `compiler-services/model/` and are covered in [Core concepts](core-concepts.md).

### The runtime description

- **`src/manifest/`** — the on-wire metadata format: a MoF-style table-plus-heap
  binary container, with a writer, a reader, and a validator. The canonical
  numeric `Cardinality` and `MetaKind` enums live here.
- **`src/manifest/reflection/`** — a read-only, lazy `System.Reflection`-style
  API over a loaded manifest. This is the browser-safe way to inspect a compiled
  model without the compiler. Deep dive: [Manifest and reflection](manifest-reflection.md).
- **`src/domain/`** — the multi-manifest runtime host (`Domain`, `FrozenGraph`,
  `Heap`) for versioned, cross-package reflection when more than one manifest is
  loaded at once.

### Consuming a model

- **`src/model-data/`** — browser-safe runtime model access: `ModelDataSource`,
  `ModelRegistry`, and pluggable connectors. No compiler dependency.
- **`src/reflection-client/`** — `ReflectedEntity`, the typed read lens that
  generated clients extend.
- **`src/codegen/`** — generates typed TypeScript clients (a DTO package plus one
  entity class per concept) from a compiled model.
- **`src/authoring/`** — the write path: `ModelDraft` stages new instances over
  frozen bases and serialises the delta back to `.todl`.

These four are the subject of [Consuming a model](consuming-a-model.md).

### Publishing and resolving

- **`src/publish/`** — the pure compile-and-persist spine: `compilePackage`,
  `CompiledPackage`, and the package stores. Compute is I/O-free; persistence is a
  seam. Deep dive: [Publish and packages](publish-and-packages.md).

### Reading and querying

- **`src/graph-api/`** — a read-only query surface (`GraphQuery`, `Snapshot`) and,
  under `graph-api/browser/`, the app bootstrap (`TodlAppBootstrap`) that mounts a
  compiled model in a page. The bootstrap is covered in
  [The runnable app](runnable-app.md).

### Orchestration

- **`src/solution-services/`** — the largest orchestration layer: the build
  systems (generic engine plus the todl realisation), the package sources and
  registries, the project types and factories, and the multi-project solution
  builder. Two deep dives split this: [Projects and solutions](projects-and-solutions.md)
  for the project/solution model, and [The build system](build-system.md) for the
  build engine and its two flavours.
- **`src/application/`** — the composition/host layer (`ApplicationBootstrapper`,
  `MuralHost`). Note the *generic* model-browser view contribution here is the
  legacy path; the current per-project app path does not go through it (explained
  in [The runnable app](runnable-app.md)).

### Editor tooling

- **`src/language-server/`** — the Language Server Protocol implementation, with a
  stdio entry point (`todl-language-server`).
- **`src/language-service/`** — the pure, cache-free whole-project analysis behind
  the LSP: completion, hover, references, semantic tokens, and so on.
- **`src/migrate/`** — a mechanical rewriter that upgrades legacy sources to the
  current surface.

The tooling is covered in [Tooling](tooling.md).

### The barrel

- **`src/index.ts`** — the package's root barrel, re-exporting the public API
  across every layer. The export strategy (subpaths and the development/default
  conditions) is covered in [Package surface and dependencies](package-surface.md).

## Two things called "runtime"

A naming collision that trips up newcomers, worth flagging on the map itself:

- **`src/runtime/`** is an *internal* handle-based consumption surface
  (`TODL.ComposeGraph`, and `Model` / `Instance` / `TodlDefinition` handles over a
  `Repository`). It is not the root `Graph` type.
- **`@pragmatic-tech-ai/todl-runtime`** is a *separate npm package* providing the
  DI and reactive primitives (`CompositionRoot`, `Signal`, `Observable`,
  `Disposable`). It is a dependency, not part of this tree.

[Package surface and dependencies](package-surface.md) spells the distinction out
in full.

## What is not published

Three sibling folders exist for development and the demo corpus, and are excluded
from the published package (whose `files` allowlist is essentially `dist` plus the
README):

- **`cli/`** — the `todl-demo` corpus runner (`list` / `run` / `test` / `docs`).
- **`examples/`** — the golden corpus the CLI drives; the golden *is* the
  normalised pipeline output.
- **`shared/`** — shared fixtures and helpers for the demo suite.

The testing conventions around these live in
[Testing and conventions](testing-and-conventions.md).

## A suggested reading order

If you are new, read the pages in this order: [What TODL is](what-todl-is.md) →
[The two-minute mental model](mental-model.md) → [Core concepts](core-concepts.md)
→ [The compiler](compiler.md), then branch into whichever consumer or build path
your work touches, and finish with [End-to-end walkthroughs](walkthroughs.md) to
see it all connect.

---

[← Back to the Architecture overview](../architecture.md)

**See also:** [The two-minute mental model](mental-model.md) · [Core concepts](core-concepts.md) · [Package surface and dependencies](package-surface.md)
