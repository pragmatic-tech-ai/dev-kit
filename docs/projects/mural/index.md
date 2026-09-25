# Mural

`@pragmatic-tech-ai/mural` — the UI and rendering framework: a retained-mode
visual tree with a WPF-style property system, a declarative markup language
(`.mu`), controls, theming, and a diagram subsystem. Built on
**[TODL](../todl/)** and **[todl-runtime](../todl-runtime/)**.

## Getting started

- [Basics](basic.md) — the core controls (`Border`, `TextBlock`, panels,
  `ContentControl`, `ItemsControl`) and how they compose.

## Rendering core

The visual tree, the layout/render lifecycle, and the drawing primitives.

- [Visual Engine — Design](visual-engine-design.md)
- [Visual Tree](visual-tree.md)
- [Layout & Render Lifecycle](layout.md)
- [Drawing](drawing.md)
- [Text Measurement](text-measurement.md)
- [Property System](property-system.md)
- [Presentation Targets](targets.md)

## Markup & authoring

The `.mu` language and the mechanisms that turn markup into a visual tree.

- [Mural Language — Design](mural-language-design.md)
- [Dynamic markup ingestion](dynamic-markup-ingestion.md) — runtime template compilation
- [Control Templating](templating.md)
- [Styles](styles.md)
- [Resources](resources.md)
- [Attached Properties — Design](attached-properties-design.md)

## Controls & shell

Higher-level controls, interaction, and the application shell.

- [Commands and command surfaces](commands-and-surfaces.md)
- [Items, Data-Binding, Virtualization, Scrolling](items-and-scrolling.md)
- [Grid](grid.md)
- [Adorners](adorners.md)
- [Behaviors](behaviors.md)
- [Marquee selection](marquee-selection.md)
- [Shell Architecture](shell-architecture.md)

## Theming

Themes, schemes, fonts, and color expressions.

- [Theme architecture](theme-architecture.md)
- [Theme authoring](theme-authoring.md)
- [Font System](fonts.md)
- [Inline color routines](color-routines.md)

## Diagram subsystem

The diagram control, its API, connectors, and design tokens.

- [Diagram Subsystem — API Guide](diagram-api-guide.md)
- [Diagram control](diagram-control.md)
- [Diagram connectors](connectors.md)
- [Diagram Design Tokens — catalog](diagram-design-tokens.md)
- [Diagrammer — User Manual](diagram-user-manual.md)

## Services & build

- [Services & Dependency Injection](services-and-di.md)
- [Setting-backed dependency properties](setting-backed-dp-subscriptions.md) — subscription lifetime
- [Build Targets](build-targets.md)
