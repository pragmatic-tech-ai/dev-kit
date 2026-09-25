# Services & Dependency Injection

Mural ships a small, explicit dependency-injection container plus a markup
surface for composing and consuming services. It is the mural analogue of
.NET's `IServiceProvider` / `IServiceCollection` and Angular's hierarchical
injectors: register implementations against tokens, resolve them by token,
scope them to a subtree, and — because a service IS a bindable `Model` — bind
view content straight to a service's properties.

There is **no reflection, no decorators, no auto-wiring**. TypeScript has no
runtime type metadata, so a service resolves its own collaborators explicitly
from the provider it's handed. This keeps wiring greppable and keeps the
[no-string-type-proxies rule](mural-language-design.md) intact — tokens are
real objects, never strings.

**Implemented in:**
- [runtime/services/service-provider.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/services/service-provider.ts) —
  `ServiceProvider`, `IServiceProvider`, `IServiceContainer`, `ServiceKey`,
  token / factory / lifetime types.
- [runtime/services/service-base.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/services/service-base.ts) —
  `ServiceBase` (a service that is also a bindable `Model`).
- [runtime/binding/element-name-binding.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/binding/element-name-binding.ts) —
  `ServiceBinding`, the `$service(Token)` consumption binding.
- [visual-engine/element.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/visual-engine/element.ts) — the inherited
  `ServiceScope` DP that publishes a provider down a subtree.
- [compiler/compiler.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/compiler/compiler.ts) — `compileServicesBlock`
  (the `.services:` markup), `compileMemberBlock` (the general `.Member:`
  block), and the `$service(...)` binding emit.
- [framework/shell/shell.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/framework/shell/shell.ts) — the application
  shell that owns a per-instance scope and publishes it as `ServiceScope`.

See also: [property-system.md](property-system.md) for the DP/binding system
services build on, [mural-language-design.md](mural-language-design.md) for the
`.mu` DSL, [resources.md](resources.md) for the `ResourceDictionary` the
`.Member:` dictionary form mirrors. The design log lives in
[backlog § 24](https://github.com/pragmatic-tech-ai/mural/blob/main/current-backlog.md).

---

## 1. The container — `ServiceProvider`

`ServiceProvider` is the DI container. It implements two orthogonal contracts:

- **`IServiceProvider`** — the resolve surface: `get`, `getRequired`, `has`.
- **`IServiceContainer`** — the compose + lifecycle surface: `register*`,
  `addInstance`, `createScope`, `dispose`.

The same object does both, but a collaborator can ask for only the half it
needs:

```ts
import { ServiceProvider, type IServiceProvider, type IServiceContainer }
    from '@pragmatic-tech-ai/mural/runtime';

const provider = new ServiceProvider();
const compose: IServiceContainer = provider;   // can register, can't resolve through this view
const resolve: IServiceProvider  = provider;    // can resolve, can't register through this view
```

### Tokens

A **token** is the identity a service is registered and resolved under. Two
forms, both real object identities (never strings):

```ts
// 1. A typed key — for interface-shaped contracts with no runtime class.
import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime';
const ClockKey = new ServiceKey<Clock>('Clock');   // the generic threads the type through

// 2. A class reference — the class is both key and resolved type.
class Counter { tick() { /* … */ } }
// `Counter` is itself a valid token.
```

`ServiceProvider.tokenFor(ctor)` is the shared rule that maps a class to its
canonical token: the class's static `Key` if it has one, else the class
itself. Markup registration, `addInstance`, and `$service` consumption all run
through `tokenFor` so they always agree on the token.

### Lifetimes

Three lifetimes, mirroring the .NET vocabulary:

| Lifetime | Instances | Cached where |
|---|---|---|
| `singleton` (default) | one, shared | at the provider where it was **registered** — shared by that provider and every scope beneath it |
| `scoped` | one per resolving scope | at each scope in the parent/child chain |
| `transient` | a fresh one every resolve | never cached |

### Registration (the `IServiceContainer` surface)

All registration methods return the container for chaining.

```ts
provider
    .register(ClockKey, (p) => new SystemClock(), 'singleton') // factory + lifetime
    .registerInstance(ClockKey, new SystemClock())             // eager, pre-built instance
    .registerScoped(DocKey, (p) => new Document(p))            // one per scope
    .registerTransient(IdKey, (p) => new Id());                // fresh per resolve

// addInstance derives the token from the instance's constructor (its static
// `Key` ?? the class) — equivalent to registerInstance(tokenFor(x.ctor), x).
provider.addInstance(new SystemClock());
```

A factory receives the resolving `ServiceProvider`, so it composes
dependencies explicitly:

```ts
provider.register(DocKey, (p) => new Document(p.getRequired(ClockKey)));
```

### Resolution (the `IServiceProvider` surface)

```ts
const clock  = provider.get(ClockKey);          // T | undefined
const clock2 = provider.getRequired(ClockKey);  // T, throws if unregistered
const ok     = provider.has(ClockKey);          // boolean (walks the parent chain)
```

`get` returns `undefined` for an optional miss; `getRequired` throws — use it
for required dependencies where a missing registration is a composition bug,
not an optional absence.

### Scopes — hierarchical injectors

`createScope()` returns a child provider. A child resolves **locally first,
then falls back to the parent**, may **shadow** a parent's registration
(Angular-style), and owns its own `scoped` instances:

```ts
const root  = new ServiceProvider();
root.registerInstance(ClockKey, sharedClock);     // singleton at root
root.registerScoped(SelectionKey, (p) => new Selection());

const scopeA = root.createScope();
const scopeB = root.createScope();

scopeA.get(ClockKey) === scopeB.get(ClockKey);    // true — shared root singleton
scopeA.get(SelectionKey) !== scopeB.get(SelectionKey); // true — one Selection per scope
```

`dispose()` tears down a scope: it calls `Dispose()` on every instance **that
scope owns** (its own cache — scoped services plus singletons registered
there), then clears the cache. It does not touch the parent chain or child
scopes — dispose the scope you created. The check is structural (anything with
a `Dispose()` method), so the container stays decoupled from `ServiceBase`.

### `Application.Services` — the root provider

Every `Application` exposes a lazy root `ServiceProvider` at `Services`. This
is the composition root for app-wide services:

```ts
import { Application } from '@pragmatic-tech-ai/mural/runtime';
Application.current.Services.registerInstance(StorageKey, localStorageAdapter);
```

---

## 2. `ServiceBase` — a service that is also a view-model

A plain service can be any object. But most app services hold state the view
should observe — a selection, a status message, a list of destinations.
`ServiceBase` makes a service a bindable `Model`, so view content can bind
directly to its DPs.

```ts
export abstract class ServiceBase extends Model
{
    protected readonly Provider: IServiceProvider;
    constructor(provider: IServiceProvider) { super(); this.Provider = provider; }
    public Dispose(): void { }   // override to release subscriptions / timers
}
```

Two contracts every `ServiceBase` follows:

1. **The constructor takes an `IServiceProvider`** and forwards it via
   `super(provider)`. This uniform ctor shape is what lets the container —
   and the `.services:` markup — construct any service as `new Impl(provider)`.
   The service resolves its own collaborators from `this.Provider`.
2. **A static `Key`** (TypeScript can't express a `static abstract`):

```ts
import { Model, MetaData, ServiceBase, ServiceKey, type IServiceProvider }
    from '@pragmatic-tech-ai/mural/runtime';

export class StatusService extends ServiceBase
{
    public static readonly Key = new ServiceKey<StatusService>('StatusService');

    public static readonly TextKey = Model.RegisterProperty<string>(
        StatusService, 'Text', '', MetaData.None);
    public get Text(): string  { return this.get_property_value(StatusService.TextKey); }
    public set Text(v: string) { this.set_property_value(StatusService.TextKey, v); }

    // No explicit ctor needed — inherits ServiceBase(provider). Add one only
    // to do construction work, and forward the provider:
    //   constructor(p: IServiceProvider) { super(p); /* … */ }
}
```

Because a subclass **inherits the base's static `Key`**, `tokenFor(SubImpl)`
resolves to the base token — so registering `class MyStatus extends
StatusService` shadows the `StatusService.Key` registration. This is how an
app supplies a richer implementation against a framework-defined service token.

**Lifecycle.** A per-scope `dispose()` calls `Dispose()` on every `ServiceBase`
that scope owns, so a per-shell scope tears its services down with the shell.

---

## 3. Composing services in markup — `.services:`

The `.services:` block is the DI container's markup surface. It registers
implementations into the surrounding scope's `Services` provider.

```mu
Application {
    .services: {
        StatusService                      // bare → singleton
        scoped NavigationService           // lifetime keyword
        transient RequestId
        StorageBackend -> IStorage         // register under a different token
    }
    resources: { … }
}
```

### Grammar

```
.services: { entry* }
entry := [lifetime] Impl [ { config } ] [ -> Token ]
lifetime := singleton | scoped | transient        // absent ⇒ singleton
```

- **`Impl`** — the implementation class (imported, or in the symbol table).
- **`lifetime`** — `singleton` (default), `scoped`, or `transient`.
- **`-> Token`** — register `Impl` under a token *different* from itself
  (absent ⇒ the token derived from `Impl` via `tokenFor`). Use it to register
  a concrete class against an interface-shaped key.

Every entry lowers to a **lazy** factory `(p) => new Impl(p)`. Registration is
deferred to first resolve, so a service may depend on a later sibling in the
same block without an ordering hazard. There is **no constructor-dependency
list** — a service receives the provider and resolves its own dependencies.
The old `Impl(Dep, …)` form is a pointed parse error.

```mu
// Lowers to (illustrative):
//   app.Services.register(ServiceProvider.tokenFor(StatusService),
//                         (p) => new StatusService(p), 'singleton');
//   app.Services.registerScoped(ServiceProvider.tokenFor(NavigationService),
//                               (p) => new NavigationService(p));
//   app.Services.register(ServiceProvider.tokenFor(IStorage),
//                         (p) => new StorageBackend(p), 'singleton');
```

### Where `.services:` can appear

- **`Application { .services: { … } }`** → registers into
  `Application.current.Services` (the app root).
- **On any element that exposes a `Services` provider** → registers into that
  element's scope. The application shell is the built-in example — see § 6.

### Inline config — seeding and property injection

An optional `{ prop: value }` block seeds the freshly-constructed instance,
each assignment going through the service's JS setter:

```mu
.services: {
    // Seed a literal — non-default state without writing a subclass.
    StatusService { Text: "Ready" }

    // Inject a collaborator — $service(Token) is resolved EAGERLY from the
    // factory's provider (explicit property injection).
    EditorService { Clock: $service(IClock) }

    // Compose with lifetime + token:
    scoped SearchService { MaxResults: 50 } -> ISearch
}
```

A config value is either:
- a **literal** (string, number, colour, tuple, …) — seeds the DP, or
- **`$service(Token)`** — resolved once at construction (`p.getRequired(...)`),
  the only coherent form of property injection given mural has no reflection.
  A dotted tail (`$service(IDoc).Title`) reads a property off the resolved
  service eagerly.

Config values are **not** reactive — they are wired once at construction.
DataContext `$path`, `@resource`, and `$Self` values are rejected: there is no
target visual at service-construction time.

```mu
// StatusService { Text: "Ready" } lowers to a constructing factory:
//   (p) => { const _s = new StatusService(p); _s.Text = "Ready"; return _s; }
```

---

## 4. Consuming services in markup — `$service(Token)`

`$service(Token).path` binds a property to a service resolved from the ambient
scope. It's the dual of `.services:` — registration writes, `$service` reads.

```mu
// Bind a control property to a service DP — reactive on the service's DP.
TextBlock [Text=$service(StatusService).Text]

// No path → the service object itself (e.g. as a DataContext).
PageView [DataContext=$service(NavigationService)]

// TwoWay works when the target DP is BindsTwoWayByDefault (selection, etc.):
ListBox [ItemsSource=$service(NavigationService).Items,
         SelectedItem=$service(NavigationService).SelectedItem]
```

### How it resolves

`$service` emits a `ServiceBinding(target, tokenFor(Token), "path")`. The
binding resolves the provider from the target's inherited **`ServiceScope`**
DP — the nearest ancestor that published a provider — and falls back to
`Application.current.Services` when no scope is in the tree. So:

- A `$service` outside any published scope resolves against the app root.
- A `$service` inside a shell (which publishes its scope, § 6) resolves the
  **shell-scoped** instance.

Three robustness properties:

- **Forward-ref / install-before-parent.** A binding materialised before its
  host is parented (so `ServiceScope` hasn't inherited yet) resolves to
  `undefined` and retries on the next microtask, landing on the scoped
  instance once the scope inherits in.
- **Scope reactivity.** The binding watches `ServiceScope` and re-resolves if
  the subtree is later re-parented under a different provider — it isn't
  pinned to the scope it first resolved.
- **Source-authoritative initial sync (TwoWay).** On initial resolution the
  source wins (WPF "source wins on load"): a value the target control buffered
  during the forward-ref window — typically its transient default (a list's
  `undefined` selection, a rail's `-1` sentinel) — is discarded in favour of
  the service's value, rather than clobbering it. (Only when the source has no
  value of its own does the buffered target write fill in.)

---

## 5. The general `.Member: { … }` block

`.services:` is a *named* case of a general mechanism: `.Member: { … }` fills a
complex aggregate property of the surrounding element. It chooses one of two
strategies by the body's shape.

### List strategy — `.Add(child)`

Bare elements (no `x:key`) append to `target.<Member>` (an
`ObservableCollection` DP). Reproduces the bespoke `ColumnDefinitions { … }`
lowering through one general syntax:

```mu
Grid {
    .ColumnDefinitions: {
        ColumnDefinition [Width=GridLength.Auto]
        ColumnDefinition [Width=GridLength.Star]
    }
}
// → grid.ColumnDefinitions.Add(new ColumnDefinition()); (×2)
```

### Dictionary strategy — `.Set(key, value)`

Keyed entries — `@Key = value`, or an element/resource carrying `x:key="K"` —
set into `target.<Member>` via `.Set(key, value)` (the `ResourceDictionary`
shape, the same keyed surface `resources:` uses):

```mu
Palette {
    .Swatches: {
        @Primary  = #6750A4
        @Surface  = #FFFBFE
        Border x:key="Card" [Background=#fff]
    }
}
// → palette.Swatches.Set("Primary", …); palette.Swatches.Set("Card", …); …
```

A body becomes a dictionary as soon as **one** entry is keyed, and then every
entry must be keyed (mixing keyed and unkeyed is a compile error). The target
member must be a dictionary-shaped object exposing `.Set(key, value)`.

> The bigger ambition — folding `resources:` itself onto `.Member:` — is
> tracked in [backlog § 25](https://github.com/pragmatic-tech-ai/mural/blob/main/current-backlog.md); for now the generic
> dictionary `.Member:` and the bespoke `resources:` block coexist.

---

## 6. Shell integration

The application shell ([framework/shell/shell.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/framework/shell/shell.ts))
is the primary place `.services:` and `$service` meet a scope that isn't the
app root:

- The shell owns a **per-instance child scope** (`shell.Services`, a child of
  `Application.current.Services`).
- Creating that scope **publishes it as the inherited `ServiceScope`** DP, so
  every `$service(...)` in the shell's regions resolves the shell-scoped
  instance — and a sibling shell gets its own.
- A `.services: { … }` block authored on a shell element registers into
  `shell.Services` (because the element exposes a `Services` provider), not the
  app root. So a status service registered on the shell does **not** leak to
  the root.
- `shell.Dispose()` disposes the scope, tearing down its `ServiceBase`
  instances.

The framework defines region service tokens (`NavigationService`,
`InspectorService`, `StatusService`) the shell binds its regions to; an app
registers a concrete subclass against those tokens.

---

## 7. Worked example — the demo platform

[demo/platform/demo-navigation-service.mjs](https://github.com/pragmatic-tech-ai/mural/blob/main/demo/platform/demo-navigation-service.mjs)
is the end-to-end dogfood. `DemoNavigationService` extends the framework
`NavigationService` (so it registers/resolves under `NavigationService.Key`),
self-populates from the demo registry, and owns the whole navigation + page
model — no host-script view-model at all.

```mu
// demo/platform/platform.mu (excerpt)
EditorShell {
    .services: {
        DemoNavigationService          // registered into the shell scope
    }

    // Region content consumes the shell-scoped service. Selection is TwoWay.
    NavigationRail [SelectedIndex=$service(NavigationService).SelectedGroupIndex] { … }
    ListBox [ItemsSource=$service(NavigationService).Items,
             SelectedItem=$service(NavigationService).SelectedItem]
    PageView [Title=$service(NavigationService).Title,
              Content=$service(NavigationService).Content]
}
```

```js
// demo-navigation-service.mjs (excerpt)
export class DemoNavigationService extends NavigationService {
    constructor(provider) {
        super(provider);                       // forward the provider
        for (const def of allDemos()) { /* build Groups from the registry */ }
        this._syncSelectedGroupFromIndex();    // seed the initial selection
    }
    // Items / SelectedItem inherited from NavigationService; the service
    // derives Title / Subtitle / Content from the selection.
}
```

The host script seeds **no** DataContext — the regions resolve the service
through their inherited `ServiceScope`, selection flows both ways through the
TwoWay `$service` bindings, and the service self-populates from the registry.

---

## 8. Patterns & guidance

- **App-wide services → `Application.Services` (or `Application { .services: }`).
  Per-subtree services → the shell's scope.** Register where the lifetime
  belongs; resolution walks up, never down.
- **One token, one meaning.** Let services follow the static-`Key` convention
  and register subclasses against the inherited key — `tokenFor` keeps markup
  and code agreeing.
- **Inject explicitly.** A service pulls its collaborators from `this.Provider`
  (in code) or via `{ prop: $service(Token) }` (in markup). There is no
  auto-wiring; the wiring is meant to be visible and greppable.
- **State the view observes lives on `ServiceBase` DPs.** A closure variable or
  plain field a view can't bind to defeats the purpose — register the DP.
- **Prefer `getRequired` for required deps.** A missing registration is a
  composition bug; fail loud at resolve time, don't silently no-op.
- **Dispose the scope you created.** A shell disposes its own scope; don't
  reach up to dispose a parent.

---

## 9. API reference

### Runtime (`mural/runtime`)

| Export | Kind | Summary |
|---|---|---|
| `ServiceProvider` | class | the DI container; implements both interfaces below |
| `IServiceProvider` | interface | resolve surface: `get` / `getRequired` / `has` |
| `IServiceContainer` | interface | compose + lifecycle: `register*` / `addInstance` / `createScope` / `dispose` |
| `ServiceBase` | class | a service that is also a bindable `Model`; ctor takes the provider |
| `ServiceKey<T>` | class | a typed token for interface-shaped contracts |
| `ServiceToken<T>` | type | `ServiceKey<T>` \| class reference |
| `ServiceConstructor<T>` | type | a class usable directly as a token |
| `ServiceFactory<T>` | type | `(provider: ServiceProvider) => T` |
| `ServiceLifetime` | type | `'singleton' \| 'scoped' \| 'transient'` |
| `ServiceBinding` | factory | the `$service(Token)` binding (usually emitted by markup) |

### `ServiceProvider` methods

| Method | Returns | Notes |
|---|---|---|
| `register(token, factory, lifetime?)` | `this` | lifetime defaults to `'singleton'` |
| `registerInstance(token, instance)` | `this` | eager singleton |
| `registerScoped(token, factory)` | `this` | one per scope |
| `registerTransient(token, factory)` | `this` | fresh per resolve |
| `addInstance(instance)` | `this` | token derived from `instance.constructor` |
| `get(token)` | `T \| undefined` | optional resolve |
| `getRequired(token)` | `T` | throws if unregistered |
| `has(token)` | `boolean` | walks the parent chain |
| `createScope()` | `ServiceProvider` | child scope (resolves locally then parent) |
| `dispose()` | `void` | `Dispose()` every instance this scope owns |
| `ServiceProvider.tokenFor(ctor)` | `ServiceToken` | static; the `static Key ?? class` rule |

### Markup

| Form | Meaning |
|---|---|
| `.services: { [lifetime] Impl [ { config } ] [-> Token] }` | register services into the surrounding `Services` provider |
| `Impl { prop: literal }` | seed a DP on the constructed instance |
| `Impl { prop: $service(Token) }` | inject a resolved service (eager) |
| `$service(Token)` | bind to the resolved service object |
| `$service(Token).path` | bind to a service DP (reactive, TwoWay-capable) |
| `.Member: { elem … }` | list strategy → `Member.Add(child)` |
| `.Member: { @Key = value … }` | dictionary strategy → `Member.Set(key, value)` |
