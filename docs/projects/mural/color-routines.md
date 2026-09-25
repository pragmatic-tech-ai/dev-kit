# Inline color routines

How to write colors — and transform them — directly in `.mu` markup, plus the
runtime `Color` API and the `<<` modifier pipe that backs it.

Three layers, bottom-up:

1. **`Color`** — the runtime value type (`src/visual-engine/primitives.ts`).
2. **Color literals** — `#hex` / `#name` in markup, compiled to a brush.
3. **Color modifiers** — `#base << Lighten(0.5)`, transforms over the `<<`
   converter pipe.

---

## 1. Color literals

A `#` value in markup is a color literal:

```mu
Border [Background=#0d47a1]          // hex
Border [Background=#fff]             // short hex (#rgb)
Border [Background=#1e40af80]        // #rrggbbaa — 50% alpha
TextBlock [Foreground=#blue]         // named color (a Color static)
```

| Form        | Accepts                                  | Compiles to |
|-------------|------------------------------------------|-------------|
| `#rgb`      | 3 hex digits, expanded (`#f00`→`#ff0000`) | `new SolidColorBrush(Color.FromHex('#…'))` |
| `#rgba`     | 4 hex digits, last is alpha               | ″ |
| `#rrggbb`   | 6 hex digits                              | ″ |
| `#rrggbbaa` | 8 hex digits, last byte is alpha          | ″ |
| `#name`     | a `Color` static (`Blue`, `White`, …)     | `new SolidColorBrush(Color.Name)` |

A color literal always lowers to a **`SolidColorBrush`**, not a bare `Color`,
because the common targets (`Background`, `Foreground`, `Fill`, `Stroke`,
`BorderBrush`) are brush properties. The named-color set is the `Color`
statics: `Transparent`, `Black`, `White`, `Red`, `Green`, `Blue` (extend by
adding statics to `Color`).

---

## 2. The `Color` runtime type

`Color` (`src/visual-engine/primitives.ts`) is an immutable RGBA value, each
channel `0..255`:

```ts
new Color(r, g, b, a = 255)

Color.FromHex('#1e40af')          // #rgb / #rgba / #rrggbb / #rrggbbaa, '#' optional
color.WithAlpha(128)              // copy with a new alpha channel
Color.Lerp(a, b, t)              // channel-wise blend a→b at t∈[0,1] (clamped), alpha included
color.AdjustSaturation(delta)     // shift HSL saturation by delta (~-1..+1), hue/lightness/alpha kept
color.ToCss()                     // 'rgb(r,g,b)' or 'rgba(r,g,b,a)'
color.ToHex()                     // '#rrggbb' or '#rrggbbaa' — round-trips through FromHex
color.Equals(other)
```

`Lerp` and `AdjustSaturation` are the math the modifiers build on. They're
public, so you can call them directly in code or in a custom modifier.

---

## 3. Color modifiers — the `<<` pipe

`<<` is mural's converter-pipe operator (a value run through one or more
`ValueConverter`s, composing left-to-right). Color modifiers are converters
that take a color and return a color, so they ride the same pipe:

```mu
Fill:   #0d47a1 << Lighten(0.5)               // literal, lightened 50% toward white
Stroke: @Primary << Darken(0.2)                // a resource color, darkened
Glow:   $accent << Lighten(0.3) << Alpha(0.6)  // a binding, chained
Tint:   @Surface << Mix(#ff0000, 0.25)         // blended 25% toward red
```

### Built-in modifiers

| Modifier            | Effect | Notes |
|---------------------|--------|-------|
| `Lighten(amount)`   | Blend `amount` of the way toward **white** (`amount∈0..1`; `1`→white) | source alpha preserved |
| `Darken(amount)`    | Blend `amount` toward **black** | source alpha preserved |
| `Mix(other, amount)`| Blend `amount` toward `other` (all channels, alpha included) | `other` may be a `Color` **or** a color literal (`#ff0000` compiles to a brush — `Mix` accepts it) |
| `Saturate(amount)`  | Increase HSL saturation by `amount` | clamps to `0..1` |
| `Desaturate(amount)`| Decrease HSL saturation by `amount` | `Desaturate(1)` ≈ grey |
| `Alpha(a)`          | Set the alpha channel | `a≤1` read as a `0..1` fraction → scaled to `0..255`; `a>1` taken as a raw `0..255` channel |

Lighten / Darken are `Mix` with white / black, so `Lighten(t)` ≡
`Mix(#ffffff, t)` except that Lighten/Darken keep the source alpha (a tint
shouldn't change opacity).

### Chaining

`<< A << B` composes left-to-right — `B(A(value))`:

```mu
Fill: @Primary << Darken(0.2) << Alpha(0.5)   // darken first, then halve alpha
```

### Static fold vs. reactive

The base of the pipe decides whether the result is a one-time constant or stays
live:

| Base                         | Lowering | Reactive? |
|------------------------------|----------|-----------|
| color literal (`#hex` / `#name`) | folded once at instantiation: `Lighten(0.5).convert(new SolidColorBrush(Color.FromHex('#0d47a1')))` | no — a constant |
| local `@resource` (declared in the same dictionary) | folds against the resolved local value | no |
| non-local `@resource`        | `DynamicResource(target, key, Darken(0.2))` — the modifier re-applies on every re-resolve | **yes** — tracks theme swaps / dictionary edits |
| `$binding` (`$path`, `$Self`, `$service`) | the modifier becomes the binding's converter | **yes** — re-applies on every source change |

So `@Primary << Darken(0.2)` automatically re-darkens when the theme switches
light↔dark; `#0d47a1 << Darken(0.2)` is baked at build time.

### Allowed bases (applies to any converter, not just color modifiers)

The four rows above are the **only** valid left-hand bases for `<<`: a color
literal, a named/`ident` value, an `@resource`, or a `$binding`. Any other
literal base — in particular a **bare string literal** — is rejected at compile
time (`compileModifiedValue` in `src/compiler/compiler.ts`):

```
"" << glyph_geo
// error: '<<' modifiers apply to a color literal, a named color,
//        or an @resource — not a string value
```

This matters for non-color converters like
[`GlyphGeometryConverter`](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/converters/glyph-geometry-converter.ts): you
can't pipe a constant string straight into one. To run a converter over a fixed
value, give it a reactive base instead:

- **Wrap the value in an `@resource`** — `@resource` is an allowed base, so
  `@IconChar << glyph_geo` (with `@IconChar = ""`) lowers to
  `DynamicResource(target, "IconChar", glyph_geo)`, resolves the key to the
  string, then applies the converter.
- **Bind it** — `$Icon << glyph_geo` when the value comes from data.

For a glyph that's known at build time, prefer the compile-time `glyphs` keyword
(bakes the outline into a resource `PathGeometry`) over the converter entirely.

### The brush ↔ color boundary

Modifiers operate on `Color`, but a brush property carries a `SolidColorBrush`.
The adapter (`colorOp` in `src/runtime/binding/color-modifiers.ts`) unwraps a
`SolidColorBrush` to its `Color`, applies the transform, and rewraps — so a
`Fill` / `Foreground` binding keeps its brush shape. A non-solid brush
(gradient / image / pattern) has no single color to modify and raises a clear
error rather than silently dropping to a default.

---

## 4. Authoring a custom modifier

A modifier is just an **exported factory function** that returns a
`ValueConverter` — there is no string registry (which keeps the
[no-string-type-proxies](mural-language-design.md) rule intact). Built-ins live
in `src/runtime/binding/color-modifiers.ts` and are auto-imported by the
compiler; your own modifier is the same shape, pulled into a `.mu` file with an
`import` clause exactly like any custom converter.

```ts
// my-mods.mts
import { Color, type ValueConverter } from '@pragmatic-tech-ai/mural/runtime';

// A modifier: (args) => ValueConverter. Operate in the Color domain; the
// `colorOp`-style brush unwrap/rewrap is up to you (or reuse the pattern).
export const Sepia = (): ValueConverter => ({
    convert(v: unknown): unknown {
        const c = v as Color;                 // (unwrap a SolidColorBrush if needed)
        const grey = 0.3 * c.R + 0.59 * c.G + 0.11 * c.B;
        return new Color(Math.min(255, grey * 1.07), grey * 0.74, grey * 0.43, c.A);
    },
});
```

```mu
import { Sepia } from "./my-mods.mjs"

Image [Tint=@Surface << Sepia()]
```

**Call form vs. bare form.** `<< Sepia()` calls the factory to get a converter;
`<< Name` (no parens) uses `Name` as a converter *directly*. So a parameterless
modifier authored as a factory (`() => converter`) still needs the parens
(`<< Sepia()`); only a modifier exported as a bare `ValueConverter` object
(`export const Sepia = { convert(v) { … } }`) can be used as `<< Sepia`. The
built-ins are all factories, so they always take parens.

---

## 5. In code

Everything inline-markup does is available imperatively:

```ts
import { Color } from '@pragmatic-tech-ai/mural/runtime';
import { SolidColorBrush } from '@pragmatic-tech-ai/mural/visual-engine';
import { Lighten, Mix } from '@pragmatic-tech-ai/mural/runtime';

const base    = Color.FromHex('#0d47a1');
const lighter = Color.Lerp(base, Color.White, 0.5).WithAlpha(base.A);

// Or through a modifier converter (same result a markup `<<` produces):
const brush = Lighten(0.5).convert(new SolidColorBrush(base)) as SolidColorBrush;
```

---

## See also

- **[drawing.md](drawing.md)** — `SolidColorBrush`, gradients, `Pen`,
  geometry: the brush/paint model color literals produce.
- **[resources.md](resources.md)** — `@resource` / `DynamicResource`: the
  reactive base a `<<` modifier threads through.
- **[theme-authoring.md](theme-authoring.md)** — theme/scheme color tokens; a
  `@token << Darken(…)` derives a shade that tracks scheme swaps.
- **[mural-language-design.md](mural-language-design.md)** — the `.mu` value
  grammar, including the `#color` literal and the `<<` converter pipe.
