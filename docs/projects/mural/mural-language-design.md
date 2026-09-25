# Mural Language — Design

Working name **µ-mural** (`.mu` files). A compact, LaTeX-inspired markup over the mural runtime. Target: replace imperative TS construction (`new Border(); b.Background = …; b.Child = …`) with a denser declarative surface that still resolves to the same constructor calls. Captures decisions taken during design conversation before any parser code exists.

## 0. Goals and non-goals

**Goals.** Tight syntax for the common cases (element trees, attribute setting, attached properties, bindings, resources, styles, templates). One uniform skeleton — `Name[attrs]{body}` — for elements, resource forms, and macros. A small extensibility mechanism (scope extensions) for adding markup-language directives without growing the grammar. Direct mapping to existing runtime primitives ([src/runtime/](src/runtime/), [src/basic/](src/basic/)) so the language is purely a parse-and-construct layer.

**Non-goals.** XAML compatibility at the byte level — semantics align with WPF where it costs nothing, the syntax does not. C#/.NET interop. Designer tooling, hot reload, validation against a schema language. Markup-driven flow control (loops, conditionals) beyond what styles + triggers already cover.

## 1. Worked example

A single file exercising every clause type. Each section is referenced from the corresponding rule below.

```
// dashboard.mu — exercises every clause type.

import basic from "@pragmatic-tech-ai/mural"

def card[#bg, #title, #1]{
  Border[Background=#bg, CornerRadius=(8), Padding=(16)]{
    StackPanel[Orientation=Vertical]{
      TextBlock[FontSize=18, FontWeight=Bold]{#title}
      #1
    }
  }
}

Application{
  resources: {
    @primary = #4caf50
    @padding = (12, 6)

    style[targettype=Button]{                                  // implicit
      Background = @primary
      Padding    = @padding
      when{IsMouseOver and not IsPressed}{
        Background = $( @primary * 0.85 )$
      }
    }

    style[x:key="DangerButton", targettype=Button]{            // keyed
      Background = #d32f2f
      Foreground = #white
    }

    template[x:key="FancyButton", targettype=Button]{
      Border[Background=$$Background, CornerRadius=(12)]{
        ContentPresenter
      }
    }

    datatemplate[x:key="PersonRow", datatype=Person]{
      StackPanel[Orientation=Horizontal]{
        TextBlock{$FirstName}
        TextBlock[Margin=(8,0,0,0)]{$LastName}
      }
    }

    datatemplate[datatype=Company]{                             // implicit
      TextBlock{$DisplayName}
    }
  }

  MainWindow: Window[Title="Demo"]{
    Grid{
      Columns: [auto, *]
      Rows:    [auto, *]

      TextBlock[Grid.Row=0, Grid.Column=0, FontSize=24]{Dashboard}

      card[#0d47a1, "Revenue"]{
        TextBlock{$Q4Total — escaped \$ literal, literal \{brace\}}
      }

      ItemsControl[
        Grid.Row=1, Grid.Column=1,
        ItemsSource=$People,
        ItemTemplate=@PersonRow
      ]
    }
  }
}
```

## 2. Lexical conventions

### 2.1 Casing

Three-tier convention, directly XAML-aligned. The compiler uses casing as a structural signal — there is no other way to tell controls from forms from metadata.

| Casing                    | Role                              | Examples                                  |
|---------------------------|-----------------------------------|-------------------------------------------|
| `PascalCase`              | runtime type or property          | `Border`, `Background`, `BorderThickness` |
| plain lowercase           | form-level keyword or meta-attr   | `style`, `template`, `def`, `targettype`  |
| `x:` + lowercase          | scope-extension lookup            | `x:key`, `x:name`, `x:class`              |

The contrast carries information: lowercase talks to the compiler; PascalCase talks to the control. Identifiers are `[A-Za-z][A-Za-z0-9]*` — no kebab, no underscores.

### 2.2 Whitespace and separators

Whitespace separates items inside body groups `{…}`. Commas separate inside attribute lists `[…]` and value tuples `(…)` / `<…>` / `[…]`-as-list. No commas inside bodies, no whitespace-as-separator inside attribute lists.

### 2.3 Comments

`// line comment` and `/* block comment */`. No nesting.

### 2.4 Escape

`\` is the universal escape character — inside string literals and inside content groups where literal `$`, `#`, `@`, `{`, `}`, `\` are needed. The backslash itself is otherwise unclaimed (it is **not** a command sigil).

## 3. The one skeleton — `Name[attrs]{body}`

Every element-shaped invocation has the same shape. The casing of `Name` decides the part of speech:

```
Element       ::= Name AttrBlock? Body?
Name          ::= PascalIdent | lowerIdent
AttrBlock     ::= "[" AttrList "]"
Body          ::= "{" BodyContent "}"
```

Four legal forms:
- `Name`                — bare invocation (`ContentPresenter`)
- `Name[…]`             — attributes only (`Border[Background=#blue]`)
- `Name{…}`             — body only (`TextBlock{Hello}`)
- `Name[…]{…}`          — both (`Border[…]{…}`)

The same shape covers controls (`Border[…]{…}`), resource forms (`style[…]{…}`), macro definitions (`def name[…]{…}`), macro invocations (`card[…]{…}`), and forms like `when[…]{…}`. There is no second skeleton.

## 4. Body content — type-driven dispatch

A `{…}` body is parsed in one of four modes, decided by the slot type on the parent. This is the one place where the grammar is mildly context-sensitive; everything else is context-free.

| Parent slot type      | Mode             | Example                                |
|-----------------------|------------------|----------------------------------------|
| `string`              | text mode        | `TextBlock{Hello $Name}`               |
| single `Visual`       | single element   | `Border{ TextBlock{…} }`               |
| `IList<Visual>`       | element list     | `StackPanel{ A B C }`                  |
| multi-slot composite  | mixed            | `Grid{ Columns: […]; …elements… }`     |
| `object`              | peek to dispatch | `ContentControl{ "text" or Element }`  |

Text mode interpolates sigils (§5). Element list mode whitespace-separates `Element` children. Mixed mode (composites with multiple element slots like Grid) allows `SlotAssign` lines (`Identifier ":" SlotValue`) interspersed with regular `Element` children — the SlotAssign targets a named slot; everything else accumulates into the default slot.

```
Grid{
  Columns: [auto, *, *]
  Rows:    [40, *]
  TextBlock[Grid.Row=0, Grid.Column=0]{Header}
  TextBlock[Grid.Row=1, Grid.Column=1]{Body}
}
```

`Columns:` and `Rows:` are SlotAssigns; the two `TextBlock`s fall into Grid's default slot (`Children`).

## 5. Sigils — values without ceremony

Where XAML uses curly-brace markup extensions, µ-mural uses single-character sigils. Each is a distinct lexical token; precedence and parsing are trivial.

| Sigil               | Maps to                          | Example                                |
|---------------------|----------------------------------|----------------------------------------|
| `$Path`             | `{Binding Path=Path}`            | `Text=$FirstName`                      |
| `$Path.Sub.Deeper`  | dotted binding path              | `Text=$Customer.Name`                  |
| `$$Property`        | `{TemplateBinding Property}`     | `Background=$$Background`              |
| `@Key`              | `{StaticResource Key}`           | `Background=@primary`                  |
| `@@Key`             | `{DynamicResource Key}`          | `Background=@@accent`                  |
| `#color`            | `SolidColorBrush(Color.X)`       | `Background=#blue`, `Background=#0d47a1` |
| `(a, b, c, d)`      | `Thickness` / tuple              | `Padding=(8)`, `Margin=(3,2,3,2)`      |
| `<w, h>`            | `Size`                           | `MinSize=<100, 50>`                    |
| `[a, b, c]`         | list / array                     | `Columns: [auto, *, *]`                |
| `#1`, `#name`       | macro hole                       | (only inside `def` body)               |
| `$( … )$`           | inline expression                | `Background=$(@primary * 0.85)$`       |

`$Path` is the bare-Binding form. Disambiguation from `$( … )$` is by next-character: `$(` opens an inline expression; `$Ident` opens a binding path.

## 6. Attributes

Inside `[…]`, comma-separated. Three attribute shapes:

| Shape           | Role                         | Example                          |
|-----------------|------------------------------|----------------------------------|
| `prop=v`        | runtime property             | `Background=#blue`               |
| `Type.prop=v`   | attached property            | `Canvas.Left=10`, `Grid.Row=2`   |
| `x:ext=v`       | scope-extension request      | `x:key="primary"`                |

`x:ext` resolves at bind time against the active scope stack (§8); the other two write a value on the element directly. The three shapes can interleave freely; positional and named *cannot* mix inside one attribute list (forbidden by design — clean errors over flexible parsing).

Positional attributes are for macro invocations only. A macro `def card[#bg, #title, #1]{…}` is called positionally:

```
card[#0d47a1, "Revenue"]{ … body becomes #1 … }
```

## 7. Resource forms — one shape, three keywords

```
KeyedResourceForm ::= ResourceKeyword "[" MetaAttrList "]" "{" Body "}"
ResourceKeyword   ::= "style" | "template" | "datatemplate"
```

All three forms share the universal `Name[attrs]{body}` skeleton. They differ only in the keyword and the meta-attrs they require:

| Form           | Required meta-attr | Optional meta-attrs        | Body                |
|----------------|--------------------|----------------------------|---------------------|
| `style`        | `targettype=T`     | `x:key`, `basedon=@k`      | SetterList          |
| `template`     | `targettype=T`     | `x:key`                    | one Element         |
| `datatemplate` | `datatype=T`       | `x:key`                    | one Element         |

```
style[targettype=Button]{ Padding = (12, 6) }                  // implicit
style[x:key="DangerButton", targettype=Button]{ … }            // keyed
template[x:key="FancyButton", targettype=Button]{ … }
datatemplate[datatype=Person]{ … }                              // implicit
datatemplate[x:key="PersonRow", datatype=Person]{ … }          // keyed
```

The resource-form skeleton is *literally identical* to a regular element invocation. The only thing distinguishing `datatemplate[…]{…}` from `Border[…]{…}` is the keyword's casing — lowercase form vs. PascalCase control. No special-case form grammar.

### 7.1 SetterList (inside `style`)

```
SetterList     ::= SetterItem*
SetterItem     ::= PropertySetter | TriggerGroup
PropertySetter ::= AttrPath "=" Value
TriggerGroup   ::= "when" "{" TriggerExpr "}" "{" SetterList "}"
```

Whitespace separated, no commas. Triggers nest:

```
style[targettype=Button]{
  Background = @primary
  Foreground = @on:white
  Padding    = (12, 6)
  when{IsMouseOver}{ Background = @primary-light }
  when{IsPressed and not IsDisabled}{
    Background = @primary-dark
  }
}
```

### 7.2 Trigger expressions

```
TriggerExpr ::= TriggerOr
TriggerOr   ::= TriggerAnd ("or" TriggerAnd)*
TriggerAnd  ::= TriggerTerm ("and" TriggerTerm)*
TriggerTerm ::= "not"? Ident ("=" Value)? | "(" TriggerExpr ")"
```

Bare `IsMouseOver` means `IsMouseOver = true`; `not IsEnabled` means `IsEnabled = false`; explicit `Status = "active"` is allowed. `and`/`or`/`not` are lowercase keyword tokens; precedence: `not` > `and` > `or`.

## 8. Scope extensions — the `x:` mechanism

### 8.1 The mechanism

Every element body is a scope. Certain elements *advertise* named extensions to that scope. Children write `x:foo = value` to address the nearest ambient extension named `foo`; the compiler walks the scope stack outward.

**Scope extensions are distinct from attached properties.** They are not sugar over `Type.prop`-style attached properties, they are not stored on the child element as runtime data, and the owning element is not named by the syntax — it is resolved by walking the scope stack at parse/bind time. The two mechanisms coexist; do not conflate.

### 8.2 What an extension is in code

```ts
interface ScopeExtension<T = unknown> {
    readonly name: string;
    parse(raw: AstValue): T;
    apply(owner: Element, child: Element, value: T): void;
}
```

Three things: a name (what `x:foo` resolves to), a value parser (raw AST → typed value), an application hook (what the owning element does with the parsed value when the child is instantiated). The application is where the value moves into the owner's state; the child carries no residue.

### 8.3 How an element advertises extensions

Declarative, static. The compiler reads `providedExtensions` without instantiating:

```ts
class ResourceDictionary extends Element {
    static readonly providedExtensions: readonly ScopeExtension[] = [
        new KeyExtension(),
    ];
}

class KeyExtension implements ScopeExtension<string> {
    readonly name = 'key';
    parse(raw: AstValue): string {
        if (raw.kind !== 'string') throw new Error('x:key requires a string');
        return raw.value;
    }
    apply(owner: Element, child: Element, value: string): void {
        (owner as ResourceDictionary).Set(value, child);
    }
}
```

### 8.4 Resolution rules

1. The bind pass maintains a stack of active scope frames `{ owner: Element, exts: ScopeExtension[] }`.
2. Entering an element body that advertises extensions pushes a frame.
3. `x:foo` on a child resolves by stack walk, innermost outward.
4. **Shadowing is a static error.** If two frames advertise the same name simultaneously, the parser raises an "ambiguous" error listing the candidate scopes. Shadowing-by-innermost would be footgun-shaped; better to force an explicit rename.
5. **Unresolved** `x:foo` is a static error with the active scope list in the message.
6. **Single prefix.** `x:` is the only scope-extension prefix; there is no per-scope alias mechanism.

### 8.5 Currently-known extensions

Closed table; grows as the runtime gains new scope-providing elements.

| Advertising element  | Extensions               | Consumed for                                                  |
|----------------------|--------------------------|---------------------------------------------------------------|
| `ResourceDictionary` | `key`, `root`            | dictionary lookup table; root marker for `Application.Mount`  |
| `Application` (root) | `name`, `class`          | namescope registration, document class                        |

`x:root` is a flag (no value) marking the unique child of a `ResourceDictionary` that is the application's main visual. `ResourceDictionary.Root` exposes it. At most one `x:root` per dictionary; multiple is a static error. Used by `Application.Mount` (§9.2) to know what to attach to a `PresentationTarget`.

Additional advertisements (e.g. `index` on `ItemsControl`, `cell` on `Grid` as an alternative to attached `Grid.Row`/`Grid.Column`) are future possibilities that fit the mechanism without grammar changes.

## 9. Resources and `Application`

### 9.1 Every element has a Resources slot

There is no top-level `resources{…}` form. Every Element (every Visual) carries an implicit `Resources: ResourceDictionary` slot, fillable via SlotAssign syntax:

```
Border[…]{
  resources: {
    @primary = #4caf50
    style[targettype=Button]{ Background = @primary }
  }
  TextBlock{Hello}    // not a resource — falls into the default slot
}
```

The `resources:` SlotAssign's body is the dictionary's contents. Children of that block can use `x:key` because the `ResourceDictionary` instance pushes its scope frame; children of the outer `Border` (outside `resources:`) cannot.

### 9.2 `Application` is the root element

```ts
class Application extends Element {
    Resources: ResourceDictionary = new ResourceDictionary();
    static current: Application | null = null;

    get Root(): Visual | undefined { return this.Resources.Root; }

    Mount(host: Element, options?: HtmlTargetOptions): HtmlTarget {
        if (this.Root === undefined) {
            throw new Error('Application.Mount: no x:root marker in Resources.');
        }
        const target = new HtmlTarget(host, options);
        target.Content = this.Root;
        return target;
    }
}
```

`Application` is a real element written in markup, optionally with an implicit wrapper at file root (§15.1). Its only special-ness is its root position. Its `Resources` participates in the resource walk like any other element's, just at the topmost level.

`Root` is a convenience getter delegating to `Resources.Root` — the child marked with `x:root` (§8.5). `Mount(host, options?)` constructs an `HtmlTarget` against the host element, sets `target.Content` to `this.Root`, and returns the target so the caller can dispose it on teardown or hold a handle. Throws if no `x:root` marker was registered. See §13 for the hosting pattern.

### 9.3 Two parallel walks up the parent chain

Both walks traverse the same logical-parent chain, both terminate at `Application`, but they answer different questions and share no machinery beyond the iterator shape:

| Walk                    | Triggered by      | Looks at each ancestor for      | Resolved at         |
|-------------------------|-------------------|----------------------------------|---------------------|
| Scope-extension walk    | `x:foo=v` on AST  | `cls.providedExtensions`         | bind time only      |
| Resource walk           | `@key` value      | `ancestor.Resources?.Resolve`    | bind or runtime     |

`x:` does **not** use Resources; `@` does **not** use providedExtensions.

### 9.4 Runtime already implements the resource walk

The mural runtime ships [src/runtime/resource-dictionary.ts](src/runtime/resource-dictionary.ts) and [src/runtime/visual.ts](src/runtime/visual.ts) with the resource side fully built:

- [ResourceDictionary](src/runtime/resource-dictionary.ts) — `Map<string | Function, unknown>` (one map; string keys for `@key`, Function keys for implicit-style-by-TargetType), `Set`/`Get`/`Has`/`Delete`/`Clear`/`Resolve`/`CanResolve`, `MergedDictionaries` with last-wins, cycle detection, transitive change forwarding, `Subscribe(listener)` for `DynamicResource` reactivity.
- [Visual.Resources](src/runtime/visual.ts) — lazy per-instance dictionary.
- [Visual.TryFindResource](src/runtime/visual.ts) / `FindResource` — logical-ancestor walk with `templatedParent` fallback and active-style Resources checked first.
- [Visual.resolve_implicit_style](src/runtime/visual.ts) — implicit-style lookup via `TryFindResource(this.constructor)` plus `subscribe_implicit_style` for live re-resolution.

µ-mural's responsibility on the resource side is purely **construction** — emitting `rd.Set(key, value)` calls during the bind pass. The runtime walks, the merged-dict composition, and the reactivity are out-of-scope for the language.

## 10. Macros

```
DefForm     ::= "def" Ident "[" ParamList "]" "{" Element "}"
ParamList   ::= Param ("," Param)*
Param       ::= "#" (Ident | Integer) (":" TypeRef)? ("=" Value)?
```

Macros are pure parse-time substitution; they do not survive into the runtime. A macro can take named parameters (`#bg`) and positional parameters (`#1`, `#2` — by convention `#1` is the content body); the body is a single element subtree with holes substituted textually before bind.

```
def card[#bg, #title, #1]{
  Border[Background=#bg, CornerRadius=(8), Padding=(16)]{
    StackPanel[Orientation=Vertical]{
      TextBlock[FontSize=18, FontWeight=Bold]{#title}
      #1
    }
  }
}

card[#0d47a1, "Revenue"]{
  TextBlock{$Q4Total}
}
```

At the call site, macros are indistinguishable from controls — both are PascalCase or lowercase identifiers followed by `[…]{…}`. The compiler resolves macro names ahead of control names; a macro shadows a control of the same name (questionable; might tighten to "error on name collision" later).

## 11. Bind pass — semantics

The bind pass walks the AST and produces (logically) a constructed object graph. The compiler emits JS that performs these steps (§12); the dynamic-compile path runs them directly. The steps:

1. **Element instantiation.** `new <Class>()` for the resolved constructor (control or `ResourceDictionary` for `resources:` slots).
2. **Regular attributes.** For each `prop=v`, call `inst.set_property_value(prop, evalValue(v))`. Type conversion at this step.
3. **Attached attributes.** For each `Type.prop=v`, call `inst.set_property_value(Type, prop, evalValue(v))`. The mural runtime's composite-key storage (see [attached-properties-design.md](attached-properties-design.md)) handles this uniformly.
4. **`x:` attributes.** For each `x:ext=v`, walk the scope stack to find the advertising extension, call `ext.parse(v)` then `ext.apply(owner, inst, parsedValue)`.
5. **Body content** — dispatch on the parent's slot type per §4.
6. **Resources slot specifically** — push a `ResourceDictionary` scope frame before visiting the body; pop after.
7. **Implicit-style registration** — a `Style` child of a `ResourceDictionary` body with no `x:key` registers via `rd.Set(style.TargetType, style)` (Function key into the same map). With `x:key`, registers via `rd.Set(keyString, style)`.

### 11.1 Sketch of the resources-slot handler

```ts
function bindResourcesSlot(
    owner: Visual, slotBody: AstNode[], scopeStack: ScopeFrame[]
): void {
    const rd = owner.Resources;          // lazy-allocates in mural runtime
    scopeStack.push({
        owner: rd,
        exts: ResourceDictionary.providedExtensions,
    });

    for (const childAst of slotBody) {
        if (childAst.kind === 'KeyValueResource') {
            // @primary = #4caf50
            rd.Set(childAst.name, evalValue(childAst.value));
            continue;
        }

        const child = visit(childAst);
        const xKey = childAst.xAttrs.get('key');

        if (xKey !== undefined) {
            applyXAttrs(childAst.xAttrs, child, scopeStack);
            // x:key's apply already called rd.Set(string, child).
        } else if (child instanceof Style) {
            // Implicit style — Function-keyed registration.
            rd.Set(child.TargetType, child);
        } else {
            throw new Error(
                `${childAst.name} requires x:key (no implicit registration)`);
        }
    }

    scopeStack.pop();
}
```

## 12. Compilation

### 12.1 Architecture

Compilation runs at build time. `.mu` files compile to plain JS modules that import directly against the existing runtime ([src/runtime/](src/runtime/), [src/basic/](src/basic/), [src/visual-engine/](src/visual-engine/)) and use it imperatively — no parser ships with the consumer's runtime bundle.

The compiler is also exported as a library function so consumers can compile and run markup dynamically (server-delivered templates, designer hot-reload, prototyping). The dynamic path runs the *same* parse + bind logic; the only difference is whether the emitted JS goes through a `.js` file or `new Function(…)`.

### 12.2 Output format — direct constructor calls (E1)

The compiler emits one IIFE per Application root (or one factory function per fragment), built from direct constructor calls and `set_property_value` calls against the existing runtime API.

`dashboard.mu`:

```
Application{
  resources: {
    @primary = #4caf50
    style[targettype=Button]{ Background = @primary, Padding = (12, 6) }
    Window[x:root, Title="Demo"]{
      Border[Padding=(16)]{
        TextBlock{Hello mural}
      }
    }
  }
}
```

`dashboard.mu.js` (emitted):

```js
import { Application, Style, Setter, DynamicResource } from '@pragmatic-tech-ai/mural/runtime';
import { Border, TextBlock, Button, Window } from '@pragmatic-tech-ai/mural/basic';
import { SolidColorBrush, Color, Thickness } from '@pragmatic-tech-ai/mural/visual-engine';

export const app = (() => {
    const _app = new Application();
    const _rd  = _app.Resources;

    _rd.Set('primary', new SolidColorBrush(Color.FromHex('#4caf50')));

    const _s0 = new Style(Button);
    _s0.Setters.push(new Setter('Background', new DynamicResource('primary')));
    _s0.Setters.push(new Setter('Padding', new Thickness(12, 6, 12, 6)));
    _rd.Set(Button, _s0);

    const _root = new Window();
    _root.set_property_value('Title', 'Demo');

    const _border = new Border();
    _border.set_property_value('Padding', new Thickness(16));

    const _t0 = new TextBlock();
    _t0.set_property_value('Text', 'Hello mural');

    _border.Child = _t0;
    _root.Content = _border;
    _rd.Root = _root;

    return _app;
})();
```

Plain JS over the existing runtime API. No new abstractions, no helper DSL, no second surface to maintain. Stack traces from a misconfigured property point at real lines of emitted code, and the bundler gzips repeated `set_property_value` strings to near-nothing.

### 12.3 Export shape by root form

| Source root           | Compiled module exports                                                |
|-----------------------|------------------------------------------------------------------------|
| `Application{…}`      | `export const app: Application` — eagerly instantiated at import time  |
| any other root        | `export function create(): Visual` — lazy factory                       |

Eager for apps because a `.mu` application is a singleton — you imported it because you want it instantiated. Lazy for fragments because a `BookCard` template needs to be instantiable many times.

If §15.1 is resolved "yes," a file whose outermost form is a SlotAssign (`resources:` or `MainWindow:`) or a bare resource form implicitly wraps in `Application{…}` and the export takes the eager shape.

### 12.4 Compiler API

```ts
// mural/compiler

/** Pure source-to-source. Returns the JS module body as a string. Used
 *  by build-time tooling (Vite plugin, CLI, etc.) to emit .js files. */
export function compile(source: string, opts?: CompileOptions): string;

/** Wraps compile() with new Function(...) and runs the result. Returns the
 *  constructed Application (or Visual for fragments). Used by consumers
 *  needing dynamic compile of server-delivered or user-templated markup. */
export function instantiate(source: string, opts?: CompileOptions): Application | Visual;

export interface CompileOptions {
    /** Resolves `import X from "name"` to source text. */
    resolveImport?: (name: string) => string;
    /** Pre-registered macros shared across compile calls. */
    macros?: Record<string, MacroDefinition>;
}
```

Two entry points; both share the AST → bind → emit pipeline internally. The dynamic path costs the consumer the compiler bundle (~tens of KB); the static path costs nothing at runtime.

### 12.5 Build tooling

Three thin wrappers over `compile()`:

| Wrapper        | Form                                                          | Priority |
|----------------|---------------------------------------------------------------|----------|
| Vite plugin    | `vitePluginMural()` transforms `import './x.mu'` at build     | first    |
| CLI            | `npx mural compile src/*.mu --out-dir dist`                   | second   |
| esbuild loader | Same idea, for esbuild users                                  | later    |

The Vite plugin lands first because it matches the active consumer workflow. The CLI follows for non-Vite environments. Each is ~40 lines of glue over `compile()`.

## 13. Hosting — bare HTML page

The minimal consumer pattern. An HTML page with one element defining the viewport; a script that imports a compiled `.mu` module and mounts it.

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Mural Demo</title>
  <style>
    html, body { margin: 0; height: 100%; }
    #app { width: 100vw; height: 100vh; }
  </style>
</head>
<body>
  <div id="app"></div>
  <script type="module">
    import { app } from './dashboard.mu.js';
    app.Mount(document.getElementById('app'));
  </script>
</body>
</html>
```

Two lines of JS. The HTML doesn't know mural exists; it imports a compiled module like any other JS module. The runtime parser is not in the bundle.

`Application.Mount(host, options?)` constructs an `HtmlTarget` against the host element, sets `target.Content` to `this.Root`, and returns the target so the caller can dispose it on teardown or hold a handle. The `HtmlTarget` handles viewport sizing via `ResizeObserver` ([html-target.ts:67-79](src/visual-engine/targets/html-target.ts)).

For the dynamic-compile path (when source is fetched or user-supplied):

```html
<script type="module">
  import { instantiate } from '@pragmatic-tech-ai/mural/compiler';
  const src = await fetch('/templates/admin-panel.mu').then(r => r.text());
  const app = instantiate(src);
  app.Mount(document.getElementById('app'));
</script>
```

Same `Mount` call, source comes from elsewhere. The page now ships the compiler.

## 14. EBNF — full grammar

```ebnf
File              ::= TopForm*

TopForm           ::= Import | Element
                    | DefForm           (* macros may also appear in resources *)

Import            ::= "import" Ident ("from" String)?

DefForm           ::= "def" Ident "[" ParamList "]" "{" Element "}"

Element           ::= Name AttrBlock? Body?
Name              ::= PascalIdent | lowerIdent
AttrBlock         ::= "[" AttrList "]"
Body              ::= "{" BodyContent "}"

AttrList          ::= NamedAttrs | PositionalAttrs | (* empty *)
NamedAttrs        ::= NamedAttr ("," NamedAttr)* ","?
PositionalAttrs   ::= Value ("," Value)* ","?
NamedAttr         ::= AttrPath "=" Value
AttrPath          ::= Ident ("." Ident)?               (* attached *)
                    | "x:" Ident                       (* scope extension *)

BodyContent       ::= StringContent                    (* string-typed slot *)
                    | BodyItem*                        (* element-typed or mixed *)
BodyItem          ::= SlotAssign | Element
SlotAssign        ::= Ident ":" SlotValue
SlotValue         ::= Value | "{" BodyContent "}"

(* Resource forms — keyword-prefixed Element variants, but the body grammar
   inside is form-specific. *)
StyleForm         ::= "style" "[" MetaAttrList "]" "{" SetterList "}"
TemplateForm      ::= "template" "[" MetaAttrList "]" "{" Element "}"
DataTemplateForm  ::= "datatemplate" "[" MetaAttrList "]" "{" Element "}"
MetaAttrList      ::= MetaAttr ("," MetaAttr)* ","?
MetaAttr          ::= MetaAttrName "=" Value
MetaAttrName      ::= "x:" Ident | Ident

SetterList        ::= SetterItem*
SetterItem        ::= PropertySetter | TriggerGroup
PropertySetter    ::= AttrPath "=" Value
TriggerGroup      ::= "when" "{" TriggerExpr "}" "{" SetterList "}"
TriggerExpr       ::= TriggerOr
TriggerOr         ::= TriggerAnd ("or" TriggerAnd)*
TriggerAnd        ::= TriggerTerm ("and" TriggerTerm)*
TriggerTerm       ::= "not"? Ident ("=" Value)?
                    | "(" TriggerExpr ")"

ParamList         ::= Param ("," Param)*
Param             ::= "#" (Ident | Integer) (":" TypeRef)? ("=" Value)?

Value             ::= Number | String | EnumIdent
                    | Color | Tuple | Size | List
                    | Binding | TemplateBinding
                    | StaticRes | DynamicRes
                    | MacroHole | InlineExpr
                    | TypeRef

Number            ::= "-"? Digit+ ("." Digit+)?
String            ::= '"' ( "\\" AnyChar | NonQuoteNonBackslash )* '"'
Color             ::= "#" ( HexDigit{3} | HexDigit{6} | HexDigit{8} | ColorName )
Tuple             ::= "(" Value ("," Value)* ")"
Size              ::= "<" Value "," Value ">"
List              ::= "[" Value ("," Value)* "]"       (* value position only *)

Binding           ::= "$" PathExpr
TemplateBinding   ::= "$$" Ident
StaticRes         ::= "@" Ident
DynamicRes        ::= "@@" Ident
MacroHole         ::= "#" (Ident | Integer)
InlineExpr        ::= "$(" Expr ")$"

PathExpr          ::= Ident ("." Ident)*
TypeRef           ::= PascalIdent

Ident             ::= [A-Za-z][A-Za-z0-9]*             (* no '-', no '_' *)
PascalIdent       ::= [A-Z][A-Za-z0-9]*
lowerIdent        ::= [a-z][A-Za-z0-9]*

Comment           ::= LineComment | BlockComment
LineComment       ::= "//" (NonEOL)* EOL
BlockComment      ::= "/*" (AnyChar — "*/")* "*/"

StringContent     ::= ( "\\" AnyChar | Sigil | NonBraceChar )*
Sigil             ::= Binding | TemplateBinding | StaticRes | DynamicRes
                    | Color | MacroHole | InlineExpr
```

The grammar is LL(1) except for `BodyContent`, where the dispatch between `StringContent` and `BodyItem*` depends on the parent's slot type — a one-bit lookup at parse time. This is the same context-sensitivity that XAML's `[ContentProperty]` resolution introduces.

## 15. Open questions

These have not been pronounced on yet; the spec is consistent with either resolution.

### 13.1 Implicit `Application` wrapper at file root

When the outermost form of a `.mu` file is a SlotAssign (`resources:` or `MainWindow:`) or a bare resource form, wrap implicitly in `Application{…}`. Reduces boilerplate for app-spec files; matches XAML's `App.xaml` ergonomics. Vote: yes, for ergonomics.

### 13.2 Merged-dictionary syntax

The runtime supports `AddMergedDictionary`. Two natural surfaces:

(A) Reserved entry inside `resources:`:
```
resources: {
  merge: [@externalRd1, @externalRd2]
  …
}
```

(B) File-root `import` directives that lower to `Application.Resources.AddMergedDictionary(…)`:
```
import @themeBase from "themes/base.mu"
```

Both can coexist. Default vote: A as primary; B as a file-level convenience that lowers to the same calls.

### 13.3 Extension contract — `parse`-only vs `apply`-bearing

The `KeyExtension.apply` is trivially `rd.Set(key, child)`. Whether the extension owns that line or the bind pass does it directly is a style call:

- `parse`-only: the bind pass calls `rd.Set` after extension parsing. Cleaner separation: the extension is just a typed value validator.
- `apply`-bearing: the extension owns registration. Uniform across all directives; future extensions with more elaborate registration logic (e.g. `x:name` registering in a namescope) follow the same shape.

The spec above uses `apply`-bearing for uniformity. Switching to `parse`-only is a small, local change.

### 13.4 Macros vs controls — shadowing rule

A macro named `Card` and a control named `Card` (both at the same site of resolution) — does the macro win, does this raise a static error, or are macros and controls in separate namespaces? Current spec: macro shadows. Likely better: error on collision.

### 13.5 `BasedOn` for style composition

XAML's `Style.BasedOn` lets one Style inherit setters from another. Whether µ-mural exposes this as `style[basedon=@parent, …]{…}` (probably yes) and how it interacts with implicit vs explicit keys is a future-work decision.

## 16. What's explicitly out of scope

- Type-converter authoring (covered by the runtime's existing converter mechanism).
- Bind-time validation of property/value type compatibility — runtime error is acceptable; static error is better but not blocking.
- A standalone tool (CLI, watcher, language server). The first integration target is in-process compilation invoked by build tooling.
- Source maps for runtime errors back to `.mu` locations — desirable, not required for a v0.

## 17. References

- [attached-properties-design.md](attached-properties-design.md) — composite-key storage that µ-mural's `Type.prop=v` attached syntax routes through.
- [visual-engine-design.md](visual-engine-design.md) — the render layer below the control library.
- [src/runtime/resource-dictionary.ts](src/runtime/resource-dictionary.ts) — the dictionary µ-mural's `resources:` slot fills.
- [src/runtime/visual.ts](src/runtime/visual.ts) — `TryFindResource`, implicit-style resolution, the resource walk.
- [src/basic/](src/basic/) — the control library whose constructors the bind pass targets.
