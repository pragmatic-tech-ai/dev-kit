# Architecture Agentic Suite — Dev Kit

The documentation hub for the suite. Each project builds on the ones beneath it:

```
Plexus            desktop workbench (Electron)
  └─ Mural        UI / rendering framework      Fresco   layout engine
       └─ TODL    typed-object language + compiler
            └─ todl-runtime   zero-dependency runtime core
```

Start with the **[projects overview](projects/)**, or jump straight in:

- **[TODL](projects/todl/)** — the typed-object language: compiler, meta-models, and the model runtime.
- **[todl-runtime](projects/todl-runtime/)** — the zero-dependency runtime core TODL and Mural share.
- **[Mural](projects/mural/)** — the UI and rendering framework: property system, markup language, controls, theming, and the diagram subsystem.
- **[Fresco](projects/fresco/)** — the hierarchical layout engine.
- **[Plexus](projects/plexus/)** — the desktop workbench that hosts it all.

---

This site is served from [`pragmatic-tech-ai/dev-kit`](https://github.com/pragmatic-tech-ai/dev-kit)
and rebuilt on every push to `main`.
