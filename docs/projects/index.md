# Projects

The suite is a layered stack — every project depends only on the ones below it.

| Project | Role | Depends on |
| --- | --- | --- |
| **[Plexus](plexus/)** | Desktop workbench (Electron) hosting the editors, diagrammer, and agent tooling | Mural, Fresco, TODL |
| **[Mural](mural/)** | UI / rendering framework — property system, markup language, controls, theming, diagrams | TODL, todl-runtime |
| **[Fresco](fresco/)** | Hierarchical layout engine | — |
| **[TODL](todl/)** | Typed-object language: compiler, meta-models, model runtime | todl-runtime |
| **[todl-runtime](todl-runtime/)** | Zero-dependency runtime core (Observable, disposables, service provider) | — |

## Where to start

- New to the language? Read **[TODL → the language reference](todl/todl-language.md)** and **[TODL architecture](todl/architecture.md)**.
- Building UI? **[Mural](mural/)** is the largest section — start with its index for the full topic map.
- Working on layout? See **[Fresco](fresco/)**.
- Extending the app? See **[Plexus](plexus/)**.
