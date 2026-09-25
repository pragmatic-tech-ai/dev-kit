# Text Measurement

How the framework computes text dimensions for layout — the abstraction,
the two implementations (approximation vs real font metrics), and the
Google Fonts convenience loader.

**Implemented in:**
- [runtime/text-measurer.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/text-measurer.ts) — `TextMeasurer` interface, `TextMetrics`, `ApproximateTextMeasurer`, `APPROXIMATE_TEXT_MEASURER` singleton
- [visual-engine/font-metrics-measurer.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/visual-engine/font-metrics-measurer.ts) — `FontMetricsMeasurer` (opentype.js-backed)
- [visual-engine/google-font-loader.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/visual-engine/google-font-loader.ts) — `loadGoogleFont`, `loadGoogleFontInto`, `parseFontFaces`
- [visual-engine/formatted-text.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/visual-engine/formatted-text.ts) — `FormattedText` carries `TextMetrics`

The design discussion (why an abstraction, why opentype.js, what's
deferred) is in [../../visual-engine-design.md](visual-engine-design.md) §11.

## 1. Why an abstraction

Text measurement is per-font and per-glyph: proportional fonts have varying
character widths, kerning shifts adjacent pairs, ligatures collapse multiple
glyphs into one. There's no single answer — accurate measurement depends on
the environment:

| Environment | Best measurement strategy |
|---|---|
| Modern browser | `ctx.measureText` via Canvas 2D — accurate, sync, fast |
| Node (no DOM) | Parse the font file with opentype.js / fontkit |
| No font available | Approximation from font size and character count |

The library defines a `TextMeasurer` interface, ships a stateless
approximation as default, and provides a `FontMetricsMeasurer`
implementation that uses opentype.js for real metrics in both Node and
browser.

## 2. The interface

```ts
interface TextMetrics {
    readonly Width:   number;   // text width in DIPs
    readonly Height:  number;   // text height in DIPs (Ascent + Descent)
    readonly Ascent:  number;   // distance from top of bounding box to baseline
    readonly Descent: number;   // distance from baseline to bottom
}

interface TextMeasurer {
    LoadFont(
        family: string,
        source: ArrayBuffer | Uint8Array,
        weight?: string,      // 'normal' | 'bold' (matches FontWeight enum values)
        style?:  string,      // 'normal' | 'italic'
    ): void;

    Measure(
        text: string,
        fontFamily: string,
        fontSize:   number,
        fontWeight: string,
        fontStyle:  string,
    ): TextMetrics;
}
```

A measurer lives on the host (`VisualHost.TextMeasurer`), so any Visual
reaches it via `this.target?.TextMeasurer`. `TextBlock.MeasureOverride`
uses this to size its content.

`LoadFont` is sync — parsing a font from a buffer doesn't require network
or I/O. Async font *fetching* is the caller's concern.

## 3. `ApproximateTextMeasurer`

The stateless default. No font files, no real metrics — just consistent
heuristics calibrated to typical sans-serif proportions:

| Field | Formula |
|---|---|
| `Width` | `glyphCount × fontSize × 0.6` (slightly overestimated) |
| `Height` | `fontSize × 1.2` (CSS / WPF default line-height ratio) |
| `Ascent` | `fontSize × 0.85` |
| `Descent` | `Height - Ascent` |

`glyphCount` is `Array.from(text).length` — code-point aware, so emoji
counts as one glyph rather than two UTF-16 units.

`LoadFont` is a no-op. The measurer ignores font data entirely; the
approximation doesn't change based on FontFamily / FontWeight / FontStyle.

### Singleton access

```ts
import { APPROXIMATE_TEXT_MEASURER, ApproximateTextMeasurer } from '../runtime/index.js';

APPROXIMATE_TEXT_MEASURER          // shared singleton (stateless, safe to share)
new ApproximateTextMeasurer()      // instantiate if you want a separate one (no benefit)
```

The shared singleton is what every `PresentationTarget` uses by default:

```ts
public TextMeasurer: TextMeasurer = APPROXIMATE_TEXT_MEASURER;
```

### When to keep using it

- Tests where exact text widths don't matter (you assert layout structure,
  not pixel precision).
- Headless rendering where you don't have or don't want to ship a font.
- Prototypes — accurate enough to get layout looking right.

### When to upgrade

- Real UIs in the browser — switch to a `FontMetricsMeasurer` with loaded
  fonts. Or eventually a `CanvasTextMeasurer` once that's built.
- Pixel-perfect headless rendering for screenshots, image comparison,
  documentation snapshots.

## 4. `FontMetricsMeasurer`

Real per-glyph widths + ascent / descent / kerning, backed by opentype.js.
Works in both Node and browser — opentype.js parses TTF / OTF / WOFF1
buffers.

```ts
import { FontMetricsMeasurer } from '../visual-engine/index.js';

const measurer = new FontMetricsMeasurer();
measurer.LoadFont('Inter', interBuffer);              // ArrayBuffer or Uint8Array
measurer.LoadFont('Inter', interBoldBuffer, 'bold');  // explicit weight tag

target.TextMeasurer = measurer;
```

### Loading fonts

```ts
LoadFont(family, source, weight?, style?): void
```

- `family`: the name you'll reference (`'Inter'`, `'Roboto'`, etc.). The
  measurer's `family` storage is independent of the font's own internal
  name — `LoadFont('MyAlias', interBuffer)` works.
- `source`: an already-fetched `ArrayBuffer` or `Uint8Array`. Network /
  filesystem I/O is the caller's responsibility.
- `weight` / `style`: optional explicit tags. When omitted, the measurer
  reads the font's OS/2 table:
  - `usWeightClass ≥ 600` → `'bold'`, else `'normal'`
  - `fsSelection` bit 0 set → `'italic'`, else `'normal'`

Loading from Node:
```ts
import { readFile } from 'node:fs/promises';
const buf = await readFile('./fonts/Inter-Regular.ttf');
measurer.LoadFont('Inter', buf);
```

Loading from browser:
```ts
const buf = await fetch('/fonts/Inter-Regular.woff').then(r => r.arrayBuffer());
measurer.LoadFont('Inter', buf);
```

### Resolution

`Measure(text, family, size, weight, style)` walks the comma-separated
family stack:

```ts
measurer.Measure('Hello', 'Inter, Helvetica, sans-serif', 16, 'bold', 'normal');
```

For each family in order:

1. **Exact match** — `weight|style` is loaded → use that font.
2. **Fall back to normal** — that family's `normal|normal` variant.
3. **Any variant beats no variant** — any loaded variant in that family.

If no family in the stack is loaded, falls through to
`ApproximateTextMeasurer` so callers always get sensible output rather
than zeros. (This is why mixing accurate and approximate output is
possible — a TextBlock with an unloaded FontFamily degrades silently.)

### Width computation

Width is computed character-by-character using `font.charToGlyph(ch)` and
the glyph's `advanceWidth`, plus `font.getKerningValue(prev, curr)` between
adjacent glyphs.

This bypasses opentype.js's full layout pipeline (`font.getAdvanceWidth`),
which throws on common modern fonts whose `GSUB` tables use feature
substitutions opentype.js doesn't yet implement (Inter, Roboto, most
variable fonts).

**Trade-off**: we keep pairwise kerning but lose ligature substitution
(`fi` → `ﬁ`) and contextual alternates. For Latin UI text the visible
difference is small; for body text with frequent ligature triggers
("office", "fluff") or for non-Latin scripts (Arabic, Devanagari), this
would matter — see [code-review.md](code-review.md) and the design doc for
the path to a HarfBuzz-based measurer.

### Iterating code points

Like `ApproximateTextMeasurer`, `FontMetricsMeasurer` iterates code points
via `Array.from(text)` — emoji counts as one glyph.

## 5. Google Fonts loader

A convenience for fetching fonts from Google Fonts without manual URL
hunting.

```ts
import { loadGoogleFont, loadGoogleFontInto } from '../visual-engine/index.js';

// Convenience: fetch + register in one call
await loadGoogleFontInto(measurer, 'Inter', { weights: [400, 700] });

// Lower-level: fetch buffers, register manually
const variants = await loadGoogleFont('Inter', { weights: [400, 700] });
for (const v of variants) {
    measurer.LoadFont(v.family, v.buffer, v.weight, v.style);
}
```

### Options

```ts
interface GoogleFontOptions {
    weights?: number[];   // default [400]; specify [400, 700] for normal + bold
    italics?: boolean;    // when true, also fetches italic variants for each weight
}
```

### How it works

1. Constructs the Google Fonts CSS2 URL with the requested weight/italic combinations.
2. Fetches the CSS with an **old-Firefox User-Agent**. Google returns TTF
   for older UAs and WOFF2 for modern ones — opentype.js can't parse WOFF2,
   so we masquerade as Firefox 30 (2014) to land in the TTF bucket.
3. Parses the response for `@font-face` blocks and extracts the binary URLs,
   weights, and styles.
4. Dedupes by `(weight, style, url)` — Google sometimes emits multiple
   `@font-face` blocks per variant for different unicode-range subsets,
   all pointing at the same TTF.
5. Fetches each unique TTF in parallel via `Promise.all`.

### Loaded shape

```ts
interface LoadedGoogleFont {
    family: string;
    weight: 'normal' | 'bold';
    style:  'normal' | 'italic';
    buffer: ArrayBuffer;
}
```

`loadGoogleFont` returns `LoadedGoogleFont[]`; `loadGoogleFontInto` calls
`measurer.LoadFont` for each variant.

### Failure modes

- Network error → the underlying `fetch` rejects; the helper propagates.
- Google returns non-2xx for the CSS or binary → throws with the URL and
  status code.
- Google's CSS contains no `@font-face` blocks → throws "no @font-face
  blocks found" (unknown family or API changed).
- Google ignores the UA hint and serves WOFF2 → opentype.js's `parse`
  throws "Unsupported OpenType signature" inside the subsequent `LoadFont`.
  Migration paths: use `@fontsource/*` npm packages (no network needed,
  TTF/WOFF1 included) or add a WOFF2 decoder (`wawoff2`).

## 6. Wiring into a target

Targets default to the approximation. Swap to a real measurer when you want
accurate metrics:

```ts
import { FontMetricsMeasurer } from '../visual-engine/index.js';
import { HeadlessTarget } from '../visual-engine/index.js';

const target = new HeadlessTarget(400, 200, myScene);

// Install a real measurer BEFORE the first Render, so the first
// MeasureOverride on TextBlock uses the new measurer.
target.TextMeasurer = new FontMetricsMeasurer();
await loadGoogleFontInto(target.TextMeasurer, 'Inter', { weights: [400, 700] });
// Or LoadFont with your own buffer:
// target.LoadFont('Inter', interBuffer);
// (target.LoadFont is a convenience method that delegates to TextMeasurer.LoadFont)
```

## 7. `FormattedText` and renderer-side metrics

`TextBlock.MeasureOverride` stores the `TextMetrics` it got from the measurer
into `_metrics`, then passes it through `FormattedText` to the renderer:

```ts
class FormattedText {
    readonly Text:       string;
    readonly FontFamily: string;
    readonly FontSize:   number;
    readonly Foreground: Brush | undefined;
    readonly FontWeight: FontWeight;
    readonly FontStyle:  FontStyle;
    readonly Metrics:    TextMetrics | undefined;   // ← from the measurer
}
```

`SvgDrawingContext.DrawText` reads `Metrics.Ascent` (when present) for
baseline placement (`y = origin.Y + Ascent`). Without metrics, falls back
to `fontSize × 0.85`. This is why loading a real font visibly shifts the
text baseline in the SVG output — the real ascent rarely matches the 0.85
approximation exactly.

## 8. Performance notes

- **Measurer caching**: `FontMetricsMeasurer` doesn't currently cache
  measurement results. The same `(text, family, size, weight, style)` tuple
  re-walks every glyph on each call. For a TextBlock that's measured many
  times across layout passes, that's redundant. LRU caching is on the
  improvement list (see [code-review.md](code-review.md)).
- **Font storage**: One opentype.js `Font` object per loaded variant.
  Each is a few MB in memory (parsed font tables). Don't load fonts you
  don't need.
- **Network**: Google Fonts loader does one CSS request + N binary requests
  in parallel. Each TTF is typically 50–300KB. The fetched buffers stay in
  memory inside the measurer's variant map.

## 9. Building a custom measurer

Implement the two methods, plug it in:

```ts
import type { TextMeasurer, TextMetrics } from '../runtime/index.js';

class CanvasTextMeasurer implements TextMeasurer {
    private canvas = new OffscreenCanvas(1, 1);
    private ctx    = this.canvas.getContext('2d')!;

    LoadFont(): void { /* nothing — browser handles font loading via CSS */ }

    Measure(text, fontFamily, fontSize, fontWeight, fontStyle): TextMetrics {
        this.ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
        const m = this.ctx.measureText(text);
        const ascent  = m.actualBoundingBoxAscent  ?? fontSize * 0.85;
        const descent = m.actualBoundingBoxDescent ?? fontSize * 0.35;
        return {
            Width:   m.width,
            Height:  ascent + descent,
            Ascent:  ascent,
            Descent: descent,
        };
    }
}

// Install:
target.TextMeasurer = new CanvasTextMeasurer();
```

That's the path to a browser-side `CanvasTextMeasurer` for `HtmlTarget`'s
default — accurate, sync, fast, no font-loading bookkeeping required.

## 10. Common patterns

**Approximate, no setup** (the default — works out of the box):
```ts
const target = new HeadlessTarget(...);   // TextMeasurer is APPROXIMATE_TEXT_MEASURER
```

**Real metrics with a local font file** (Node):
```ts
import { readFile } from 'node:fs/promises';
import { FontMetricsMeasurer } from '../visual-engine/index.js';

target.TextMeasurer = new FontMetricsMeasurer();
const buf = await readFile('./fonts/Inter-Regular.ttf');
target.LoadFont('Inter', buf);
```

**Real metrics from Google Fonts**:
```ts
import { FontMetricsMeasurer, loadGoogleFontInto } from '../visual-engine/index.js';

target.TextMeasurer = new FontMetricsMeasurer();
await loadGoogleFontInto(target.TextMeasurer, 'Inter', {
    weights: [400, 700],
    italics: true,
});
```

**Use the loaded font in a TextBlock**:
```ts
const text = new TextBlock('Hello');
text.FontFamily = 'Inter, sans-serif';      // family stack — falls back if Inter isn't loaded
text.FontSize   = 24;
text.FontWeight = FontWeight.Bold;
```

The `FontMetricsMeasurer` finds the bold Inter variant by exact match;
if you only loaded the regular weight, it'd fall back to normal|normal
within Inter rather than giving up.
