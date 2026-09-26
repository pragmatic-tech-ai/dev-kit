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
after a declarative up-front check confirms that `generated/model.ts` and
`generated/app.mu` already exist in the project. Neither file is produced by
this pipeline: both are project content, written ahead of time by the
generators described in
[Project content generators](content-generators.md), and the build's
`ProjectBuildManager.CheckRequirements` fails fast, before provisioning a
sandbox or running a single action, if either is missing. The build system
deep-dive page covers the pipeline mechanics (artifact keys,
consume-before-produce validation, sandbox promotion); the point that matters
here is the last few actions, because they are what actually generates the
code the browser eventually runs:

1. `ResolveBasesAction` and `CompileModelAction` do what every build does —
   assemble the base closure and compile it into a `CompiledModel`, whose
   `fullDocument` is the entire closure (not just the project's own nodes).
2. `EmitEntryAction` writes `generated/entry.ts` — the wiring that ties the
   DTO and the UI together and calls the bootstrap — into the build's
   sandbox, not the project; it is build glue, never committed project
   content.
3. `CompileMuralAction` compiles every `.mu` file the project has —
   including its `generated/app.mu`, required to already be there — to
   `compiled/<basename>.mu.js` via mural's own `compile()`.
4. `BundleAppAction` runs esbuild over the staged entry point.
5. `EmitBundledHostAction` renders the final `index.html`, as described above.

Step 2 is worth reading in full, because it is the one action left in this
pipeline that produces code from scratch — everything else either compiles
what already exists or requires it up front.

### Generating the entry point

`EmitEntryAction`
(`src/solution-services/todl-build-system/html-bundle/emit-entry-action.ts`)
writes `generated/entry.ts` into the build's sandbox from a small hoisted
template:

```ts
import { app } from "../compiled/app.mu.js";
import { {{PkgClass}} } from "./model.js";
import { TodlAppBootstrap } from "@pragmatic-tech-ai/todl";
const dto = {{PkgClass}}.fromJSON((window as any).__TODL_APP__);
TodlAppBootstrap.Mount(app, dto);
```

`{{PkgClass}}` is the `pascalCase` of the project's manifest id or name — the
generated DTO class name from `generateReadClient`. Two things happen here in
sequence: `{{PkgClass}}.fromJSON(window.__TODL_APP__)` rehydrates the inlined
JSON into the typed DTO instance (this *is* the app's DataContext, built
purely from the data `HtmlShell` inlined — no network call), and `app` is
imported directly from the compiled `app.mu.js` — the mural `Application`
instance the project's generated UI markup compiles down to. `entry.ts` is
the file esbuild actually bundles; everything before it in the pipeline exists
to produce its two imports.

### The UI that ships

`generated/app.mu` is not produced by this pipeline at all. By the time the
build runs, the file is already sitting in the project — written once, at
project creation, by `UiPlaceholderGenerator` (id `app-ui`; see
[Project content generators](content-generators.md)).
The generator reflects the compiled model back into a `Repository` (via
`fromJSON`, from `compiler-services/emit/json.ts`) and hands it to
`AppUiTemplate.Render` (`app-ui-template.ts`) — the same template class the
build used before this generator existed. The template walks every
`Concept`-kind node in the repository, sorted by id, and emits one section per
concept inside a root `Application { resources: { StackPanel x:root { … } } }`
block:

```
StackPanel [ Orientation = Vertical, Margin = (0,0,0,16) ] {
    TextBlock [ Text = "Technology", FontSize = 15, FontWeight = Bold, Margin = (0,0,0,4) ]
    ListBox [ ItemsSource = $technologies, DisplayMemberPath = "id" ]
}
```

The collection name bound in `$technologies` is not arbitrary — it is
`pluralize(camelCase(conceptId))`, exactly the accessor name
`generateReadClient` puts on the DTO class for that concept. This is the
load-bearing contract mentioned in section 7 of the overview: the UI
generator and the DTO generator must agree on collection naming without ever
importing from each other, because they run as two independent generators
over the same reflected `Repository` and only meet at runtime through this
string. `DisplayMemberPath = "id"` is why every row in the rendered app shows
the raw entity id rather than a label — there is no per-concept display
customization in the generated markup today.

`UiPlaceholderGenerator` runs with `WritePolicy.WriteOnce`: it writes
`generated/app.mu` only if the path is absent, and never touches a file that
is already there — no marker check is needed to protect a hand edit, the
write policy already guarantees it. `AppUiTemplate` still emits a
generated-marker first line (`// @generated by todl build — regenerable`),
but purely as a human-readable signal that the file started out generated;
nothing in the generator or the build path reads it back to decide anything.
This is what lets "how entities are shown" move from generated boilerplate to
a hand-tuned view without any special handling: a developer edits `app.mu`
freely, and no generator or build action ever overwrites it again. See
[Project content generators](content-generators.md) for the full
write-policy story.

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
        theme: Material,
        autoScheme: { light: MaterialLight, dark: MaterialDark },
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
`app.initialize(new HtmlTarget(host), { theme: Material, autoScheme: { light,
dark }, dataContext })`. `HtmlTarget` is mural's DOM rendering target —
`Mount` doesn't render anything itself, it hands mural a real element to own.
The `dataContext` is the rehydrated DTO instance `entry.ts` built two lines
earlier. Everything about *what appears* inside that element — the
`StackPanel`, the per-concept `ListBox`es, their bindings — was decided at
build time by `AppUiTemplate` and compiled into `app.mu.js`; the bootstrap
never inspects the model to decide what to draw.

From here mural takes over: `initialize` resolves the Material theme (so
every control in the compiled `app.mu` picks up its themed default style),
binds `Resources.Root` — the visual `AppUiTemplate` marked `x:root`, which
mural's compiler lowers into that property — as the application's content,
and each `ListBox`'s `$<collection>` binding resolves against the DTO now
sitting in `DataContext`. The rows that appear are the DTO's live collection
objects; `DisplayMemberPath = "id"` is mural's instruction for how to render
each one as text.

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
initializes it with the Material theme, and boots it through
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
   `window.__TODL_APP__`, then a second `<script>` — the esbuild IIFE bundle
   of `generated/entry.ts` plus everything it imports.
2. The bundle's top-level code runs immediately. It imports `app` from the
   compiled `app.mu.js` (mural's compiled form of the project's generated or
   hand-authored UI), imports the generated DTO class from `model.js`, and
   calls `<PkgClass>.fromJSON(window.__TODL_APP__)` to rebuild the typed DTO
   in memory — no fetch, the data was already on the page.
3. `TodlAppBootstrap.Mount(app, dto)` runs: it confirms it's in a browser,
   finds `#todl-app-root`, and calls `app.initialize(new HtmlTarget(host), {
   theme: Material, autoScheme: { light, dark }, dataContext: dto })`.
4. mural takes the compiled `Application`, resolves the theme, mounts the
   generated `StackPanel` of per-concept sections into the host element, and
   binds each `ListBox`'s `ItemsSource` to the matching collection on the
   DTO. The page is now live: every row shown is a real DTO instance, bound
   by reference, not a static render.

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
