# Commands and command surfaces

UI/UX design for the command system: ToolBar, Menu (hamburger fly-out),
and Ribbon (core + contextual tabs). Commands stay pure `ICommand`s on
the VM; all visual UX (icons, text, gesture display, chrome states)
lives on the **control** side. Surface controls are templated
`ItemsControl`s over collections of invokers; the same `ICommand`
appears in multiple surfaces without redeclaration on the command layer.

This document captures the design at sketch-level: control inventory,
DPs, UX rules, and mockups. The **infrastructure** (5.9.1–5.9.5) has
shipped — `ICommandSource` contract, `CommandTarget`, `RoutedCommand` +
`CommandBindings`, `InputBindings` + `KeyBinding` / `MouseBinding`, the
four named-command libraries (`ApplicationCommands` / `EditingCommands`
/ `NavigationCommands` / `MediaCommands`), and
`CommandManager.RequerySuggested` all live now (see
[completed-backlog.md](https://github.com/pragmatic-tech-ai/mural/blob/main/completed-backlog.md) §5.9). What's still
pending is the **surface** controls (5.11) — ToolBar / Menu / Ribbon
plus the `commands` demo that exercises them.

**Related:** [behaviors.md](behaviors.md),
[marquee-selection.md](marquee-selection.md),
[items-and-scrolling.md](items-and-scrolling.md).

## 1. Layered architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  Surface controls (this exercise)                                  │
│     ToolBar / Menu / Ribbon and their item subclasses.             │
│     Own ALL visual UX: icons, text, gesture display, chrome states.│
├────────────────────────────────────────────────────────────────────┤
│  ICommandSource mixin (backlog 5.9.1)                              │
│     Command + CommandParameter + CommandTarget on every invoker.   │
│     CanExecuteChanged → auto-disable visual state.                 │
├────────────────────────────────────────────────────────────────────┤
│  InputBindings (backlog 5.9.2)                                     │
│     KeyBinding[Key, Modifiers, Command] declared per Visual,       │
│     dispatched from the focus root via PreviewKeyDown.             │
├────────────────────────────────────────────────────────────────────┤
│  ICommand (shipping)                                               │
│     Execute / CanExecute / CanExecuteChanged. RelayCommand.        │
└────────────────────────────────────────────────────────────────────┘
```

### Why visual UX lives on the control, not the command

The natural pull toward WPF-style `RoutedUICommand` (carrying
`Text` / `Icon` / `KeyGesture` on the command itself) was deliberately
rejected. The trade-off:

| Approach | Reuse | Per-surface tailoring | Coupling |
|---|---|---|---|
| Metadata on command | High — declare once, every surface reads the same | Hard — same label everywhere | Command leaks presentation concerns |
| Metadata on control | Lower — each invoker declares its own | Easy — Ribbon can say "Delete shape" where Menu just says "Delete" | Clean separation; commands are pure logic |

The framework's MVVM-first stance puts commands on the VM; the control
layer is where presentation already lives, so that's where Text /
Icon / display gesture belong. Reuse of the same visual config across
surfaces happens through `Style` and `ResourceDictionary` keyed
resources — the standard mechanisms — not through a special
command-metadata layer.

## 2. ICommand (shipping)

The existing primitive in [runtime/command.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/command.ts).

```ts
interface ICommand
{
    Execute(parameter?: unknown): void;
    CanExecute(parameter?: unknown): boolean;
    AddCanExecuteChanged(listener: () => void): void;
    RemoveCanExecuteChanged(listener: () => void): void;
}
```

`RelayCommand` is the standard concrete: takes an `execute` callback,
an optional `canExecute` predicate, and a `RaiseCanExecuteChanged()`
the VM calls when its world changes. Surface controls subscribe to
`CanExecuteChanged` to auto-disable.

## 3. ICommandSource (shipping)

A contract every command invoker implements. Three DPs:

| DP | Type | Default | Meaning |
|---|---|---|---|
| `Command` | `ICommand \| undefined` | `undefined` | The command to invoke. `undefined` = the source is non-interactive (or driven by other means like a click handler). Accepts both `RelayCommand` and `RoutedCommand`. |
| `CommandParameter` | `unknown` | `undefined` | Passed as the argument to `Execute` / `CanExecute`. |
| `CommandTarget` | `Visual \| undefined` | `undefined` | RoutedCommand-only override of the routing dispatch target. Plain `ICommand` ignores this DP. When unset, RoutedCommand dispatches from the source Visual itself. |

`Button` implements `ICommandSource` today through `CommandSourceHelper`
([src/runtime/command-source.ts](https://github.com/pragmatic-tech-ai/mural/blob/main/src/runtime/command-source.ts)). Each
command-source control registers its own `Command` /
`CommandParameter` / `CommandTarget` DPs and forwards
`OnPropertyChanged` writes to a `CommandSourceHelper` instance that
handles the cached `_canExecute` boolean, the `CanExecuteChanged`
subscription, and the RoutedCommand-vs-plain-ICommand dispatch branch.
Future ICommandSource controls (`MenuItem`, `ToolBarButton`,
`RibbonButton`, `Hyperlink`, `ToggleButton`) follow the same pattern.

**Auto-disable contract**: when `Command !== undefined` and
`Command.CanExecute(CommandParameter) === false`, the source visually
appears disabled (low alpha, no hover/press states, click ignored).
Driven by `CanExecuteChanged` — every invoker subscribes when
`Command` is set, unsubscribes when it clears.

## 4. InputBindings (shipping)

Per-`Visual` collection of gesture-to-command mappings:

```mu
Window x:name="root" {
    InputBindings {
        KeyBinding   [Key=S, Modifiers=Control, Command=$SaveCmd]
        KeyBinding   [Key=Delete,                Command=$DeleteCmd]
        MouseBinding [Gesture=MiddleClick,       Command=$PanCmd]
    }
    /* content */
}
```

Dispatch model: the routed-event walker's `KeyDown` bubble pass calls
into `_tryFireInputBindingsForVisual` at each ancestor on the route up
from the focused element. Per-instance bindings (`Visual.InputBindings`)
are consulted first, then per-class bindings registered via
`CommandManager.RegisterClassInputBinding`. The innermost matching
binding wins because the bubble walker stops on `args.Handled = true`.
When the bound command is a `RoutedCommand`, dispatch flows through
`CommandManager.Execute` against `CommandTarget ?? host`; for plain
`ICommand` the binding calls `Execute(CommandParameter)` directly.
`KeyBinding` fires on `KeyDown` only (matches WPF — `KeyUp` doesn't
trigger commands).

**For surface controls**: a `MenuItem`'s displayed `InputGestureText`
is a STRING, not a wire. It's the menu's UI hint. The actual shortcut
firing is the matching `KeyBinding` declared elsewhere in the tree.
Both reference the same command, so the menu's hint and the keyboard
shortcut stay consistent. This is the same separation `WPF`
maintains.

## 5. ToolBar

Flat strip of icon/text buttons. Mixed default: most buttons are
icon-only with tooltip; high-value verbs opt into text via
`ShowText=true`.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ [📂 Open] [💾 Save] │ [✂] [📋] [📄] │ [⊘ Delete] [⎘ Duplicate] │ [↶] [↷] │ ⋯ │
└─────────────────────────────────────────────────────────────────────────────┘
   ShowText=true        ShowText=false  ShowText=true (important)    ShowText=false   overflow
```

### Controls

- `ToolBar` — `ItemsControl`. Default `ItemsPanel` is `ToolBarPanel`
  (horizontal stack with last-item-wins-or-overflows logic).
- `ToolBarPanel` — measures children left-to-right, collapses anything
  past the width budget into a popup-fed `ToolBarOverflowPanel`.
- `ToolBarButton` — Button-derived `ICommandSource`. DPs:
  - `Icon`   — Visual or brush, 16-20px painted at left.
  - `Text`   — string. Always rendered when `ShowText=true`.
  - `ShowText` — bool, default `false`.
  - `Command`, `CommandParameter` — from ICommandSource.
- `ToolBarToggleButton` — `ToolBarButton` + `IsChecked` two-way DP.
  Used for B/I/U-style mutually-exclusive-or-orthogonal groups.
- `ToolBarSeparator` — 1×24 vertical line with 4px margin each side.
- `ToolBarOverflowPanel` — popup hosting items that didn't fit; the
  ToolBarPanel renders a `⋯` chevron at the right edge to open it.

### UX rules

- 28-32px row height. Icon 16-20px; padded 6-8px each side.
- Visual states: idle / hover / pressed / checked / disabled (50% alpha).
- Auto-tooltip composes `<Text> (<gesture>)` from the matching
  InputBinding's key gesture (looked up by command identity on the
  focus root). Without `Text`, tooltip is `<gesture>` alone.
- Disabled buttons don't respond to hover/click; tooltip still shows.
- Overflow: items that don't fit collapse into the chevron popup in
  original order, including their separators.

## 6. Menu — hamburger fly-out

The Menu control opens from a `MenuButton` (hamburger). Top-level
items render in a vertical popup; submenus fly out to the right.

```
[☰] Diagrammer
 ↓
┌──────────────────┐                ┌────────────────────────────┐
│ 📁 File       ▸  │ → hover Edit → │ ✂  Cut         Ctrl+X      │
│ ✏  Edit       ▸  │                │ 📋 Copy        Ctrl+C      │
│ 👁 View       ▸  │                │ 📄 Paste       Ctrl+V      │
│ ?  Help       ▸  │                │ ────────────────────────── │
└──────────────────┘                │ ⊘  Delete      Del         │
                                    │ ⎘  Duplicate   Ctrl+D      │
                                    │ ────────────────────────── │
                                    │    Select All  Ctrl+A      │
                                    └────────────────────────────┘
```

### Controls

- `MenuButton` — Button-derived control with no `Command` of its own.
  Holds a `Menu` and opens it on click as a popup anchored below.
- `Menu` — popup-hosted `ItemsControl` of `MenuItem`s. Same control is
  used at every nesting level (root popup, submenu popups,
  `ContextMenu`); only the host is different.
- `MenuItem` — `ICommandSource` + `ItemsControl` (nested `Items` = its
  own submenu). DPs:
  - `Header` — string text shown as the main label.
  - `Icon` — leading icon Visual.
  - `InputGestureText` — string shown right-aligned (e.g. `Ctrl+S`).
    Pure display; doesn't wire the shortcut.
  - `Items` — child `MenuItem`s; non-empty = submenu, the row shows a
    `▸` chevron in the right column and opens on hover/click.
  - `Command`, `CommandParameter` — inherited from ICommandSource;
    leaf items invoke them when clicked.
  - `IsCheckable`, `IsChecked` — checkbox-style menu items.
- `Separator` — horizontal divider; reused from ToolBar (same primitive).
- `ContextMenu` — `Menu` variant that positions at the cursor; opens
  on right-click on any Visual that sets `ContextMenu` attached DP.

### Template parts inside MenuItem

The row layout is a 4-column grid:

```
[icon  16px][header                 *  ][gesture 80px][chevron 16px]
```

Columns auto-hide when empty (no icon column when no item in the menu
has an Icon; no gesture column when no item declares
`InputGestureText`). This keeps a "no-icon" submenu from wasting 16px.

### UX rules

- Popup row height: 24px.
- Top-level row (vertical layout under the hamburger): same 4-column
  shape; submenu chevron always shown.
- Submenu opens to the RIGHT of the parent row on hover (immediately
  if a sibling submenu is already open; ~400ms otherwise — matches
  Windows menu hover delay).
- Esc closes one nesting level; click outside the popup chain closes
  all.
- Keyboard:
  - **Alt** focuses the active menu popup (if any open) or opens the
    hamburger and focuses the top-level row.
  - **↑/↓** navigate rows.
  - **→** opens submenu, **←** closes one level.
  - **Enter** activates the focused item (invokes Command).
  - Letter keys jump to the first item whose `Header` starts with the
    letter (case-insensitive). Repeating cycles through matches.
- Underlined-accelerator support: `_S_ave` notation in Header marks
  the `S` as the accelerator; `Alt+S` activates while menu is focused.

## 7. Ribbon — core + contextual tabs

Tabbed grouped chrome. Two tab kinds:
- **Stable** tabs always visible (Home / Insert / View / …).
- **Contextual** tabs hidden by default; appear when a VM predicate
  flips. Visually distinguished by a non-default tab `Color` — an
  inline-badge style, no separate banner above the tab strip.

```
No selection — only stable tabs:
┌────────────────────────────────────────────────────────────────────────┐
│  Home   Insert   View                                                   │
├────────────────────────────────────────────────────────────────────────┤
│  ┌────────┐ ┌──────────────┐ ┌────────────────────────┐                │
│  │   📂   │ │ [✂][📋][📄]  │ │ [Background ▼]         │                │
│  │  Open  │ │  Clipboard   │ │ [Theme       ▼]        │                │
│  │        │ │              │ │  Appearance            │                │
│  └────────┘ └──────────────┘ └────────────────────────┘                │
└────────────────────────────────────────────────────────────────────────┘

With selection — contextual "Format" tab badged in colour:
┌────────────────────────────────────────────────────────────────────────┐
│  Home   Insert   View   │ ██ Format ██                                  │
├────────────────────────────────────────────────────────────────────────┤
│  (Format tab body)                                                      │
│  ┌────────────────┐ ┌──────────────────┐ ┌────────────────────────────┐│
│  │ [⊘ Delete]     │ │ [Bring Front]    │ │ [Align L][C][R]            ││
│  │ [⎘ Duplicate]  │ │ [Send  Back]     │ │ [Align T][M][B]            ││
│  │     Edit       │ │   Z-order        │ │   Alignment              ↘ ││
│  └────────────────┘ └──────────────────┘ └────────────────────────────┘│
└────────────────────────────────────────────────────────────────────────┘
```

### Controls

- `Ribbon` — overall shell (TabControl-shaped). Two `ItemsControl`s
  underneath:
  - `Tabs`             — stable `RibbonTab`s.
  - `ContextualGroups` — `RibbonContextualGroup`s, each containing
    its own contextual tabs.
- `RibbonTab` — one tab page. DPs:
  - `Header` — string label.
  - `Items`  — child `RibbonGroup`s.
  - `Color`  — optional accent for contextual tabs (background fill
    when the tab is rendered). `undefined` = stable look.
  - `IsActive` — bool, default `true`. Setting to `false` collapses
    the tab from the strip. For contextual tabs, bind this to a VM
    predicate (e.g. `[IsActive=$HasSelection]`).
  - `IsSelected` — manages which tab body is currently visible.
- `RibbonContextualGroup` — wraps related contextual tabs sharing a
  `Color`. DPs: `Header`, `Color`, `Tabs`, `IsActive`.
- `RibbonGroup` — bordered box. DPs:
  - `Header` — label rendered at the bottom of the group.
  - `Items`  — child invokers (RibbonButtons, RibbonSplitButtons, …)
    and/or `RibbonSmallButtonColumn`s.
  - `LaunchCommand` — optional. When set, a `↘` corner icon at the
    group's bottom-right is rendered and invokes the command on click.
- `RibbonSmallButtonColumn` — vertical stack of up to 3 small buttons
  (the standard Office layout).
- `RibbonButton` — `ICommandSource`. DPs:
  - `LargeIcon` — 32px Visual painted top-centered for large layout.
  - `SmallIcon` — 16-20px Visual painted left for small layout.
  - `Text`      — label, rendered below the icon (large) or to the
                  right (small).
  - `Size`      — `RibbonButtonSize.Large` (default) or `Small`.
- `RibbonToggleButton` — `RibbonButton` + `IsChecked` two-way DP.
- `RibbonSplitButton` — main action + tiny right-side dropdown arrow.
  Two click regions: the main icon area invokes the primary `Command`;
  the dropdown opens a `Menu`-popup of secondary commands.
- `RibbonDropDownButton` — single dropdown region; the whole button
  opens a Menu-popup. No primary action.

### UX rules

- Tab strip 28px tall; ribbon body 92-100px (one large button column
  + small column + group label all fit).
- Group: 4px padding, 1px right separator, header centered at the
  bottom.
- Large button: 64×88. 32px icon centered top; text below, wraps to
  two lines, ellipsizes if longer.
- Small button: 24px tall. 16-20px icon + 6px gap + text. Stack 3 per
  column in a `RibbonSmallButtonColumn`.
- Split-button: dropdown arrow region separated by a faint vertical
  divider on hover — UX cue for the two halves.
- Group launcher `↘`: 12×12 at bottom-right corner, opens whatever
  `LaunchCommand` invokes (typically a dialog).
- Tab switching: instant; no animation in v1.
- Contextual tabs use their group's `Color` as the tab-header fill.
  No separate band above the strip; single-row tab strip layout
  retained.

### Out of scope for v1

- **Backstage** (the File-tab full-screen view typical of Office).
  File can be a normal tab.
- **Quick Access Toolbar (QAT)** — the tiny row of icons above the
  tab strip. Skipping; the regular ToolBar serves the same role.
- **Minimize ribbon** — double-click-tab-to-collapse. Out.
- **Galleries** — large preview grids inside groups. Use the `Menu`
  popup pattern via `RibbonDropDownButton`.
- **Touch / pen sizing modes** — Office has a "touch" toggle that
  enlarges hit targets. Out.

## 8. Cross-surface concerns

### Tooltip integration

Every `ICommandSource` produces an auto-tooltip composed from:
- `Text` (or `Header` for `MenuItem`).
- The matching `KeyBinding` gesture for the same `Command` on the
  focus root chain — formatted as `"<text> (Ctrl+S)"`.

Consumers can override by setting `Tooltip` explicitly.

### CanExecute → disabled chrome

When `Command !== undefined`, the source subscribes to
`Command.CanExecuteChanged`. The result of `Command.CanExecute(CommandParameter)`
drives an `IsEffectivelyEnabled` internal flag. The flag participates
in a Style trigger that swaps to disabled visuals (50% alpha, no
hover state, click ignored). Same pattern across all four invoker
controls.

### Keyboard activation paths

| Action | Toolbar | Menu | Ribbon |
|---|---|---|---|
| Tab focus | Yes (focusable button) | Once popup is open | Yes |
| Activation key | Enter / Space | Enter | Enter / Space |
| Accelerator | — | Underlined letter in Header (Alt+letter) | KeyTips (Alt → letter overlay) — TBD |
| Shortcut | InputBinding on focus root | InputBinding (display via `InputGestureText`) | InputBinding |

KeyTips (the Alt-then-letter overlay Office uses to navigate the
ribbon) are deferred — not in the v1 ribbon scope. Regular Tab focus
into the ribbon and arrow-key navigation between tabs/groups/buttons
covers the keyboard story for now.

### Resource sharing of visual metadata

Same icon used by toolbar / menu / ribbon: declare once as a
`ResourceDictionary` resource (`DeleteIcon`), reference from each
invoker. Same `Text`: declare as a static-resource string. The
command itself stays referenced by identity from the VM.

```mu
ResourceDictionary x:key="commandResources" {
    SolidColorBrush x:key="deleteIconColor" [Color=#e11d48]
    DataTemplate    x:key="deleteIcon"      { /* Path / icon */ }
    String          x:key="deleteText"      [Value="Delete"]
}

/* invokers */
ToolBarButton [Icon=@deleteIcon, Text=@deleteText, Command=$DeleteCmd]
MenuItem      [Icon=@deleteIcon, Header=@deleteText, Command=$DeleteCmd,
               InputGestureText="Del"]
RibbonButton  [LargeIcon=@deleteIcon, Text=@deleteText, Command=$DeleteCmd]
```

## 9. Demo plan — commands

Dedicated demo exercising the three surfaces over a shared command set.
Reuses the existing Diagram model from the diagram demo so the visual
context is familiar.

### Layout

```
┌───────────────────────────────────────────────────────────────────────────┐
│  [☰] Diagrammer                                    [⃝ Classic  ⦿ Ribbon] │
├───────────────────────────────────────────────────────────────────────────┤
│  ━━ MODE: CLASSIC ━━                                                       │
│  [📂 Open][💾 Save] │ [✂][📋][📄] │ [⊘ Del][⎘ Dup] │ [↶][↷]              │
├───────────────────────────────────────────────────────────────────────────┤
│            [ Diagram canvas — NodeVMs; drag, click, marquee, etc. ]       │
└───────────────────────────────────────────────────────────────────────────┘

Toggle to RIBBON →
┌───────────────────────────────────────────────────────────────────────────┐
│  [☰] Diagrammer                                    [⃝ Classic  ⦿ Ribbon] │
├───────────────────────────────────────────────────────────────────────────┤
│  ━━ MODE: RIBBON ━━                                                        │
│  Home   Insert   View   │ ██ Format ██  (only when HasSelection)           │
│  [ribbon body for current tab]                                            │
├───────────────────────────────────────────────────────────────────────────┤
│            [ Diagram canvas — unchanged ]                                  │
└───────────────────────────────────────────────────────────────────────────┘
```

### Commands

All pure `ICommand`s on the VM. No visual metadata on the command.

| Group | Command | Bound in surfaces | InputBinding |
|---|---|---|---|
| File | `OpenCmd` | Menu › File, Toolbar | Ctrl+O |
| File | `SaveCmd` | Menu › File, Toolbar | Ctrl+S |
| File | `ClearAllCmd` | Menu › File | — |
| Edit | `CutCmd` | Menu › Edit, Toolbar, Ribbon › Home | Ctrl+X |
| Edit | `CopyCmd` | Menu › Edit, Toolbar, Ribbon › Home | Ctrl+C |
| Edit | `PasteCmd` | Menu › Edit, Toolbar, Ribbon › Home | Ctrl+V |
| Edit | `DeleteCmd` | Menu › Edit, Toolbar, Ribbon › Format (contextual) | Del |
| Edit | `DuplicateCmd` | Menu › Edit, Toolbar, Ribbon › Format | Ctrl+D |
| Edit | `SelectAllCmd` | Menu › Edit | Ctrl+A |
| Edit | `UndoCmd` | Menu › Edit, Toolbar | Ctrl+Z |
| Edit | `RedoCmd` | Menu › Edit, Toolbar | Ctrl+Y |
| Arrange (contextual) | `BringFrontCmd` / `SendBackCmd` | Ribbon › Format | — |
| Arrange (contextual) | `AlignLeftCmd` / `AlignCenterHCmd` / `AlignRightCmd` / `AlignTopCmd` / `AlignMiddleVCmd` / `AlignBottomCmd` | Ribbon › Format | — |

### CanExecute drivers (computed from VM state)

- `HasSelection` (boolean derived from selector state): gates Cut /
  Copy / Delete / Duplicate / all Arrange commands.
- `Clipboard.HasContent` (demo-local boolean): gates Paste.
- Undo / Redo history non-empty flags.

### Proof points

- **Same `DeleteCmd` invoked from FOUR surfaces** (Toolbar button,
  Edit menu item, contextual Format ribbon button, Del KeyBinding)
  with zero command-level metadata duplication. Each invoker
  declares its own icon / text / gesture-display.
- **Classic ↔ Ribbon toggle swaps chrome** without touching the
  command set. Demonstrates the surface controls are interchangeable
  templates over the same logical command catalog.
- **Contextual "Format" tab** appears/disappears as `HasSelection`
  flips, exercising the `IsActive` predicate binding path on
  `RibbonContextualGroup`.
- **CanExecute auto-disable** visible everywhere consistently: with
  nothing selected, every selection-gated command appears disabled
  on whichever surface is active.

## 10. Open items / future work

- **KeyTips** (Alt-prefix letter overlay for Ribbon): a focused
  feature for ribbon-heavy apps; defer until v2 ribbon work.
- **Backstage view** (Ribbon's File-tab full-screen): only worthwhile
  for apps that need pre-document chrome (recent files, templates,
  printer setup, …). Out for v1.
- **QAT** (Quick Access Toolbar above the tab strip): customizable
  pin-this-command UX. Defer; regular ToolBar suffices.
- **Ribbon minimize / collapsed state**: tab-strip-only mode with
  body shown on tab click. Polish item; not in v1.
- **Touch / pen sizing modes**: enlarged hit targets for ribbon
  controls. Defer until a touch demo appears.
- **Galleries**: large preview grids (font picker, theme picker)
  inside ribbon groups. Use `RibbonDropDownButton` + `Menu` until a
  real gallery shape is needed.
