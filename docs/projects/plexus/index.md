# Plexus

The desktop workbench (Electron) that hosts the editors, the diagrammer, the
agent tooling, and the project/solution model. Built on **[Mural](../mural/)**,
**[Fresco](../fresco/)**, and **[TODL](../todl/)**.

- **[Settings architecture](settings-architecture.md)** — how settings are
  layered, stored, and bound.
- **[Skills help](skills.md)** — the agent skills subsystem from the user's
  perspective.

## Architecture deep dives

How Plexus organizes projects into solutions, shows them, and builds them — for
engineers who need the full picture. Each builds on TODL's
[solution-services](../todl/architecture/projects-and-solutions.md) engine; the
split between the engine (TODL, the lower layer) and the workbench (Plexus, above
it) is a recurring theme.

- [The solution model](architecture/solution-model.md) — `SolutionManagerService`,
  what a solution and its members are, the active-solution signal, and the
  host-seam contract that lets an engine type drive the workbench without
  depending on it.
- [The Solution Explorer](architecture/solution-explorer.md) — the hierarchy tree,
  the keyed-contributor / delta-provider split, projects and files as live rows,
  and the `IContentMutations` command seam.
- [Process-agnostic builds](architecture/process-agnostic-builds.md) — one build
  engine across Electron's renderer/main divide: `BuildService`, the `IBundler`
  and build-storage seams, the IPC boundary, and how a build is triggered from
  the UI.
- [Build targets](architecture/build-targets.md) — the three selectable outputs
  (`npm-package`, `npm-publish`, `html-bundle`), what each produces, which project
  types they apply to, and when to use each.
