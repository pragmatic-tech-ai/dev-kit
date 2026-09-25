# The compiler front end

TODL's compiler lives entirely under `src/compiler-services/` in the
`@pragmatic-tech-ai/todl` package. It is the one place in the codebase that
turns `.todl` source text into the reflective typed graph everything else in
TODL — the language server, the build system, the publish pipeline, the
runnable app — reads. This page is the deep-dive companion to
[section 5 of the architecture overview](../architecture.md#5-the-compiler-compiler-services),
walking the pipeline stage by stage and calling out the gotchas that trip
people up.

The pipeline in one line: source text becomes an AST (parse), the AST is staged
into a graph across several dependency-ordered passes (load), the graph is
checked against semantic rules (validate), and the checked graph is serialised
one of three ways depending on who's consuming it (emit). The public entry
point for all of it is `src/compiler-services/api.ts`.

## parse: text to a dumb-data tree

Parsing is two files working together: `parse/lexer.ts` turns raw text into a
flat `Token[]`, and `parse/parser.ts` (a hand-written recursive-descent parser,
no parser-generator) consumes those tokens and builds an AST defined in
`parse/ast.ts`. The parser's own comment states its scope precisely: it is
"purely SYNTACTIC — it never resolves names, never looks up types, never
touches the graph." Anything type-directed is deferred to the loader.

Every AST node is tagged with one of two discriminant enums so downstream code
can switch exhaustively:

```ts
export enum DeclKind
{
  Primitive, Taxonomy, Viewpoint, Concept, Instance, Model, Annotation, Package, Operator,
}

export enum ValueKind
{
  String, Name, List, Composite, Boolean, Object, Edge,
}
```

`DeclKind` tags top-level declarations (a `concept`, a `model`, an `annotation`,
…); `ValueKind` tags the shape of a value on the right-hand side of `=`, a list
element, or an annotation param. The critical design point is `NameValue`: a
bare identifier like `calls = api` is *always* parsed as a `NameValue` — the
parser has no way to know, and does not try to know, whether `api` will end up
as a scalar attr or a graph edge. That decision needs the *declared type* of
the `calls` member, which doesn't exist as staged data until a later loader
pass. This is the seed of the "attr-vs-edge" type-directed rule covered below.

Almost every AST node carries a `span` (`diagnostics/span.ts`'s `SourceSpan` —
1-based line/column, exclusive end) so the language server can point back at
exact text for hover, go-to-definition, and diagnostics. A syntax error throws
an internal `ParseError`; the top-level `Parser.parse()` catches a hard failure
and returns an empty namespace, while the per-declaration loop inside
`parseNamespace()` catches a soft failure, records one diagnostic, and calls
`synchronize()` to skip to the next declaration boundary — so one malformed
`concept` doesn't take down diagnostics for the rest of the file.

The result of `parse(source, uri)` is a single `NamespaceNode`: the file's
`namespace <path>`, its `import <path>` list, and a flat `declarations` array.
Nothing is nested by namespace at this stage — namespace is just a tag the
loader reads later.

## load: staging the graph in dependency order

`parse/loader.ts` is the front door that turns parsed sources into a populated
`Repository`. Its header comment is worth quoting because it states the whole
rationale for why loading is staged rather than done in one pass:

> TODL lets you reference names before they are declared, and instances lean
> on type information that only exists once types are committed. So the
> loader stages the graph in dependency order, each pass committing before
> the next reads it.

Concretely, `loadInto(model, sources, reserved, idGenerator, provenance)` runs
these stages in order:

1. **Parse and flatten.** Every source file is parsed, and every top-level
   declaration is flattened into a `units` array, each tagged with its
   namespace, that file's imports, and its uri — the loader works over
   `units`, never `sources`, from here on. A unit whose name is already
   provided by the prelude (see below) is dropped with a
   `prelude.name-redeclared` warning rather than staged; the prelude always
   wins.
2. **Resolve pre-pass.** Before anything is staged, `resolve/resolver.ts`'s
   `makeResolver` walks *every* reference occurrence (collected by the
   unified AST walker `visitReferences` in `parse/references.ts`) and
   classifies each as `ok`, `qualified` (an explicit `ns.x` rewritten in
   place to the flat node `x`), `unreachable` (the target exists but its
   namespace isn't imported — `reference.unreachable`, deliberately distinct
   from "no such symbol" so the fix reads as "add an import"), or `undefined`
   (`reference.undefined`). `uses`/`libraries`/`conforms` targets on
   taxonomies and models are normalised and kind-checked here too.
3. **Pass 1 — type shells.** Primitives, concepts (with their explicit
   `extends` only — a parent-less concept virtually extends the prelude root
   `Element` as a *virtual* rule resolved on read, not a stored edge),
   taxonomies plus their term hierarchy, viewpoints, annotations, operators.
4. **Pass 2a — members.** Concept fields and relationships, annotation
   params, and invariant predicates (parsed via `predicate-parser.ts`, only
   *registered* at the very end). Committed before instances so a nested
   record can consult its parent concept's committed schema.
5. **Pass 2b — instances and models.** The concrete graph: model containers,
   contained objects, deferred taxonomy-term compositions, deferred term
   values, and reified operator edges — all materialised through the same
   `applyInstance`/`realizeValue` machinery (see below). This is where a
   member's declared type decides attr-vs-edge for every authored value.
6. **Applications and finalize.** Annotation applications (`target@Ann`) on
   concepts, members, taxonomies/terms, the package node, and class
   instances; `ApplicationRootPass.Resolve` marks the `entrypoint`-annotated
   application root; pass-2a invariants are registered; every
   declaration/instance/assignment gets its source span recorded via
   `recordSpans`.

Every reference that never resolved is threaded through as `undefinedIds`; at
each commit, edges touching those ids are silently dropped rather than
creating dangling placeholder nodes. That's a deliberate invariant: the graph
never contains a node created purely to be the target of a bad reference.

### The Builder and the commit-before-next-reads pattern

Each stage above opens its own `Builder` (`model/builder.ts`) — a staging
mutation API over the `Graph`. The class-level doc comment explains the
two-phase commit:

> Edits are staged, then applied together on `Builder.commit`. Commit is
> two-phase — all nodes first, then attrs and edges — so a reference may
> point at a target staged later in the same batch (forward references). A
> pre-check validates every staged reference before anything is written, so a
> bad reference aborts the whole commit without partial mutation.

So within *one* pass, forward references are free (e.g. `Component web { calls
= api; }` before `api` is declared, as long as both are in the same pass).
Across passes, the loader deliberately reopens a *fresh* `Builder` for each
stage and calls `.commit(undefinedIds)` before the next stage starts reading —
this is the "commit-before-next-reads" discipline named in the loader's own
comments. Pass 2a's field/relationship commits must land before Pass 2b reads
`model.effectiveSchema(concept)` to classify instance values, or the
attr-vs-edge decision would be working against a half-built schema.

### The attr-vs-edge oracle

The loader's most important semantic rule — and the one most likely to
surprise a newcomer — is that whether `x = foo` becomes a scalar attribute or
a graph edge is decided purely by the *declared type of member x*, never by
how `foo` is written. Two small helpers in `loader.ts` are the oracle:

```ts
function isReferenceType(model: Repository, type: string | undefined): boolean
{
  if (type === undefined) return false;
  const kind = model.resolve(type)?.metaKind;
  return kind === MetaKind.Concept || kind === MetaKind.Taxonomy;
}

function isReferenceMember(model: Repository, concept: string, name: string): boolean
{
  const schema = model.effectiveSchema(concept);
  if (schema.relationships.some((r) => r.name === name)) return true;
  const field = schema.fields.find((f) => f.name === name);
  return field !== undefined && isReferenceType(model, field.type);
}
```

`realizeValue` then switches on the authored `ValueKind` against that verdict:
a bare `NameValue` becomes `builder.addRelationship(id, name, value.name)` when
the member is reference-like, or `builder.setField(id, name, value.name)`
(a scalar) otherwise. A quoted string or boolean literal assigned to a
reference member is a hard error (`member.value-kind`) — you cannot fake an
edge with a string. Lists recurse per item (a repeated reference member yields
one edge per item); a typed inline object (`ObjectValue`) is materialised as a
contained, field-bound child node through the same `applyInstance` machinery
used for hand-written records; an `EdgeValue` (an operator application used as
a value, `a --> b`) mints the reified edge entity the same way. Reusing
`applyInstance` for all three keeps containment, id-dedup, and reference
resolution identical regardless of surface form.

Gotcha: because this decision reads `model.effectiveSchema(concept)`, it can
only run once Pass 2a has committed — which is exactly why taxonomy term
values whose shape isn't an unambiguous literal (`Name`, `List`, `Composite`)
are pushed onto a `deferredTermValues` queue in Pass 1 and only classified in
Pass 2b, once the represented concept's schema exists.

## Repository: the read+construct façade

`model/model.ts`'s `Repository` wraps a `Graph` (default store:
`InMemoryGraphStore`, dual adjacency plus type/metaKind indexes) and is the
thing every later stage — validate, emit, the language service, `ModelDraft` —
actually queries. Representative methods: `resolve(id)`, `instancesOf(concept)`,
`effectiveSchema(concept)`, `supertypesOf`, `represents`, `termsOf`, `attr`,
`ref`/`refs`, and `builder()` (which hands the loader a fresh `Builder` bound
to the underlying graph). It also owns `recordSpan`/`spanOf` for the
per-node and per-member span bookkeeping the loader and validator both use.

## validate: the compiler is the validator

`validate/validate.ts` walks every committed node and returns `Diagnostic[]`.
There is no separate "linter" — this *is* the answer to "is this model
correct?", and it's the same function the language server, the build system,
and agent tooling all call. The rule families, each backed by real code in
`validate.ts`:

- **Cardinality** — `checkCardinality` checks `One`/`Optional`/`Many`/`OneOrMore`
  against the *effective* (own + class-inherited) count of a field or
  relationship: `cardinality.required-missing`, `cardinality.too-many`,
  `cardinality.empty-not-allowed`.
- **Reference and target integrity** — `checkTargetTypes` verifies a
  relationship's targets are an allowed type or subtype
  (`relationship.target-type`); `checkTaxonomyValue` verifies a
  taxonomy-typed field's value resolves to a term of that taxonomy
  (`taxonomy.value-unresolved`); `checkBooleanValue` rejects a non-boolean
  value on a `boolean`-typed field (`type.boolean-invalid`).
- **Model binding and bound vocabulary** — `validateModel` checks the model's
  `: <metaModel>` namespace actually loaded (`model.binding-undefined`), then
  requires every contained object's constructing concept/class to come from
  the model's *bound vocabulary* — its own namespace, the meta-model's
  namespace, or the namespace of any `uses` taxonomy — else
  `constructor.out-of-scope`.
- **Conforms** — for a model split across files, each entity's home viewpoint
  (a per-entity `conforms` attr) must actually frame that entity's concept,
  via `model.viewpointsFraming` — else `model.entity-not-framed`.
- **Classes** — `checkBinding` validates an `instanceof` target exists, is a
  class, and shares the leaf's concept (`Class.binding-invalid`);
  `checkOverride` forbids a leaf from setting a class-fixed scalar to a
  different value (`Class.override`).
- **Invariants** — `checkInvariants` evaluates every predicate registered on
  a concept (and its supertypes) against each instance via
  `predicate/evaluate.ts`'s `satisfies(model, expr, nodeId)`, reporting
  `invariant.failed` with the invariant's own description text.
- **Annotations** — checks an annotation's base is itself an annotation, no
  param is redeclared, every applied param is known
  (`annotation.unknown-param`), and required params are present.

A **class** (`isClass: true` — a partial, fixed-value definition) is
deliberately exempt from completeness checks like `required-missing`, since
its instances are expected to complete it; it is still checked for
over-cardinality and target-type mismatches. A **leaf** (an `instanceof`
target's concrete instance) is counted over the merged class+leaf view via
`Repository.effectiveFields`/`effectiveRelationships` — this is the
class-wins resolution used everywhere validation and typed clients read the
graph, and it is intentionally *not* the same merge policy the manifest
emitter uses (see below).

Every diagnostic — from lex, parse, resolve, load, or validate — is the same
shape, defined once in `diagnostics/diagnostic.ts`:

```ts
export interface Diagnostic
{
  code: DiagnosticCode;
  severity: Severity;
  message: string;
  span: SourceSpan | null;
  node: NodeId | null;
  path: string | null;
}
```

`DiagnosticCode` is a real enum (not string-literal unions) with dotted string
values (`"cardinality.required-missing"`, `"constructor.out-of-scope"`,
`"taxonomy.ambiguous-bare-reference"`, …) grouped by phase — syntax, semantic,
class/taxonomy, instance-loading, operators, reference-resolution, model,
prelude, annotation, application-root, and solution-composition codes are all
in the one enum. Because every diagnostic carries a machine-legible `code`
plus a `span` that points at exact source text plus a human `message`, the
exact same `Diagnostic[]` a build pipeline gates on is what the language
server turns into an editor squiggle and what an agent can parse to decide
its next edit. That uniformity is the concrete meaning of "the compiler is the
validator" from the architecture overview.

## emit: three serialisations, three different merge policies

`src/compiler-services/emit/` holds three emitters that read the same
`Repository` but serve different consumers, and they disagree on purpose about
how a class and its instance merge.

**emit/json.ts** is the interchange form — `TodlDocument = { nodes, edges }`,
enums written by member name (`"Instance"`, `"Relationship"`, …) rather than
numeric value, so the wire form stays stable and legible across schema
evolution. `toJSON(model, options?)` serialises the whole graph;
`toJSONOwn(model, ownIds, options?)` serialises only the nodes in `ownIds`
and their out-edges, leaving an edge whose target is outside `ownIds` as a
dangling id resolved once the base package that owns it is also loaded —
exactly what `compilePackage`'s `document` (own nodes + recorded
dependencies) relies on. `fromJSON(doc)`/`graphFromJSON(doc)` reconstruct a
`Repository`/`Graph`. An optional `debug: true` attaches a
`NodeDebug`/`EdgeDebug` block per node/edge (readable name, type, namespace,
and — given a `provenance` map — the source uri) without changing the plain
wire form when left off.

**emit/todl.ts** re-emits a compiled model's own delta back to `.todl` text —
the write path `authoring/ModelDraft.toTodl()` depends on. It is
type-directed the same way loading is: reference values are emitted as bare
or dotted names (no sigil), and `collectOperators` reverse-maps a
reified-edge concept back to the first operator glyph that mints it, so a
round-tripped edge re-emits in its original shorthand (`a --> b`) rather than
as a synthesised record.

**emit/manifest.ts**'s `ManifestEmitter` is the one that matters most to get
right, because it deliberately breaks from `effectiveFields`. It produces two
artifacts: the **logical manifest** (the ontology tier — concept schemas,
class definitions, taxonomies) via `emitManifest()`, and the **flattened data
graph** (the instance tier — self-contained nodes with user-only attrs and
relationship-only edges) via `emitDataGraph()`. The file's own header comment
states the policy plainly:

> Flattening is INSTANCE-WINS: an instance's own value overrides its class's
> fixed value, and the class fills only fields the instance leaves unset...
> It deliberately differs from Repository.effectiveFields (class-wins), which
> stays the resolution used by validation / typed clients.

The implementation is a small, literal merge in `flattenedAttrs`: it copies the
class's attrs into the result first, then overwrites with the leaf's own
attrs — so a later write (the instance's) always wins over an earlier one (the
class's), even though both "win" in the sense that either can supply a value:

```ts
private flattenedAttrs(leaf: NodeId): Record<string, Scalar>
{
  const result: Record<string, Scalar> = {};
  const cls = this.repo.classOf(leaf);
  if (cls !== null)
  {
    const clsNode = this.repo.resolve(cls);
    if (clsNode !== undefined)
      for (const [key, value] of clsNode.attrs)
        if (!ManifestEmitter.MARKERS.has(key)) result[key] = value;
  }
  const own = this.repo.resolve(leaf)?.attrs;
  if (own !== undefined)
    for (const [key, value] of own)
      if (!ManifestEmitter.MARKERS.has(key)) result[key] = value;
  return result;
}
```

Why the split policy at all? Class-wins (`effectiveFields`) is what
`validate.ts`'s `checkOverride` enforces at compile time — a leaf is *not
allowed* to disagree with a class-fixed value, so by emit time, class and
leaf values for any given field are either equal or the leaf simply didn't
set it. Instance-wins matters specifically for `manifest/reflection`'s
`FieldView`, which exposes two independent axes: *definitionOrigin* (which
type declared the field) and *valueOrigin* (whether the concrete value came
from the instance or a fixing term). Axis 2 is only meaningful if the
instance's own value stays visible as distinct from the class's, rather than
being pre-collapsed the way `effectiveFields` does for validation's
purposes. Two emitters, two audiences, two deliberately different merge laws
over the same graph.

## api.ts: the public entry points

Everything above is orchestrated by three functions in `api.ts`.

`check(sources, idGenerator?)` compiles and validates a set of sources against
nothing but the prelude — it's `checkAgainst([], sources, idGenerator)`.

`checkAgainst(bases, sources, idGenerator?)` does the same against already
-compiled base documents (published meta-models or libraries, as
`TodlDocument` JSON):

```ts
export function checkAgainst(
  bases: TodlDocument[],
  sources: SourceFile[],
  idGenerator: IdGenerator = new SnowflakeIdGenerator(),
): { model: Repository; diagnostics: Diagnostic[]; provenance: Map<string, string> }
{
  const model = new Repository(mergeBases([preludeDocument(), ...bases]));
  const provenance = new Map<string, string>();
  const diagnostics = loadInto(model, sources, preludeNames(), idGenerator, provenance);
  return { model, diagnostics: [...diagnostics, ...validate(model)], provenance };
}
```

Note the order: the `Repository` is seeded from `mergeBases` *before* any
source is loaded, so a reference in `sources` to a base symbol resolves to the
base's node rather than being reported `reference.undefined`; `loadInto` is
handed `preludeNames()` as its `reserved` set specifically so a source
redeclaring a prelude name (`identifier`, `Element`, …) is warned and dropped
instead of colliding with the base node the builder already staged.

**mergeBases(bases)** deserialises a list of compiled base documents into one
graph with *first-wins* dedup: all nodes across all bases are added first (a
node id already present from an earlier base is skipped, never overwritten),
then all edges (one identical by `kind + via + from + to` to an existing edge
is dropped). Nodes are fully merged before edges because an edge needs both
endpoints to exist. This lets a library that carries its own meta-model, and
the prelude it was itself compiled against, collapse into one shared copy of
the prelude's nodes rather than duplicating them — `checkAgainst` relies on
exactly this to seed `preludeDocument()` plus every caller-supplied base in
one call.

**The prelude** (`stdlib/prelude.ts`, compiled from the embedded
`stdlib/prelude.todl` via `PRELUDE_SOURCE`, namespace `todl`) is the implicit
foundation base injected into *every* compile: the primitives `identifier`,
`slug`, `resourceKey`; well-known annotations `icon`, `label`, `toolbox`,
`instance`, `entrypoint`, `has_children`, `containment`, …; and the universal
root concept `Element` (`label?`, `description?`), which every parent-less
concept virtually extends. `preludeDocument()` compiles it once with the
*raw* loader (`load`, never `check` — so the prelude can't reference itself)
and memoizes the result; a malformed prelude throws at build time, since
that's an authoring error in the compiler's own foundation, not a user one.

## Gotchas worth remembering

A few things in this pipeline are easy to get backwards:

- A bare identifier is *never* syntactically a reference — `NameValue` covers
  both enum-flag members and object references; only the loader's
  `isReferenceMember` (needing a *committed* Pass-2a schema) can tell them
  apart. The parser and AST cannot answer "is this a ref?".
- `reference.undefined` and `reference.unreachable` are different codes on
  purpose: the former means no such symbol exists anywhere reachable; the
  latter means it exists but lives in an unimported namespace — different
  fixes (define it vs. `import ns;`).
- `toJSONOwn`'s dangling-edge behaviour is intentional: a published package's
  `model.json` is expected to have edges pointing outside its own node set,
  resolved once its declared base is also loaded.
- The manifest emitter's instance-wins flattening and `effectiveFields`'
  class-wins resolution are *both* correct — they answer different questions
  (reflection's current-value view vs. validation's binding view) and must
  not be unified.
- A model split across more than one file must repeat `conforms <viewpoint>`
  in every contributing block, checked by the loader's resolve pre-pass
  (`model.conforms-required-when-split`) before Pass 1 even starts staging —
  the earlier failure mode was a vocabulary-binding bug that silently passed
  for single-taxonomy blocks.

---

[← Back to the Architecture overview](../architecture.md)

See also:
- [Core concepts](../core-concepts.md)
- [Manifest and reflection](../manifest-reflection.md)
- [Consuming a model](../consuming-a-model.md)
