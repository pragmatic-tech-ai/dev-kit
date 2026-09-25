# Theme architecture — sketch of the finished system

## Principles

1. **Two levels: Theme and Scheme.** A Theme is the structural design language — ControlTemplates, default Styles, DataTemplates, state triggers. A Scheme is the complete token dictionary. One Theme owns N Schemes; activation always picks a `(theme, scheme)` pair.
2. **Standardized adaptive context via ThemeManager + EventManager.** Density, viewport class, pointer type, and OS preferences (color scheme, contrast, reduced motion) live as inherited DPs on Visual, written by a `ThemeManager` service that watches matchMedia / ResizeObserver. Templates consume them via the existing `when (...)` trigger syntax; imperative consumers subscribe via standardized routed events on `EventManager`.
3. **Subtree overrides come free from inheritance.** Setting `Density=Compact` or `Scheme=@MaterialDark` on a Visual cascades to descendants — no `*.ApplyTo` attached properties.
4. **Tokens are typed and validated at compile time.** A Scheme declared against a Theme must satisfy the Theme's token contract. `@Promary` is a compile error.
5. **Themes are first-class values**, not module-load side effects. `defineTheme({...})` + `defineScheme({...})` returned to `ThemeManager.Current.RegisterTheme(...)`. `SetTheme('light' | 'dark')` becomes a convenience alias.
6. **No TDZ workarounds in the public surface.** `ensureControlsTheme` / `ensureSurfaceTheme` survive as theme-internal details.

---

## The two levels

### Theme — the design language (structure + token catalog)

A Theme owns:

- **Token catalog** — an explicit `tokens { … }` block declaring every token the Theme's templates will reference, with a type and optional description. This is the contract Schemes must satisfy.
- **ControlTemplates** — every default Template the controls in this theme need.
- **Default Styles** — `Style [TargetType=Button]` blocks that pick the Template and wire static setters.
- **DataTemplates** — typed item-render templates shipped with the theme.
- **State triggers** — including triggers on adaptive ambient DPs (`Density`, `ViewportClass`, …).
- **Behavior attachments** — ride implicitly inside Styles via `AttachBehaviorAction`. No separate slot.

A Theme owns **no token values** — it owns the *contract* (which tokens exist and what type each is). The catalog is the single source of truth; the compiler validates both directions:

- Templates reference only tokens declared in the catalog.
- Schemes provide values for every token in the catalog.

Tokens are **unique per Theme**. Two Themes can both declare `@Primary` independently — they're separate tokens that happen to share a name. There's no global token namespace.

### Scheme — the token dictionary (values)

A Scheme is a **pure value dictionary**, declared *against* one specific Theme. Schemes provide values for every token in the Theme's catalog:

- **Color tokens** — `@Primary`, `@OnPrimary`, `@Surface`, `@OnSurface`, `@SurfaceContainerHigh`, `@Outline`, …; `Brush`.
- **State-layer overlays** — `@StateHoverOverlay`, `@StatePressOverlay`, `@StateFocusOverlay`; `Brush`.
- **Typography** — `@DisplayLarge`, `@BodyMedium`, …; `Typography`.
- **Shape tokens** — `@ShapeSmall`, `@ShapeFull`, …; `number | CornerRadius`.
- **Spacing tokens** — `@Space1`..`@Space8`; `number`.
- **Motion tokens** — `@DurationStandard`, `@EaseEmphasis`, …; `number` / `EasingFunction`.
- **Elevation** — `@Elevation1..5`; `Effect`. Both geometry and tint here.

A Scheme is **pure values only** — no element declarations, no triggers, no styles, no templates. Just `@Token = value` assignments. Examples within `material`: `light`, `dark`, `high-contrast-light`, `high-contrast-dark`.

A Scheme MUST provide every token in its Theme's catalog.

---

## What lives where

| Concern                                            | Theme | Scheme |
|----------------------------------------------------|:-----:|:------:|
| ControlTemplate                                    | ✓ |   |
| Default Style                                      | ✓ |   |
| DataTemplate                                       | ✓ |   |
| State triggers (incl. on ambient adaptive DPs)     | ✓ |   |
| Behavior attachments (inside Styles)               | ✓ |   |
| Typography (font / size / weight / line-height)    |   | ✓ |
| Shape tokens (CornerRadius scale)                  |   | ✓ |
| Spacing tokens                                     |   | ✓ |
| Motion (durations, easings)                        |   | ✓ |
| Color tokens (Primary, Surface, OnPrimary, …)      |   | ✓ |
| State-layer overlays                               |   | ✓ |
| Elevation geometry (blur, offset)                  |   | ✓ |
| Elevation tint                                     |   | ✓ |

Theme is the form (markup); Scheme is the values (tokens). Nothing crosses the line at runtime; cross-theme scheme reuse is supported only as an authoring convenience (see *Scheme borrowing*).

---

## Adaptive context — ThemeManager + EventManager

### Ambient inherited DPs on Visual

A small set of MetaData.Inherits DPs surface OS / viewport / user-pref state to every Visual using the same cascade `DataContext` uses. `ThemeManager` writes them on the Application root; descendants read them through inheritance:

```ts
Visual.DensityKey              : enum Density         = Regular;       // app / user choice
Visual.ViewportClassKey        : enum ViewportClass   = Desktop;       // ResizeObserver
Visual.PointerKey              : enum Pointer         = Fine;          // matchMedia
Visual.PrefersContrastKey      : enum PrefersContrast = Normal;        // matchMedia
Visual.PrefersReducedMotionKey : boolean              = false;         // matchMedia
Visual.PrefersColorSchemeKey   : enum PreferredScheme = NoPreference;  // matchMedia
Visual.SchemeKey               : Scheme | undefined   = undefined;     // active scheme
Visual.ThemeKey                : Theme  | undefined   = undefined;     // active theme

enum Density          { Compact, Regular, Comfortable }
enum ViewportClass    { Mobile, Tablet, Desktop }
enum Pointer          { Fine, Coarse }
enum PrefersContrast  { Normal, More }
enum PreferredScheme  { NoPreference, Light, Dark }
```

### Templates consume them with existing trigger syntax

No new grammar — these are just inherited DPs from the template's perspective:

```mu
Template x:key="DefaultToolBarButton" [TargetType=ToolBarButton] {
    Border x:name="PART_Border" [Padding=(12,8,12,8)] { ContentPresenter }

    when (Density = Compact)            { PART_Border.Padding = (8,4,8,4); }
    when (Pointer = Coarse)             { PART_Border.Padding = (16,12,16,12); }
    when (PrefersContrast = More)       { PART_Border.BorderThickness = (1); }
    when (Position = Only)              { PART_Border.CornerRadius = CornerRadius.Full; }
}

Template x:key="DefaultMenu" [TargetType=Menu] {
    Border x:name="PART_Popup" { /* popup chrome */ }
    when (ViewportClass = Mobile)       { PART_Popup.Template = @DefaultMenuDrawer; }
}
```

### Subtree overrides come free

Setting an ambient DP locally overrides the cascade for that subtree — no `*.ApplyTo` attached property needed:

```mu
// Dense panel inside a regular-density app:
StackPanel [Density=Compact] { /* ... */ }

// Dark sidebar inside a light app:
Border [Scheme=@MaterialDark] { /* ... */ }

// Side-by-side light/dark theme preview:
StackPanel [Orientation=Horizontal] {
    Border [Scheme=@MaterialLight, Width=400] { /* preview pane A */ }
    Border [Scheme=@MaterialDark,  Width=400] { /* preview pane B */ }
}
```

### ThemeManager — the service

```ts
class ThemeManager
{
    public static get Current(): ThemeManager;

    // Registration + activation
    public RegisterTheme(theme: Theme): void;
    public ActivateTheme(name: string, opts?: { scheme?: string }): void;
    public ActivateScheme(name: string): void;
    public AutoScheme(opts: { light: string; dark: string; listen: boolean }): void;

    public get ActiveTheme(): Theme   | undefined;
    public get ActiveScheme(): Scheme | undefined;

    // App-controlled adaptive DP
    public get Density(): Density;
    public set Density(v: Density): void;

    // Read-only adaptive DPs — driven by MediaWatcher
    public get ViewportClass(): ViewportClass;
    public get Pointer(): Pointer;
    public get PrefersContrast(): PrefersContrast;
    public get PrefersReducedMotion(): boolean;
    public get PrefersColorScheme(): PreferredScheme;

    // Opt-in transitions for animated palette swaps
    public set SchemeTransition(t: SchemeTransition | undefined): void;
}
```

`ThemeManager.Current` is a singleton bound to the active Application. Activation writes `Visual.ThemeKey` / `Visual.SchemeKey` on the Application root; the change cascades.

A small internal **MediaWatcher** (browser-side) wires matchMedia / ResizeObserver outputs to ThemeManager's adaptive DPs:

| Source                                              | Driven DP                |
|-----------------------------------------------------|--------------------------|
| `ResizeObserver` on root surface                    | `ViewportClass`          |
| `matchMedia('(pointer: coarse)')`                   | `Pointer`                |
| `matchMedia('(prefers-contrast: more)')`            | `PrefersContrast`        |
| `matchMedia('(prefers-reduced-motion: reduce)')`    | `PrefersReducedMotion`   |
| `matchMedia('(prefers-color-scheme: dark)')`        | `PrefersColorScheme`     |

### EventManager — imperative consumption

The same parameters surface as standardized routed events for VMs and behaviors that need to react imperatively:

```ts
class ThemeManager
{
    public static readonly DensityChangedEvent              = EventManager.RegisterRoutedEvent(...);
    public static readonly ViewportClassChangedEvent        = EventManager.RegisterRoutedEvent(...);
    public static readonly PointerChangedEvent              = EventManager.RegisterRoutedEvent(...);
    public static readonly PrefersContrastChangedEvent      = EventManager.RegisterRoutedEvent(...);
    public static readonly PrefersReducedMotionChangedEvent = EventManager.RegisterRoutedEvent(...);
    public static readonly PrefersColorSchemeChangedEvent   = EventManager.RegisterRoutedEvent(...);
    public static readonly ThemeChangedEvent                = EventManager.RegisterRoutedEvent(...);
    public static readonly SchemeChangedEvent               = EventManager.RegisterRoutedEvent(...);
}

// Subscribe from a behavior or VM:
visual.AddRoutedEventListener(ThemeManager.SchemeChangedEvent, (args) => {
    // re-fetch derived state, persist user pref, …
});
```

Events bubble through the routed-event tree, so subscribing at the root catches all changes; subscribing at a subtree root catches changes that affect that subtree's inherited values.

---

## Layered resolution

A `@Token` lookup at a Visual walks this chain. First hit wins.

```
@Token at Visual V
        │
        ▼
┌────────────────────────────────────────────────────────────────┐
│ 1. V.Resources (and ancestor V'.Resources via parent walk)     │  ← per-element local
├────────────────────────────────────────────────────────────────┤
│ 2. V's inherited Scheme.tokens                                 │  ← cascaded scheme dict
│      (subtree overrides via local Scheme= write live here)     │
├────────────────────────────────────────────────────────────────┤
│ 3. Application.DefaultResourceFactories                        │  ← unchanged fallback
│      (control styles, internal theme shims)                    │
└────────────────────────────────────────────────────────────────┘
        │
        ▼
    Token value (Brush / CornerRadius / Typography / Effect / number)
```

Because `Scheme` is an inherited DP, "what scheme applies to V" is just `V.Scheme` — subtree overrides are automatic. The DynamicResource binding subscribes to:
- the local ResourceDictionary chain (layer 1)
- the inherited `Scheme` DP on V (re-resolves on scheme swap or subtree write)
- and re-wires on `AttachLogical` / `DetachLogical` so reparenting picks up the new ancestor chain.

---

## Registration & activation API

```ts
const materialLight = defineScheme({
    name:    'light',
    theme:   'material',
    tokens: {
        // Colors
        Primary:              Brush.FromHex('#6750A4'),
        OnPrimary:            Brush.FromHex('#FFFFFF'),
        Surface:              Brush.FromHex('#FEF7FF'),
        // ... (full token dict for every group)
        // Typography, Shape, Spacing, Motion, Elevation, State overlays ...
    },
});

const materialDark = defineScheme({
    name:    'dark',
    theme:   'material',
    tokens:  { Primary: Brush.FromHex('#D0BCFF'), /* ... */ },
});

const material = defineTheme({
    name:           'material',
    templates:      [BasicTheme, SurfaceTheme],     // ControlTemplate dicts from .mu
    schemes:        [materialLight, materialDark],
    defaultScheme:  'light',
});

ThemeManager.Current.RegisterTheme(material);
ThemeManager.Current.ActivateTheme('material');       // uses defaultScheme
ThemeManager.Current.ActivateScheme('dark');          // swap tokens

// Auto-track OS preference:
ThemeManager.Current.AutoScheme({
    light:  'light',
    dark:   'dark',
    listen: true,
});

// Convenience aliases:
SetTheme('dark');                                     // === ActivateScheme('dark')
ToggleTheme();                                        // flips light ↔ dark on active theme
```

### Scheme borrowing (authoring API)

When bootstrapping a new Theme, `defineScheme({ basedOn: 'theme.scheme' })` inherits another scheme's tokens. Useful for starting Fluent from Material, or building density variants from a base scheme — though with density now an ambient DP rather than a scheme variant, the most common use case becomes cross-theme bootstrapping:

```ts
const fluentLight = defineScheme({
    name:    'light',
    theme:   'fluent',
    basedOn: 'material.light',                        // borrow as starting point
    tokens: {
        Primary:      Brush.FromHex('#0078D4'),
        BodyMedium:   Typography({ family: 'Segoe UI', size: 14, /* ... */ }),
        ShapeSmall:   2,
        ShapeMedium:  4,
        // Everything else inherits.
    },
});
```

`basedOn` resolves at registration time: the referenced scheme's token dict merges under `tokens` (yours wins), and the result is validated against the target Theme's contract.

---

## Compile-time contract

The Theme **explicitly declares** its token catalog in a `tokens { … }` block at the top of its `.mu` bundle. Each entry has a name, a type, and an optional description:

```mu
theme Material {

    tokens {
        // Colors
        @Primary              : Brush         "Primary brand color"
        @OnPrimary            : Brush         "Text / icon over Primary"
        @PrimaryHover         : Brush         "Primary at hover state-layer"
        @PrimaryPress         : Brush         "Primary at pressed state-layer"
        @Surface              : Brush         "Default surface"
        @OnSurface            : Brush         "Text / icon over Surface"
        @SurfaceContainerHigh : Brush         "Elevated surface tone"
        @Outline              : Brush         "1dp dividers + control outlines"

        // State overlays
        @StateHoverOverlay    : Brush         "OnSurface @ 8% — hover state-layer"
        @StatePressOverlay    : Brush         "OnSurface @ 12% — pressed state-layer"

        // Shape
        @ShapeSmall           : CornerRadius  "4dp"
        @ShapeMedium          : CornerRadius  "12dp"
        @ShapeFull            : CornerRadius  "Fully rounded — clamped to min(W,H)/2"

        // Spacing
        @Space1..@Space8      : number        "M3 spacing scale (4 / 8 / 12 / 16 / 24 / 32 / 48 / 64)"

        // Motion
        @DurationStandard     : number        "200ms"
        @EaseEmphasis         : Easing        "Standard M3 ease curve"

        // Typography
        @BodyMedium           : Typography    "14 / 20, weight 400"
        @DisplayLarge         : Typography    "57 / 64, weight 400"

        // Elevation
        @Elevation1..@Elevation5 : Effect     "M3 elevation scale"
    }

    // Templates and styles reference the tokens above:
    Template x:key="DefaultButton" [TargetType=Button] {
        Border [Background=@Primary, CornerRadius=@ShapeFull, Padding=(@Space3, @Space2)] {
            ContentPresenter
        }
        when (IsMouseOver) { ... }
    }

    // ... more templates, styles, DataTemplates ...
}
```

The compiler enforces the catalog cross-references in both directions:

| Situation                                           | Result                                  |
|-----------------------------------------------------|-----------------------------------------|
| Template references `@Token` not in catalog         | **Error** — unknown token               |
| Scheme provides `@Token` not in catalog             | **Warning** — unused token              |
| Scheme missing `@Token` from catalog                | **Error** — scheme incomplete           |
| Scheme value's type doesn't match catalog type      | **Error** — type mismatch               |
| Catalog token never used by any template            | **Warning** — orphan token              |
| Two themes both declare `@Primary` independently    | **OK** — tokens are unique per theme    |

Every Scheme declared `against Material` MUST satisfy the catalog (after `basedOn` merging, if any). Missing tokens, type mismatches, and `@Promary`-style typos all surface as compile errors.

---

## Token taxonomy

Every token group lives in the Scheme. The Theme references them by name.

| Group        | Examples                                       | Value type                |
|--------------|------------------------------------------------|---------------------------|
| **Color**    | `@Primary`, `@Surface`, `@OnSurface`           | `Brush`                   |
| **State**    | `@StateHoverOverlay`, `@StatePressOverlay`     | `Brush`                   |
| **Typography** | `@DisplayLarge`, `@BodyMedium`               | `Typography`              |
| **Shape**    | `@ShapeSmall`, `@ShapeFull`                    | `number \| CornerRadius`  |
| **Spacing**  | `@Space1`..`@Space8`                           | `number`                  |
| **Motion**   | `@DurationStandard`, `@EaseEmphasis`           | `number` / `EasingFunction` |
| **Elevation**| `@Elevation1..5`                               | `Effect`                  |

Tokens may carry **dotted namespaces** for brand customization: `@Brand.Heading`, `@MyChart.Axis`. The compiler validates the head against registered token roots.

---

## Runtime transitions

Optional, opt-in. Applies when swapping schemes; theme swaps snap (templates can't tween):

```ts
ThemeManager.Current.SchemeTransition = {
    duration: 200,
    easing:   Easing.Standard,
    tokens:   'brushes-only',    // 'all' / 'brushes-only' / 'none'
};
```

Implemented inside the DynamicResource subscriber: when a Brush token swaps, schedule a `BrushAnimation` from old→new instead of snapping. Shape/spacing changes snap unconditionally (they affect layout). When `PrefersReducedMotion=true` is active, transitions snap regardless of the setting.

---

## Current files → new model

| Today                                       | Tomorrow                                            |
|---------------------------------------------|-----------------------------------------------------|
| `src/Basic/basic.template.mu`               | Material theme bundle — basic templates             |
| `src/framework/menu/surface.template.mu`    | Material theme bundle — surface templates           |
| `src/framework/material/typography.mu`      | Material schemes — typography tokens                |
| `src/framework/material/light.mu`           | Scheme `material.light` (full token dict)           |
| `src/framework/material/dark.mu`            | Scheme `material.dark` (full token dict)            |
| `src/framework/material/material.ts` — `SetTheme` | Theme registration entry-point + ThemeManager singleton |
| `ensureControlsTheme` / `ensureSurfaceTheme` | Internal TDZ shim invoked by the theme's loader    |

Adding a `fluent` theme later is purely additive: `src/framework/fluent/fluent.template.mu` (templates) + N schemes registered with `ThemeManager`. No changes to Material.

---

## What stays vs. what grows

| Component                          | Status |
|------------------------------------|--------|
| `light.mu` / `dark.mu`             | **Restructure** — become typed Schemes carrying the full token dict |
| `typography.mu`                    | **Restructure** — typography tokens move into each Scheme |
| `basic.template.mu` / `surface.template.mu` | **Restructure** — owned by the Material Theme; gain `Density` / `ViewportClass` triggers |
| `SetTheme` / `CurrentTheme` / `ToggleTheme` | **Keep** as convenience over `ThemeManager.Current.ActivateScheme` |
| `ensureControlsTheme` / `ensureSurfaceTheme` | **Keep** as internal TDZ shim, hidden inside the theme bundle |
| `DynamicResource` ancestor-walk wiring | **Extend** — re-wires on AttachLogical/DetachLogical; reads inherited `Scheme` DP |
| `STATIC_MEMBERS`                   | **Extend** — adds per-theme token contract for validation |
| `Theme` / `Scheme` / `defineTheme` / `defineScheme` (+ `basedOn`) | **New** — first-class theme + scheme values |
| `ThemeManager` singleton (`Current`, Register / Activate / AutoScheme) | **New** — public service |
| `Visual.Density` / `Visual.ViewportClass` / `Visual.Pointer` / `Visual.PrefersContrast` / `Visual.PrefersReducedMotion` / `Visual.PrefersColorScheme` / `Visual.Scheme` / `Visual.Theme` | **New** — inherited DPs |
| `MediaWatcher` | **New** — internal service feeding adaptive DPs from matchMedia / ResizeObserver |
| `ThemeManager.*ChangedEvent` routed events | **New** — standardized adaptive events through EventManager |
| `SchemeTransition`                 | **New** — opt-in animated token swaps |
| Spacing / motion token groups      | **New** — proper namespaces with types |
| LineHeight DP on TextBlock         | **New** — required for typography bundle |

---

## Decisions log

- **Theme.ApplyTo:** deferred. Subtree theme swaps are rare and the simplest path (set `Visual.Theme` locally) covers them when needed.
- **Density:** an enum DP on `Visual` written by `ThemeManager`. Templates consume it via triggers. Not a Scheme variant — no combinatorial explosion of `compact-*` schemes.
- **Fluid UI / responsive:** trigger-driven via ambient inherited DPs (`ViewportClass`, `Pointer`, `PrefersContrast`, `PrefersReducedMotion`). No Modifier layer. Three tiers of responsive change handled:
  - **Light fluid** (spacing / sizes) — Style or Template triggers on `Density` / `Pointer`.
  - **Layout fluid** (visibility, orientation) — triggers on `ViewportClass` setting visibility / orientation / wrap.
  - **Structural fluid** (popup → drawer, table → cards) — triggers on `ViewportClass` swap a ControlTemplate via the templated owner's `Template` DP. The Theme ships multiple Templates per surface (e.g. `DefaultMenuPopup`, `DefaultMenuDrawer`).
- **Cross-theme scheme reuse:** authoring only, via `defineScheme({ basedOn: '...' })`. Not a runtime feature.
- **Behaviors in themes:** ride implicitly inside Styles via existing trigger actions (`AttachBehaviorAction`). No separate Theme.Behaviors slot.
- **Subtree overrides:** free from inheritance. `Density=Compact` or `Scheme=@MaterialDark` on any Visual cascades to descendants. No `*.ApplyTo` attached properties.
- **Token ownership:** **the Theme owns the contract** (which tokens exist + their types, declared explicitly in a `tokens { … }` catalog block at the top of the Theme bundle). **The Scheme owns the values** (each token's concrete `Brush` / `number` / `Effect`). Not implicit auto-extraction — the catalog is explicit and documented.
- **Token catalog format:** each entry carries `@Name : Type "Optional description"`. Description is optional but recommended (lint warning if missing).
- **Schemes are pure value dictionaries:** only `@Token = value` assignments. No element declarations, no triggers, no styles, no templates allowed at the top level of a Scheme.
- **Per-theme token namespace:** tokens are unique per Theme. Material's `@Primary` and Fluent's `@Primary` are independent tokens that happen to share a name — there's no global token registry, no cross-theme relationship. The active Theme's catalog defines the only `@Primary` in scope.

---

## Deferred topics (own brainstorms)

- **Container queries** — per-element responsive observers ("when *this* container is narrower than X, restyle"). Requires a `ResizeObserver` per container; out of scope for theme architecture v1.
- **Theme.ApplyTo as an attached property** — revisit if a concrete consumer needs side-by-side full design-language preview that can't be expressed by setting `Visual.Theme` locally.
- **Animated transitions for adaptive DP changes** — e.g. tween spacing when `Density` flips. Solvable via the same `SchemeTransition` mechanism extended to inherited DPs; defer until anyone asks.

---

## Delivery plan

Six slices, dependency-ordered. Each slice ships working software, passes existing tests, and adds tests for its new surface. No slice introduces a user-visible regression.

### Slice 1 — Foundation (no behavior change)

**Goal:** introduce the new types and registration API without changing any rendered output.

**Scope:**
- `Theme` + `Scheme` value classes, `defineTheme` + `defineScheme` factories.
- `ThemeManager` singleton with `Current`, `RegisterTheme`, `ActivateTheme`, `ActivateScheme`, `AutoScheme`.
- Restructure `material.ts` to register the Material Theme through the new API. `SetTheme` / `CurrentTheme` / `ToggleTheme` become thin aliases over `ThemeManager.Current.ActivateScheme`.
- Restructure `light.mu` / `dark.mu` to declare themselves as Schemes against the `material` Theme. Includes adding the **new spacing + motion token groups** (`@Space1..8`, `@DurationStandard`, `@EaseEmphasis`) to both schemes — defining the tokens now, even though nothing consumes them yet.
- Nothing in the templates changes; everything still resolves the way it does today.

**Effort:** L. Touches the runtime, compiler emit for `.mu` schemes, material.ts, light.mu, dark.mu, the surface bundle loader.

**Risk:** Medium. Restructuring touches load-order; needs careful TDZ-shim handling.

**Open questions:**
- Hard-deprecate `SetTheme` (warn) or keep it forever as an alias? Lean keep-forever.
- Typography tokens in Schemes this slice or wait until Slice 5? Recommend wait — typography is tied up with the `Typography` value type.

### Slice 2 — Compile-time contract + scheme borrowing

**Goal:** make typos and missing tokens compile errors; enable `basedOn` for new theme bootstrapping.

**Scope:**
- Compiler scans theme templates to extract a per-theme token contract (name → type).
- Every Scheme validates against its theme's contract; missing tokens / type mismatches throw at build time.
- `@Promary` and similar typos become compile errors.
- `defineScheme({ basedOn: '...' })` resolves at registration: borrowed dict merges under `tokens`, result validated against the target contract.

**Depends on:** Slice 1.

**Effort:** M. Mostly compiler work in `symbol-table.ts` + a new contract-extraction pass; small runtime work for `basedOn` merging.

**Risk:** Medium-low. Catches errors that exist today as silent `undefined`s. May surface latent bugs in current `.mu` files (treat as a feature).

**Open questions:**
- Contract auto-extracted from templates, or also published explicitly by `defineTheme({ contract: {...} })`? Auto-extract is less ceremony but harder to lint.

### Slice 3 — Ambient DPs + MediaWatcher + events

**Goal:** ship the adaptive-context substrate. Developers can read `Density` / `ViewportClass` / `Pointer` / OS-pref DPs from their own code and triggers, even though no built-in template uses them yet.

**Scope:**
- Eight new inherited DPs on `Visual`: `Density`, `ViewportClass`, `Pointer`, `PrefersContrast`, `PrefersReducedMotion`, `PrefersColorScheme`, `Scheme`, `Theme`. All `MetaData.Inherits`.
- `MediaWatcher` service wired to matchMedia + ResizeObserver. Writes adaptive DPs on the Application root.
- `ThemeManager` setters/getters for the writable ones (`Density`) and getters for read-only ones (`Pointer`, OS prefs).
- Standardized routed events through `EventManager`: `DensityChangedEvent`, `ViewportClassChangedEvent`, etc.
- DynamicResource: also subscribe to inherited `Scheme` DP changes so subtree `Scheme=@Foo` writes re-resolve every `@Token` lookup beneath.

**Depends on:** Slice 1 (for `Scheme` / `Theme` DP types).

**Effort:** M-L. New DPs are mechanical; MediaWatcher needs care around debouncing resize.

**Risk:** Low-medium. New surface; doesn't disturb existing code paths.

**Open questions:**
- `ViewportClass` breakpoints — M3 defaults (Mobile ≤ 600, Tablet 600–840, Desktop > 840) hard-coded, or configurable via `ThemeManager.Breakpoints = ...`? Recommend M3 defaults, configurable.
- Does `MediaWatcher` activate by default, or opt-in? Lean default-on; matchMedia listeners are cheap.

### Slice 4 — Material templates adopt adaptive triggers

**Goal:** first user-visible adaptation. Material UI reacts to density, viewport, pointer, contrast.

**Scope:**
- Update `basic.template.mu` + `surface.template.mu` to add adaptive triggers:
  - ToolBarButton, Button: `Density=Compact` shrinks padding; `Pointer=Coarse` enlarges touch targets.
  - Menu, MenuButton, ContextMenu: `ViewportClass=Mobile` swaps `Template = @DefaultMenuDrawer` (new drawer-shaped template lives in the same bundle).
  - Outlined controls: `PrefersContrast=More` thickens borders.
- New demos / test page exercising density + viewport flips.
- Templates use spacing tokens (`@Space2` etc.) for the new padding values — turns the Slice 1 token definitions into actual consumers.

**Depends on:** Slice 1 (spacing tokens defined), Slice 3 (adaptive DPs cascade).

**Effort:** M. Template surgery; one new drawer template; one demo.

**Risk:** Medium. Visible UX changes; needs careful M3-spec adherence; existing demos must still look right at default density/viewport.

**Open questions:**
- Which surfaces get viewport-driven structural swaps in v1? Recommend Menu → Drawer only; everything else handled by light fluid (spacing).
- Drawer template — net-new content for this slice, or already in the design backlog?

### Slice 5 — Typography type + LineHeight DP

**Goal:** make typography a proper token value; enable per-scheme typography swaps.

**Scope:**
- New `Typography` value class: `{ family, size, weight, lineHeight, tracking }`.
- New `LineHeight` DP on `TextBlock`.
- Update `typography.mu` to define `@DisplayLarge`, `@BodyMedium`, etc. as `Typography` instances, owned by each Scheme rather than free-floating.
- Update compiler to recognise `Typography({...})` in `.mu` value position.
- Template references like `Style = @BodyMedium` continue to work; tokens now resolve to the rich `Typography` value.

**Depends on:** Slice 1 (Scheme owns typography tokens).

**Effort:** M. New value class; TextBlock DP + measure/render integration; compiler emit; typography.mu restructure.

**Risk:** Medium. Touches every TextBlock-derived control; LineHeight semantics need a clear choice (px / em / unitless).

**Open questions:**
- LineHeight units — px (absolute) or em (relative to FontSize)? Lean **px**, with a separate `LineHeightRatio` opt-in if anyone needs ratio semantics.
- Does `Style = @BodyMedium` set five DPs at once via a `Typography`-aware Style applier, or does it flow through a `Typography` DP on TextBlock that fans out internally?

### Slice 6 — Polish (SchemeTransition + DynamicResource re-wire)

**Goal:** smooth out the rough edges.

**Scope:**
- `ThemeManager.Current.SchemeTransition = { duration, easing, tokens }` opt-in.
- DynamicResource subscriber checks `PrefersReducedMotion`; if true, transitions snap regardless of setting.
- Implementation rides existing `BrushAnimation` infrastructure; only `Brush`-typed token swaps animate.
- Fix known limitation: DynamicResource re-wires its ancestor subscriptions on `AttachLogical` / `DetachLogical` so reparented visuals pick up the new chain.

**Depends on:** Slice 3 (PrefersReducedMotion DP), Slice 1 (ThemeManager).

**Effort:** M. Animation hookup; DynamicResource lifecycle change is delicate.

**Risk:** Medium. DynamicResource is widely used; lifecycle changes need careful testing across tree-mutation scenarios.

**Open questions:**
- Default value — opt-in (off until set) or opt-out (on at 200ms by default)? Opt-in is safer; matches "no behavior change until explicit."

### Dependency graph

```
Slice 1 ──► Slice 2 ──► Slice 3 ──► Slice 4 ──► Slice 6
                  │                                ▲
                  └─────────────► Slice 5 ─────────┘
```

- Slices 1–4 are the path of greatest value: type-safe theming → contract validation → adaptive context → visible adaptation.
- Slice 5 can run in parallel after Slice 2 (independent — typography type doesn't depend on adaptive DPs).
- Slice 6 is the natural finale — needs Slices 1, 3, 5 in place.

If we have to cut for time: drop Slice 6 first (polish), then Slice 5 (typography modernisation can wait), then Slice 2 (validation helpful but not blocking). Slices 1, 3, 4 form the minimum viable theme system.

### Decisions needed before Slice 1 starts

1. **`SetTheme` lifetime** — alias forever, or deprecate later?
2. **Contract publication** — auto-extracted from templates only, or also explicit on `defineTheme`?
3. **Breakpoints** — M3 defaults hard-coded in v1, or configurable from the start?
4. **Drawer template** — drafted as part of Slice 4, or separately?
5. **LineHeight units** — px, em, or unitless multiplier?
6. **SchemeTransition default** — opt-in (off) or opt-out (on at 200ms)?
