# The runnable app

Section 11 of the architecture overview compresses the whole story into four
steps: the build output is a self-contained `index.html`, the bundle
rehydrates the model, `TodlAppBootstrap.Mount` mounts a mural `Application`
over it, and mural renders. This page is the deep-dive companion to
[section 11](../architecture.md#11-the-runnable-app); it traces exactly what
happens between someone building an architecture project and a painted UI in
their browser, names the real files and classes, and draws the line between
the current per-project path and the legacy generic model browser it
replaced.

The short version: TODL compiles a model into a graph, the html-bundle build
system (part of `src/solution-services/todl-build-system/`, covered by the
build-system deep dive) turns that graph plus a generated UI into one HTML
file, and a deliberately dumb bootstrap class wires the two together at
runtime. Nothing about *how entities are shown* lives in the bootstrap — that
decision was pushed into a generated, overridable source file that ships
inside the project itself.

## What ships inside index.html

An architecture project's `html-bundle` build produces a single output file:
`index.html`. It is not a shell that fetches assets — everything the page
needs is inlined into it at build time. `EmitBundledHostAction`
(`src/solution-services/todl-build-system/html-bundle/emit-bundled-host-action.ts`)
is the action that writes it, and it does so by calling
`HtmlShell.Render(JSON.stringify(compiled.fullDocument), appBundle)`, passing
two things: the compiled model's full document (the entire dependency
closure, not just the project's own nodes) and the already-bundled
application script produced earlier in the pipeline.

`HtmlShell` lives at
`src/solution-services/todl-build-system/html-bundle/html-shell.ts` — worth
noting explicitly, because it is easy to assume the page shell belongs next
to the bootstrap under `graph-api/browser/`. It doesn't. `HtmlShell` is build
system code; it only *emits* markup. The class hoists every literal it uses
into `private static readonly` fields — `RootId = "todl-app-root"`,
`AppGlobal = "__TODL_APP__"`, `Title`, `PageStyle` — and its `Render` method
joins them into a small, fixed document structure:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>TODL Graph</title>
  <style>html, body { height: 100%; margin: 0; overflow: hidden; } #todl-app-root { height: 100%; }</style>
</head>
<body>
  <div id="todl-app-root"></div>
  <script>window.__TODL_APP__ = { …the compiled TodlDocument… };</script>
  <script>/* the bundled app, inlined */</script>
</body>
</html>
```

Three things about this shape matter for everything that follows. First,
there is exactly one mount point, `#todl-app-root`, and its id is a string
constant shared — by convention, not by import, since the two classes live in
different subsystems — between `HtmlShell` (which writes the div) and
`TodlAppBootstrap` (which looks it up). Second, the model data is not fetched;
it is the literal JSON of the compiled `TodlDocument`, assigned to
`window.__TODL_APP__` before the app script runs, so by the time the bundle
executes, the data is already sitting on the global object with no async gap.
Third, the "app" is not a generic viewer shell — it is a fully bundled,
already-compiled script produced fresh for this specific project on this
specific build. There is no runtime fetch of a shared viewer bundle; the page
carries its own.

## From the graph to a bundle: what the build pipeline hands the browser

`HtmlBundleBuildSystem`
(`src/solution-services/todl-build-system/html-bundle/html-bundle-build-system.ts`)
runs six actions in a fixed order for every architecture project — but only
after a declarative up-front check confirms that the project's four
required files already exist: `src/app.mu`, `src/main.ts`,
`generated/model.ts`, and `generated/data.ts`. None is produced by this
pipeline: all are project content, written ahead of time by the generators
described in [Project content generators](content-generators.md), and the
build's `ProjectBuildManager.CheckRequirements` fails fast, before
provisioning a sandbox or running a single action, if any is missing. The
build system deep-dive page covers the pipeline mechanics (artifact keys,
consume-before-produce validation, sandbox promotion); the point that
matters here is the last few actions, because they are what produce the code
the browser eventually runs:

1. `ResolveBasesAction` and `CompileModelAction` do what every build does —
   assemble the base closure and compile it into a `CompiledModel`, whose
   `fullDocument` is the entire closure (not just the project's own nodes).
2. `EmitEntryAction` writes `entry.ts` — the wiring that constructs the app,
   instantiates the view-model, and calls the bootstrap — into the build's
   sandbox root, not the project; it is build glue, never committed project
   content.
3. `CompileMuralAction` compiles every `.mu` file the project has —
   including its `src/app.mu`, required to already be there — to a sibling
   `<path>.mu.js` (so `src/app.mu` → `src/app.mu.js`) via mural's `compile()`.
4. `BundleAppAction` collects the staged source and compiled modules and
   hands them to the `IBundler` to produce one self-executing script.
5. `EmitBundledHostAction` renders the final `index.html`, as described above.

Step 2 is worth reading in full, because it is the one action left in this
pipeline that produces code from scratch — everything else either compiles
what already exists or requires it up front.

### Generating the entry point

`EmitEntryAction`
(`src/solution-services/todl-build-system/html-bundle/emit-entry-action.ts`)
writes `entry.ts` into the build's sandbox root from a small hoisted template
(`{App}` substituted with the view-model class name):

```ts
import { app } from "./src/app.mu.js";
import { {App} } from "./src/main.js";
import { model } from "./generated/data.js";
import { TodlAppBootstrap } from "@pragmatic-tech-ai/todl";
new {App}();
TodlAppBootstrap.Mount(app, model);
```

`{App}` is `AppNaming.AppClass(manifest.id ?? manifest.name)`. The five lines
run in an order that is not interchangeable, and understanding why is the key
to understanding the whole runtime:

1. `import { app }` evaluates the compiled `src/app.mu.js` **first**. That is
   what constructs the mural `Application` and assigns `Application.current`.
2. `import { {App} }` only *defines* the view-model class — the markup
   imported it transitively a moment ago, so by the time this line is reached
   the class object already exists; importing it again is free.
3. `import { model }` pulls in the rehydrated DTO instance — `generated/data.ts`
   has already called `<Dto>.fromJSON(window.__TODL_APP__)`, so `model` is the
   typed graph, built purely from the data `HtmlShell` inlined, no network call.
4. `new {App}()` runs the view-model constructor **now** — after step 1 — so
   its `Application.current?.Services.addInstance(this)` registers against an
   `Application` that actually exists. This is the one instance the whole app
   has; the markup's `$service` binding resolves to it.
5. `TodlAppBootstrap.Mount(app, model)` hands the host element to mural.

`entry.ts` is the file the bundler actually bundles; everything before it in
the pipeline exists to produce its imports. The subtle failure it guards
against — a view-model that self-registers before the `Application` exists,
leaving `$service` empty and the page blank — is exactly why `src/main.ts`
only *defines* the class and this glue, not the user's source, owns the single
`new`.

### The UI that ships

Neither `src/app.mu` nor `src/main.ts` is produced by this pipeline. Both are
already sitting in the project — scaffolded once, at creation, by
`AppGenerator` (id `app-ui`) and `AppViewModelGenerator` (id `app-view-model`)
with `WritePolicy.WriteOnce`, which is what makes them *yours*: a developer
edits them freely, adds more `.mu` and `.ts` files beside them, and no
generator or build action ever overwrites them again (see
[Project content generators](content-generators.md)). What the build compiles
is whatever is there now, not a regenerated template.

The scaffolded `src/app.mu` is a small, complete demonstration of the
platform's binding model rather than a per-concept dump:

```
import <App> from "./main.js"

Application
{
    resources:
    {
        ContentPresenter x:root [ Content = $service(<App>) ]

        DataTemplate [ DataType = <App> ]
        {
            StackPanel [ Orientation = Vertical, Margin = (16,16,16,16) ]
            {
                TextBlock [ Text = $HelloText ]
                TextBlock [ Text = $ConceptSummary ]
            }
        }
    }
}
```

Three mechanisms carry the whole app, and each is worth naming because they are
the seams a developer extends:

- **`import <App> from "./main.js"`** — a `.mu` top-level import directive makes
  the user's TypeScript view-model class a first-class markup symbol. This is how
  authored code and markup meet.
- **`$service(<App>)`** — a service binding. It resolves against
  `Application.current.Services`, the container the view-model registered itself
  into in its constructor. So the `ContentPresenter`'s `Content` *is* the one
  view-model instance — no manual DataContext plumbing.
- **`DataTemplate [ DataType = <App> ]`** — a *key-less* template typed to the
  view-model class. A `ContentPresenter` whose content is an instance of that
  type auto-selects this template by type, sets the instance as its
  `DataContext`, and paints it. `$HelloText` and `$ConceptSummary` then bind to
  the view-model's getters.

The paired `src/main.ts` (covered in [Project content generators](content-generators.md))
is the class the markup imports: a `<App> extends Observable` with a constructor
that self-registers into the service container and two getters —
`HelloText` and `ConceptSummary` (the latter reading
`model.ConceptNames().length` off the generated DTO). Between the two files, the
scaffold shows a developer every layer they will use — authored view-model,
service resolution, type-driven templating, and model reflection — in a form
they can read, run, and then rewrite into the real application.

## The bootstrap: wiring with no view knowledge

`TodlAppBootstrap`
(`src/graph-api/browser/todl-app-bootstrap.ts`) is deliberately the smallest
class in this whole path. Its own comment states its scope precisely: it
"carries NO view knowledge — the view lives in the project's compiled
app.mu; this class only wires host + theme + data." The entire class:

```ts
export class TodlAppBootstrap
{
    private static readonly RootId = "todl-app-root";
    private static readonly ThemeOptions: ApplicationInitOptions =
    {
        theme: Pragmatic,
        autoScheme: { light: PragmaticLight, dark: PragmaticDark },
    };

    public static Mount(app: Application, dataContext: unknown): void
    {
        if (typeof document === "undefined" || typeof window === "undefined") return;
        const host = document.getElementById(TodlAppBootstrap.RootId);
        if (host === null) return;
        app.initialize(new HtmlTarget(host), { ...TodlAppBootstrap.ThemeOptions, dataContext });
    }
}
```

Two guards precede the actual mount. The first checks for `document` and
`window` before touching either — because the exact same `entry.ts` module
that runs in the browser can also be imported under Node (by tests, by
tooling that wants to exercise the DTO without a DOM), and without this guard
that import would throw. The second checks that `#todl-app-root` actually
exists in the page before calling `getElementById` results into
`app.initialize` — a defensive no-op rather than a crash if the shell markup
is ever missing the mount point.

Past those guards, `Mount` does exactly one thing: it calls
`app.initialize(new HtmlTarget(host), { theme: Pragmatic, autoScheme: { light,
dark }, dataContext })`. `HtmlTarget` is mural's DOM rendering target —
`Mount` doesn't render anything itself, it hands mural a real element to own.
The `dataContext` is the rehydrated `model` DTO `entry.ts` imported — it
becomes the application's root `DataContext`, available to any binding that
needs the raw graph. Everything about *what appears* inside that element —
the `ContentPresenter`, its `$service` content, the type-driven
`DataTemplate` — was decided by the project's own `src/app.mu` and compiled
into `app.mu.js`; the bootstrap never inspects the model to decide what to
draw. Pragmatic is the platform's only theme (the former Material theme was
removed), so there is no theme choice to make here.

From here mural takes over: `initialize` resolves the Pragmatic theme (so
every control in the compiled `app.mu` picks up its themed default style) and
binds `Resources.Root` — the `ContentPresenter` marked `x:root`, which mural's
compiler lowers into that property — as the application's content. That
presenter's `Content` is a `$service(<App>)` binding, which resolves the one
view-model instance the entry registered into `Application.current.Services`;
the key-less `DataTemplate [ DataType = <App> ]` is auto-selected for it, the
instance becomes the template's `DataContext`, and `$HelloText` /
`$ConceptSummary` bind to the view-model's getters. What paints is driven by
the view-model, resolved through the service container — not by the bootstrap
reflecting over the model.

## The legacy path: a generic model browser

Before this per-project pipeline existed, TODL mounted a different kind of
view: a single, generic model browser that could display *any* compiled
model without a project-specific `app.mu` at all. That code still lives under
`src/application/`, and it is worth understanding precisely because the
architecture overview calls out that it is legacy, not because it has been
deleted.

The legacy stack is three classes working together. `ModelBrowserVM`
(`src/application/model-browser-vm.ts`) is an `Observable` view model that
flattens a `ModelDataSource`'s instances into one heterogeneous row list,
grouped by concept: it iterates `root.ConceptNames()`, and for each concept
with at least one instance pushes a `ConceptHeaderVM` row followed by one
`InstanceRowVM` per instance (falling back to a single "No instances to
display." row when the model is empty). `MuralViewContribution`
(`src/application/mural-view-contribution.ts`) is the piece that actually
wires this VM into a mural `Application`: it clones a themed
`ModelBrowserResources` dictionary (compiled from `model-browser.mu`), merges
its templates into the application's resources, installs the dictionary's
root visual, and sets `root.DataContext = ModelBrowserVM.For(registry.Root())`
— reading the root model straight out of the already-registered
`ModelRegistry`. `MuralHost.Run` (`src/application/mural-host.ts`) is the
entry point that ties it together: it constructs a fresh mural `Application`,
initializes it with the Pragmatic theme, and boots it through
`ApplicationBootstrapper.Boot` with two contributions —
`ModelRegistryContribution` (the data side) and `MuralViewContribution` (the
view side).

The new per-project path does not go through any of this. There is no call
to `MuralHost.Run` or `MuralViewContribution` in the html-bundle pipeline;
`TodlAppBootstrap.Mount` calls `app.initialize` directly on an `Application`
that was already constructed by compiling the project's own `app.mu`. The
divergence is precisely at the view: the legacy path mounts one shared,
built-in view over whatever model happens to be registered; the current path
compiles a view *from* the model, per project, at build time.

What the two paths do share is the composition machinery underneath the
view. `ApplicationBootstrapper` (`src/application/application-bootstrapper.ts`)
is a small static class: `Boot(sources, root?)` takes a `CompositionRoot`
(creating a plain one if the caller doesn't supply one) and applies a list of
`IContributionSource` implementations to it in order, returning an
`ApplicationEntryPoint`. `ApplicationEntryPoint`
(`src/application/application-entry-point.ts`) is a thin read façade over the
composed root — `Services`, `Registry()`, `Root()` — that lets a caller reach
the booted `ModelRegistry` and its root `ModelDataSource` without knowing how
composition happened. `ModelRegistryContribution`
(`src/application/model-registry-contribution.ts`) is the data contribution
both paths could use: it calls `registry.PrepareAll(root.Provider)` and then
registers the registry under its well-known `ServiceKey`, so a resolved
registry is always ready to read by the time anything else runs. These three
classes are project-agnostic; they don't know whether the view on top of them
is the generic browser or a generated `app.mu`. Only `MuralViewContribution`
is view-specific, and the html-bundle path simply never constructs it —
`TodlAppBootstrap` replaces that one contribution with a direct
`app.initialize` call against a view mural already compiled from the
project's own source.

## Tracing the whole path once more, end to end

Put together, opening a built architecture project's `index.html` runs
through exactly this sequence:

1. The browser parses `index.html`. It hits `<div id="todl-app-root">`, then
   a `<script>` that assigns the compiled model's full JSON document to
   `window.__TODL_APP__`, then a second `<script>` — the IIFE bundle of
   `entry.ts` plus everything it imports.
2. The bundle's top-level code runs immediately, in the order `entry.ts`
   fixes: evaluating `src/app.mu.js` constructs the mural `Application` and
   sets `Application.current`; `generated/data.js` rebuilds the typed DTO from
   `window.__TODL_APP__` (no fetch, the data was already on the page); then
   `new <App>()` runs the view-model constructor, which registers the instance
   into `Application.current.Services`.
3. `TodlAppBootstrap.Mount(app, model)` runs: it confirms it's in a browser,
   finds `#todl-app-root`, and calls `app.initialize(new HtmlTarget(host), {
   theme: Pragmatic, autoScheme: { light, dark }, dataContext: model })`.
4. mural takes the compiled `Application`, resolves the theme, and mounts its
   `x:root` `ContentPresenter` into the host element. The presenter's
   `$service(<App>)` content resolves the registered view-model, the key-less
   `DataTemplate` typed to it is auto-selected, and `$HelloText` /
   `$ConceptSummary` bind to its getters. The page is now live: what shows is
   the view-model's state, bound by reference, not a static render.

Nowhere in that sequence does the bootstrap, the DTO, or the mural runtime
need to know anything about the specific concepts in this project's model —
that knowledge was compiled once, at build time, into `app.mu.js`, and the
runtime side is generic wiring that would work identically for any project's
bundle.

---

[← Back to the Architecture overview](../architecture.md)

See also:
- [The build system](build-system.md)
- [Project content generators](content-generators.md)
- [Consuming a model](consuming-a-model.md)
- [The compiler front end](compiler.md)
