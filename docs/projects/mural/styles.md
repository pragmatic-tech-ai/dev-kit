# Styles

Reusable bags of property assignments + conditional triggers applied to
target `Visual` / `Element` classes. Mirrors WPF's `Style` / `Setter` /
`Trigger`, plus the surrounding machinery that WPF folds into `Style`:
control templates, a themed default-style tier, and an adaptive theme
engine.

**Implemented in:**
- [runtime/style.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/style.ts) — `Style`, `Setter`,
  `SetterFactory`, the five trigger kinds (`PropertyTrigger`,
  `MultiTrigger`, `DataTrigger`, `MultiDataTrigger`, plus `EventTrigger`),
  and `CompositeStyle` / `Style.Combine` (multi-style composition).
- [visual-engine/element.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/visual-engine/element.ts) —
  `Element.Style`, the three-source resolution (`refresh_active_style`),
  `DefaultStyleKey`, implicit / theme lookup with reactive subscription,
  `applyDefaultStyle()`.
- [visual-engine/style-applicator.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/visual-engine/style-applicator.ts)
  — the per-Element `StyleApplicator`: diff-swap of setters + triggers,
  binding install / disposal, TwoWay writeback bookkeeping.
- [runtime/binding/effective-value.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/binding/effective-value.ts)
  — the `PropertyValueSource` priority ladder (`StyleValue` +
  `TriggerValue` tiers).
- [basic/templates/control-template.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/templates/control-template.ts)
  — `ControlTemplate`, `TemplateBinding`, template triggers, per-instance
  `NameScope`.
- [visual-engine/theme/theme.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/visual-engine/theme/theme.ts) —
  `Theme`, `Scheme`, `ThemeManager` and the six inherited adaptive DPs.

See also: [property-system.md](property-system.md) for the value-priority
ladder, [resources.md](resources.md) for how implicit / theme styles are
looked up (keyed by class in `ResourceDictionary`).

## 0. Architecture at a glance

Four layers, from *what to set* down to *where the values come from*.
Everything is authored in `*.template.mu` and lowered to these runtime
objects.

1. **`Style` — the declarative bag** ([runtime/style.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/style.ts)).
   A `TargetType`, a list of `Setter`s, five trigger kinds, an optional
   `BasedOn`, and a per-style `Resources` dictionary.

2. **Value tiers — who wins**
   ([effective-value.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/binding/effective-value.ts)). Every
   property has an `EffectiveValueDescriptor` with a source ladder.
   Setters land in the **Style** tier; triggers in the **Trigger** tier
   (above Style). See [§8](#8-value-priority).

3. **Application + resolution.** `StyleApplicator`
   ([style-applicator.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/visual-engine/style-applicator.ts)) owns the
   per-Element setter/trigger bookkeeping and swaps styles by *diffing*.
   `Element.refresh_active_style`
   ([element.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/visual-engine/element.ts)) chooses which style is
   active from three sources — explicit > implicit > theme
   ([§4](#4-applying-styles), [§10](#10-style-resolution-on-element)).

4. **`ControlTemplate` + `Theme`.** The template is the visual blueprint a
   control builds from ([§11](#11-controltemplate)); the theme supplies the
   design tokens the setters reference ([§12](#12-theme--scheme--thememanager)).

Beyond WPF: several styles can be applied to one element at once —
`Style.Combine(a, b)` / `Style = @a + @b` ([§13](#13-composing-styles--stylecombine--a--b)).

The rest of this doc details each layer with runnable snippets.

## 1. Setters

A `Setter` is `(owner, property, value)` — explicit owner so cross-class
/ attached properties work cleanly.

```ts
import { Setter, Style } from '../runtime/index.js';
import { Border, Canvas, TextBlock } from '../basic/index.js';

new Setter(Border, 'BorderThickness', new Thickness(2));
new Setter(Canvas, 'Left', 20);           // attached property setter
new Setter(TextBlock, 'FontSize', 16);
```

A setter whose `owner` is the markup-implicit `TargetType` but whose
property is actually an *inheritable* DP registered on another class
(e.g. `Style[TargetType=Tooltip]{ Foreground = … }`, where `Foreground`
lives on `TextBlock`) still resolves: `StyleApplicator` takes a second
pass through the global inheritable-DP registry on a name match
([resolveSetterDescriptor](https://github.com/pragmatic-tech-ai/mural/blob/main/src/visual-engine/style-applicator.ts#L24)).

## 2. Style

```ts
const cardStyle = new Style(Border, [
    new Setter(Border, 'Background',      new SolidColorBrush(Color.White)),
    new Setter(Border, 'BorderBrush',     new SolidColorBrush(Color.Gray)),
    new Setter(Border, 'BorderThickness', new Thickness(1)),
    new Setter(Border, 'Padding',         new Thickness(16)),
    new Setter(Border, 'CornerRadius',    8),
]);

const card = new Border();
card.Style = cardStyle;
// card.Background, BorderBrush, BorderThickness, Padding, CornerRadius
// now reflect the setter values at the StyleValue priority tier.
```

### TargetType validation

`Style.TargetType` is the class the style targets. Applying a style to a
Visual that's not an instance of `TargetType` throws — caught early
rather than silently leaking unrelated setters.

```ts
const buttonStyle = new Style(Button, …);
const tb = new TextBlock();
tb.Style = buttonStyle;
// Error: Style.TargetType 'Button' does not match target 'TextBlock'
```

Subclass-of relationships pass: a `Style(Visual, …)` works on any
`Visual` descendant.

### Sealing

The first `Element.Style = s` assignment calls `s.Seal()`, flipping
`s.IsSealed = true`. Idempotent; cascades into `BasedOn`. `Seal()` also
performs **implicit-BasedOn resolution** — see [§3](#3-basedon).

## 3. BasedOn

Child styles inherit setters / triggers / resources from a base, and
override per (owner, property):

```ts
const base = new Style(Border, [
    new Setter(Border, 'Padding', new Thickness(8)),
    new Setter(Border, 'BorderThickness', new Thickness(1)),
]);

const accentCard = new Style(Border, [
    new Setter(Border, 'Background', new SolidColorBrush(Color.FromHex('#1e40af'))),
    new Setter(Border, 'Padding', new Thickness(16)),    // overrides base
], base);

accentCard.ResolveSetters();
//   Border.BorderThickness  = Thickness(1)            (from base)
//   Border.Background       = blue                    (from child)
//   Border.Padding          = Thickness(16)           (child overrides base)
```

Multi-level chains resolve transitively. `ResolveSetters` (and the
`ResolveTriggers` / `ResolveEventTriggers` / … siblings) run at apply
time, not at construction, so editing a base after children are built is
observable in the children.

### Implicit BasedOn — inherit the theme style automatically

When a Style declares no explicit `BasedOn`, `Seal()` splices in the
**theme's default Style for the same `TargetType`**
([style.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/style.ts#L341)). This is WPF parity for "every
Style implicitly derives from the default Style for its target type."
The practical payoff: an author-side `ItemContainerStyle` that only sets
`IsExpanded = true` no longer blows away the control's whole chrome
(Template + colours) — that chrome flows in through the implicit theme
base. A `BasedOn = @key` pointing at a token in another (not-yet-merged)
dictionary is passed as a **thunk** and resolved at `Seal()` too, since
the dictionary is often built before its theme merges into
`Application.Resources`.

## 4. Applying styles

An Element's *active* style is chosen from **three sources**, in WPF
priority order (see [§10](#10-style-resolution-on-element) for the
resolver):

```
explicit Style  >  implicit [TargetType=X]  >  theme (DefaultStyleKey)
```

### Explicit — `Element.Style = someStyle`

Direct assignment. Always wins.

```ts
border.Style = cardStyle;
border.Style = undefined;    // clears; falls back to implicit / theme (if any)
```

### Implicit — keyed by `TargetType` in a `ResourceDictionary`

```ts
const root = new TestPanel();
root.Resources.Set(Border, cardStyle);

const card = new Border();
root.AddChild(card);    // implicit style auto-applied at AttachLogical
```

When a Visual enters the logical tree it walks up its ancestor
`Resources` chain for an entry keyed by `this.constructor`. The lookup is
**reactive**: the Visual subscribes to every `Resources` dict along the
chain, so adding / removing / replacing the implicit style afterwards
re-resolves automatically.

```ts
root.Resources.Set(Border, cardStyle);   // card picks it up via the subscription
root.Resources.Set(Border, otherStyle);  // card switches automatically
```

### Theme — keyed by `DefaultStyleKey`

The lowest tier: a control's baseline chrome. Resolved the same way as
the implicit style but keyed by the Element's `DefaultStyleKey` instead
of its constructor, and normally satisfied by a Style sitting in a merged
theme dictionary. See [§10](#10-style-resolution-on-element) and
[§12](#12-theme--scheme--thememanager).

## 5. Setter values

A `Setter.value` can be:

### A plain literal
```ts
new Setter(Border, 'CornerRadius', 4)
```

### A `Binding` (with a per-target sharing caveat)
A bare `Binding` has per-instance state (its `setOnValueChanged`
callback). Sharing one `Binding` across two Visuals applying the same
`Style` would have the second target overwrite the first's callback. For
per-target safety, wrap in `SetterFactory`.

### A `SetterFactory<T>` — fresh value per target
```ts
import { SetterFactory } from '../runtime/index.js';

new Setter(Border, 'Background', new SetterFactory(
    target => DynamicResource(target, 'AccentBrush'),
))
```

The factory's `create(target)` runs at apply time on each Visual the
style applies to — producing a fresh `Binding` / `DynamicResource` per
target, so they don't share state.

When the produced value is a `Binding`, `StyleApplicator.ApplySetter`
installs it reactively at the requested tier: the binding's resolved
value is pushed to the EVD slot, and changes propagate through. `TwoWay`
/ `OneWayToSource` setters also wire a **target → source writeback**
listener, tracked per-tier so the same `Setter` reused across the Style
and Trigger tiers keeps two independent writeback entries. Disposing the
style tears down the binding subscription (writeback detached *before*
the slot clears, so teardown never pushes a default back into the source
VM).

## 6. Triggers

All five WPF trigger kinds exist; each lives on the `Style` and applies
its setters at the **Trigger** tier (above Style, below Local — but see
the [priority note in §8](#8-value-priority)).

| Kind | Watches | Markup |
|------|---------|--------|
| `PropertyTrigger` | one DP `=== value` | `when( IsMouseOver )` |
| `MultiTrigger` | AND of several DPs | `when( IsMouseOver and IsEnabled )` |
| `DataTrigger` | a bound `$path` `=== value` | `when( $IsHot )` |
| `MultiDataTrigger` | AND of several `$path`s | `when( $A and $B )` |
| `EventTrigger` | a routed event (fires actions, not values) | `on PointerDown { … }` |

```ts
import { PropertyTrigger } from '../runtime/index.js';

const hoverTrigger = new PropertyTrigger(
    Border,                       // owner of the watched property
    'IsMouseOver',
    true,                         // value that activates
    [                             // setters applied while active
        new Setter(Border, 'Background', new SolidColorBrush(Color.FromHex('#dbeafe'))),
    ],
);

const style = new Style(Border, [
    new Setter(Border, 'Background', new SolidColorBrush(Color.White)),
], undefined, [hoverTrigger]);
```

Notes shared by all trigger kinds:

- **Match is `===`** (no value-equality helpers, no converters on the
  condition). Re-evaluated synchronously on every change to a watched
  property, so a hot-path property with many triggers has real cost.
- **`enterActions` / `exitActions`** fire only on genuine activation /
  deactivation *edges* — never on initial style apply when the property
  already matches, nor on style detach. (Initial-state match still
  applies the setters, silently.)
- **Trigger-tier stacking.** Multiple triggers whose setters target the
  same property stack in activation order; deactivating one removes only
  its contribution, so a still-active sibling's value survives
  ([effective-value.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/binding/effective-value.ts#L102)).
- **`BasedOn` triggers append** — base triggers first, child triggers
  after; last-applied-wins on conflict via the Trigger tier.
- Trigger setters can use `SetterFactory` and reactive `Binding` values
  just like regular setters.

`DataTrigger` / `MultiDataTrigger` bind by *data identity* (the styled
Visual's `DataContext`), so the same trigger transparently fires for any
item whose source resolves to a matching value — heavily used inside
`DataTemplate` triggers.

## 7. `Style.Resources`

Lazy per-style `ResourceDictionary`. Consulted **first** by
`Visual.TryFindResource` when this style is the Visual's active style —
so a `Setter` value using `DynamicResource(target, 'Accent')` resolves
`'Accent'` in the style's own dict before walking the tree.

```ts
const style = new Style(Border, [
    new Setter(Border, 'Background', new SetterFactory(
        t => DynamicResource(t, 'Accent'),
    )),
]);
style.Resources.Set('Accent', new SolidColorBrush(Color.FromHex('#1e40af')));
```

`HasResources` lets you check whether the dict was allocated without
allocating one. `BasedOn` resources resolve transitively through
`Style.TryResolveResource`.

## 8. Value priority

Each property's `EffectiveValueDescriptor` picks a winner from its base
slots. Mural's ladder (high → low):

```
Coerced ──▶ (transform overlay — not a slot; the descriptor's CoerceValue
             runs on whatever base wins, and reports CoercedValue when the
             result differs)

Animated  >  Trigger  >  Binding  >  Local  >  Style  >  Inherited  >  Default
```

> **⚠️ Mural intentionally deviates from WPF here.** WPF orders
> `Local > Trigger`; mural orders **`Trigger > Binding > Local`**
> ([effective-value.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/binding/effective-value.ts#L556)). The
> reason: a `ControlTemplate` factory sets per-part *local* defaults
> (`PART_Border.Background = …`), and state-driven triggers in the *same*
> template (`when(IsPressed){ PART_Border.Background = … }`) must still
> win over those defaults. Under WPF's order the local default would mask
> the trigger. The local slot still updates underneath, so clearing the
> trigger falls back to the freshest local value, not a stale snapshot.

Practical implications:

- A **trigger** value shadows the regular style setter *and* a local /
  binding write for the same property. Trigger deactivation re-exposes
  whatever sits below.
- The **styled** value shadows inherited values — a styled `Foreground`
  overrides one inherited from an ancestor.
- **Binding vs Local** is last-writer-wins between those two slots (each
  takes over from the other), both shadowed by Trigger and Animated. In
  the template-authoring model above, treat Binding as sitting just above
  Local.
- **Coercion** is the final word — a registered `CoerceValue` clamps /
  normalizes whatever base slot won, and `Source` reports `CoercedValue`
  when it changed the value.

## 9. `StyleApplicator` — apply / swap machinery

One `StyleApplicator` per Element
([style-applicator.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/visual-engine/style-applicator.ts)), created
lazily on first Style touch (Elements that never opt into Style pay zero
allocation). It owns the active Style plus all setter/trigger
bookkeeping.

`RefreshActiveStyle(desired)` performs a **diff swap**, not a naïve
unapply-then-apply:

- Resolve the previous and next styles' setter maps (BasedOn-flattened).
  A setter present on **both** sides *at the same instance* (e.g. a
  `Template` setter living on a shared theme base, reached identically
  through both `ResolveSetters` walks) is left untouched — no EVD write.
- Only genuinely **removed** setters unapply and only genuinely **new**
  setters apply. Same diff for all six trigger collections.

Why it matters: the naïve sequence pulses every shared property through
its default fallback, which fires `rebuildTemplate` twice and detaches
constructor-cached template-part references (`TreeViewItem._label`, etc.)
— every group row in the platform's nav tree once rendered blank because
of exactly this. The diff keeps shared-value slots stable so
`OnPropertyChange` fires only for real changes.

## 10. Style resolution on Element

`Element.refresh_active_style`
([element.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/visual-engine/element.ts#L327)) computes:

```ts
const desired = this.Style ?? this._implicitStyle ?? this._themeStyle;
```

and hands the swap to the `StyleApplicator`. The three fields are kept
current by:

- **`resolve_implicit_style`** — `TryFindResource(this.constructor)` in
  the ancestor chain (Styles only; a `ControlTemplate` registered under
  the same Function key is skipped via `instanceof Style`).
- **`resolve_theme_style`** — `TryFindResource(this.DefaultStyleKey)` in
  the same chain, normally hitting a merged theme dictionary.
- **`subscribe_styles`** — subscribes to every ancestor `Resources` dict
  so *both* re-resolve when any dictionary changes. Re-wired on tree
  mutations via `_refresh_styles_subtree`.

### `DefaultStyleKey` — opt-in theme lookup

`DefaultStyleKey` is a read-only DP, `undefined` by default, so theme
lookup is **opt-in per subclass**. A control declares it via an
`OverrideMetadata` static block:

```ts
class Button extends ContentControl {
    static {
        Model.OverrideMetadata(Button, Element.DefaultStyleKeyKey,
            { default_value: Button });   // "my theme Style is keyed by Button"
    }
}
```

> **Gotcha:** without that static block, `applyDefaultStyle()` silently
> no-ops for the theme tier — the control ends up with no default Style /
> Template even though the theme dictionary has one. First thing to check
> when a default cap/template "doesn't apply."

### `applyDefaultStyle()` — eager resolution from the ctor

The framework would otherwise resolve styles only at `AttachLogical`.
Templated controls call `applyDefaultStyle()` at the end of their
constructor so a standalone / unmounted instance still has its Template
(and its `visualChildren` / `Measure` contracts hold). It's WPF's lazy
`EnsureTemplate`, run eagerly. Idempotent — re-resolving the same style
is a no-op.

The canonical control-ctor shape:

```ts
constructor() {
    super();
    this.applyDefaultStyle();          // resolves Style[TargetType=X]
                                       //   → Template DP write
                                       //   → rebuildTemplate() fires
    this._part = this.GetTemplateChild('PART_X') as X;
}
```

## 11. `ControlTemplate`

A `ControlTemplate`
([control-template.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/templates/control-template.ts)) is the
imperative blueprint a control builds its visual subtree from — a
**factory**, so the same template applied to two controls yields two
independent trees. It's carried on a control as the `Template`
`ControlTemplate` DP (`MetaData.Measure`); changing it fires
`rebuildTemplate`, where subclasses re-adopt parts via
`GetTemplateChild`.

`Apply(templatedParent)`:

1. Runs the factory, then `markTemplated` stamps the `templatedParent`
   back-pointer on every generated node (stopping at sub-template roots).
2. Re-walks styles + dynamic resources so an implicit Style on the
   templated control's own ancestry crosses the template boundary.
3. Creates a **per-instance `NameScope`** and registers every `x:name`d
   node, so `PART_` names in two templates never collide and `FindName`
   from inside the template resolves locally.
4. Attaches **template triggers** — each watches a property on the
   *templated parent* (`IsMouseOver`, `IsPressed`, `Variant`, …) and
   writes its setters onto named parts:
   `when(IsSelected){ PART_Border.Background = … }`.
5. Finds the first `ContentPresenter` (depth-first, stopping at
   sub-template roots) as the Content slot.

`TemplateBinding(tp, path)` is sugar for a `OneWay` `Binding` back to the
templated parent — the `{TemplateBinding Property}` markup extension.

### Every control has a default Style (project rule)

Per [CLAUDE.md](https://github.com/pragmatic-tech-ai/mural/blob/main/CLAUDE.md), a control's templates are
`ControlTemplate` DPs (`Template`, `RowTemplate`, …) set on its default
Style in a `*.template.mu` file. The ctor calls `applyDefaultStyle()`
then reads the DPs — no `Application.ResolveDefaultResource(stringKey)`
or `resolveXxxTemplate` string lookups. Undefined at use time means the
surface theme wasn't registered — fix the bundle wiring, don't paper over
with a string key.

Worked example — the Button family
([buttons.template.mu](https://github.com/pragmatic-tech-ai/mural/blob/main/src/framework/buttons/buttons.template.mu)):

```
// One ControlTemplate per variant, keyed for reuse:
Template x:key="DefaultFilledButton" [TargetType = Button] {
    Border x:name="PART_Border" [ … ] {
        Border x:name="PART_StateLayer" [ … ] { ContentPresenter [ … ] }
    }
    when ( IsMouseOver ) { PART_StateLayer.Background = @OnPrimaryHoverLayer; }
    when ( IsPressed )   { PART_StateLayer.Background = @OnPrimaryPressLayer; }
    when ( ThemeManager.Density = Compact ) { PART_StateLayer.Padding = (16,6,16,6); }
}

// The default Style sets the baseline Template, then a one-level Variant-
// trigger chain swaps whole templates:
Style [TargetType = Button] {
    Template = @DefaultFilledButton;
    when ( Variant = Elevated ) { Template = @DefaultElevatedButton; }
    when ( Variant = Tonal )    { Template = @DefaultTonalButton; }
    …
}
```

Hover / press colour swaps live *inside* each template, so the Style's
trigger graph stays one level deep. These per-family `.template.mu`
dictionaries merge into the framework theme bundle
([framework.resources.mu](https://github.com/pragmatic-tech-ai/mural/blob/main/src/resources/framework.resources.mu)).

## 12. Theme / Scheme / ThemeManager

The token source the setters reference
([theme.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/visual-engine/theme/theme.ts)):

- **`Theme`** — a token *catalog* plus a set of `Scheme`s (e.g. Material
  with `light` / `dark`). The catalog is the contract every Scheme must
  satisfy; the compiler validates against it.
- **`Scheme`** — a frozen value dictionary satisfying those tokens
  (`@Primary = #…`, `@OnPrimary = #…`, …). `BasedOn` merges happen at
  registration so the in-memory Scheme is complete.
- **`ThemeManager`** — a fully-static class pairing the active Theme with
  the active Scheme, merging their resources onto `Application.Resources`,
  and owning **six inherited adaptive DPs**: `Density`, `Pointer`,
  `PrefersContrast`, `PrefersReducedMotion`, `PrefersColorScheme`, and the
  preferred scheme. Templates read them via triggers —
  `when (ThemeManager.Density = Compact) { … }`.

Because tokens are `@resource` references (DynamicResource-backed), a
scheme swap (`ThemeManager.ActivateScheme('dark')`) re-pushes every
dependent colour through the live bindings without rebuilding anything.

The upshot for cross-control consistency: the per-control type / colour
atoms are set through these theme Styles, so library-wide typography or
palette inconsistencies are fixed centrally in the theme's Styles rather
than control-by-control (see the type-scale audit,
[current-backlog.md § 18.13](https://github.com/pragmatic-tech-ai/mural/blob/main/current-backlog.md)).

## 13. Composing styles — `Style.Combine` / `@a + @b`

WPF allows exactly one `Style` per element. mural adds **composition**:
apply several styles at once, either programmatically or in markup.

```
// Markup — the `+` operator, lowered to Style.Combine:
TextBlock [ Style = @Heading + @Hypertext ]
```

```ts
// Programmatic:
element.Style = Style.Combine(heading, hypertext);
```

Both produce a [`CompositeStyle`](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/style.ts) — a `Style`
subclass that drops into the `Style` DP, the `StyleApplicator` diff-swap,
and the implicit / theme tiers unchanged; it only overrides the `Resolve*`
surface those collaborators call.

### Merge semantics

- **Rightmost wins on conflict.** In `@a + @b`, when both set the same
  property, `b` wins — read it as "start from `a`, layer `b` on top" (same
  direction as CSS class order and `BasedOn`).
- **Mixin, not a flat overlay.** Each component contributes only the
  setters it (or its *explicit* `BasedOn` chain) actually declares. Values
  a component merely inherited from the shared theme base are subtracted by
  instance identity before merging, and the theme base is applied once
  underneath. So:

  ```
  @Heading    sets FontSize = 32   (overriding the theme default 14)
  @Hypertext  sets Foreground, Underline   (never mentions FontSize)

  @Heading + @Hypertext  →  FontSize 32 + Foreground + Underline
  ```

  A naïve flat-map merge would let `@Hypertext`'s theme-inherited
  `FontSize=14` clobber `@Heading`'s explicit `32`; the mixin merge keeps
  `32`. This is the crux of "composition" meaning something useful.
- **Triggers (all five kinds) concatenate** — theme base first, then each
  component in order. The `StyleApplicator` installs through a `Set`, so a
  shared theme-base trigger surfacing through several components dedupes;
  later components' setters win at the Trigger tier.
- **TargetType** is the most-derived type shared by all components.
  Composing styles whose target types fork (e.g. `TextBlock` + `Border`)
  throws at `Seal`.

### Resolution timing

`Style.Combine` accepts each component as a `Style` **or** a thunk
`() => Style | undefined`. The markup `@key` form emits the local JS var
when the style is declared earlier in the *same* dictionary (eager), and
a deferred `() => Application.current?.Resources.Resolve(key)` thunk for a
cross-dictionary token — resolved at `Seal` (first apply), exactly the
deferral `BasedOn = @key` uses. A thunk that resolves to nothing (missing
key) is dropped, same as a dangling `BasedOn`.

> **Not a reactive binding.** Unlike a lone `Style = @TitleLarge` (which
> installs a `DynamicResource` binding), a composite resolves its
> components once at `Seal`. Style *objects* are stable instances, and the
> color/size tokens *inside* their setters are still `DynamicResource`, so
> theme swaps re-tint composed styles the same as any other — but swapping
> the dictionary *entry* for a composed key after first apply is not
> observed. Matches `BasedOn`'s resolve-once contract.

## 14. Limitations

User-visible gotchas.

- **Setter.value cloning vs sharing.** A bare `Binding` shared across
  multiple targets of the same style hits a callback-overwrite issue
  (last attached target wins). `SetterFactory` is the workaround; the
  framework doesn't auto-clone Bindings.
- **Implicit / theme style is reactive at the dictionary level.**
  Subscribes to the resource dicts the Visual found at `AttachLogical`;
  doesn't auto-subscribe to dicts that appear later on ancestors that
  hadn't allocated `Resources` yet. (Same limitation as
  [DynamicResource](resources.md#6-limitations).)
- **Trigger match is reference/`===` only.** No value-equality helpers or
  converters on a trigger *condition* (converters do work on a setter
  *value* via `Binding`). A fixed set of trigger-condition values should
  be an `enum` so the comparison is against a stable member.
- **No per-style namespace scoping for setter-resolved names.** Setter
  values don't go through a `FindName` lookup; they're literal values or
  factory-produced bindings. This is the main remaining gap vs WPF's
  `Style` namespace semantics.
- **`DefaultStyleKey` is opt-in.** A control that forgets the
  `OverrideMetadata` static block gets no theme Style — see
  [§10](#10-style-resolution-on-element).
</content>
</invoke>
