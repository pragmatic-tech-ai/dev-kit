# Diagrammer — User Manual

The Diagrammer is a Visio-/drawio-style canvas for drawing diagrams: drag
shapes from a palette, connect them with routed lines, label them with rich
text, and arrange, group, and combine them. This manual covers everything you
do with the mouse and keyboard. Developers integrating the diagram control
should read the [API guide](diagram-api-guide.md) instead.

---

## 1. The workspace

```
┌──────────────────────────────────────────────────────────────┐
│  🏠 Diagrammer     <status text>                               │  ← header
├──────────────────────────────────────────────────────────────┤
│ Align ▸ | Distribute ▸ | Group ▸ | Combine ▸                  │  ← command toolbars
├──────────┬──────────────────────────────────────┬────────────┤
│  Shapes  │                                        │  Format    │
│  ▢ ▽ ○   │            (drawing canvas)            │  Shape     │
│  ◇ ⬡ ♥   │                                        │  ▸ Fill    │
│   …      │                                        │  ▸ Stroke  │
│  [Save]  │                                        │  ▸ Caps    │
│  [Load]  │                                        │            │
└──────────┴──────────────────────────────────────┴────────────┘
```

- **Header** — the title and a live **status line** (node/connector counts,
  hints).
- **Command toolbars** — Align, Distribute, Group, and Combine tools. Buttons
  that don't apply to the current selection are disabled; extras collapse into
  each toolbar's overflow chevron.
- **Shapes palette** (left) — the shape library. Drag a tile onto the canvas.
  **Save** / **Load** buttons sit below it.
- **Canvas** (centre) — where you build the diagram. It scrolls and grows as
  you move shapes past its edges.
- **Format Shape** pane (right) — edit the fill, stroke, and (for connectors)
  end caps of the current selection.

---

## 2. Adding shapes

**Drag a tile from the Shapes palette onto the canvas.** The new shape appears
where you drop it and is selected, ready to move or label. The library has 35
kinds — rectangles, ellipses, squircles, arrows, diamonds, hearts, flowchart
symbols, and more.

---

## 3. Selecting

| To… | Do this |
|-----|---------|
| Select one shape | Click it. |
| Add / remove one shape | **Ctrl-click** it (toggles). |
| Select a range | Click one shape, then **Shift-click** another — everything between them is selected. |
| Select many at once | **Drag a rectangle** on empty canvas (marquee). Everything inside is selected. |
| Select a connector | Click the line. Connectors have their own selection — Ctrl/Shift-click work the same way. |
| Clear selection | **Click empty canvas.** |

---

## 4. Moving shapes

**Click and drag** a shape to move it. Drag a **group** to move all its
members together. Connectors attached to a moving shape re-route automatically.

**Nudge with the arrow keys** when something is selected:

- **Arrow key** — move 1 px.
- **Shift + Arrow key** — move 10 px.

If **alignment guides** are on, dashed lines appear as you drag and the shape
snaps when its edges or centre line up with a neighbour.

---

## 5. Resizing

When resize is enabled, selecting a shape (or several) shows **handles** around
the selection bounds. Drag a handle to scale. A shape's text label can be set
to grow or shrink with the box — see [§10](#10-text-and-labels).

---

## 6. Aligning and distributing

Select **two or more** shapes, then use the **Align** toolbar:

- **Align Left / Right / Top / Middle / Center** — line the selection up to the
  first shape's edge or centre.

Select **three or more** shapes for the **Distribute** toolbar:

- **Distribute Horizontally / Vertically** — space them evenly.

Buttons stay disabled until enough shapes are selected.

---

## 7. Grouping

Combine shapes into a single movable unit.

| Action | Gesture |
|--------|---------|
| **Group** (needs ≥2 selected) | **Ctrl+G**, or the Group toolbar button. |
| **Ungroup** (needs a group selected) | **Ctrl+Shift+G**, or the Ungroup button. |

A new group renders behind its members and moves as one. Ungrouping releases
the members back to the canvas (or to the parent group, if it was nested). On
Windows the **⊞ Windows key** works in place of Ctrl for these.

---

## 8. Combining shapes (boolean)

Select **two or more** shapes and use the **Combine** toolbar to merge their
outlines into one new shape:

| Tool | Result |
|------|--------|
| **Union** | Everything covered by either shape. |
| **Intersect** | Only the overlap. |
| **Subtract** | The first shape minus the overlap. |
| **Exclude** | Both shapes minus the overlap. |

The originals are replaced by the single combined shape, which is then
selected.

---

## 9. Connectors

Connectors are the lines that link shapes. They need connector interactions to
be enabled (they are, in the demo).

### Drawing a connector

1. **Hover a shape** — its connection ports light up.
2. **Press on the shape body or a port and drag** — a line follows your cursor.
3. **Release over another shape** (or one of its ports) — the connector is
   created between the two.

Releasing over empty canvas cancels the draw.

### Editing a connector

- **Select it** (click the line) — handles appear at each end and on any
  waypoints.
- **Drag an endpoint** to re-attach it to a different shape, port, or a free
  position.
- **Drag a waypoint** to bend the route; drag a segment to shift it. You can
  add waypoints by dragging on the line.
- Connectors between shapes **re-route automatically** as the shapes move.

### Routing and caps

A connector can route as a **straight**, **orthogonal** (right-angle), or
**bezier** (curved) line. Its ends can carry **caps** — arrowheads, circles, or
diamonds — chosen in the Format Shape pane when a connector is selected.

---

## 10. Text and labels

Every shape and connector can carry a text label.

### Editing text

- **Double-click** a shape (or connector) to edit its label in place.
- Or select a shape and press **F2**.
- While editing, **Ctrl+B / Ctrl+I / Ctrl+U** toggle **bold**, *italic*, and
  underline. **Enter** starts a new paragraph; **Esc** or clicking away
  commits.

### Placing and rotating a label

A label doesn't have to sit dead-centre. When the text adorner is on, select a
shape to get **move** and **rotate** grips on the label — drag them to
reposition or spin the caption. A label can be anchored to any of 13 spots
(centre, the four sides, the corners) or placed **outside** the shape (above,
below, left of, right of).

### Live fields

Labels can contain **fields** — tokens that show live values and update
automatically. For example a label of `{Width}×{Height}` shows the shape's
current size and changes as you resize it; a connector label with `{Length}`
shows its route length. Available fields include a shape's width, height,
position, kind, and id, and a connector's length and endpoint ids.

### Auto-fit

A label can be set to **shrink** to stay inside its shape, or a shape can be
set to **grow** to contain its label.

### Text shapes and callouts

Two shapes exist purely for annotation:

- A **text box** is a transparent, auto-growing box you type into — a
  free-floating note.
- A **callout** is a text box with a **leader line** that points at another
  shape and follows it as that shape moves.

---

## 11. Formatting (Format Shape pane)

Select one or more shapes (or a connector) and use the **Format Shape** pane on
the right to change:

- **Fill** — the interior brush (solid colour, gradient, …).
- **Stroke** — the outline pen (colour, thickness, dash).
- **Caps** (connectors only) — the source and target end decorations and their
  size.

Edits apply to **every** shape in the selection at once, including shapes
nested inside selected groups.

---

## 12. Deleting

Select any shapes and/or connectors and press **Delete** or **Backspace**.
Deleting a shape also removes any connectors that were attached only to it.

---

## 13. Saving and loading

- **Save** stores the whole diagram — every shape, its position, geometry,
  colours, and text (including placement, rotation, rich formatting, fields,
  and callout targets), plus every connector (its ends, waypoints, routing, and
  label).
- **Load** restores the last saved diagram.

Persistence uses whatever storage the app provides (typically the browser's
local storage), so your diagram survives a reload.

---

## 14. Keyboard & mouse reference

| Input | Action |
|-------|--------|
| Click shape | Select it |
| Ctrl-click | Toggle a shape in/out of the selection |
| Shift-click | Range-select from the last click to this one |
| Drag on empty canvas | Marquee-select |
| Click empty canvas | Clear the selection |
| Drag shape | Move it (snaps to guides if enabled) |
| Arrow key | Nudge selection 1 px |
| Shift + Arrow | Nudge selection 10 px |
| Delete / Backspace | Delete selected shapes and connectors |
| Ctrl+G (⊞+G) | Group ≥2 selected shapes |
| Ctrl+Shift+G (⊞+Shift+G) | Ungroup selected group |
| Double-click shape / connector | Edit its label |
| F2 | Edit the selected shape's label |
| Ctrl+B / Ctrl+I / Ctrl+U | Bold / italic / underline (while editing text) |
| Enter (editing) | New paragraph |
| Esc (editing) / click away | Commit the edit |
| Drag from a port | Draw a connector |

---

*See also:* the [API guide](diagram-api-guide.md) for developers, and the live
[diagram demo](https://github.com/pragmatic-tech-ai/mural/blob/main/demo/demos/diagram/) this manual describes.
