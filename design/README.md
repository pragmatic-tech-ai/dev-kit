# design/

Design systems for the suite, imported from **Claude Design**
(`claude.ai/design`) and kept in sync via the DesignSync tool.

## Layout

```
design/
  design-systems.json          registry: name → { projectId, url, focusFiles }
  design-systems/
    default/                   the Pragmatic Labs Design System (imported)
      colors_and_type.css      tokens — single source of truth (colors/type/spacing/…)
      _ds_manifest.json        token + card manifest
      _ds_bundle.js            component bundle
      _adherence.oxlintrc.json oxlint rules that enforce token usage in code
      README.md / SKILL.md     the system's own docs
      …
```

The **canonical source** is the Claude Design project referenced in
`design-systems.json`; the files here are a synced copy. Edit the design in
Claude Design, then re-import (below) — do not hand-edit the imported files.

## Import / update — a single prompt

Ask (in an interactive Claude Code terminal):

> import the default design system

or invoke the skill directly:

> /import-design-system default

The **[import-design-system](../.claude/skills/import-design-system/SKILL.md)**
skill resolves the name to its `projectId` in `design-systems.json` and pulls the
current files via `DesignSync` into `design-systems/<name>/`.

### Authentication

DesignSync rides your claude.ai login. The first run prompts once to grant
design-system scope; if the session has no claude.ai login, run `/design-login`
first. This requires an **interactive** terminal — headless/CI runs cannot
authenticate, so the import is an on-demand action, not a cron job.

## Consuming the tokens

`design-systems/default/colors_and_type.css` is the source of truth for brand
color, type, spacing, radii, shadows, and motion (Signal Green `#2EA862`, Inter
Tight / JetBrains Mono / Source Serif 4). Downstream surfaces (the docs site,
Mural themes, the apps) should reference these tokens rather than hard-coded
values. `_adherence.oxlintrc.json` can be wired into CI to flag raw hex/px/font
literals.
