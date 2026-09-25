# Attached Properties — Design

Tracking item 5.1 in [current-backlog.md](current-backlog.md). Captures the design before implementation so the trade-offs are explicit.

## 0. The reframing

Initial sketches treated "attached property" as a separate concept with its own registry, its own value store, and its own access methods. Working through the design with the WPF parallel made it clear that this is the wrong split — it's an artifact of how XAML talks about it, not how the runtime needs to handle it.

WPF's trick: **every `DependencyProperty` is universally identifiable by `(ownerType, name)`, and any `DependencyObject` can hold a value for any DP**. The distinction between `Register` and `RegisterAttached` exists mostly for XAML readers and for some default-value semantics; the underlying storage and notification machinery is one set of mechanics.

The practical motivation in WPF is patterns like setting `TextBlock.FontSize="14"` on a `<Border>`: `FontSize` is registered on `TextBlock` (not on `Border` or any ancestor), but the Border holds the value and — because `FontSize` is `Inherits` — descendant `TextBlock`s pick it up via the tree walk. **We want the same.**

This design unifies the mechanics. Property identity is `(owner, name)`, stored under a composite key on every Model. Two access surfaces — implicit-owner (existing API, walks the target's class hierarchy) and explicit-owner (new overload). Both flow through the same EVD machinery.

## 1. Storage and identity

### 1.1 PropertyDescriptor gains an owner field

```ts
export class PropertyDescriptor {
    private name: string;
    private propertyClass: Function;          // NEW — the class that registered this property
    private own: PropertyMetadata;
    private parent_descriptor: PropertyDescriptor | undefined;

    constructor(owner: Function, name: string, own: PropertyMetadata, parent_descriptor?: PropertyDescriptor) {
        this.propertyClass = owner;
        this.name = name;
        // ...
    }

    public get Owner(): Function { return this.propertyClass; }
    public get Name(): string { return this.name; }
    // ... rest unchanged
}
```

The owner is the class that called `RegisterProperty`. For metadata overrides registered against a derived class via `OverrideMetadata`, the override descriptor's `Owner` is the derived class — its parent reference still points to the original. So `Owner` tracks where the metadata *lives*, while the property's *identity* is determined by walking the parent chain to the root descriptor.

For composite-key composition we use the **root descriptor's** owner (the class that first registered the property). A small helper:

```ts
public get RootOwner(): Function {
    return this.parent_descriptor?.RootOwner ?? this.propertyClass;
}
```

### 1.2 Composite storage key — uniform for every property

```ts
// In Model
private static compose_key(owner: Function, property: string): string {
    return `${owner.name}.${property}`;
}
```

Every value lives on `property_values: Map<string, EVD>` under `${descriptor.RootOwner.name}.${name}`. **Regular** properties and **attached** properties use the same composite key — the only difference is whether the caller specified the owner or let the implicit walk find it.

Collision risk: a regular property named `'Grid.Row'` would collide with attached `Grid.Row`. Mitigation: reject `.` in registration time. Cheap, documented.

### 1.3 One descriptor registry

```ts
private static property_bags: WeakMap<Function, Map<string, PropertyDescriptor>>;
```

Already exists. No second parallel registry. Lookup has two entry points:

```ts
// Implicit owner — walks the target's class hierarchy looking for the
// first ancestor that registered `property`. Used by the no-owner
// overloads of set/get/etc.
protected static find_descriptor(klass: Function, property: string): PropertyDescriptor | undefined;

// Explicit owner — walks the owner's chain (so subclass overrides win)
// looking for `property` in the owner's bag. Used by the explicit-owner
// overloads.
protected static find_descriptor_on(owner: Function, property: string): PropertyDescriptor | undefined;
```

Both walk via `Object.getPrototypeOf` over the registered bags; only the starting class differs.

## 2. API — two access surfaces

Each accessor gains a second overload that takes an explicit owner. Internally both forms resolve to the same `(descriptor, composite_key)` pair and dispatch through a shared helper.

```ts
// Single registration entry point. Pure synonym alias for clarity at
// declaration sites (see §4).
public static RegisterProperty(
    owner: Function,
    property: string,
    default_value: any,
    meta_data: MetaData,
    coerce_value?: CoerceValue,
): void;

// Implicit owner — current public API, unchanged behavior.
public set_property_value(property: string, value: any): void;
public get_property_value(property: string): any;
public ClearValue(property: string): void;
public GetValueSource(property: string): PropertyValueSource;
public AddPropertyChangedListener(property: string, callback: PropertyChangeCallback): void;
public RemovePropertyChangedListener(property: string, callback: PropertyChangeCallback): void;

// Explicit owner — for cross-class / "attached" usage.
public set_property_value(owner: Function, property: string, value: any): void;
public get_property_value(owner: Function, property: string): any;
public ClearValue(owner: Function, property: string): void;
public GetValueSource(owner: Function, property: string): PropertyValueSource;
public AddPropertyChangedListener(owner: Function, property: string, callback: PropertyChangeCallback): void;
public RemovePropertyChangedListener(owner: Function, property: string, callback: PropertyChangeCallback): void;
```

### 2.1 Shared core

```ts
private set_via_descriptor(descriptor: PropertyDescriptor, value: any): void {
    const key = Model.compose_key(descriptor.RootOwner, descriptor.Name);
    let evd = this.property_values.get(key);
    if (evd === undefined) {
        const coerce = descriptor.CoerceValue;
        if (coerce !== undefined) value = coerce(this, value);
        evd = this.new_effective_value(descriptor);
        this.property_values.set(key, evd);
    }
    evd.value = value;
}
```

Both `set_property_value` overloads boil down to "find the descriptor, call `set_via_descriptor`". Same shape for get/clear/source/listeners — one shared body, two entry points.

## 3. Usage examples

### 3.1 Regular case (no syntactic change)

```ts
class Box extends PanelBase {
    static { Model.RegisterProperty(Box, 'width', 0, MetaData.Measure | MetaData.Arrange); }
}

const b = new Box();
b.set_property_value('width', 100);   // implicit owner: walks Box's chain, finds Box.width
b.get_property_value('width');         // 100
```

### 3.2 Cross-class / attached case

```ts
class TextBlock extends Model {
    static {
        Model.RegisterProperty(TextBlock, 'fontSize', 12, MetaData.Inherits | MetaData.Measure);
        Model.RegisterProperty(TextBlock, 'foreground', 'black', MetaData.Inherits | MetaData.Render);
    }
}

class Border extends Single {
    // Border doesn't register fontSize or foreground; doesn't extend TextBlock.
}

const wrapper = new Border();
wrapper.set_property_value(TextBlock, 'fontSize', 14);   // explicit owner
wrapper.set_property_value(TextBlock, 'foreground', 'red');

// Inside the wrapper's subtree, every TextBlock sees fontSize=14, foreground='red'
// because both are Inherits-flagged. The values "live" on the Border but cascade
// down via the 1.5 inheritance machinery — which already works on composite keys.
```

### 3.3 WPF-style Grid.Row attached property

```ts
class Grid extends PanelBase {
    static {
        Model.RegisterAttachedProperty(Grid, 'Row',    0, MetaData.Arrange | MetaData.Measure);
        Model.RegisterAttachedProperty(Grid, 'Column', 0, MetaData.Arrange | MetaData.Measure);
    }

    // Static helpers (convention only):
    public static GetRow(target: Model): number { return target.get_property_value(Grid, 'Row') as number; }
    public static SetRow(target: Model, v: number): void { target.set_property_value(Grid, 'Row', v); }
}

const button = new Button();
Grid.SetRow(button, 2);
// Or directly:
button.set_property_value(Grid, 'Row', 2);
```

## 4. RegisterAttachedProperty — sugar synonym

Kept for readability at declaration sites — `RegisterAttachedProperty(Grid, 'Row', ...)` signals intent more clearly than `RegisterProperty(Grid, 'Row', ...)` when the property is meant for cross-class use. It's a pure alias:

```ts
public static RegisterAttachedProperty(
    owner: Function,
    property: string,
    default_value: any,
    meta_data: MetaData,
    coerce_value?: CoerceValue,
): void {
    Model.RegisterProperty(owner, property, default_value, meta_data, coerce_value);
}
```

No runtime distinction. Either function produces the same descriptor in the same bag.

## 5. What carries over for free from existing machinery

Because all values live in `property_values: Map<string, EVD>` under composite keys, and the EVD type already carries `property_descriptor`, everything below the lookup layer works without further change:

- **Bindings**: `target.set_property_value(Grid, 'Row', new Binding(source, 'row'))` installs a binding under the composite key. Push notifications fire on `'Grid.Row'`.
- **Per-instance listeners**: register via either form — listener fires when that specific `(owner, name)` value changes on this target.
- **ClearValue / GetValueSource**: same delegation, just with composite-key lookup.
- **Layout invalidation routing** (`OnPropertyChanged`): uses `EVD.property_descriptor.MetaData`, which is correct for any property regardless of owner.
- **Inheritance machinery from 1.5**: `walk_inherited`, `refresh_inherited`, `propagate_inheritance_for` already operate on opaque string keys. With composite keys, `wrapper.set_property_value(TextBlock, 'foreground', 'red')` puts a value under `'TextBlock.foreground'`; descendants' `walk_inherited('TextBlock.foreground')` finds it. Zero structural change.
- **Disposal**: when a target is GC'd, its `property_values` go with it. Composite keys add no leak risk.

## 6. The one subtlety in cascading

`collect_inheritable_properties(klass)` enumerates inheritable descriptors on the target's *own* class hierarchy. For cross-class inherited properties (like `TextBlock.foreground` set on a `Border`), the target's class doesn't know about `foreground`, so the helper skips it.

That's correct behavior for two reasons:

1. **Initiation** — when a `Border` is attached/detached, it shouldn't initiate cache fills for properties no ancestor in its class hierarchy declared. The implicit-owner walk wouldn't find them.
2. **Reception** — the descendant still receives cascade updates via `propagate_inheritance_for(composite_key)` — which is dispatched purely on the key, regardless of whether the receiving class "knows" the property. So when `border.set_property_value(TextBlock, 'foreground', 'red')` happens, the cascade reaches every descendant whose tree-walk would have found `'TextBlock.foreground'` set on the border.

The subtree refresh on Attach is symmetric — it walks **the target's own** inheritable properties because cross-class values stored on ancestors are reached by descendants via the cascade triggered when the ancestor was set, not via a periodic enumeration.

## 7. Implementation cost

### Phase 1 — refactor + unified API

- Add `owner` + `RootOwner` to `PropertyDescriptor`, plumb through `RegisterProperty` and `OverrideMetadata`.
- Add `compose_key(owner, property)` and `find_descriptor_on(owner, property)` to `Model`.
- Refactor `set_property_value` / `get_property_value` / `ClearValue` / `GetValueSource` / `Add+RemovePropertyChangedListener` into shared cores + thin overloads. Implicit-owner path looks the same to callers; explicit-owner is the new overload.
- Update `ensure_effective_value` and `new_effective_value` to operate on `(descriptor, key)` rather than name-only.
- Update `walk_inherited` / `refresh_inherited` / `propagate_inheritance_for` / `refresh_inheritance_subtree` to use composite keys (drop-in change — they already treat the key as opaque).
- Reject `.` in property names at registration time.
- Add `RegisterAttachedProperty` alias.

Roughly **120–150 lines** of production code. Existing 103 tests should keep passing because the implicit-owner path is unchanged.

### Phase 1 tests (new)

- `set_property_value(OtherClass, 'foo', x)` on an instance whose class doesn't extend OtherClass — works, stored under `'OtherClass.foo'`.
- Read back via `get_property_value(OtherClass, 'foo')` — returns the set value.
- Read via the implicit form `get_property_value('foo')` — throws (no `'foo'` in the target's hierarchy).
- Two different owners register a same-named property; setting one doesn't affect the other.
- `Inherits`-flagged cross-class property set on an ancestor cascades to descendants that *do* have the property registered on their own class.
- `Inherits`-flagged cross-class property set on an ancestor cascades to descendants regardless of whether those descendants' classes "know" the property (via the cascade key dispatch).
- Listener registered with explicit-owner overload fires only for that `(owner, name)` pair.
- `Binding` on a cross-class property pushes the resolved value through the descendant tree.
- Registering a property whose name contains `.` throws.

### Phase 2 — optional sugar

- `RegisterAttachedProperty` is in Phase 1 (it's a one-line alias).
- Factory helper for generating `GetXxx`/`SetXxx` static pairs.
- ~20 lines, ~3 tests if we do this. Not blocking.

## 8. Open questions deferred for later (not blocking)

Tracked in [current-backlog.md § 15](https://github.com/pragmatic-tech-ai/mural/blob/main/current-backlog.md):
- **`targetType` validation on attached properties** — § 15.1.
- **Bulk cross-class inheritance enumeration** — § 15.2.
- **`RemoveValue` vs `ClearValue`** — § 15.3.

## 9. Decisions captured

| Question | Decision |
|---|---|
| Storage layout | Composite key `${descriptor.RootOwner.name}.${name}` on the existing `property_values` map — uniform for every property. |
| Registry | Single `property_bags` registry. Lookup has two entry points (`find_descriptor` walks target hierarchy; `find_descriptor_on` walks owner hierarchy). |
| API shape | Each accessor gains a second overload that takes an explicit owner. The no-owner overload (existing public API) is unchanged. |
| `RegisterAttachedProperty` | Kept as a synonym alias for `RegisterProperty` — readability sugar at declaration sites, no runtime difference. |
| Descriptor-lookup refactor (option c in older revision) | Mandatory — descriptors must carry their owner so set methods can compose the composite key. |
| Inheritance for cross-class properties | Works out-of-the-box. The 1.5 cascade is key-based; composite keys flow through the existing walk/refresh/propagate machinery unchanged. |
| Listener identification | Both implicit-owner and explicit-owner forms supported via the same overload pattern. |
| Property name `.` collision | Rejected at registration time. |
