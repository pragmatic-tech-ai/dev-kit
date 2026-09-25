# Font System

How fonts are declared, registered, measured, rendered, and turned into
glyph geometry — one registry feeding every consumer, with WPF-style value
classes at the API/markup boundary.

**Implemented in:**
- [visual-engine/text/font-family.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/visual-engine/text/font-family.ts) — `FontFamily`, `Typeface` value classes
- [visual-engine/text/font-manager.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/visual-engine/text/font-manager.ts) — `FontManager` registry, `RegisteredFont`, `FontSource`, `FontSourceKind`, `FontConsumer`
- [visual-engine/targets/presentation-target.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/visual-engine/targets/presentation-target.ts) — base `FontConsumer` wiring (load into measurer + embed hook)
- [visual-engine/targets/html-target.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/visual-engine/targets/html-target.ts) — render-side `@font-face` / FontFace embedding
- [basic/text-block.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/text-block.ts) / [basic/text-box.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/text-box.ts) — `FontFamily` DP (coercing)
- [compiler/parser.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/compiler/parser.ts) / [compiler/compiler.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/compiler/compiler.ts) — the `fonts { … }` markup block + `glyphs @Family`

Closely related: **text *measurement*** (the `TextMeasurer` abstraction the
font system feeds) is documented in [text-measurement.md](./text-measurement.md);
font-glyph **outlines → geometry** (the `glyphs` keyword) in
[../document/mural-language-design.md](./mural-language-design.md).

---

## 1. The problem

Before this system a "font" was scattered:

- `FontFamily` was a bare `string` DP — no value type.
- Fonts were loaded ad-hoc, per measurer, from demo bootstrap `.mjs`
  (`measurer.LoadFont(...)`) — duplicated fetches, and resource management
  in JS rather than markup.
- A font loaded **for metrics** was not loaded **for rendering**: the SVG
  renderer emits `font-family` verbatim and relies on the browser already
  having the font, so a custom `.ttf` measured correctly but painted as a
  fallback.
- The `glyphs` keyword (font → `PathGeometry` at compile time) referenced a
  font by path, unrelated to any runtime font.

The font system unifies these: **declare a font once** (ideally in markup),
and it serves measuring, rendering, and the `glyphs` keyword from one
registry.

---

## 2. Value classes

`FontFamily` and `Typeface` are immutable value objects — WPF analogues.

```ts
class FontFamily {
    readonly Source: string;        // CSS family or fallback stack
    get Name(): string;             // first family in the stack
    get FamilyNames(): string[];    // ["Inter", "system-ui", "sans-serif"]
    Equals(other): boolean;
    toString(): string;             // === Source
    static from(value: FontFamily | string): FontFamily;
}

class Typeface {                    // family + weight + style
    readonly Family: FontFamily;
    readonly Weight: FontWeight;    // Normal | Medium | Bold
    readonly Style:  FontStyle;     // Normal | Italic
}
```

`FontFamily.Source` is the CSS string the engine layer (the `TextMeasurer`,
`FormattedText`, the SVG/Canvas renderers) works in — those layers stay
string-based. The value class lives only at the **DP / markup boundary**.

`Typeface` mirrors WPF: controls keep `FontFamily` / `FontWeight` /
`FontStyle` as separate DPs; a `Typeface` is the value that combines them
when a single handle is convenient (registration, resolution, cache keys).

---

## 3. The `FontFamily` DP

`TextBlock` / `TextBox` expose `FontFamily` typed as `FontFamily`, but the
getter/setter **coerce** so it tolerates a plain string:

```ts
get FontFamily(): FontFamily { return FontFamily.from(this.get_property_value(FontFamilyKey)); }
set FontFamily(v: FontFamily | string) { this.set_property_value(FontFamilyKey, FontFamily.from(v)); }
```

This is WPF's TypeConverter behaviour and it matters in practice: the
theme's typography tokens (`@FontFamily`, `@BodyLargeFont`, …) resolve to
CSS **strings** via `DynamicResource`, so a string can flow into the DP
through a binding. The getter normalizes either form to a `FontFamily`;
reads are always a value object, writes accept either.

At the engine seam the control passes `this.FontFamily.Source` to the
measurer and into `FormattedText`.

---

## 4. The registry — `FontManager`

A process-wide singleton (`FontManager.Current`) that owns font sources and
fans them out to everyone who needs the font.

```ts
FontManager.Current.Register(
    'Inter',
    { kind: FontSourceKind.Url, url: '/fonts/Inter.ttf' },   // or Buffer
    { weight: FontWeight.Bold, style: FontStyle.Italic },    // defaults: Normal/Normal
);
```

- **Faces** are keyed by `(family, weight, style)`. Re-registering a key
  replaces it.
- **Sources** are a `FontSource`: a `Url` (fetched lazily) or an in-memory
  `Buffer`.
- **`Subscribe(consumer)`** registers a `FontConsumer` and *immediately
  replays every already-registered face*, then streams each new one.
  Returns an unsubscribe thunk. Replay is what lets a target created
  **after** the fonts were declared still receive them, and a font
  declared **after** the target still reach it.
- **`LoadBuffer(face)`** resolves a face's bytes — fetching a URL once and
  caching the promise, so N consumers share one fetch. Buffer sources
  resolve immediately.
- **`SourceUrl(face)`** returns the URL for a URL face (for an `@font-face`
  `src`), `undefined` for a buffer face.

### Why subscribe/replay instead of push

Fonts and targets are created in either order — a markup `fonts {}` block
registers at dictionary-merge time, an `HtmlTarget` is constructed when the
view mounts. Replay-on-subscribe makes the order irrelevant: whoever shows
up last is caught up to the current set.

---

## 5. Targets as consumers — measure **and** render

`PresentationTarget` implements `FontConsumer`. On construction it
subscribes to `FontManager.Current`; each `ReceiveFont` does two things:

1. **Measure** — `await LoadBuffer(face)`, then
   `this.TextMeasurer.LoadFont(family, buf, weight, style)` so text using
   the font gets real metrics. (A later content relayout is nudged so text
   reflows once metrics arrive.)
2. **Render** — calls `EmbedFontForRender(face, buffer)`, a hook the base
   class leaves empty.

`HtmlTarget` overrides the hook to register the face with the live document
via the **FontFace API**:

```ts
const face = new FontFace(font.Family, srcUrlOrBuffer, { weight, style });
document.fonts.add(face);
void face.load();
```

That closes the historic measure-vs-render gap — the same registration now
both sizes and paints the custom font. Headless / SVG-string targets keep
the no-op base hook (they emit `font-family` verbatim).

```
                         ┌──────────────────────────┐
  fonts {} / Register ─▶ │      FontManager         │
                         │  faces + lazy buffers    │
                         └────────────┬─────────────┘
                       Subscribe + replay │ ReceiveFont(face)
                         ┌────────────────▼──────────────────┐
                         │ PresentationTarget (FontConsumer)  │
                         │  • LoadFont → TextMeasurer (metrics)│
                         │  • EmbedFontForRender (HtmlTarget): │
                         │      document.fonts.add(FontFace)   │
                         └─────────────────────────────────────┘
```

---

## 6. Declaring fonts in markup — the `fonts { }` block

Resource management is markup-first, so fonts are declared in `.mu` inside a
resource dictionary (a sibling of the `glyphs` keyword):

```
resources MyDemo {
    fonts {
        Inter from "../assets/Inter.ttf"
        Inter from "../assets/Inter-Bold.ttf"    [Weight=Bold]
        Inter from "../assets/Inter-Italic.ttf"  [Style=Italic]
    }

    DataTemplate x:key="T" [DataType=MyVM] {
        TextBlock [Text="hi", FontFamily=@Inter]
    }
}
```

Each entry is one **face**: a family name, the `from` keyword, a source
path (or URL) string, and an optional `[Weight=…, Style=…]` block whose
values are `FontWeight` / `FontStyle` members.

The compiler emits, per entry, a runtime registration plus — once per
family — a `@<family>` `FontFamily` resource:

```js
FontManager.Current.Register("Inter",
    { kind: FontSourceKind.Url, url: new URL("../assets/Inter.ttf", import.meta.url).href });
FontManager.Current.Register("Inter",
    { kind: FontSourceKind.Url, url: new URL("../assets/Inter-Bold.ttf", import.meta.url).href },
    { weight: FontWeight.Bold });
t.Set("Inter", new FontFamily("Inter"));   // so `@Inter` resolves
```

Notes:
- The path is resolved at **runtime** against the emitted module
  (`new URL(path, import.meta.url)`) — relative paths resolve against the
  `.mu.js`, absolute URLs pass through. No font file is read at compile time
  (unlike `glyphs`, which bakes geometry and *does* read the file).
- Registration runs when the dictionary is built (`MyDemo.Clone()` /
  `AddMergedDictionary`), so merging the dictionary is what arms the fonts.
- `@Inter` is a normal resource; `FontFamily=@Inter` resolves to the
  `FontFamily` value (and the DP getter would accept a string too).

---

## 7. Unifying `glyphs` with `fonts`

A font declared by a `fonts` block can back the `glyphs` keyword by family
name, so the font path isn't repeated:

```
resources Icons {
    fonts  { Symbols from "../assets/material-symbols.ttf" }
    glyphs @Symbols { home  star  settings }
}
```

`glyphs @Symbols` resolves the family to the path declared by the `fonts`
block and runs the same compile-time outline → `PathGeometry` baking as the
literal form `glyphs "…path…" { … }` (which still works). The font is also
registered at runtime, so the same family is available for text if needed.

**Ordering constraint:** the `fonts` block must appear **before** the
`glyphs @Family` that references it in the same dictionary — resolution is
lexical during compile. A `glyphs @Unknown` with no matching `fonts` entry
is a compile error.

---

## 8. End-to-end lifecycle

1. **Declare** — `fonts { Inter from "…" }` in `.mu` (or
   `FontManager.Current.Register(...)` in TS for non-markup cases).
2. **Merge** — the dictionary is cloned/merged → `Register` runs → the face
   is in `FontManager`, and `@Inter` resolves to a `FontFamily`.
3. **Fan-out** — every subscribed target (present or future) receives the
   face: loaded into its `TextMeasurer` (metrics) and embedded via FontFace
   (rendering on `HtmlTarget`).
4. **Use** — `FontFamily=@Inter` (or `FontFamily="Inter"`) on a TextBlock;
   layout measures with real metrics, the renderer paints with the embedded
   font.

---

## 9. Constraints & gotchas

- **Outlines vs metrics.** `FontManager` gives consumers *metrics* (via the
  target's measurer) and *rendering* (via FontFace). It does **not** expose
  glyph **outlines** at runtime. Code that needs vector outlines (e.g. the
  `textOnPath` pipeline) still uses a `FontMetricsMeasurer` (opentype.js)
  directly — but it can pull the buffer from `FontManager.LoadBuffer(face)`
  instead of fetching its own (see the `text-on-path` demo).
- **`import.meta.url`.** Emitted `fonts` registrations assume an ES-module
  runtime (the `.mu.js` files are ESM). 
- **Lexical order** for `glyphs @Family` (see §7).
- **Theme tokens stay strings.** `@FontFamily` and the `@…Font` typography
  tokens remain CSS-string tokens; the `FontFamily` DP coercion absorbs
  them. Introducing a `FontFamily`-typed token type was intentionally left
  out of this pass.

---

## 10. Public API surface

Exported from `mural/runtime` (and
`mural/visual-engine`):

`FontFamily`, `Typeface`, `FontWeight`, `FontStyle`, `FontManager`,
`RegisteredFont`, `FontSourceKind`, and the `FontSource` / `FontRegistration`
/ `FontConsumer` types.
