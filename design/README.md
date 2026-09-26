# design/

Design systems for the suite. Each one lives as a **Claude Artifact** (type
"Design System") on claude.ai; this folder only holds pointers to them.

## Layout

```
design/
  design-systems.json          registry: name → { name, artifactUrl, entryFiles }
  design-systems/
    pragmatic/
      README.md                artifact URL, how to read it, quick reference
```

The **canonical source** is the artifact referenced in `design-systems.json`.
Edit the design there — nothing in this folder is a copy of its content.

## Reading a design system

Use the Artifact tool's `read` action on the system's `artifactUrl` (not
WebFetch/curl). Start with `project/README.md` (the brand book), then
`project/tokens.json` for exact values. See
[design-systems/pragmatic/README.md](design-systems/pragmatic/README.md).

## Consuming the tokens

The Pragmatic Labs artifact's `project/tokens.json` is the source of truth for
brand color, type, spacing, radii, and shadows (Signal Green `#2EA862`, Inter
Tight / JetBrains Mono / Source Serif 4). Downstream surfaces (the docs site,
Mural themes, the apps) should reference these tokens rather than hard-coded
values.
