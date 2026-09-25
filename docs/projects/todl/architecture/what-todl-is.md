# What TODL Is

TODL is the TypeScript rebuild of the **Typed Object Language** — a typed
substrate for authoring and reasoning over ontologies and taxonomies. This page
expands on the one-paragraph definition in the [architecture overview](../architecture.md)
and explains the ideas that shape every other page: what problem TODL solves, the
shape of the workflow it supports, and the three properties that recur throughout
the codebase.

## The problem TODL solves

Many domains — enterprise architecture, product catalogues, regulatory models,
system topologies — are really *typed graphs of classified things*. A component
depends on other components; an application is deployed into an environment; a
technology is billable and belongs to a vendor. People model these today in
diagramming tools, spreadsheets, or bespoke schemas, and the model's rules live
only in someone's head or in a validation script bolted on afterwards.

TODL makes the rules first-class. You write a **meta-model** — a small language
for your domain that declares what a `component` is, what fields and
relationships it has, and how instances are classified into taxonomies. Then you
(or an agent) author concrete **models** against that meta-model, and TODL
answers the only question that matters at authoring time — *is this model
correct?* — by compiling it. A correct model is one the compiler accepts; an
incorrect one comes back with precise, located diagnostics.

The pipeline is always the same three verbs:

```
compile → validate → emit
```

Source `.todl` text is **compiled** into a reflective typed graph, the graph is
**validated** against the meta-model's rules, and the result is **emitted** in
whatever form the consumer needs: a JSON interchange document, a compact binary
manifest, regenerated `.todl` text, a typed TypeScript client, a publishable npm
package, or a self-contained runnable web app.

## Who authors TODL, and why the compiler is the contract

TODL was built with agent-assisted authoring in mind. An agent given a
meta-model and a set of libraries can propose a model, and the compiler is the
oracle that tells it — deterministically, with machine-legible diagnostics —
whether the proposal holds together. Because the *same* compiler powers the
language server in an editor, the build system in CI, and the tools an agent
calls, everyone shares one definition of "correct." There is no second,
drifting validator.

This is why so much of the architecture funnels through a small public API
(`check` and `checkAgainst`, described in [The compiler](compiler.md)): it is the
single front door to that shared judgement.

## Three properties worth internalising

Three ideas show up again and again once you start reading the code. Holding
them in mind makes the rest of the system read naturally.

### One graph, many tiers

Everything TODL knows about lives in **one graph**. A concept declaration, a
taxonomy term, and a concrete instance are all `Node`s in the same structure;
every relationship between them — "is typed by", "extends", "is contained in",
"is narrower than", "is annotated with" — is a typed `Edge`. The nodes are
stratified into **tiers**: the meta tier, the ontology (type/definition) tier,
and the instance (data) tier.

Because there is only one structure, the compiler, the validator, the emitters,
and the runtime reflection API all operate over the same thing. There is no
separate "schema representation" and "data representation" to keep in sync —
the type layer and the data layer are neighbouring tiers of one graph. The
vocabulary of that graph (`Node`, `Edge`, `Tier`, `MetaKind`, `Cardinality`,
and friends) is the subject of [Core concepts](core-concepts.md).

### The compiler is the validator

TODL deliberately refuses to separate "parse it" from "is it valid." Asking
whether a model is correct *is* compiling it. The output of a compile is a
populated graph **plus** a list of `Diagnostic`s, each carrying a stable code, a
source span, and a message. Nothing downstream has to re-derive correctness: the
build system gates on the same diagnostics the editor underlines and an agent
reads back.

A practical consequence appears in the publish path: `compilePackage` runs the
compiler and *refuses to produce a package if there are errors*. You cannot
accidentally publish a broken model, because a broken model never becomes an
artifact in the first place. See [Publish and packages](publish-and-packages.md).

### Provenance-blind by file type

Downstream stages key off *what a file is* — a `.todl`, a `.mu` — never where it
came from. A `.todl` file that a human wrote, one a generator produced, and one
that was generated and then hand-edited are indistinguishable to the compiler,
exactly the way `tsc` treats a `.ts` file the same however it was produced.

This is what makes generated content safe to check in and safe to override. The
build system's application compiler, for instance, generates a `generated/app.mu`
view for a project but will not clobber it if you have edited it — and the
compiler treats your edited version and the generated one identically because
both are simply `.mu` files. The same principle lets the load path record a
`provenance` map (which source URI a node came from) as *metadata* for tooling,
without ever letting provenance change the meaning of the code.

## Where to go next

- To learn the vocabulary the rest of the docs assume, read
  [Core concepts](core-concepts.md).
- For the shape of the whole system at a glance, read
  [The two-minute mental model](mental-model.md).
- To see the pipeline run end to end, read [End-to-end walkthroughs](walkthroughs.md).

---

[← Back to the Architecture overview](../architecture.md)

**See also:** [Core concepts](core-concepts.md) · [The two-minute mental model](mental-model.md) · [The compiler](compiler.md)
