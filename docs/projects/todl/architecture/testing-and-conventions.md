# Testing and conventions

This page is the deep-dive companion to section 14 of the [Architecture overview](../architecture.md). It covers how `@pragmatic-tech-ai/todl` actually runs its tests — the runner, why it doesn't type-check, where a test file is allowed to live, the layered unit/smoke/golden testing strategy and what each layer catches that the others don't — plus the house coding style the codebase holds itself to, and where specs and plans are tracked. As with the [package surface](package-surface.md) page, everything below is read from real `package.json` scripts and real files in the repository, not summarised from memory.

## The test runner, and why it doesn't type-check

`npm test` runs:

```
tsx --conditions=development --test "src/**/*.test.ts"
```

Three things are worth unpacking in that one line. First, `--conditions=development` is the same import condition discussed on the package-surface page: it makes every `@pragmatic-tech-ai/*` import inside a test file resolve to raw TypeScript source rather than compiled `dist`, so tests always exercise the code as it stands in the working tree, not whatever was last built. Second, `--test` is Node's own built-in test runner (`node:test`) — there is no Jest, Vitest, or Mocha in this repository; test files use `import { test } from "node:test"` and `import assert from "node:assert/strict"` directly, as you can see in essentially every `*.test.ts` file in `src/`. Third, and most important to internalise: `tsx` is a transpiler, not a type-checker. It strips types and runs the resulting JavaScript; it never calls into `tsc` to check that the types are actually consistent. That means `npm test` passing tells you the *behaviour* is correct, not that the *types* are.

Type-checking is a deliberately separate gate: `npm run typecheck` runs `tsc --noEmit` (and `npm run build` runs the real compile, `tsc -p tsconfig.build.json`, as part of producing `dist`). Because these are two independent commands, it's possible — and has actually happened — for `tsc --noEmit` to report pre-existing strict-null issues inside test files that `npm test` never enforces, since the test runner never looks at them. If you're chasing down a type error that doesn't show up when you run the tests, this split is usually why: the test gate and the type gate are answering two different questions, and only one of them runs by default in the fast inner loop.

There is also a separate corpus script, `test:corpus`, which runs `tsx --conditions=development --test` over `shared/**/*.test.ts`, `examples/**/*.test.ts`, `examples/**/*.test.mts`, and `cli/**/*.test.ts` — the demo/corpus suite that lives outside `src/**` entirely (see Goldens below).

## Test location: a tests subfolder next to the code it exercises

Every unit test lives in a `tests/` subfolder sitting next to the source it exercises — `src/model-data/tests/model-data-source.test.ts`, never `src/model-data/model-data-source.test.ts` sitting flat beside `model-data-source.ts`. This is consistent across the whole `src/` tree: `src/authoring/tests/model-draft.test.ts`, `src/manifest/tests/manifest-writer.test.ts`, `src/manifest/reflection/tests/repository-parity.test.ts`, `src/language-service/tests/hover.test.ts`, `src/domain/tests/domain.test.ts`, `src/publish/tests/compile-package.test.ts`, and dozens more, one `tests/` folder per module directory that has tests. The `src/**/*.test.ts` glob `npm test` runs finds all of them regardless of depth, so this is purely an organisational convention, not something the runner requires — its payoff is that every source directory itself stays test-free: `ls src/model-data/` shows only the module's actual implementation files plus one `tests/` folder, rather than implementation and test files interleaved.

A real example worth looking at, `src/model-data/tests/model-data-source.test.ts`, shows the convention alongside the house coding style described below in the same file: a `miniRepo()` helper and a `MiniSource extends ModelDataSource` test double, both written with Allman braces and a small, self-contained fixture built directly off `Repository`'s `Builder` API — no mocking framework, just the real compiler types exercised in miniature.

## Smoke tests: outside the glob, closer to the real user

`user-smoke-tests/` is a second, deliberately separate test tree, run with its own script:

```
npm run test:smoke
```

which is `tsx --conditions=development --test "user-smoke-tests/**/*.test.ts"` — note the glob root is `user-smoke-tests/`, not `src/`, so these tests never run as part of the default `npm test` invocation; a `pretest:smoke` script (`playwright install chromium`) provisions the headless browser first.

The single smoke test currently in that folder, `architecture-bundle.smoke.test.ts`, is worth reading end to end because it is the closest thing in the repository to "does this actually work for a user." It drives the *real* on-disk `test_architecture` project through the full solution-manager build stack — `TodlBuildSystemRegistry`, `SolutionBuildManager`, an in-memory `LocalNpmRegistry` standing in for a published registry, and a `RegistrySource` for cross-project base resolution — building a meta-model and two libraries (`meta-models/tech-architecture`, `libraries/microsoft`, `libraries/aws`) as npm packages first, publishing them, then building the architecture project itself as an `html-bundle`. It asserts on the produced `index.html` structurally (it contains `todl-app-root`, `__TODL_APP__`, `TodlAppBootstrap`, and namespaces from every base in the closure), and then goes further: it launches real headless Chromium via Playwright, navigates to the built page, and asserts that the page renders with no `pageerror`s, that a meaningful number of `<text>` nodes actually painted, that known concept-section headers (`Actor`, `Application`, `Component`, `Block`) appear, and — critically — that no row rendered as the literal string `"[object Object]"`.

That last assertion is not decorative. The test's own comments record that this exact regression — rows binding through `DisplayMemberPath` and silently falling back to a stringified object instead of the entity's `id` — was a real bug that the unit-test suite did not catch, because nothing at the unit level renders a mural UI in a browser and looks at the resulting text nodes. This is the concrete argument for why the smoke layer exists at all, separate from and slower than the unit suite: unit tests verify each piece in isolation against the compiler's own types, but only an end-to-end build plus an actual browser render can catch a wiring bug in the generated glue between the compiled DTO and the compiled `.mu` UI. The layering is deliberate — fast, in-`src/` unit tests for the compiler/model/codegen logic that changes constantly, and a slower, real-browser smoke test outside that glob for the handful of places where "it type-checks and the unit tests pass" and "it actually renders correctly for a user" can diverge.

## Goldens: the examples corpus

`examples/` is a corpus of small, focused `.todl` fixtures — `examples/basics/prelude-element/`, `examples/operators/operator-edges/`, `examples/references/type-directed/`, `examples/bases/check-against/`, and so on — each pairing a `m.todl` source file with a `golden.json` snapshot of that source's compiled, normalised emit output. The corpus is driven by the CLI (`cli/`, invocable via `npm run cli`, and packaged as the `todl-demo` command for demo purposes though it is not a published `bin`): the CLI's `test` command (`cli/src/commands/test.ts`) either verifies every example against its golden (`verifyAll(CORPUS)`, reporting pass/fail per example id with a diff on failure) or, with `--update`, regenerates the goldens from the current compiler output. The corpus itself is generated into `examples/corpus.generated.ts` by `npm run gen:corpus`, and `npm run gen:goldens` chains `update-goldens` followed by a corpus regeneration so the two stay in sync.

The point of a golden here is the same as anywhere else the pattern is used: the golden *is* the normalised emit output, so a golden test doesn't assert some hand-picked property of a compile — it pins the compiler's actual, full output for a small representative input and flags any diff. That makes it sensitive to real regressions in the emitter or loader (a change in how an edge is written to JSON, an ordering change, a newly-dropped field) that a narrower assertion-based unit test might not think to check, at the cost of needing a deliberate `--update` + review whenever a change to the emit format is intentional.

## House style

The codebase holds itself to a consistent style, documented in the project's `CLAUDE.md` and the workspace-wide rules, and visible directly in the source (for example the `MiniSource`/`miniRepo()` example above, or the `TempBuildStorage`/`EmptySource` classes in the smoke test):

- **Object-oriented, not functional.** Behaviour lives on classes as methods; there are no free functions or module-level mutable state. A pure transform still becomes a (possibly static) method on the type it belongs to.
- **Allman braces.** Every block's opening brace goes on its own line — class, method, and control-flow bodies alike — including `else`/`catch`/`finally` starting their own line. Object literals and one-line blocks stay inline.
- **PascalCase for interfaces and public methods.** `IBuildAction`, `TryGet`, `ComposeGraph`, `Mount` — every public interface and public method name is PascalCase. Private members and plain data-shape properties that mirror serialized JSON keep their own casing.
- **Enums over string-literal unions.** A fixed set of values is a real enum (`EdgeKind`, `MetaKind`, `Cardinality`, `ProjectBuildStatus`), never a `"a" | "b" | "c"` union.
- **Reused string literals are hoisted.** A label, message, or serialization key used more than once becomes a `private static readonly` constant on the owning class rather than being retyped at each use site.
- **New view models extend Observable, not MuralBase.** `MuralBase` is reserved for things that genuinely need the dependency-property system; a plain view model defaults to the lighter `Observable` root.
- **Generated files keep their generator's style.** `*.generated.ts` and `*.mu.js` output is exempt from the above — it's produced code, not hand-authored code, so it follows whatever its generator emits.

## Where work is tracked

Specs, plans, and tasks for TODL live in the GitHub Project *Architecture Agentic Suite* (organisation `pragmatic-tech-ai`, project 1) — not as files under `docs/` in this or the TODL repository. If you're looking for the current backlog, an in-flight design, or the status of a particular piece of work, the GitHub Project is the source of truth; the documentation you're reading now (and the in-repo `docs/ARCHITECTURE.md` it mirrors) describes the system as it stands, not what's planned or in progress.

---

[← Back to the Architecture overview](../architecture.md)

See also: [The compiler](compiler.md) · [Package surface and dependencies](package-surface.md) · [Core concepts](core-concepts.md)
