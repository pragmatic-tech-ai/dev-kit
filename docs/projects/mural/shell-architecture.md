# Shell Architecture

How mural composes an application: a **services-driven shell** whose regions
bind to injected services, fed by **modules** that contribute **capabilities**
and register those services. This document covers the shell family, the DI
container, the service catalog, and how a running app is wired together.

> Orientation: the shell is the chrome (app bar, rails, panels, status). It
> owns **no** app content and takes **no** body children. Everything the user
> sees inside it arrives through *services* the shell's template binds to, and
> those services are supplied by *modules* composed on the `Application`.

---

## 1. The big picture

```
 Application
   ├─ Services : ServiceProvider ..................... the app-root DI container
   ├─ Modules  : IShellModule[] ..................... composed capability providers
   │     └─ each module: Capabilities[] + Resources + service Registrations
   └─ Resources.Root = EditorShell (x:root) ......... the shell instance

 EditorShell (ShellBase)
   ├─ Services : child scope of Application.Services  (per-shell scoped services)
   └─ Template (shell.template.mu) — region hosts, each binding $service(Token):
        Header · Commands · Nav rail · Left pane · Inspector · Status · Content
```

Three mechanisms connect these:

1. **`$service(Token)`** bindings in the shell template resolve a service from
   the DI scope the shell publishes (§3, §4).
2. **Modules** register their services into the app-root container and merge
   their resources app-global when added to `Application.Modules` (§5).
3. A **Capability** names a service via `ServiceKey`; `NavigationService`
   resolves it as `ActiveService` when its rail item is selected (§5, §6).

An app therefore reads:

```
Application {
    .modules: { DiagramModule; LayersModule; … }
    resources: { EditorShell x:root { } }
}
```

No region-tagged children, no imperative wiring — declare modules, register
services, bind regions.

---

## 2. The shell family

`src/framework/shell/`

| Type | Role |
|------|------|
| `ShellBase` (`shell.ts`) | Abstract skeleton. Owns the per-shell DI scope; no chrome of its own. |
| `EditorShell` (`editor-shell.ts`) | Full editing chrome — header, commands, nav rail, left pane, inspector, status, content. |
| `ViewerShell` (`viewer-shell.ts`) | Read-only subset — header, nav, content. |

### `ShellBase` — the DI seam

`ShellBase.Services` is a **child scope** of `Application.current.Services`,
created lazily. Creating it also *publishes* it as the element's `ServiceScope`,
which inherits down the template so every descendant `$service(Token)` binding
resolves against **this shell's** scope. `Dispose()` tears the scope down,
disposing the scoped services it owns.

```ts
public get Services(): ServiceProvider {
    if (this._scope === undefined) {
        const root = Application.current?.Services;
        this._scope = root ? root.createScope() : new ServiceProvider();
        this.ServiceScope = this._scope;          // publish for $service(...)
    }
    return this._scope;
}
```

### Region → DockPanel map (`shell.template.mu`, `@DefaultEditorShell`)

Regions are docked one edge at a time in child order; `PART_ContentHost` is
last so `LastChildFill` hands it the remaining rectangle.

```
 ┌───────────────── PART_HeaderHost  (Top) ─────────────────┐
 │────────────────  PART_CommandHost  (Top, menu+toolbar) ──│
 │ rail │ left  │                                           │
 │ (ᴸ)  │ pane  │        PART_ContentHost  (fill)           │  Inspector
 │      │ (ᴸ)   │        ← ContentHostService.Content       │  (Right)
 │──────┴───────┴───────────────────────────────────────────│
 │────────────────  PART_StatusHost  (Bottom) ──────────────│
 └───────────────────────────────────────────────────────────┘
```

| Region | Binds to |
|--------|----------|
| Nav rail (`ContentControl`, Left) | `$service(NavigationService)` — rendered by a `DataTemplate[DataType=NavigationService]` = a `NavigationRail` |
| Left pane (`ContentControl`, Left, 300w) | `$service(NavigationService).ActiveService` — the active capability's service |
| `PART_ContentHost` (`ContentPresenter`, fill) | `$service(ContentHostService).Content` |
| `PART_StatusHost` (Bottom) | `DataContext = $service(StatusService)` |
| `PART_InspectorHost` (Right) | `DataContext = $service(InspectorService)` |

Each host renders a **non-Visual service** through a `DataTemplate` matched to
the service's runtime type (implicit-by-type dispatch — §7).

`EditorShell` auto-registers a base `NavigationService` and a base
`ContentHostService` (both `scoped`) **only if nothing up-chain already
supplies one** (`if (!this.Services.has(Key))`), so an app that registers its
own wins.

---

## 3. Dependency injection

`src/runtime/services/service-provider.ts`

### Tokens

A service is registered/resolved under a **token** — either a `ServiceKey<T>`
(a named object) or the service **constructor** itself (class-as-token).
`ServiceProvider.tokenFor` normalizes:

```ts
static tokenFor(ctor) { return ctor.Key ?? ctor; }   // own Key, else the class
```

So a class with `static Key` resolves under that Key; a class **without** one
resolves under itself. This is why abstract bases must NOT declare a `Key`
(see §8) — a static `Key` is inherited through the JS prototype chain and would
collapse every subclass to the same token.

### Lifetimes

| Lifetime | Semantics |
|----------|-----------|
| `Singleton` | One instance for the container it's registered on (the app root). |
| `Scoped` | One instance **per scope** — registered on a parent, resolved via a child scope, cached at the owning scope. Each shell gets its own. |
| `Transient` | A fresh instance every resolution. |

### Scopes

`createScope()` makes a child provider; `get()` walks the parent chain, so a
child scope resolves a parent's registrations. `ShellBase.Services` is one such
child scope. **Consequence that bites:** a service registered on the *root*
(e.g. a module singleton) cannot reach a collaborator registered only in a
*shell* scope — resolution walks *up*, never *down* (§8, scope-sharing).

### API surface

```
register(token, factory, lifetime?)   registerInstance(token, value)
registerScoped(token, factory)        registerTransient(token, factory)
get(token) → T | undefined            getRequired(token) → T
has(token) → boolean                  createScope() → ServiceProvider
dispose()
```

### `$service(...)` bindings

`$service(Token)` in markup lowers to
`ServiceBinding(target, ServiceProvider.tokenFor(Token), "path")`. It resolves
against `readServiceScope(target) ?? Application.current.Services` — i.e. the
nearest published `ServiceScope` (the shell's), falling back to the app root.
The binding subscribes to the first path segment, so
`$service(NavigationService).ActiveService` re-renders when `ActiveService`
changes.

---

## 4. `ServiceBase` — services that are view-models

`src/runtime/services/service-base.ts`

```ts
export abstract class ServiceBase extends Model {
    protected readonly Provider: IServiceProvider;   // resolve collaborators
    constructor(provider) { super(); this.Provider = provider; }
    public Dispose(): void { }                       // scope teardown hook
}
```

Because a service **is a `Model`**, it exposes **DPs** that view content binds
to directly (`$Text`, `$Items`, …). Two rules follow:

- **View-observable state lives on DPs**, never plain fields. A `$path` binding
  resolves its first segment through the property system (`Model.HasProperty`);
  a plain field is invisible and the binding silently yields `undefined`. (This
  was a real bug: a plain `Demos` collection field → empty ListBox.)
- **Public/protected methods are PascalCase** (WPF-style: `View`, `Open`,
  `Save`, `OnSelectedItemChanged`); camelCase is for `private` helpers only.

---

## 5. Modules & Capabilities

`src/framework/shell/module.ts` · runtime contracts in
`src/runtime/shell-modules.ts`

A **`ShellModule`** is a capability provider plugged into a shell. It carries:

- **`Capabilities`** — `ObservableCollection<Capability>` (the content children).
- **`Resources`** — a `ResourceDictionary` merged app-global when the module is
  added (styles, brushes, DataTemplates, icon geometries).
- **Service registrations** — recorded from a `.services:` block via
  `AddRegistration`, replayed by `RegisterServices` when composed.

A **`Capability`** is one rail destination:

| Property | Meaning |
|----------|---------|
| `Name` | Label in the root nav rail |
| `Icon` | Vector `Geometry` painted beside it |
| `ServiceKey` | DI token of the service backing its content |

```
module DiagramModule [ Name = "Diagram" ] {
    .services: { ShapesService  LayersService }        // → app-root container
    resources: { DataTemplate [DataType = ShapesService] { … } }
    Capability [ Name = "Shapes", ServiceKey = ShapesService ]
    Capability [ Name = "Layers", ServiceKey = LayersService ]
}
```

### Layering

`Application` lives in **runtime**, `ShellModule` in **framework**, and runtime
must not depend on framework. Resolved with structural contracts in runtime —
`IShellModule` / `ICapability` — that the concrete types satisfy.
`Application.Modules` is typed `IShellModule[]`; `NavigationService` up-casts to
the concrete `Capability` to read the view-facing `Icon` / `ServiceKey`.

### Composition (`Application.Modules.Add`)

On any `Modules` change the `Application`:

1. **`reconcileModuleResources()`** — `AddMergedDictionary` for each module's
   `Resources`, so its DataTemplates/icons are in app-global scope.
2. **`registerModuleServices()`** — replays each new module's
   `RegisterServices(this.Services)` **once** (add-only, guarded by
   `HasServiceRegistrations`), landing the services on the **app root**.

---

## 6. The service catalog

`src/framework/shell/services/`

### `NavigationService`

Backs the nav rail. `Items` (destinations), `SelectedItem`, and the **derived
`ActiveService`**:

- `PopulateFromModules()` flattens every module's capabilities into `Items` as
  `NavigationDestination`s (each wraps its `Capability`; carries `Label`/`Icon`).
- On `SelectedItem` change, `ActiveService` = the selected capability's
  `ServiceKey` resolved through the container
  (`Provider.get(tokenFor(ServiceKey))`), or `undefined`.

The left pane binds `$service(NavigationService).ActiveService`, so selecting a
rail item swaps the panel to that capability's service (rendered by its
DataTemplate).

### `ContentHostService`

Backs the main content region (`PART_ContentHost`). A thin presenter:

```ts
View(content: unknown): void      // sets the Content DP; undefined clears
get Content(): unknown            // read-only to the view
```

Anything resolves it and calls `View(x)` to swap what the shell shows.

### `DocumentsContentHostService extends ContentHostService`

A workspace of open documents (tabbed-document / TDI shape). Register under
`ContentHostService.Key` to drive the region with documents.

```ts
interface IDocument { Id; Title; IsDirty; Save(): void | Promise<void>; }

OpenDocuments : ObservableCollection<IDocument>
ActiveDocument: IDocument | undefined            // View(ActiveDocument) on change
Open(doc)   // add if new (dedupe by Id) + activate
Close(doc)  // remove; if active, activate the shifted-in neighbour
Save(doc?)  // delegates to (doc ?? ActiveDocument).Save() — the host owns
            //   lifecycle, the document owns IO
```

### `DocumentSelectorService`

A selectable list — the *selector* half of a workspace. Concrete (usable as-is)
but commonly subclassed. **No `Key`** — it's a base subclassed into many
distinct per-context instances, so it uses class-as-token (§8).

```ts
Items       : ObservableCollection<object>       // ItemsSource = $Items
SelectedItem: object | undefined                 // SelectedItem = $SelectedItem
protected OnSelectedItemChanged(item) {          // default behaviour:
    this.Provider.get(ContentHostService.Key)?.View(item);   // present the pick
}
```

Override `OnSelectedItemChanged` for richer behaviour (open into a documents
host, guards, history).

### `StatusService` / `InspectorService`

Thin region VMs. `StatusService`: `Text`, `IsBusy`. `InspectorService`:
`Target` (the inspected object; `undefined` → empty state).

---

## 7. Rendering a service: implicit DataTemplates

A region host (`ContentControl` / `ContentPresenter`) is handed a **non-Visual
`Model`** (a service). It resolves a `DataTemplate` by the value's runtime type:

- `findDataTemplateForType(klass, host)` walks the host's **resource-scope
  chain** — local (ancestor) dictionaries first, then `Application.Resources`
  (which includes module-merged dictionaries).
- Within each scope it walks the value's prototype chain **most-specific-first**,
  so a `[DataType=Base]` template matches every subclass that has no more
  specific entry. One `DataTemplate[DataType=DemoGroupService]` serves all five
  concrete group services.

If **no** template resolves, `ContentControl` renders a loud red
`can not resolve template for: <Type>` diagnostic instead of nothing.

---

## 8. Conventions & gotchas

**Keys on concrete leaf services only.** Every concrete service that needs a
stable token declares `static readonly Key = new ServiceKey<Self>('Name')`.
**Abstract/base classes carry no `Key`** — a static `Key` is inherited through
the prototype chain, so `tokenFor` would collapse all subclasses to one token.
Bases (and services with many distinct subtypes) use class-as-token instead.

**Shared collaborators must be reachable up-chain.** DI resolution walks parent
scopes, never children. If a **root** singleton needs a service, that service
must be registered on the **root** too — not in a shell scope. (The demo
registers `ContentHostService` in the module `.services:` block so its root
singleton group services and the shell's region binding share one instance.)

**Bindable state on DPs; PascalCase public/protected methods.** See §4.

**Register-your-own to override the defaults.** `EditorShell` only auto-registers
a base `NavigationService` / `ContentHostService` when `has(Key)` is false up to
the root — register your own (a subclass, a `DocumentsContentHostService` under
`ContentHostService.Key`) at the root or shell and it wins.

---

## 9. Worked example — the demo platform

`demo/platform/`

```
platform.mu
  Application {
      .modules: { DemoPlatformModule }
      resources: { DataTemplate[DataType=DemoVM]{…};  EditorShell x:root { } }
  }

demo-platform.module.mu
  module DemoPlatformModule {
      .services: { AnimationsService … StylesService   ContentHostService }
      resources: { DataTemplate[DataType=DemoGroupService] {
                      ListBox [ ItemsSource=$Items, SelectedItem=$SelectedItem ] } }
      Capability [ Name="Animation", Icon=@AnimationIcon, ServiceKey=AnimationsService ]
      …five groups…
  }
```

- **`DemoGroupService extends DocumentSelectorService`** (abstract, Key-less):
  `Items` = the group's `DemoVM` rows, `SelectedItem` = the active demo. Five
  concrete subclasses (`AnimationsService`, …) each fix a group name and declare
  their **own** `Key`. Registry-driven: each snapshots + subscribes the demo
  registry filtered by group.
- The rail flattens the five capabilities; selecting one sets
  `NavigationService.ActiveService` to that group service; the left pane renders
  it via the `DataTemplate[DataType=DemoGroupService]` (a `ListBox` of demos).
- Selecting a demo row → `SelectedItem` (TwoWay) → `OnSelectedItemChanged` builds
  the demo Visual and `ContentHostService.View(it)` → `PART_ContentHost` (bound
  to `$service(ContentHostService).Content`) shows the demo.

End-to-end selection flow:

```
click rail item  → NavigationService.SelectedItem → ActiveService = <GroupService>
                                                     left pane = its ListBox
click demo row   → GroupService.SelectedItem (TwoWay)
                 → OnSelectedItemChanged → ContentHostService.View(demoVisual)
                 → PART_ContentHost renders the demo
```

---

## File map

| Concern | Files |
|---------|-------|
| Shell | `src/framework/shell/{shell,editor-shell,viewer-shell}.ts`, `shell.template.mu` |
| Modules | `src/framework/shell/module.ts`, `src/runtime/shell-modules.ts` |
| DI | `src/runtime/services/{service-provider,service-base}.ts` |
| Services | `src/framework/shell/services/{navigation,content-host,documents-content-host,document-selector,status,inspector}-service.ts` |
| Composition | `src/runtime/application.ts` (`reconcileModuleResources`, `registerModuleServices`) |
| Template resolution | `src/basic/templates/data-template.ts`, `src/visual-engine/resource-resolver.ts` |
| Demo | `demo/platform/` |
```
