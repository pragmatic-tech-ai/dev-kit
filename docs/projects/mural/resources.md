# Resources

String- or class-keyed dictionaries attached to `Visual`s that store shared
values (brushes, templates, numbers, …) and feed `DynamicResource` reactive
references. Mirrors WPF's `ResourceDictionary` + `FindResource` +
`DynamicResource`, scaled to what we need without XAML.

**Implemented in:**
- [runtime/resource-dictionary.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/resource-dictionary.ts) —
  `ResourceDictionary`, `ResourceKey`, `ResourceChangeListener`
- [runtime/dynamic-resource.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/dynamic-resource.ts) —
  `DynamicResource(host, key)`
- [runtime/visual.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/visual.ts) — `Visual.Resources`,
  `TryFindResource`, `FindResource`

See also: [styles.md](styles.md) for how `Style` uses
`Resources` and how implicit-style lookup works,
[templating.md](templating.md) for how template-internal Visuals fall back
through `TemplatedParent` when resolving resources.

## 1. The dictionary

`ResourceDictionary` is a typed wrapper around `Map<ResourceKey, unknown>`
where `ResourceKey = string | Function`. Strings cover the usual
`"AccentBrush"` case; functions (class constructors) cover implicit-style
lookup — the same dictionary holds both.

```ts
import { ResourceDictionary } from '../runtime/index.js';

const dict = new ResourceDictionary();
dict.Set('AccentBrush', new SolidColorBrush(Color.FromHex('#1e40af')));
dict.Set('CornerRadius', 8);
dict.Get('AccentBrush');     // SolidColorBrush
dict.Has('CornerRadius');    // true
dict.Delete('Missing');      // false
dict.Size;                   // 2
```

`Resolve(key)` and `CanResolve(key)` go through merged dictionaries too —
use them in preference to `Get` / `Has` when you want composite lookup.
`Get` is "local entries only".

## 2. Composing dictionaries

```ts
const theme = new ResourceDictionary();
theme.Set('AccentBrush', new SolidColorBrush(Color.FromHex('#1e40af')));
theme.Set('Surface',     new SolidColorBrush(Color.White));

const overrides = new ResourceDictionary();
overrides.Set('AccentBrush', new SolidColorBrush(Color.FromHex('#15803d')));

const app = new ResourceDictionary();
app.AddMergedDictionary(theme);
app.AddMergedDictionary(overrides);

app.Resolve('AccentBrush');   // GREEN — overrides wins (last-merged precedence)
app.Resolve('Surface');       // WHITE — from theme, not overridden

// Set a local entry — shadows both merged dictionaries.
app.Set('AccentBrush', new SolidColorBrush(Color.FromHex('#9333ea')));
app.Resolve('AccentBrush');   // PURPLE — local beats both merged
```

**Lookup order**: local entries first; then `MergedDictionaries` walked
last-to-first (most recently merged wins on conflict). Nested merges
resolve transitively — a merged dictionary's own merged dictionaries are
visible too.

**Cycle protection**: `AddMergedDictionary` throws if the addition would
create a cycle (direct self-merge or transitive). Mural keeps this strict
because resolution would otherwise stack-overflow.

```ts
const a = new ResourceDictionary();
const b = new ResourceDictionary();
a.AddMergedDictionary(b);
b.AddMergedDictionary(a);   // throws: would create a cycle
```

## 3. Change notifications

`Subscribe(listener)` fires for any mutation that could affect resolutions
through this dictionary — local `Set` / `Delete` / `Clear`, merged
dictionary added / removed, OR any change inside a merged dictionary
(forwarded transitively). Coarse-grained on purpose: consumers re-resolve
the specific keys they care about.

```ts
const unsubscribe = app.Subscribe(() => {
    // re-resolve and refresh UI
});

app.Set('AccentBrush', somethingNew);    // listener fires
theme.Set('Surface', somethingElse);     // listener fires (forwarded via merged)
app.AddMergedDictionary(newTheme);       // listener fires (structure change)

unsubscribe();                            // stop hearing about it
```

## 4. Per-Visual Resources

Every `Visual` has a lazy `Resources: ResourceDictionary`. Touching the
getter allocates one on first access; reads through `TryFindResource`
don't allocate at each tree-walk step (they peek the backing field
directly).

```ts
const root = new MyPanel();
root.Resources.Set('AccentBrush', new SolidColorBrush(Color.FromHex('#1e40af')));

const leaf = new SomeVisual();
root.AddChild(leaf);

leaf.TryFindResource('AccentBrush');  // → the blue brush
leaf.FindResource('Missing');         // throws — use Try for optional lookups
```

### Lookup walk

`Visual.TryFindResource(key)` walks logical ancestors. At each ancestor:
1. If the ancestor has an active `Style` whose `Resources.CanResolve(key)`
   is true → return from there. (Style.Resources have first priority.)
2. Else if the ancestor's own `Resources.CanResolve(key)` is true → return.
3. Else step to `logicalParent ?? templatedParent`.

The `templatedParent` fallback is what lets template-internal Visuals find
resources defined on the templated control (or on its surrounding tree).
Same fallback used by inheritance and `FindName`.

## 5. DynamicResource — reactive resource references

Wraps `Resources` lookup in a `Binding`-shaped value that pushes the
current resolved value into a property and updates when the dictionary
changes.

```ts
import { DynamicResource } from '../runtime/index.js';

border.set_property_value('Background', DynamicResource(border, 'AccentBrush'));

// Now changing the dictionary updates the border:
root.Resources.Set('AccentBrush', new SolidColorBrush(Color.Red));
// border.Background reactively becomes red
```

Implementation: `DynamicResource` is a `Binding` subclass with an internal
`ResourceWatcher` model. The watcher subscribes to every `Resources` dict
along the host's logical ancestor chain at construction; when any fires
a change, the watcher re-resolves and pushes the new value through the
binding. Plays cleanly with EVD priority — `Binding` sits above `Local`,
so a `DynamicResource` reference shadows any local value.

### Disposing

Replacing the value on the property (with any other value, including a
plain literal) calls `Binding.dispose()` on the old `DynamicResource`,
which tears down all its dictionary subscriptions. `ClearValue` on the
property does the same.

## 6. Limitations

Roadmap items (`DynamicResource` re-wiring, `MergedDictionaries.Source`,
coarse-grained notifications, keyed sealing) are tracked in
[current-backlog.md § 12](https://github.com/pragmatic-tech-ai/mural/blob/main/current-backlog.md).

- **Markup is `.mu`, not XAML.** Resources can be authored declaratively
  in `.mu`'s `resources:` slot or imperatively via `Set(...)` calls.
  No XAML parser.
- **`Resources` getter allocates on first read.** Reading `v.Resources`
  just to inspect (without intent to write) wastes an empty dictionary
  allocation. `TryFindResource` / `FindResource` avoid this by reading
  the backing field directly. Consumers checking "does this Visual have
  any resources?" should use a separate marker — there's no public
  `HasResources` on Visual yet.
</content>
