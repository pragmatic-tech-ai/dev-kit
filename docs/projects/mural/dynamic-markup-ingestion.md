# Dynamic markup ingestion (runtime template compilation)

mural markup is normally compiled **ahead of time**: a `.mu` file → a `.mu.js`
module by the build step. But the compiler is also callable **at runtime** —
`instantiate()` turns a mural source *string* into a live visual factory. This
lets an app compile markup it only has as text: author-supplied templates from a
published package, a fragment typed into an editor, a template assembled from
config.

This doc records the pattern and its non-obvious mechanics. Reach for it only
when the source is genuinely dynamic — for fixed templates, author a static
`.mu` and resolve it from `Application.Resources` (compile-time validation, no
runtime compiler cost, real imports instead of the symbol-table dance below).

> The worked example is preserved verbatim at the end. It was Plexus's
> `visual-library.ts`, which compiled two constant templates at runtime; once
> the author-supplied-template path was retired (presentation went icon-only)
> those two constants no longer justified the runtime compiler and moved to a
> static `.mu`. The technique itself is still the right tool when the source
> really is dynamic — hence this record.

## The API

```ts
import { instantiate, DEFAULT_SYMBOLS } from '@pragmatic-tech-ai/mural/compiler'

const factory = instantiate(source, ctx, { symbols: SYMBOLS }) as () => Visual
const visual = factory()   // builds a fresh visual tree each call
```

`instantiate(source, ctx, opts)` parses `source` (a bare-element fragment — one
root element, no `resources` / `DataTemplate` wrapper) and returns a **zero-arg
factory** that builds the visual. It needs **two different symbol tables**, and
conflating them is the usual mistake.

## The two symbol tables

**1. `symbols` — the *compile-time* table (name → module string).**
Used while parsing (the compiler's `ensureImport` step) to validate that every
referenced symbol is a known, importable thing. Start from `DEFAULT_SYMBOLS`
(all built-in mural types) and add any custom symbol the markup names.

The subtlety: for a symbol supplied *by value* at runtime (see `ctx` below), the
module string is a **fiction**. `instantiate` never imports from it — but it
must be **present and non-empty** or the import check rejects the symbol. So you
map custom converters/types to any placeholder module path:

```ts
const CONVERTER_MODULE = '../../diagram/services/icon-key-converter.js' // never actually imported
const SYMBOLS = new Map([
    ...DEFAULT_SYMBOLS,
    ['IconKeyConverter', CONVERTER_MODULE],
    ['ImageKeyConverter', CONVERTER_MODULE],
])
```

**2. `ctx` — the *runtime* table (name → actual value).**
The object `instantiate` destructures referenced symbols from when it builds the
visual. Spread the mural namespaces so `Grid`, `Border`, `Image`, `@OnSurface`,
etc. resolve to real constructors/values, then add your custom values:

```ts
function buildCtx(): Record<string, unknown> {
    return {
        ...muralRuntime, ...muralBasic, ...muralEngine,
        IconKeyConverter: new IconKeyConverter(),   // INSTANCE, not the class — see below
        ImageKeyConverter: new ImageKeyConverter(),
    }
}
```

Mnemonic: **`symbols` satisfies the compiler ("this name is legal"); `ctx`
satisfies the runtime ("here's the object that name means").**

## Converter references need instances

A no-arg converter reference in markup — `$IconKey << IconKeyConverter` — takes
the **bare symbol** from `ctx` and calls `.convert(value)` on it. So `ctx` must
map the name to a converter **instance** (which has `.convert`), not the class
(which does not). This differs from a static `.mu`, where `<< IconKeyConverter`
is resolved by the compiler and the emitted code instantiates it.

## Wrapping into a DataTemplate

`instantiate` yields a bare visual factory. To use it as a `DataTemplate` (so
`$Display`, `$IconKey`, … bind against a data item), wrap it and set
`DataContext` yourself — the manual step a static `DataTemplate.Apply(data)`
would otherwise do for you:

```ts
const wrapped: DataTemplateFactory = (data) => {
    const v = factory() as Visual & { DataContext: unknown }
    v.DataContext = data
    return v
}
return new DataTemplate(wrapped)
```

## Gotchas

- **A shim may be required.** Running the compiler in the renderer needed a
  Node-module shim (`node-module-shim.mjs`) because `instantiate` pulls in
  compiler machinery that expects a module environment. Static `.mu` avoids this.
- **Errors surface at runtime, not build.** Bad source throws from
  `instantiate` when the code path runs, not at compile time. Test the compile.
- **`factory()` builds a new tree each call** — cache the `DataTemplate`, not the
  visual, and let the template's consumer manage instances.

## Worked example (preserved)

The original `Plexus/src/renderer/src/modules/library/services/visual-library.ts`
— compiled two constant icon templates (a tile chip and a transparent canvas
figure), each an `Image`+`Icon` overlay bound to `$IconKey` through two
mutually-exclusive converters (raster → `Image`, vector → `Icon`):

```ts
import { instantiate, DEFAULT_SYMBOLS } from '@pragmatic-tech-ai/mural/compiler'
import * as muralRuntime from '@pragmatic-tech-ai/mural/runtime'
import * as muralBasic from '@pragmatic-tech-ai/mural/basic'
import * as muralEngine from '@pragmatic-tech-ai/mural/visual-engine'
import { DataTemplate, type DataTemplateFactory } from '@pragmatic-tech-ai/mural/basic'
import type { Visual } from '@pragmatic-tech-ai/mural/runtime'
import { IconKeyConverter, ImageKeyConverter } from '../../diagram/services/icon-key-converter.js'

// Fake module string — unused by instantiate, but ensureImport needs it present.
const CONVERTER_MODULE = '../../diagram/services/icon-key-converter.js'
const SYMBOLS = new Map([
    ...DEFAULT_SYMBOLS,
    ['IconKeyConverter', CONVERTER_MODULE],
    ['ImageKeyConverter', CONVERTER_MODULE],
])

// Runtime table: converter names must map to INSTANCES (binding calls .convert).
export function buildCtx(): Record<string, unknown> {
    return {
        ...muralRuntime, ...muralBasic, ...muralEngine,
        IconKeyConverter: new IconKeyConverter(),
        ImageKeyConverter: new ImageKeyConverter(),
    }
}

// Compile a bare-element fragment into a DataTemplate; wrap so the host's
// Content becomes the visual's DataContext. Throws (via instantiate) on bad source.
export function compileTemplate(source: string, ctx: Record<string, unknown>): DataTemplate {
    const factory = instantiate(source, ctx, { symbols: SYMBOLS }) as () => Visual
    const wrapped: DataTemplateFactory = (data) => {
        const v = factory() as Visual & { DataContext: unknown }
        v.DataContext = data
        return v
    }
    return new DataTemplate(wrapped)
}

// Two icons overlaid in a Grid, both bound to $IconKey: an Image for a RASTER
// icon (ImageKeyConverter → BitmapImage) and an Icon for a VECTOR icon
// (IconKeyConverter → colored IconDefinition; empty/unknown key → default glyph).
// Exactly one is non-empty per entity, so they never collide.
const ICON_BODY =
      ' Grid {'
    + ' Image [ Source = $IconKey << ImageKeyConverter, Stretch = Uniform,'
    + ' Width = $IconWidth, Height = $IconHeight, HorizontalAlignment = Center, VerticalAlignment = Center ]'
    + ' Icon [ Source = $IconKey << IconKeyConverter, Recolor = false, Foreground = @OnSurface,'
    + ' Width = $IconWidth, Height = $IconHeight, HorizontalAlignment = Center, VerticalAlignment = Center ]'
    + ' }'

// Tile context (toolbox tiles + preview): a raised chip behind the icon.
const TILE_SOURCE = 'Border [ Fill = @SurfaceContainerHigh, CornerRadius = 6 ] {' + ICON_BODY + ' }'
// Figure context (canvas nodes): transparent — the icon floats on the diagram.
const FIGURE_SOURCE = 'Border [ CornerRadius = 6 ] {' + ICON_BODY + ' }'

export function buildDefaultTemplate(ctx: Record<string, unknown>): DataTemplate {
    return compileTemplate(TILE_SOURCE, ctx)
}
export function buildFigureTemplate(ctx: Record<string, unknown>): DataTemplate {
    return compileTemplate(FIGURE_SOURCE, ctx)
}
```

The paired binding converters (`Plexus/.../diagram/services/icon-key-converter.ts`)
each return `undefined` for the other's asset kind, which is what makes the
overlay collapse to exactly one visible icon:

```ts
export class IconKeyConverter {          // vector path
    public convert(key: unknown): unknown {
        const k = typeof key === 'string' ? key : ''
        if (k === '') return DEFAULT_ICON
        const hit = resolve(k)
        if (hit === undefined || hit === null) return DEFAULT_ICON
        return isBitmap(hit) ? undefined : hit          // raster → let the Image draw it
    }
}
export class ImageKeyConverter {         // raster path
    public convert(key: unknown): unknown {
        const k = typeof key === 'string' ? key : ''
        if (k === '') return undefined
        const hit = resolve(k)
        return isBitmap(hit) ? hit : undefined          // vector → let the Icon draw it
    }
}
```
