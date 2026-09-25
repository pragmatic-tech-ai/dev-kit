# Package surface and dependencies

This page is the deep-dive companion to section 13 of the [Architecture overview](../architecture.md). It walks through what `@pragmatic-tech-ai/todl` actually publishes: the root barrel, the subpath exports, the two-condition import strategy that lets in-repo tooling run against raw TypeScript while consumers get compiled output, the package's two runtime dependencies, and a naming collision worth getting straight the first time you meet it — two different things in this codebase are called "runtime." Everything below is read directly from `package.json` and `src/index.ts` in the TODL package (currently `0.36.x`), not paraphrased from memory.

## The root barrel

`src/index.ts` is a large root barrel: a single file that re-exports the public surface of nearly every layer described elsewhere in this architecture series — the compiler model (`Graph`, `Tier`, `EdgeKind`, `Cardinality`, `Repository`, `EntityBase`, `Builder`), the model-data layer (`ModelDataSource`, `ModelRegistry`, the connector types), the application/composition layer (`ApplicationBootstrapper`, `MuralHost`, `TodlAppBootstrap`), codegen (`generateReadClient`, `ModelPackageGenerator`), authoring (`ModelDraft`, `TodlFileStore`), publish (`compilePackage`, `publish`, `PackageKind`, the `PackageStore` family), the predicate AST and evaluator, `validate`, the diagnostics types, `check`/`checkAgainst`, the JSON emitter (`toJSON`/`fromJSON`/`TodlDocument`), the legacy-source rewriter (`rewrite`), the parser/loader/lexer, and a substantial slice of `solution-services` — the headless `SolutionManagerService`, the three project factories (`TodlProjectFactory`, `MetaModelProjectFactory`, `LibraryProjectFactory`, `ArchitectureProjectFactory`), the package-source chain (`CompositePackageSource`, `CachingPackageSource`, `SolutionCacheSource`), and the producer seams (`PresentationBakerKey`, `PackageStoreKey`, `TodlProjectSourceFiles`).

If you only ever `import { ... } from "@pragmatic-tech-ai/todl"`, this barrel is the whole surface you see. That is deliberate: a consumer authoring or reading TODL models, generating a typed client, or driving a project build should rarely need to reach past the root into a specific module path.

## Subpath exports and why they exist

Beyond the root, `package.json`'s `exports` map defines seven focused subpaths:

- `./language-service` — pure, cache-free whole-project analysis (`analyze`, plus the hover/completion/navigation/semantic-token feature modules).
- `./language-server` — the LSP core and its stdio transport.
- `./package-manager` (and `./package-manager/connections`) — the registry client surface (`PackageRegistryClient`, `parseManifest`, `LocalNpmRegistry`) and, on the `/connections` subpath specifically, the registry-connection engine module.
- `./build-system-core` — the generic build engine (`IBuildAction`, `ArtifactKey`, `BuildSystemRegistry`, `ProjectBuildManager`) that names zero TODL types.
- `./todl-build-system` — the TODL-coupled realisation of that engine (`TodlBuildSystemRegistry`, `SolutionBuildManager`, `RegistrySource`, the npm-package and html-bundle build systems).
- `./domain` — the multi-manifest runtime host (`Domain`, `FrozenGraph`, `Heap`) for versioned, cross-package reflection.
- `./graph-api` — the read-only query surface (`GraphQuery`, `Snapshot`) plus, under its own `browser/` folder, the app bootstrap.

These are exported as separate subpaths rather than folded into the root barrel for two reasons visible in how they're actually consumed. First, size and audience: something like `./language-service` is a large, self-contained analysis engine that only the LSP and editor tooling need; a model-authoring consumer importing the root barrel shouldn't pay for it in their dependency graph or bundle. Second, layering: `./build-system-core` is explicitly generic — it "names zero todl types," per its own module comment — so keeping it a distinct subpath (rather than merging it into `./todl-build-system` or the root) keeps that boundary enforced by the package structure itself, not just by convention. A consumer who wants the generic build engine without the TODL-specific action set can depend on exactly that subpath.

The `bin` field ships one executable, `todl-language-server`, pointing at `./dist/language-server/stdio.js` — the compiled stdio transport for the language server, independent of whether a consumer imports `./language-server` as a library.

## The development and default import conditions

Every one of those eight `exports` entries (the root plus seven subpaths) declares the same two-condition shape under `import`:

```json
"import": {
  "development": "./src/index.ts",
  "default": "./dist/index.js"
}
```

`development` resolves straight to the raw `./src/**/*.ts` source; `default` resolves to the compiled `./dist/**/*.js` output. (`require` always points at `dist`, since the package has no CommonJS source to speak of — `"type": "module"` — so a `require` consumer only ever gets compiled JS.)

This split exists because TODL is consumed two different ways at two different points in its own lifecycle. In-repo tests and tooling run against the package's own uncompiled source: `npm test` is `tsx --conditions=development --test "src/**/*.test.ts"`, and the user-smoke-tests, the CLI, and the build-system actions all import sibling modules the same way — through `tsx` with `--conditions=development` set, which makes Node's conditional-exports resolution pick the `development` branch and load `.ts` files directly (`tsx` transpiles on the fly). This means test code never runs against stale compiled output and never requires a build step before the test suite is meaningful. The `html-bundle` build system's `BundleAppAction` does the same thing deliberately at build time: it runs esbuild with `conditions: ["development"]` so a project's generated app bundle resolves `@pragmatic-tech-ai/*` packages from their TypeScript `src`, not an installed `dist` — the architecture doc flags this explicitly as a known deferred follow-up, since no consumer builds against an *installed* todl yet.

A published, `npm install`-ed consumer, by contrast, gets `default`: compiled `./dist/**/*.js` plus the matching `.d.ts` declarations. `files: ["dist", "README.md"]` is the enforcement mechanism — the npm tarball for `@pragmatic-tech-ai/todl` contains only those two things. Everything else in the repository — `cli/`, `examples/`, `shared/`, `user-smoke-tests/`, `test_projects/`, the raw `src/` tree itself — never leaves the repo. So the two conditions aren't just an optimisation; they're the only way a consumer can resolve the package at all once it's installed as a dependency, since `src/` won't be there. The `build` script (`gen:prelude && gen:scaffold && compile:mu && tsc -p tsconfig.build.json`) is what produces `dist`, and `prepublishOnly` (`clean && build`) guarantees a fresh one before every publish.

## Dependencies

The package declares two `@pragmatic-tech-ai` runtime dependencies, plus the `vscode-languageserver*` family that backs the LSP:

- **`@pragmatic-tech-ai/mural`** (`^0.55.13`) — the UI/visual-engine framework. TODL depends on it for `Application`, `HtmlTarget`, the Material theme, and `Observable`. This dependency is what makes the `html-bundle` build system possible at all: `CompileMuralAction` compiles every `.mu` file (including the generated `app.mu`) through mural's own `compile()`, and the runnable app's bootstrap (`TodlAppBootstrap.Mount`, in `src/graph-api/browser/`) calls `app.initialize(new HtmlTarget(host), { theme: Material, ... })` directly against mural's API.
- **`@pragmatic-tech-ai/todl-runtime`** (`^0.5.7`) — the DI and reactive substrate: `CompositionRoot`, `ServiceProvider`, `Signal`, `Disposable`, `Observable`, `IStorage` and its implementations (`NodeFsStorage`, `FakeStorage`), and the prompt-service types (`Ask`, `ConfirmAsk`, `PickFolderAsk`, `PickFileAsk`, `PromptTextAsk`, `ChooseAsk`, `IPromptService`). This is the package the whole `solution-services` layer is built on — `SolutionManagerService`, the project factories, the build-system contexts all thread a `ServiceProvider` through for composition, and reactive state (change notification on `Graph`, `ModelDataSource`, view models) is built on `Signal`.

The root barrel re-exports a slice of `todl-runtime` directly — `Signal`, `Disposable`, and the whole `Ask`/prompt-service family — so a consumer who only imports `@pragmatic-tech-ai/todl` still gets those primitives without adding `@pragmatic-tech-ai/todl-runtime` as an explicit dependency of their own. That's a convenience, not an abstraction boundary: the types are genuinely `todl-runtime`'s, just re-exported for ergonomics.

## Two things called "runtime" — do not confuse them

The name "runtime" is overloaded in this codebase in a way that trips people up the first time they read the source, so it's worth stating plainly:

**`@pragmatic-tech-ai/todl-runtime`** is the npm package described above — the DI and reactive substrate (`CompositionRoot`, `ServiceProvider`, `Signal`, `Observable`, `Disposable`). It is a dependency *of* TODL, published and versioned independently, and it has nothing to do with TODL models specifically — it's the same substrate mural itself is built on.

**`src/runtime/`** is something else entirely: an *internal* handle-based consumption surface inside the TODL package, for reading an already-composed model at runtime without touching the compiler's `Repository` API directly. Its entry point is the `TODL` static object (`src/runtime/graph.ts`): `TODL.ComposeGraph(metaModels, libraries)` merges an assembly's meta-model and library documents into one live schema (via the same first-wins `mergeBases` the compiler itself uses), returning a `Graph` instance; `TODL.Load(graph, source)` then populates that graph's models from a `ModelSource`. Reads go through three handle classes in `src/runtime/handles.ts` — `TodlDefinition` (the meta/concept tier: `Id`, `Name`, `Is(other)`), `Instance` (the domain tier: `Id`, `Name`, `Definition`, `GetValue(name)`), and `Model` (an instance container) — each a thin, id-backed live lens that delegates every read straight through to the underlying `Repository`, so `EdgeKind`/`Tier`/`attrs` never leak into this API.

Here's the part worth double-checking if you're skimming: `src/runtime/graph.ts` defines a class *literally named* `Graph` — a façade over a composed `Repository` that exposes `.Models` and `.GetDefinition(name)`. That is a third thing that could plausibly be called "the graph," distinct from both `@pragmatic-tech-ai/todl-runtime`'s primitives and the root barrel's `Graph`. But this `src/runtime/` `Graph` is not part of the published package surface — `src/index.ts` does not export anything from `./runtime/`. The `Graph` that `@pragmatic-tech-ai/todl` actually exports from its root is a different class altogether: `compiler-services/model/graph.ts`'s `Graph`, the one that wraps a swappable `GraphStore` and emits a `changed` signal on every mutation — the structure the compiler, validator, and emitters all read and write directly. If you're holding a `Graph` imported from `@pragmatic-tech-ai/todl`, it is always this compiler one; `src/runtime/`'s handle-based `Graph` is reachable only from inside the package's own source tree.

The short version: "todl-runtime" (the npm package) gives TODL its DI/reactive plumbing; `src/runtime/` (the internal folder) gives *internal* callers a simplified, handle-based way to read a composed model without learning the full `Repository` surface. Neither one is "the" graph you get from the public API — that's always `compiler-services/model/graph.ts`.

---

[← Back to the Architecture overview](../architecture.md)

See also: [The build system](build-system.md) · [Consuming a model](consuming-a-model.md) · [Core concepts](core-concepts.md)
