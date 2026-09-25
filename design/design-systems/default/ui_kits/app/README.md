# Atlas — App UI Kit

Recreation of the Atlas product workspace. Three-column layout (sidebar / canvas / inspector) with the core flows architects use day-to-day.

## Components

- `AppShell.jsx` — top app bar with workspace switcher, search, user
- `Sidebar.jsx` — navigation tree: capabilities, ADRs, services, activity
- `Canvas.jsx` — main work surface (renders capability map view)
- `Inspector.jsx` — right-side properties panel for the selected node
- `CommandPalette.jsx` — ⌘K overlay
- `ADRList.jsx` — list view alternative for the canvas
- `Toolbar.jsx` — floating capsule toolbar over the canvas

`index.html` boots into the capability-map view with a node selected. ⌘K opens the palette. Sidebar items are clickable and switch the view.
