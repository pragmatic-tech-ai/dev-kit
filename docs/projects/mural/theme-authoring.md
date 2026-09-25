# Theme authoring

Practical guide for writing Themes, Schemes, and the registration glue
that ties them into the runtime. Companion to the architectural design
in [`../../theme-architecture.md`](theme-architecture.md) — read
that first for the *why*; read this for the *how*.

**See also:**
- [resources.md](resources.md) — the underlying `ResourceDictionary` +
  `DynamicResource` machinery a Theme + Scheme sit on top of.
- [styles.md](styles.md) — `Style` / `TargetType` / implicit-style
  lookup.
- [templating.md](templating.md) — `ControlTemplate` mechanics.

---

## 1. Mental model

Three kinds of files exist:

| Kind                          | Declares                                        | One per         |
|-------------------------------|-------------------------------------------------|-----------------|
| `<theme>.template.mu`         | A Theme: token catalog + ControlTemplates + default Styles + DataTemplates + triggers | Theme           |
| `<theme>.<scheme>.mu`         | A Scheme: pure `@Token = value` dictionary       | Scheme variant  |
| `<theme>.ts`                  | Registration glue — imports the compiled bundles and calls `ThemeManager.RegisterTheme(...)` | Theme           |

Each Theme has **one** template file and **N** scheme files (one per
variant: light, dark, high-contrast-light, …). Adding a new variant is
one new `.mu` file plus a one-line addition in the registration
TypeScript.

App `.mu` files and demo `.mu` files don't change — they consume themes
and schemes through the same `@Token` syntax they already use.

---

## 2. Directory layout

```
src/framework/material/
├── material.ts                ← registration entry point
├── material.template.mu       ← Theme bundle (catalog + templates + styles)
├── material.light.mu          ← Scheme: light tokens
├── material.dark.mu           ← Scheme: dark tokens
└── material.hc-light.mu       ← Scheme: high-contrast light (optional)
```

Same shape for any new Theme:

```
src/framework/fluent/
├── fluent.ts
├── fluent.template.mu
├── fluent.light.mu
└── fluent.dark.mu
```

The convention is `<theme-name>` for the directory name and
`<theme-name>.<scheme-name>.mu` for each scheme file. The compiler does
not require this naming — it's a convention for grepability.

---

## 3. Authoring a Theme bundle

`<theme>.template.mu` is wrapped in a top-level `theme Foo { … }` form
that the compiler treats specially. It must declare a `tokens { … }`
catalog before any templates.

### 3.1 Skeleton

```mu
theme Material {

    tokens {
        // … catalog entries …
    }

    Template x:key="DefaultButton" [TargetType=Button] {
        // … template body …
    }

    Style [TargetType=Button] {
        Template = @DefaultButton;
    }

    // more templates, styles, DataTemplates
}
```

### 3.2 The token catalog

Each catalog entry has the form `@Name : Type "Optional description"`.
Types are runtime value-type names recognised by the compiler:

| Type             | Used for                                |
|------------------|------------------------------------------|
| `Brush`          | Colors, state-layer overlays            |
| `CornerRadius`   | Shape tokens                            |
| `number`         | Spacing, durations, opacity, sizes      |
| `Typography`     | Composite font bundle (Slice 5)         |
| `Effect`         | Drop shadows / elevation                |
| `Easing`         | Motion easing curves                    |

A range form `@Foo1..@Foo8 : number` declares eight tokens
`@Foo1`, `@Foo2`, … `@Foo8`, all with the same type and description.

```mu
tokens {
    // Colors
    @Primary              : Brush         "Primary brand color"
    @OnPrimary            : Brush         "Text / icon over Primary"
    @PrimaryHover         : Brush         "Primary at hover state-layer"
    @PrimaryPress         : Brush         "Primary at pressed state-layer"
    @Surface              : Brush         "Default surface"
    @OnSurface            : Brush         "Text / icon over Surface"

    // State overlays
    @StateHoverOverlay    : Brush         "OnSurface @ 8% — hover state-layer"
    @StatePressOverlay    : Brush         "OnSurface @ 12% — pressed state-layer"

    // Shape
    @ShapeSmall           : CornerRadius  "4dp"
    @ShapeMedium          : CornerRadius  "12dp"
    @ShapeFull            : CornerRadius  "Fully rounded"

    // Spacing
    @Space1..@Space8      : number        "M3 spacing scale"

    // Motion
    @DurationStandard     : number        "200ms"
    @EaseEmphasis         : Easing        "Standard M3 ease curve"

    // Typography
    @BodyMedium           : Typography    "14 / 20, weight 400"
    @DisplayLarge         : Typography    "57 / 64, weight 400"

    // Elevation
    @Elevation1..@Elevation5 : Effect     "M3 elevation scale"
}
```

The catalog is the contract every Scheme against this Theme must
satisfy. Adding a token here is a deliberate Theme change — schemes
will fail compile until they provide a value for it.

### 3.3 Templates referencing tokens

Templates use the existing `@Token` syntax. Every reference must match
a catalog entry; unknowns are compile errors.

```mu
Template x:key="DefaultButton" [TargetType=Button] {
    Border x:name="PART_Border"
          [Background      = @Primary,
           CornerRadius    = @ShapeFull,
           Padding         = (@Space3, @Space2, @Space3, @Space2)] {
        ContentPresenter
    }

    when (IsMouseOver)            { PART_Border.Background = @PrimaryHover; }
    when (IsPressed)              { PART_Border.Background = @PrimaryPress; }
}

Style [TargetType=Button] {
    Template = @DefaultButton;
}
```

### 3.4 Adaptive triggers

The same `when (…)` syntax works on the ambient inherited DPs written
by `ThemeManager`:

```mu
Template x:key="DefaultToolBarButton" [TargetType=ToolBarButton] {
    Border x:name="PART_Border" [Padding=(@Space3, @Space2)] {
        ContentPresenter
    }

    // State triggers (existing)
    when (IsMouseOver)            { PART_Border.Background = @StateHoverOverlay; }
    when (IsPressed)              { PART_Border.Background = @StatePressOverlay; }

    // Adaptive triggers (inherited from ThemeManager)
    when (Density = Compact)      { PART_Border.Padding = (@Space2, @Space1); }
    when (Pointer = Coarse)       { PART_Border.Padding = (@Space4, @Space3); }
    when (PrefersContrast = More) { PART_Border.BorderThickness = (1); }
    when (ViewportClass = Mobile) { PART_Border.Padding = (@Space4, @Space3); }
}
```

No new trigger grammar — adaptive DPs are just inherited DPs on Visual
written by `ThemeManager`.

### 3.5 Structural variants (popup vs drawer)

When a control needs an entirely different Template at different
viewports (popup menu → drawer on mobile), the Theme ships **multiple
keyed templates** and the Style triggers on `ViewportClass` swap the
control's `Template` DP:

```mu
Template x:key="DefaultMenuPopup"  [TargetType=Menu] { /* popup chrome */ }
Template x:key="DefaultMenuDrawer" [TargetType=Menu] { /* drawer chrome */ }

Style [TargetType=Menu] {
    Template = @DefaultMenuPopup;
    when (ViewportClass = Mobile) { Template = @DefaultMenuDrawer; }
}
```

### 3.6 What the Theme bundle compiles to

The compiler emits a `.template.mu.js` file with two named exports:

```ts
// build/framework/material/material.template.mu.js
export const MaterialTemplates: ResourceDictionary = /* populated dict */;
export const MaterialCatalog = {
    Primary:              { type: 'Brush',         description: 'Primary brand color' },
    OnPrimary:            { type: 'Brush',         description: 'Text / icon over Primary' },
    Space1:               { type: 'number',        description: 'M3 spacing scale' },
    // ... every catalog entry
};
```

`MaterialCatalog` is what `defineTheme(...)` and Scheme contract
validation consume.

---

## 4. Authoring a Scheme

`<theme>.<scheme>.mu` is a **pure value dictionary**. The top-level form
is `scheme Foo against Bar { … }` — every assignment is `@Token = value`
and that's it. No element declarations, no triggers, no styles, no
templates allowed.

### 4.1 Skeleton

```mu
scheme MaterialLight against Material {

    // Colors
    @Primary              = #6750A4
    @OnPrimary            = #FFFFFF
    @PrimaryHover         = #6750A40A
    @PrimaryPress         = #6750A41F
    @Surface              = #FEF7FF
    @OnSurface            = #1D1B20

    // State overlays
    @StateHoverOverlay    = #1D1B2014
    @StatePressOverlay    = #1D1B201F

    // Shape
    @ShapeSmall  = 4
    @ShapeMedium = 12
    @ShapeFull   = CornerRadius.Full

    // Spacing
    @Space1 = 4
    @Space2 = 8
    @Space3 = 12
    @Space4 = 16
    @Space5 = 24
    @Space6 = 32
    @Space7 = 48
    @Space8 = 64

    // Motion
    @DurationStandard = 200
    @EaseEmphasis     = Easing.Standard

    // Typography (Slice 5)
    @BodyMedium   = Typography [Family="Roboto", Size=14, Weight=400, LineHeight=20]
    @DisplayLarge = Typography [Family="Roboto", Size=57, Weight=400, LineHeight=64]

    // Elevation
    @Elevation1 = DropShadow [Blur=3,  OffsetY=1, Tint=#6750A4, Opacity=0.15]
    @Elevation2 = DropShadow [Blur=6,  OffsetY=2, Tint=#6750A4, Opacity=0.18]
    @Elevation3 = DropShadow [Blur=8,  OffsetY=3, Tint=#6750A4, Opacity=0.20]
    @Elevation4 = DropShadow [Blur=12, OffsetY=4, Tint=#6750A4, Opacity=0.22]
    @Elevation5 = DropShadow [Blur=16, OffsetY=6, Tint=#6750A4, Opacity=0.25]
}
```

### 4.2 Validation against the Theme catalog

`against Material` ties this Scheme to Material's catalog. At build
time the compiler cross-checks:

- Every catalog token appears here → ok.
- A catalog token doesn't appear → **error** (missing token).
- A value's type doesn't match the catalog's type → **error**.
- A token appears here that the catalog doesn't declare → **warning**
  (unused token).

Schemes can't add their own free-floating tokens. If you find yourself
wanting to add `@MySpecialColor` to a Scheme without first declaring it
in the Theme's catalog, the right move is to add it to the catalog
(making it part of the contract) or use a local resource (`Resources`
block on a Visual) instead.

### 4.3 Scheme borrowing

When bootstrapping a new Theme (or starting a Scheme similar to an
existing one), `basedOn` borrows another Scheme's values:

```mu
scheme FluentLight against Fluent basedOn MaterialLight {
    // Only the deltas:
    @Primary     = #0078D4
    @ShapeSmall  = 2
    @ShapeMedium = 4
    @BodyMedium  = Typography [Family="Segoe UI", Size=14, Weight=400, LineHeight=20]
    // Everything else (state overlays, spacing, motion, elevation, …)
    // inherits from MaterialLight.
}
```

The compiler resolves `basedOn` at build time: it merges the borrowed
dict under your assignments (yours win), then validates the merged
result against Fluent's catalog. Borrowing across themes is fine — the
contract check is what keeps things honest.

If Fluent's catalog requires tokens Material doesn't have (e.g.
`@FluentAccent`), those must appear in your own assignments. If
Material has tokens Fluent's catalog doesn't (e.g.
`@MaterialSpecific`), they're silently dropped during the merge.

### 4.4 What the Scheme compiles to

The compiler emits a `.scheme.mu.js` file (or similar) exporting a
`Scheme` value object:

```ts
// build/framework/material/material.light.mu.js
export const MaterialLight = defineScheme({
    name:   'light',
    theme:  'material',
    tokens: {
        Primary:     new SolidColorBrush(Color.FromHex('#6750A4')),
        OnPrimary:   new SolidColorBrush(Color.FromHex('#FFFFFF')),
        Space1:      4,
        Space2:      8,
        ShapeFull:   CornerRadius.Full,
        // ... every token
    },
});
```

---

## 5. The registration TypeScript file

`<theme>.ts` is small. It imports the compiled bundles, calls
`defineTheme(...)` once, and registers it with the singleton
`ThemeManager`:

```ts
// src/framework/material/material.ts
import { ThemeManager, defineTheme } from '../../runtime/index.js';
import {
    MaterialTemplates,
    MaterialCatalog,
} from '../../../build/framework/material/material.template.mu.js';
import { MaterialLight }   from '../../../build/framework/material/material.light.mu.js';
import { MaterialDark }    from '../../../build/framework/material/material.dark.mu.js';
import { MaterialHCLight } from '../../../build/framework/material/material.hc-light.mu.js';

const material = defineTheme({
    name:           'material',
    templates:      MaterialTemplates,
    catalog:        MaterialCatalog,
    schemes:        [MaterialLight, MaterialDark, MaterialHCLight],
    defaultScheme:  'light',
});

ThemeManager.RegisterTheme(material);

// Convenience aliases retained for back-compat:
export function SetTheme(name: 'light' | 'dark'): void {
    ThemeManager.ActivateScheme(name);
}
export function CurrentTheme(): string {
    return ThemeManager.ActiveScheme?.name ?? 'light';
}
export function ToggleTheme(): string {
    const next = CurrentTheme() === 'light' ? 'dark' : 'light';
    SetTheme(next);
    return next;
}
```

Adding a new Scheme variant is a one-line change: import it and add
to the `schemes` array. The compiler enforces the catalog contract;
runtime registration is mechanical.

---

## 6. App activation

The app's bootstrap imports the theme module (side effect: registers
with `ThemeManager`) and activates:

```ts
// app/bootstrap.ts
import '@pragmatic-tech-ai/mural/framework/material';     // side-effect: registers Material
import { ThemeManager } from '@pragmatic-tech-ai/mural/runtime';

ThemeManager.ActivateTheme('material');           // → light (defaultScheme)

// Or: track OS preference automatically
ThemeManager.AutoScheme({
    light:  'light',
    dark:   'dark',
    listen: true,
});
```

App `.mu` files reference tokens normally — `@Primary`, `@Space2`,
`@BodyMedium` — and the resolver walks the inherited `Scheme` DP to
find the active value.

---

## 7. Common tasks

### 7.1 Adding a new control to the library

1. Write the control class in TypeScript with its DPs.
2. In `material.template.mu`, add a Template:
   ```mu
   Template x:key="DefaultNewControl" [TargetType=NewControl] {
       Border [Background=@Surface, /* … */] { ContentPresenter }
       when (IsMouseOver) { /* … */ }
   }
   Style [TargetType=NewControl] {
       Template = @DefaultNewControl;
   }
   ```
3. Reference tokens. If the template needs a token not yet in the
   catalog, add it to the `tokens { … }` block.
4. Build. The compiler will error on any Scheme that's now missing the
   new token.
5. Add the new token's value to every Scheme that should ship.

### 7.2 Adding a new token

1. Add it to the Theme's `tokens { … }` block:
   ```mu
   @MyNewToken : Brush "What this is for"
   ```
2. Reference it from templates.
3. Build — every Scheme will error with "missing token MyNewToken".
4. Add `@MyNewToken = value` to every Scheme file.

If the token is only needed by *some* templates (a rare specialised
case), it still has to appear in every Scheme. There's no notion of
"optional tokens" — the contract is total.

### 7.3 Adding a new Scheme variant

1. Create `src/framework/material/material.<variant>.mu`.
2. Use `scheme NewVariant against Material { … }` (or `basedOn
   MaterialLight` if it's close to an existing scheme).
3. Provide values for every catalog token.
4. Import + register in `material.ts`:
   ```ts
   import { MaterialNewVariant } from '...';
   const material = defineTheme({
       /* ... */
       schemes: [MaterialLight, MaterialDark, MaterialNewVariant],
   });
   ```

The app can activate it with `ThemeManager.ActivateScheme('new-variant')`.

### 7.4 Adding a whole new Theme alongside Material

1. Create `src/framework/<name>/` with the same shape: `.template.mu`,
   one `.mu` per Scheme, a `.ts` registration file.
2. Write the Theme's templates referencing its own token names. Names
   can overlap with Material (Fluent's `@Primary` is independent of
   Material's `@Primary`).
3. Write the Schemes — or use `basedOn` to start from a Material
   Scheme as a baseline.
4. Register in the new Theme's `.ts` file. Material is untouched.
5. App opts in with `ThemeManager.ActivateTheme('<name>')`.

---

## 8. What the compiler validates

| Situation                                              | Result                                  |
|--------------------------------------------------------|-----------------------------------------|
| Template references `@Token` not in catalog            | **Error** — unknown token               |
| Scheme provides `@Token` not in catalog                | **Warning** — unused token              |
| Scheme missing `@Token` from catalog                   | **Error** — scheme incomplete           |
| Scheme value's type doesn't match catalog type         | **Error** — type mismatch               |
| Catalog token never used by any template               | **Warning** — orphan token              |
| Two Themes both declare `@Primary` independently       | **OK** — tokens are unique per theme    |
| `basedOn` merge still leaves a catalog gap             | **Error** — missing token after merge   |
| Scheme top-level contains an element/style/trigger     | **Error** — scheme must be value-only   |

---

## 9. Subtree overrides in app markup

App `.mu` files override the cascade by setting the relevant inherited
DP locally. No `*.ApplyTo` attached properties — just plain DP writes:

```mu
// Dense panel inside a regular-density app:
StackPanel [Density=Compact] { /* ... */ }

// Dark sidebar inside a light app:
Border [Scheme=@MaterialDark] {
    NavList { /* renders with dark tokens */ }
}

// Side-by-side preview:
StackPanel [Orientation=Horizontal] {
    Border [Scheme=@MaterialLight, Width=400] { /* preview A */ }
    Border [Scheme=@MaterialDark,  Width=400] { /* preview B */ }
}
```

`@MaterialLight` and `@MaterialDark` are scheme references resolved by
the registration step — `ThemeManager` exposes them as named resources
once `RegisterTheme` runs.

---

## 10. Quick reference

### What goes where

```
Theme bundle (.template.mu)              Scheme dict (.<scheme>.mu)
─────────────────────────                ──────────────────────────
tokens { … } catalog                     @Token = value assignments
ControlTemplate                          Color values
Default Style                            State overlay values
DataTemplate                             Typography values
State triggers                           Shape values
Adaptive triggers                        Spacing values
Behavior attachments (in Style)          Motion values
                                         Elevation values
```

### Rule of thumb

> If you find yourself wanting to put a *literal value* in a template
> file (`Padding = (8, 4)` instead of `(@Space2, @Space1)`), you're
> probably missing a token. Add it to the catalog, define it in every
> Scheme, then reference it.

### Adaptive triggers cheat sheet

```mu
when (Density = Compact)         { … }   // app / user choice
when (Density = Comfortable)     { … }
when (ViewportClass = Mobile)    { … }   // ResizeObserver
when (ViewportClass = Tablet)    { … }
when (ViewportClass = Desktop)   { … }
when (Pointer = Coarse)          { … }   // touch device
when (PrefersContrast = More)    { … }   // OS pref
when (PrefersReducedMotion)      { … }   // OS pref
```

All inherited DPs on `Visual`. Subtree overrides come free from setting
the same DP locally.
