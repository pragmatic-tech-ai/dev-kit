# Property System

The foundation everything else builds on. Models own per-instance property
state with WPF-style dependency-property semantics: registered metadata,
default values, change notification, coercion, bindings, value priority,
read-only properties, attached/cross-class properties, and inheritance.

**Implemented in:**
- [runtime/model.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/model.ts) — `Model`, `PropertyKey`
- [runtime/property-descriptor.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/property-descriptor.ts) — `PropertyDescriptor`
- [runtime/effective-value.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/effective-value.ts) — `EffectiveValueDescriptor`, `PropertyValueSource`
- [runtime/metadata.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/metadata.ts) — `MetaData` flags
- [runtime/binding.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/binding.ts) — `Binding`, `BindingMode`, `ValueConverter`, `BindingOptions`

## 1. Models and properties

A `Model` is a property bag with change notification. You don't store values
as fields — you register them with `Model.RegisterProperty` and access them
through accessors. Subclasses register their properties in a `static {}`
initializer.

```ts
import { MetaData, Model } from '../runtime/index.js';

class Box extends Model {
    static {
        Model.RegisterProperty(Box, 'Width',  100, MetaData.None);
        Model.RegisterProperty(Box, 'Color', 'red', MetaData.None);
    }

    // Typed accessors that delegate to the property store.
    public get Width(): number { return this.get_property_value('Width'); }
    public set Width(value: number) { this.set_property_value('Width', value); }
    public get Color(): string { return this.get_property_value('Color'); }
    public set Color(value: string) { this.set_property_value('Color', value); }
}

const b = new Box();
b.Width        // 100   — falls through to the registered default
b.Width = 200; // fires change notification, listeners run
```

The typed accessors are optional but recommended — they're how every concrete
class in the library (`Brush`, `Pen`, `Border`, `TextBlock`, …) exposes its
properties to consumers. Without them, callers fall back to the raw
`get_property_value('Width')` / `set_property_value('Width', value)` form,
which always works.

### Registration options

```ts
Model.RegisterProperty(
    owner: Function,       // the class registering the property (typically `this` in a static block)
    property: string,      // the property name
    default_value: any,    // returned by get when no value has been set
    meta_data: MetaData,   // flag enum — affects Measure/Arrange/Render/Inherits routing
    coerce_value?: CoerceValue,        // optional value-normalization callback
    validate_value?: ValidateValue,    // optional boolean gate — rejected writes throw
): void
```

`ValidateValue` is a `(value) => boolean` predicate that runs BEFORE
storage and coerce on every write. A `false` result rejects the write
with no side effects — neither storage nor listeners fire. The default
value is checked against the rule at registration time; a default that
fails throws at registration. Bindings bypass the gate (installing a
Binding is not a value-in-the-domain write).

```ts
Model.RegisterProperty(Item, 'count', 0, MetaData.None,
    undefined,                  // no coerce
    (v) => typeof v === 'number' && v >= 0,  // reject negatives
);
```

`CoerceValue` runs on every effective-value recomputation — every read,
every binding push, every animation tick — and returns the normalized
value:

```ts
Model.RegisterProperty(Slider, 'Value', 0, MetaData.Render,
    (_model, v) => Math.max(0, Math.min(100, v))  // clamp to [0, 100]
);
```

Storage holds the raw write; coerce is applied on read. This means a
coerce callback that depends on sibling state re-evaluates automatically
when that sibling changes — no explicit `CoerceValue(dp)` call needed:

```ts
// Value clamps to whatever Ceiling currently is.
class Range extends Model {
    static CeilingKey = Model.RegisterProperty(Range, 'Ceiling', 100, MetaData.None);
    static ValueKey   = Model.RegisterProperty(Range, 'Value',   0,   MetaData.None,
        (m, v) => Math.min(v as number, (m as Range).get_property_value(Range.CeilingKey)));
}

const r = new Range();
r.set_property_value(Range.ValueKey,   80);  // reads as 80
r.set_property_value(Range.CeilingKey, 50);  // Value re-coerces → 50
r.set_property_value(Range.CeilingKey, 200); // raw 80 re-emerges
```

`GetValueSource` returns `CoercedValue` when a coerce callback is
registered AND its result differs from the underlying base. Otherwise
it returns the base source (`LocalValue`, `Binding`, etc.) — useful as
a diagnostic for "this isn't what you set".

### Default values

`get_property_value` returns the descriptor's `default_value` when no value
has been explicitly set on the instance. Defaults survive `ClearValue`, which
removes the local override and resets the effective value to the default.

## 2. Change notification

`AddPropertyChangedListener` subscribes to property changes per instance:

```ts
const b = new Box();
b.AddPropertyChangedListener('Width', (model, name, old, neu) => {
    console.log(`${name}: ${old} -> ${neu}`);
});
b.Width = 50;
// logs: "Width: 100 -> 50"
```

The callback receives `(model, propertyName, oldValue, newValue)`. Remove
with `RemovePropertyChangedListener(property, callback)` — the same callback
reference must be passed. Listeners fire after every effective-value change
regardless of source (direct set, binding push, `ClearValue`, etc.).

## 3. Value priority and GetValueSource

Each Model property tracks where its current value came from — the
`EffectiveValueDescriptor` resolves the highest-priority source per read.
The priority order (highest first):

```
CoercedValue     — base value transformed by a registered CoerceValue
                   callback (overlay, not a base slot — see §1)
AnimatedValue    — placeholder, no animation engine yet
Binding          — value from a Binding (see §5) OR a DynamicResource
LocalValue       — explicitly set via set_property_value
TriggerValue     — applied by an active PropertyTrigger (see styles.md)
StyleValue       — applied by a Style's Setter (see styles.md)
InheritedValue   — inherited from an ancestor's MetaData.Inherits property
SettingValue     — sourced from an application setting bound at registration
Default          — descriptor's default_value
```

The Trigger / Style tiers (between Local and Inherited) come from the
styling system. A locally-set value or an active Binding always
shadows a styled value; styled values shadow inherited values;
inherited shadows the setting value; the setting value shadows default.
See [styles.md](styles.md) for how Styles push values into the StyleValue
slot and how PropertyTriggers push into the TriggerValue slot.

The `SettingValue` tier lets a property draw its value from an
application setting (opt in with the `{ key, convert? }` registration
argument). The subscription that keeps it reactive is demand-driven — it
lives only while the property is observed — for the lifetime rationale
(and the rejected finalization alternative) see
[setting-backed-dp-subscriptions.md](setting-backed-dp-subscriptions.md).

Read the current source with `GetValueSource`:

```ts
import { PropertyValueSource } from '../runtime/index.js';

b.GetValueSource('Width');   // PropertyValueSource.Default
b.Width = 50;
b.GetValueSource('Width');   // PropertyValueSource.LocalValue
b.ClearValue('Width');
b.GetValueSource('Width');   // PropertyValueSource.Default again
```

## 4. Cross-class / attached properties

Any property registered on any class can be set on any Model instance. This
is the mechanism WPF calls "attached properties" — e.g., `Grid.Row="2"` on
a `<Button>`. There's no separate API surface; the same registration produces
both regular and attached access.

```ts
class Grid extends Panel {
    static {
        Model.RegisterAttachedProperty(Grid, 'Row',    0, MetaData.Arrange);
        Model.RegisterAttachedProperty(Grid, 'Column', 0, MetaData.Arrange);
    }
}

const button = new Button();
button.set_property_value(Grid, 'Row',    2);   // explicit-owner overload
button.set_property_value(Grid, 'Column', 1);

button.get_property_value(Grid, 'Row');         // 2
```

`RegisterAttachedProperty` is a synonym for `RegisterProperty` — the same
registration. Both produce identical behavior. The naming exists purely as
documentation at the call site.

Every accessor (`set_property_value`, `get_property_value`, `ClearValue`,
`GetValueSource`, `Add/RemovePropertyChangedListener`) has two overloads:

- **Implicit owner** — `set_property_value('Width', 100)` walks the target's
  class hierarchy to find the property.
- **Explicit owner** — `set_property_value(Grid, 'Row', 2)` uses the
  specified owner class directly.

Per-instance storage uses composite keys (`${RootOwner.name}.${name}`), so
two different classes can register a property with the same name without
collision.

## 5. Bindings

A `Binding` connects a target property to a source property via a path. The
runtime supports four modes:

```ts
import { Binding, BindingMode } from '../runtime/index.js';

// OneWay (default): source changes propagate to target
view.set_property_value('label',
    new Binding(model, 'user.name'));

// TwoWay: target changes write back to source
input.set_property_value('value',
    new Binding(model, 'count', BindingMode.TwoWay));

// OneTime: read once, never observe
view.set_property_value('initialValue',
    new Binding(model, 'startingPoint', BindingMode.OneTime));

// OneWayToSource: target writes propagate to source; source changes don't update target
log.set_property_value('latest',
    new Binding(model, 'lastTouched', BindingMode.OneWayToSource));
```

### Property paths

Paths traverse Model graphs with three syntactic shapes:

| Syntax | Meaning |
|---|---|
| `a.b.c` | Dotted access — `a.b.c` |
| `items[0]` | Indexed access — `items[0]` |
| `(Owner.Property)` | Attached-property access — uses the explicit-owner accessor with the named owner class |

These compose: `dept.manager.(Grid.Row)`, `items[2].label`,
`(Holder.List)[1]`.

The path attaches change listeners at each Model along the chain. When any
chain member's relevant property mutates, the path re-traverses from the
mutated segment forward and pushes the new terminal value through.

### Collection reactivity (INotifyCollectionChanged)

When a path traverses an `ObservableCollection<T>` or a plain `Array<T>`
at an index segment (`managers[2]`), the binding subscribes to that
collection's mutation channel. Operations that affect the value at the
bound index — `SetAt(2, …)`, `Insert(0, …)` (shifts our item right),
`RemoveAt(0)` (shifts left), `Clear()` — re-resolve the binding and push
the new terminal value through. Operations that don't affect the index
(e.g., `Add(item)` on a tail-only mutation) re-evaluate but emit no push
because the resolved value at index 2 is unchanged.

`ObservableCollection<T>` is the canonical reactive collection; plain
arrays get the same behavior via a Proxy wrapper minted on first read
(`observe_array(arr)` returns the same proxy on repeated calls). The
caveat for plain arrays: only mutations routed through the proxy
notify. The proxy is what the binding returns and what
`view.get_property_value(SomeKey)` resolves to when the property holds
the binding; mutating the underlying raw array directly bypasses the
trap and won't push. For guaranteed reactivity regardless of how the
collection is held, use `ObservableCollection<T>`.

#### Collection-as-leaf pulses

A binding whose path resolves to a collection itself
(`new Binding(holder, 'managers')`) emits a pulse on every mutation
even though the resolved collection's identity is unchanged. The pulse
fires through the same `PropertyChanged` channel that delivers normal
value transitions; consumers see `(coll, coll)` and read the current
contents through the resolved value. This mirrors WPF's
`INotifyCollectionChanged` channel surfaced through `INotifyPropertyChanged`.
`ItemsControl` and other collection consumers normally subscribe to
the collection directly rather than going through this pulse, but the
channel exists so a bound property can react to "items changed" without
extra plumbing.

### Binding pipeline

Optional `BindingOptions` apply transformations between source and target.
The pipeline (in order):

```
Convert  →  StringFormat  →  TargetNullValue  →  FallbackValue
```

```ts
new Binding(model, 'count', BindingMode.OneWay, {
    converter:       { convert: v => v * 2, convertBack: v => v / 2 },
    stringFormat:    'Count: {0}',     // "{0}" placeholder for the value
    targetNullValue: '(empty)',         // substituted when value is null
    fallbackValue:   '?',               // substituted when value is undefined (path unreachable)
});
```

- `Convert` runs source → target on every read and on push notifications.
- `StringFormat` wraps after convert; one-way only (TwoWay writeback bypasses).
- `TargetNullValue` substitutes when the resolved value is null.
- `FallbackValue` substitutes when the resolved value is undefined.

### validationRules — gating the binding

`BindingOptions.validationRules?: readonly ValidationRule[]` runs every
rule against the post-pipeline value on every push (source → target) and
on every TwoWay / OneWayToSource writeback (target → source). Failures
surface on the target via the `Validation.HasError` / `Validation.Errors`
attached properties; on writeback, the source write is blocked so the
source keeps its previous value.

```ts
import { Binding, BindingMode, Validation, type ValidationRule } from '@pragmatic-tech-ai/mural/runtime';

const notEmpty: ValidationRule = {
    validate(v) {
        return typeof v === 'string' && v.length > 0
            ? { isValid: true }
            : { isValid: false, errorContent: 'required' };
    },
};

target.set_property_value_by_name(
    'label',
    new Binding(src, 'title', BindingMode.TwoWay, { validationRules: [notEmpty] }),
);
Validation.GetHasError(target);  // false / true
Validation.GetErrors(target);    // readonly ValidationError[]
```

Multiple bindings on the same target aggregate their errors. Replacing
or clearing a binding drops its contribution. `PropertyTriggers` can
react to `Validation.HasError` against a target the same way they react
to any other DP.

### MultiBinding / PriorityBinding

`MultiBinding(bindings: Binding[], converter)` combines N child Bindings
through a converter — each child can have its own source, mode,
converter, and rules. The converter receives the children's resolved
values in array order. Converter exceptions surface as `undefined` so
the outer Binding's `fallbackValue` can apply.

```ts
import { MultiBinding, PriorityBinding, Binding } from '@pragmatic-tech-ai/mural/runtime';

target.set_property_value_by_name('sum',
    MultiBinding(
        [new Binding(a, 'x'), new Binding(b, 'y')],
        (x, y) => x + y,
    ));

// First child with a non-undefined value wins. Useful as a fallback
// chain — user-set title, then VM title, then a resource lookup.
target.set_property_value_by_name('title',
    PriorityBinding([
        new Binding(userPrefs, 'title'),
        new Binding(vm,        'title'),
        new Binding(resources, 'defaultTitle'),
    ]));
```

The existing 3-arg `MultiBinding(target: Visual, paths: string[], converter)`
form (used by the inline-expression compiler) is still available as an
overload — same export, different signature.

### AncestorBinding — RelativeSource FindAncestor

`AncestorBinding(start, ancestorType, property, level=1)` walks
`start.GetVisualParent()` chain looking for the `level`-th ancestor that
is an instance of `ancestorType`, then binds to one of its properties.
Useful inside templates that need to reach the outer `ListBox`,
`ItemsControl`, or similar.

```ts
import { AncestorBinding } from '@pragmatic-tech-ai/mural/runtime';

container.set_property_value_by_name(
    'IsSelected',
    AncestorBinding(container, ListBox, 'SelectedItem'),
);
```

`Self` is expressible directly as `new Binding(self, 'Prop')`;
`TemplatedParent` uses the existing `TemplateBinding(templatedParent,
property)` factory. Ancestor resolution is captured at construction
time — re-parenting the start Visual does not trigger a re-resolve.

### Disposing bindings

`Binding.dispose()` removes every listener the path registered along the
chain. The framework disposes bindings automatically when one is replaced
by another value, but explicit disposal is the contract if you hold a
binding outside the framework.

### Binding sources — DataContextBinding vs ElementNameBinding

Two factories ship for path-style bindings; both produce a `Binding`
the EVD knows how to install. The difference is what they bind
**against**:

| Factory | Source | Reactive on | Mirrors WPF |
|---|---|---|---|
| `DataContextBinding(target, path)` | The target's `DataContext`. Re-resolves whenever DataContext changes — inheritance carries this from ancestors. | `target.DataContext` changes + each Model in the path. | `{Binding Path=…}` (default Source) |
| `ElementNameBinding(source, path)` | A FIXED Visual passed in at construction. | Each Model in the path on that Visual. No DataContext listener. | `{Binding ElementName=foo, Path=…}` |

```ts
import { DataContextBinding, ElementNameBinding } from '@pragmatic-tech-ai/mural/runtime';

// Track the active VM's Title — source resolves through DataContext
// inheritance; rebinds if DataContext is later reassigned.
border.set_property_value(Border.BackgroundKey,
    DataContextBinding(border, 'Active.Title'));

// Mirror chrome's Background onto text.Foreground — fixed source.
text.set_property_value(TextBlock.ForegroundKey,
    ElementNameBinding(chrome, 'Background'));
```

#### ElementName from markup

Inside a template body, the compiler tracks every `x:name` and lowers
`$head.Property` to `ElementNameBinding(<that element's var>,
'Property')` when `head` matches an `x:name` declared earlier in the
same template scope. No new syntax — the same `$path` form switches
sources based on whether the head is a Visual in scope or a
DataContext property.

```mu
DataTemplate [DataType=ButtonVM] {
    Border x:name="chrome" [Background=#ffffff] {
        TextBlock [Foreground=$chrome.Background]   // ElementName binding
        TextBlock [Text=$Label]                      // DataContext binding
    }
}
```

In that template:

- `$chrome.Background` → `ElementNameBinding(chrome, 'Background')` —
  `chrome` is an x:name in scope, so the binding source is that Border.
  TwoWay-capable when the target DP declares `BindsTwoWayByDefault`.
- `$Label` → `DataContextBinding(textBlock, 'Label')` — `Label` is not
  an x:name, so it falls through to the DataContext (the per-template
  ButtonVM).

Disambiguation rule when an x:name shadows a DataContext path: the
x:name wins. The author can either rename the x:name or write a
template-binding sigil (`$$Property` against the templated parent's
property) to access the DataContext explicitly.

A bare `$head` with no trailing `.Property` is a compile error — the
binding has no path to walk, and silently binding to "the element
itself" would be surprising. Use `$head.Property`.

The ElementName resolution only applies INSIDE a template body
(ControlTemplate or DataTemplate). At application-root scope, `$path`
always addresses the DataContext.

## 6. Read-only properties

`RegisterReadOnlyProperty` returns a `PropertyKey` token. External code can
read the property (and bind to it) but only the holder of the key can write
or clear it.

```ts
class Stopwatch extends Model {
    private static readonly ElapsedKey =
        Model.RegisterReadOnlyProperty(Stopwatch, 'Elapsed', 0, MetaData.None);

    public get Elapsed(): number { return this.get_property_value('Elapsed'); }

    public tick(): void {
        // Internal write — uses the privileged setter with the key.
        this.set_property_value_with_key(Stopwatch.ElapsedKey, this.Elapsed + 1);
    }
}

const s = new Stopwatch();
s.Elapsed = 5;   // throws — "Elapsed is read-only"
s.tick();        // OK — Stopwatch holds the key
```

`ClearValueWithKey(key)` is the privileged equivalent of `ClearValue`.
Listeners and bindings on read-only properties work normally.

## 7. Metadata overrides

A subclass can override the metadata of a property registered on an ancestor.
`OverrideMetadata` chains a per-class descriptor whose `parent` references
the inherited one — unspecified fields fall through to the parent.

```ts
class StackPanel extends Panel { }
Model.OverrideMetadata(StackPanel, 'Orientation', {
    default_value: Orientation.Vertical,
});
// StackPanel.Orientation now defaults to Vertical, even though
// Panel.Orientation defaulted to Horizontal. MetaData flags
// and coerce callback fall through unchanged.
```

The descriptor chain preserves identity: the same property registered on the
root class is referred to by the same composite key (`${RootOwner.name}.${name}`)
across overrides, so per-instance storage and listener subscriptions stay
unified.

## 8. The MetaData flag enum

`MetaData` is a flag enum (powers of two). Combine with `|`:

```ts
MetaData.None                                  // 0
MetaData.Measure                               // affects Visual layout's measure pass
MetaData.Arrange                               // affects Visual layout's arrange pass
MetaData.Render                                // affects Visual rendering
MetaData.Inherits                              // value cascades through the visual tree
MetaData.BindsTwoWayByDefault                  // bindings default to TwoWay on this DP
MetaData.IsNotDataBindable                     // Binding installs throw — structural DPs only
MetaData.IsAnimationProhibited                 // SetAnimatedValue throws — identity / collection DPs
MetaData.Measure | MetaData.Render             // combine with bitwise OR
```

`IsNotDataBindable` and `IsAnimationProhibited` are author-intent
contracts. The runtime throws at the binding install / animation write
site so a mistake fails clearly instead of producing weird downstream
behavior. `Visual.DataContext`, `ItemsControl.Items`, and
`ItemsControl.ItemsSource` ship with `IsAnimationProhibited` — animating
a DataContext or a collection reference is nonsensical.

On plain `Model`, the flags are advisory — `Model.OnPropertyChanged` is a
no-op. `Visual` overrides `OnPropertyChanged` to dispatch:

- `Measure` → `InvalidateMeasure()` → notify host
- `Arrange` → `InvalidateArrange()`
- `Render` → `InvalidateVisual()`
- `Inherits` → propagate the new value to descendants

Use the right flag per property. A render-only attribute (color, fill) uses
`MetaData.Render`. A layout-affecting attribute (font size, padding) uses
`MetaData.Measure`. A pure data property without visual effect uses
`MetaData.None`.

## 9. Property value inheritance

Properties flagged `MetaData.Inherits` cascade down the visual tree. A child
that hasn't explicitly set the value reads it from the nearest ancestor
that has.

```ts
class TextBlock extends Visual {
    static {
        Model.RegisterProperty(TextBlock, 'FontSize', 14,
            MetaData.Measure | MetaData.Inherits);
    }
}

const child  = new TextBlock();
const parent = new Border(child);
parent.set_property_value(TextBlock, 'FontSize', 24);
//  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//  Border doesn't know about TextBlock.FontSize, but the explicit-owner
//  overload + cross-class storage means the value still lives on Border.
//  Inheritance walks up from child, finds it, and caches as InheritedValue.

child.FontSize;                              // 24
child.GetValueSource('FontSize');            // PropertyValueSource.InheritedValue
```

Inheritance is push-based: when an ancestor's inheritable value changes, the
framework walks descendants and refreshes their cached inherited values.
Local overrides on a descendant act as cascade boundaries — `SetInheritedValue`
returns early when a higher-priority source already owns the slot.

The cached `InheritedValue` source means reads are O(1); the cascade only
runs when ancestor values change or when subtrees are attached / detached.

## 10. Useful patterns

**Define a Model with a property — minimum boilerplate:**
```ts
class Counter extends Model {
    static { Model.RegisterProperty(Counter, 'Count', 0, MetaData.None); }
    public get Count(): number { return this.get_property_value('Count'); }
    public set Count(v: number) { this.set_property_value('Count', v); }
}
```

**Observe a property:**
```ts
counter.AddPropertyChangedListener('Count', (_m, _p, old, neu) => render());
```

**Bind a property to a source:**
```ts
display.set_property_value('text', new Binding(counter, 'Count'));
```

**Bind with a converter:**
```ts
display.set_property_value('text', new Binding(counter, 'Count', BindingMode.OneWay, {
    converter: { convert: n => `${n} clicks` }
}));
```

**Reset a property to its default:**
```ts
b.ClearValue('Width');
```

**Detect whether the value is the default:**
```ts
if (b.GetValueSource('Width') === PropertyValueSource.Default) {
    // no explicit set
}
```
