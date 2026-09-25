# Control Templating

The mechanism that lets a control define its visual structure as a
`ControlTemplate` separate from its data — and lets consumers re-skin
controls without touching the consumer-facing API. Mirrors WPF's
`Control` + `ControlTemplate` + `ContentControl` + `ContentPresenter` +
`TemplatedParent` pattern.

**Implemented in:**
- [basic/templates/control-template.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/templates/control-template.ts) —
  `ControlTemplate`, `TemplateFactory`, `TemplateInstance`,
  `TemplateBinding`
- [basic/templates/content-presenter.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/templates/content-presenter.ts) —
  `ContentPresenter`
- [basic/content-control.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/basic/content-control.ts) —
  `ContentControl`
- [runtime/visual.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/visual.ts) — `TemplatedParent` accessor,
  `Name` + `FindName` + `NameScope`
- [runtime/namescope.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/namescope.ts) — `NameScope`

See also: [visual-tree.md](visual-tree.md) for the visual/logical tree
split that templating motivates, [items-and-scrolling.md](items-and-scrolling.md)
for `ItemsPresenter` (the items-collection analogue of
`ContentPresenter`).

## 1. Why templating

A `ContentControl` has a single piece of consumer-supplied `Content`
plus a `Template` that defines the visual surround. When the template
is applied, the consumer's Content is *visually* slotted into the
template's `ContentPresenter`, but *logically* remains a direct child
of the ContentControl.

```
Consumer code:                       Visual tree (after template apply):
  cc.Template = template               cc
  cc.Content  = TextBlock("Hi")          Border        ← from template
                                           ContentPresenter
                                             TextBlock("Hi")  ← consumer's Content

Logical tree:
  cc
    TextBlock("Hi")                   ← skips template internals
```

The two-tree split (see [visual-tree.md](visual-tree.md)) is what makes
this work: rendering walks the visual tree (with all the template
chrome); property inheritance / `FindName` / resources walk the logical
tree (skipping template internals, going straight from Content to its
ContentControl ancestor).

## 2. ControlTemplate

Mural uses an imperative-factory template form. A `ControlTemplate`
wraps a function `(templatedParent: Visual) => Visual` that constructs
a fresh visual subtree each call.

```ts
import { ControlTemplate, ContentPresenter } from '../basic/index.js';
import { Border } from '../basic/index.js';
import { SolidColorBrush } from '../visual-engine/index.js';

const cardTemplate = new ControlTemplate(templatedParent => {
    const border = new Border();
    border.Background = new SolidColorBrush(Color.White);
    border.BorderBrush = new SolidColorBrush(Color.Black);
    border.BorderThickness = new Thickness(1);
    border.Padding = new Thickness(16);

    const presenter = new ContentPresenter();
    border.SetChild(presenter);

    return border;   // visual root
});
```

`templatedParent` is the control whose template the factory is
producing for — useful if the factory needs to read the control's
properties at construction time, and stamped automatically on every
generated visual by the apply pipeline.

### Apply

`ControlTemplate.Apply(templatedParent)` runs the factory, walks the
resulting subtree to stamp `templatedParent` on every node (so
`TemplateBinding` can dereference back), creates a per-instance
`NameScope` and registers every named Visual in it, then finds the
first `ContentPresenter` (or `ItemsPresenter`) in the subtree. Returns
a `TemplateInstance`:

```ts
interface TemplateInstance {
    readonly root: Visual;
    readonly contentPresenter: ContentPresenter | undefined;
}
```

ContentControl owns the apply call — consumers normally never call
`Apply` directly.

## 3. ContentPresenter

A Visual whose `visualChild` is the templated control's slotted
content. Its `logicalChildren` is intentionally empty — the content
logically belongs to the ContentControl, not the presenter.

```ts
// Inside a ControlTemplate factory:
const presenter = new ContentPresenter();
border.SetChild(presenter);
return border;

// At ContentControl.Content = something:
// → ContentControl finds the presenter via TemplateInstance,
// → calls presenter.SetContent(something) which AttachVisual's it.
// → something's logicalParent stays the ContentControl (set separately
//   via AttachLogical), only visualParent becomes the presenter.
```

`SetContent` is the wiring point — only ContentControl calls it.
Measure / Arrange delegate to the slotted content.

## 4. ContentControl

```ts
import { ContentControl } from '../basic/index.js';

const cc = new ContentControl();
cc.Template = cardTemplate;
cc.Content  = new TextBlock('Hi');
```

Properties:
- `Content: Visual | undefined` — consumer's content. Logical child of
  the control. Visual parent becomes the ContentPresenter when a
  template with a presenter is applied; otherwise the content has no
  visual home and won't render.
- `Template: ControlTemplate | undefined` — when set, applied
  immediately. Setting to undefined tears down the template tree.

### Re-templating preserves Content

Swapping `Template` to a fresh instance keeps `Content` the same
instance — only the template tree is rebuilt and the content re-slotted
into the new presenter. The two-tree headline benefit:

```ts
cc.Content  = textBlock;
cc.Template = templateA;     // textBlock visually under presenterA
cc.Template = templateB;     // textBlock now visually under presenterB
assert.equal(cc.Content, textBlock);    // same instance
```

### GetTemplateChild

WPF parity — look up a named template part within the applied
template's `NameScope`.

```ts
const cc = new ContentControl();
cc.Template = new ControlTemplate(_tp => {
    const b = new Border();
    b.Name = 'PART_Background';
    b.SetChild(new ContentPresenter());
    return b;
});
const bg = cc.GetTemplateChild('PART_Background');   // → the Border
```

Returns undefined if no template applied or no Visual with that name in
the template.

## 5. TemplateBinding

A convenience that creates a `Binding` whose source is the
`templatedParent`. Bind a template-internal property to a property on
the control.

```ts
import { TemplateBinding } from '../basic/index.js';

const template = new ControlTemplate(tp => {
    const border = new Border();
    border.set_property_value('Background',
        TemplateBinding(tp, 'Background'));
    return border;
});

// When applied:
const cc = new ContentControl();
cc.Template = template;
Model.RegisterProperty(ContentControl, 'Background', undefined, MetaData.Render);
cc.set_property_value('Background', new SolidColorBrush(Color.Blue));
// The internal Border's Background reactively becomes blue.
```

Under the hood: just `new Binding(templatedParent, path, OneWay)`. The
factory captures `tp` (the templatedParent argument), so the resulting
binding tracks the right control.

## 6. TemplatedParent back-pointer

Every Visual gets a `templatedParent` accessor (and `SetTemplatedParent`
setter). Stamped by `ControlTemplate.Apply` on every node in a
template's generated subtree. Read by `TemplateBinding`, by
`walk_inherited` for template-internal inheritance, by `TryFindResource`
for template-internal resources, by `FindName` for template-internal
named-element walks.

```ts
const cc = new ContentControl();
cc.Template = new ControlTemplate(_tp => new Border());
const border = cc.visualChildren[0];
border.templatedParent;     // → cc
```

User-supplied content does NOT have `templatedParent` set — the
template-internals walk stamps the subtree returned by the factory,
which doesn't include the consumer's `Content` (slotted in
separately).

## 7. Template-internal inheritance

Properties marked `MetaData.Inherits` flow from logical ancestors.
Template-internal Visuals have no `logicalParent` (the template root's
logical parent stays undefined — it's not in the consumer's logical
tree). They inherit via `templatedParent` fallback in
`walk_inherited`:

```
template-internal Border.walk_inherited
  → border.logicalParent = undefined
  → fall through to border.templatedParent = cc
  → look up the inheritable property on cc
  → if not found, continue up cc.logicalParent
```

So a `Foreground` set on the consumer's `Window` flows down through
the ContentControl into the template-internal `TextBlock` that
displays the Content's text.

## 8. NameScope + FindName

Each `ControlTemplate.Apply` creates a per-instance `NameScope`,
attached to the template root. Every Visual whose `.Name` was set in
the factory gets registered in it. `FindName(name)` from any logical
descendant walks up until it hits the first `NameScope` and resolves
there.

```ts
const t = new ControlTemplate(_tp => {
    const b = new Border();
    b.Name = 'PART_Outer';
    const presenter = new ContentPresenter();
    presenter.Name = 'PART_Inner';
    b.SetChild(presenter);
    return b;
});

const cc1 = new ContentControl(); cc1.Template = t;
const cc2 = new ContentControl(); cc2.Template = t;

cc1.GetTemplateChild('PART_Outer');   // → cc1's Border
cc2.GetTemplateChild('PART_Outer');   // → cc2's Border (different instance)
```

Per-instance scope means the same name in two template instances doesn't
collide. Duplicate names within one template (or its `BasedOn` chain)
throw at Apply time — catches the obvious mistake early.

Consumer-supplied content (slotted into a `ContentPresenter`) has
`logicalParent = ContentControl`, so its `FindName` walk goes around
the template's namescope entirely — template-internal names are not
visible to user content. Correct WPF semantics.

## 9. Limitations

Roadmap items (`MultiBinding` for `TemplateBinding`, `Style.TargetType=TemplateType`,
`EventTrigger` inside templates) are tracked in
[current-backlog.md § 11](https://github.com/pragmatic-tech-ai/mural/blob/main/current-backlog.md) and § 7.

- **Markup is `.mu`, not XAML.** Templates can be authored declaratively
  in `.mu` or imperatively as TypeScript factory functions. No XAML
  parser.
- **First-presenter-wins for `ContentPresenter` / `ItemsPresenter`
  discovery.** Templates with multiple presenters are unusual and
  ambiguous; we don't try to disambiguate.
- **Template internals' inheritance subscriptions are NOT auto-rewired
  on a tree mutation.** If the consumer reparents the templated
  control after the template was applied, the template internals'
  inheritance was wired at apply time and may go stale. Not currently
  an issue because re-templating preserves the logical structure.
- **`templatedParent` is a single hop.** A template that contains a
  templated control (a Button template containing another Button)
  would have the inner Button's template internals see the inner
  Button as templated parent, not transitively the outer. WPF
  semantics; correct but worth knowing.
</content>
