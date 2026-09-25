# Tooling

Section 12 of the architecture overview lists four pieces under "Tooling": a
language server, a pure language service behind it, a demo/corpus CLI, and a
migration rewriter. They don't share a runtime — the LSP runs inside an
editor over stdio, the CLI runs from a terminal against a golden corpus, and
the migrator is a batch text transform — but they share one design instinct:
push analysis into pure functions over immutable inputs, and keep every
stateful, I/O-touching, or transport-specific concern in a thin shell around
that core. This page is the deep-dive companion to
[section 12](../architecture.md#12-tooling); it walks each piece with real
file paths and function signatures from `@pragmatic-tech-ai/todl` v0.36.x.

## The language server: transport and caching, nothing else

`src/language-server/` is the Language Server Protocol implementation. Its
entire job is to own the things a pure analysis function cannot own —
open-document state, debouncing, and wire I/O — and delegate every actual
question about a `.todl` file to `src/language-service/`.

`createServer(connection, makeFsProvider?)` in `server.ts` is the core: a
function, not a class, that wires a `vscode-languageserver` `Connection` to
the rest of the module. It is deliberately browser-safe — it takes an
optional `makeFsProvider` factory rather than touching the filesystem
directly, so the same function can run inside an editor extension with real
file access or inside a browser-hosted host with none. The bin entry,
`stdio.ts`, is the thin platform-specific half: it creates a stdio
`Connection` with `createConnection(process.stdin, process.stdout)` and
passes `() => new FsSourceProvider()` as the FS factory, so filesystem
discovery only exists on that path. `stdio.js` is what `package.json`'s
`bin.todl-language-server` points at — the only bin this package publishes;
the demo CLI described below is not one of them.

`createServer` maintains two pieces of state across requests: a
`ProjectRegistry` (`workspace.ts`) that partitions open documents into
projects by longest-prefix match on a root URI, and a `SourceProvider`
abstraction with two implementations — `PushedSourceProvider`, which reads
whatever text is currently open in the editor (`docs.all()` filtered to the
project's root), and `FsSourceProvider`, which scans the filesystem. Which
one is active is decided once, in `onInitialize`, from the client's
`initializationOptions.mode` (falling back to `"fs"` when workspace folders
were provided, `"pushed"` otherwise).

Every edit funnels through one `touch(uri)` function that marks a project
dirty and calls `scheduleRevalidate()` — a 200ms debounce (a single
`setTimeout`, cleared and reset on every call) so a burst of keystrokes
triggers one recompute, not one per keystroke. When the timer fires,
`revalidate()` walks every dirty project, calls `analyze(sources,
project.bases)` from the language service, stores the resulting `Analysis` on
the project, and pushes `analysis.diagnosticsByUri` back to the client via
`connection.sendDiagnostics`. Nothing else in the server computes anything —
every LSP request handler (`onCompletion`, `onHover`, `onDefinition`,
`onReferences`, `onPrepareRename`, `onRenameRequest`, `onDocumentSymbol`,
`onFoldingRanges`, `onDocumentFormatting`, `onCodeAction`,
`onSignatureHelp`, `onWorkspaceSymbol`, the semantic tokens handler) looks up
the project's already-computed `Analysis` and calls exactly one pure function
from `language-service` against it. The capability list this registers in
`onInitialize` — `textDocumentSync: Incremental`, completion (with `&`, `:`,
`-`, ` ` trigger characters), hover, definition, references, rename (with
`prepareProvider`), document symbols, document formatting, folding ranges,
workspace symbols, code actions, signature help (triggered on `&`), and full
semantic tokens against a published legend — matches this handler set
one-to-one: the server supports exactly what it has a pure function to answer
with, no more.

Two custom notifications extend the base protocol:
`todl/setBases`/`todl/refreshBases`, both taking `{ rootUri, bases }` and
calling `registry.setBases` followed by a revalidation. This is how a host
(an editor extension, or Electron main) tells the server which compiled base
packages a project resolves against — the server has no package resolution
logic of its own; bases arrive as already-compiled `TodlDocument`s pushed in
from outside.

## The language service: pure, cache-free, whole-project analysis

`src/language-service/` is where every actual question about a `.todl`
project gets answered, and its central discipline is right there in the
`Analysis` interface's own comment: "Pure — recomputed from scratch by
`analyze`; the core keeps no cache (the server owns caching)."

`analyze(sources: SourceFile[], bases: TodlDocument[] = []): Analysis`
(`analysis.ts`) is the single entry point. For every source file it runs
`parse` and `tokenize` (both from `compiler-services/parse/`) to get an AST
and a token stream, then calls `checkAgainst(bases, sources)` — the same
compiler entry point the build system and the publish pipeline use — to get
a fully compiled `Repository` and a flat `Diagnostic[]`. From there `analyze`
builds a `ReferenceIndex` (`buildReferenceIndex`, from every parsed AST) and
a `DefinitionIndex` (`buildDefinitionIndex`), and groups the compiler's
diagnostics per source URI (`diagnosticsByUri`) so the server can publish
them per document — including seeding an empty list for every known source,
so a file that becomes clean gets its squiggles cleared, and fanning
whole-model diagnostics (ones with no span, like a bound-vocabulary failure)
out to every file in the project rather than losing them. The returned
`Analysis` bundles all of it: the parsed sources (`ast`, `tokens`, `text` per
URI), the compiled `model: Repository`, `refs`, `defs`, the flat
`diagnostics`, and `diagnosticsByUri`. Nothing in `analyze` retains state
between calls — call it twice with the same inputs and you get two
independently-built, equivalent results.

Every feature module in the directory is a set of plain functions taking an
already-built `Analysis` plus a position or range, never mutating it and
never reaching back into the compiler:

- `hover.ts` — `hoverAt(a, uri, pos)` classifies the position
  (`classifyPosition`, from `classifier.ts`), resolves the symbol's kind via
  `symbolKindOf`, and for a concept walks `a.model.schemaOf(symbol)` to list
  its fields and relationships in the hover markdown, along with any
  `description` attr found on the resolved node.
- `completion.ts` — `completionsAt(a, uri, pos)` switches on the classified
  context kind (`TypeSlot`, `RelationshipTarget`, `RefValue`, or top-level
  `None`) and returns the matching candidate set: concepts/primitives/
  taxonomies for a type slot, concepts only for a relationship target, or the
  fixed declaration keyword list (`namespace`, `concept`, `taxonomy`, …) at
  top level.
- `navigation.ts`, `definitions.ts` — go-to-definition and the definition
  index the server's `onDefinition` handler reads.
- `reference-index.ts` — `buildReferenceIndex` walks every AST via the
  compiler's own `visitReferences`/`RefRole` walk (`compiler-services/parse/
  references.ts`) and re-labels each occurrence with an editor-facing `Role`
  enum (`Extends`, `FieldType`, `RelationshipTarget`, `RefValue`,
  `InstanceConcept`, `InstanceOf`, `Import`, `Represents`,
  `AnnotationName`) — deliberately derived from the loader's own reference
  walk rather than re-implemented, so the reference index and the compiler
  never disagree about what counts as a reference.
- `semantic-tokens.ts` — `semanticTokens(a, uri)` maps every occurrence's
  `Role` (and every definition's `SymbolKind`) to one of a small fixed token
  type legend (`type`, `class`, `enumMember`, `property`, `method`,
  `variable`, exported as `SEMANTIC_LEGEND`) and encodes them as LSP semantic
  token deltas.
- `rename.ts`, `document-symbols.ts`, `folding.ts`, `workspace-symbols.ts`,
  `code-actions.ts`, `formatting.ts`, `signature-help.ts`, `schema-context.ts`
  — the remaining capabilities, each following the same shape: a pure
  function over `Analysis` (plus, for a few, the raw AST or token stream
  already sitting on it).

`language-service/index.ts` re-exports all of it as one flat barrel, which is
exactly what `server.ts` imports from
(`@pragmatic-tech-ai/todl/language-service`) — the server never reaches past
that subpath into compiler internals directly. The split is strict enough
that the same `analyze` + feature-module set could sit behind a completely
different transport (a browser worker, an HTTP endpoint) with zero changes;
only `server.ts` and `stdio.ts` know they're an LSP.

## The demo CLI: a corpus runner, not a published tool

`cli/` holds `todl-demo`, a small command runner over the example corpus in
`examples/`. It is explicitly not part of the published package — `files` in
`package.json` ships only `dist` and `README.md`, and the `bin` field lists
only `todl-language-server`. `todl-demo` exists for in-repo use: exploring
the corpus, regenerating goldens, and producing the showcase docs.

`main.ts` (`runCommand(argv)`) dispatches on the first argument to one of
four commands, all under `cli/src/commands/`:

- `list` — prints every corpus entry grouped by `manifest.group`, ordered by
  `manifest.order` (via `byGroup`/`groups` in `shared/corpus-access.ts`).
- `run <id>` — looks the example up by id (`byId`), compiles it, and prints
  its diagnostics and its emitted document as JSON. Its own comment states
  the philosophy directly: "the golden IS the normalized pipeline output —
  print it as the stages" — there is no separate "demo mode" rendering, the
  command just surfaces what the golden-verification pipeline already
  produces.
- `test [--update]` — without `--update`, runs `verifyAll(CORPUS)` (from
  `shared/verify.ts`) and prints a pass/fail line per example plus a diff for
  any failure; with `--update`, calls `updateGoldens` to rewrite the
  committed snapshots instead of checking them.
- `docs [--out <dir>]` — renders the whole corpus to static markdown via
  `renderDocs` and writes it to a directory (`docs/showcase` by default).

The golden-testing philosophy lives in `shared/verify.ts`. `compile(entry)`
runs the same `check`/`checkAgainst` compiler entry points as everything
else, then hands the result to `normalize`, which produces a `Golden`: a
canonicalized diagnostics list and a canonicalized document. Canonicalization
matters because compiled ids are not stable across runs — the default id
generator is wall-clock-based — so `canonicalizeIds` rewrites every node id
to a placeholder in a fixed order (own nodes first, as `#n0`, `#n1`, …, in
emission order; referenced-but-not-own ids after, as `#r0`, `#r1`, …, in
first-appearance order) before nodes and edges are sorted for a
deterministic diff. `selectOwnDocument` additionally strips the implicit
prelude and any explicit base documents out of the emitted result, so a
golden captures only what the example itself authored. `verifyExample`
diffs the freshly computed `Golden` against the one committed in the
corpus and reports `pass`/`fail`/`updated`; because normalization is
deterministic, an unchanged compiler and an unchanged example always
reproduce byte-identical JSON, so "the golden is the normalized pipeline
output" is not a description of intent — the committed snapshot literally
is what the pipeline emits, canonicalized.

## Migrate: mechanical, string-to-string, and honest about its limits

`src/migrate/` upgrades legacy `.todl` / `.architecture.model` source text to
the current surface. Its own header comment is explicit about scope: it
handles "only the mechanical token swaps the parser cannot absorb on its
own" — everything the parser can already tolerate (doc-only `authoring`
blocks, concept `references`, `formal` invariants, the `meta-model`
descriptor, numeric literals) is left alone rather than regex-rewritten,
because "regex stripping of brace-bearing raw-string examples is fragile."

`rewrite(legacySource: string): string` (`rewriter.ts`) is the pure
string-to-string entry point, running four passes in sequence:

1. **Reference sigil strip** — `@ref` / `&ref` → `ref`: any `@` or `&`
   immediately before a lowercase identifier is dropped, because the
   type-directed loader now resolves bare names as references on its own.
2. **List type rewrite** — `list<T>` → `T[]`: matched innermost-first
   (`[^<>]+` so a `list<object{…}>` wrapping another `list<…>` unwraps from
   the inside) and looped to a fixpoint, folding a trailing `[*]`/`[1..*]`
   into the resulting cardinality suffix before the bare-list rule applies.
3. **Cardinality rewrite** — the old bracket syntax maps onto the new suffix
   syntax: `[0..1]` → `?`, `[1..*]` → `[+]`, `[*]` → `[]`, and a bare `[1]`
   is simply removed (required-one needs no suffix).
4. **Enum-to-taxonomy rewrite** — `enum` → `taxonomy` and `values` →
   `terms`, a straight keyword swap.

`rewriter.ts` is deliberately silent about anything that changes *meaning*
rather than *syntax* — a `formal` invariant downgrading to prose, for
example — the comment notes that kind of change "does so at parse time,
recorded in the migration report, not silently in the text," keeping the
rewriter itself a pure syntactic pass. `run.ts` is the batch driver on top of
it: `listTodlSources(dir)` recursively finds every `.todl`/`.model` file,
`migrateFiles(files)` reads and rewrites each one in memory (used by the
faithfulness test harness), and `migrateTree(srcDir, destDir)` writes the
rewritten sources into a new tree, renaming `.architecture.model` and
`.technology-library.model` to `.todl` along the way.

`recase.ts` is a separate, self-contained concern: the kebab-case →
C-like-identifier convention change (`project_c_like_identifiers`). It
deliberately does not reuse `compiler-services/parse/lexer.ts` — its own
comment explains why: it needs to keep working "after the lexer is flipped
to C-like," so it ships its own minimal kebab-capable scanner
(`scan(src)`) rather than depending on the very lexer whose surface it is
migrating away from. `recaseSource(text)` tokenizes, classifies every
identifier into a `Role` (`TypePascal`, `MemberCamel`, `NamespaceLower`,
`InstanceCamel`, or `Unchanged`) from its syntactic position — a name right
after `concept`/`taxonomy`/`primitive`/`annotation`/`model`/`term` becomes
`TypePascal`; a name after `relationship` becomes `MemberCamel`; a dotted
namespace header stays `NamespaceLower`; reserved keywords are always left
`Unchanged` — and rewrites only the identifiers whose casing actually
changes, leaving everything else in the source byte-identical.
`recase-ts.ts` extends the same transform to `.todl` fragments embedded in
TypeScript template literals (skipping ordinary quoted strings entirely so
it never touches unrelated code), which is what let TODL's own test fixtures
and generator templates get recased alongside real `.todl` files during the
convention change.

---

[← Back to the Architecture overview](../architecture.md)

See also:
- [The compiler front end](compiler.md)
- [Core concepts](core-concepts.md)
- [Consuming a model](consuming-a-model.md)
