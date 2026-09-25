# Architecture Agentic Suite — Dev Kit

Documentation hub for the suite. The projects — **TODL** (typed-object language +
compiler), **Mural** (UI/rendering framework), **Fresco** (layout engine), and
**Plexus** (the desktop workbench) — each build on the one below them.

This site is served from the [`pragmatic-tech-ai/dev-kit`](https://github.com/pragmatic-tech-ai/dev-kit)
repository and rebuilt on every push to `main`.

## TODL

- [Architecture](architecture.md) — how the compiler and runtime fit together:
  load → validate → emit over a reflective typed graph.
- [The TODL language](todl-language.md) — the language reference: types,
  meta-models, taxonomies, operators, and the model compiler.

## Design specs

The graph-engine redesign — the node/edge model, inheritance flattening, the
manifest format, the reflection API, and the domain layer.

- [Redesign journal](graph-engine-redesign/JOURNAL.md) — the root tracker.
- [SPEC-01 — Node & edge model](graph-engine-redesign/SPEC-01-node-and-edge-model.md)
- [SPEC-02 — Inheritance flattening](graph-engine-redesign/SPEC-02-inheritance-flattening.md)
- [SPEC-03 — Manifest model](graph-engine-redesign/SPEC-03-manifest-model.md)
- [SPEC-04 — Manifest binary format](graph-engine-redesign/SPEC-04-manifest-binary-format.md)
- [SPEC-05 — Reflection API](graph-engine-redesign/SPEC-05-reflection-api.md)
- [SPEC-06 — Domain](graph-engine-redesign/SPEC-06-domain.md)
