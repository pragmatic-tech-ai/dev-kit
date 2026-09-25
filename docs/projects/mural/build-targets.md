# Build Targets

The npm scripts available in this project, what each does, and when to run it.

All commands run from the repo root. Source: [`package.json`](package.json).

## Quick reference

| Command | What it does |
|---|---|
| `npm run build` | Full build: control templates → demo templates → TypeScript emit. |
| `npm run build:templates` | Compile only the internal control templates. |
| `npm run build:demos` | Compile only the demo `.mu` files. |
| `npm run typecheck` | Type-check without emitting any output. |
| `npm test` | Run the test suite. |
| `npm run demo:html` | Build and print instructions to serve the demo. |
| `npm run demo:border` / `demo:text` / `demo:gfont` | Run a render-pinning demo script (one-off rasterizers, not the platform demo). |
| `npm run clean` | Delete `dist/` and `build/`. |
| `npm publish` | Build clean and publish to the configured npm registry. |

## Commands in detail

### `npm run build`

```
npm run build:templates && npm run build:demos && tsc
```

The full build pipeline. Runs the three stages in order:

1. Compile `src/basic/*.template.mu` to `build/basic/*.template.mu.{js,d.ts}`.
2. Compile `demo/**/*.mu` to in-place `demo/**/*.mu.js` files.
3. Run `tsc` against `src/**/*.ts`, emitting `dist/**/*.{js,d.ts,js.map}`.

Run this after pulling, before serving the demo, or any time TypeScript or `.mu` markup changes.

### `npm run build:templates`

```
tsx src/tooling/build-control-templates.ts
```

Compiles internal control templates only. Input: `src/basic/*.template.mu`. Output: `build/basic/*.template.mu.js` plus a `.d.ts` stub.

Run when you've edited a control template but nothing else, or as the minimum step before `npm test` (the `pretest` hook calls this automatically).

### `npm run build:demos`

```
tsx src/tooling/build-demo-templates.ts
```

Compiles every demo `.mu` file. Output is written next to the source (e.g., `demo/demos/splitter/splitter.mu` → `demo/demos/splitter/splitter.mu.js`). **The `.mu.js` outputs are committed to git**, so a fresh clone can serve the demo without running this — but you must run it after editing any demo `.mu`.

### `npm run typecheck`

```
tsc --noEmit
```

Runs TypeScript in check-only mode. No files written. Fastest way to catch type errors during development; safe to wire to a watcher.

### `npm test`

```
tsx --conditions=development --test "src/**/*.test.ts"
```

Runs Node's native test runner against the TypeScript sources via `tsx`. The `--conditions=development` flag picks the source-`.ts` branch of `package.json` exports so cross-package imports inside tests resolve to source files (not `dist/`).

`pretest` hook runs `npm run build:templates` first, so a fresh checkout doesn't need a full `npm run build` to test — just `npm test`.

### `npm run demo:html`

```
npm run build && echo Demo built. From repo root: 'npx http-server -p 8080' then open http://localhost:8080/demo/
```

Runs the full build and prints a reminder of how to serve the demo. Doesn't actually start a server — you run `npx http-server -p 8080` (or any static server) yourself, then open `http://localhost:8080/demo/platform/platform.html`.

### `npm run demo:border` / `demo:text` / `demo:gfont`

```
tsx src/basic/tests/border-render.ts
tsx src/basic/tests/text-render.ts
tsx src/basic/tests/google-font-render.ts
```

Standalone render-pinning scripts. Each writes a rasterized output to disk for visual verification. Not the platform demo — these are old smoke tests kept around for regression checks on specific renderers.

### `npm run clean`

```
rimraf dist build
```

Deletes the `dist/` and `build/` output directories. In-tree `demo/**/*.mu.js` files are NOT removed (they're committed).

Run before a clean rebuild, or when stale type information from a previous build is producing confusing errors.

### `npm publish` (`prepublishOnly` hook)

```
prepublishOnly: npm run clean && npm run build
```

`npm publish` triggers the `prepublishOnly` hook automatically: clean, then full build. What ships (from `package.json`'s `"files"` field): `dist/`, `build/`, `README.md`. Source TypeScript and the `demo/` tree do not ship.

The configured registry is `http://localhost:4873/` (Verdaccio); change `publishConfig` in `package.json` to publish elsewhere.

## Output directories

| Directory | Produced by | Shipped to npm? | Gitignored? |
|---|---|---|---|
| `dist/` | `tsc` | yes | yes |
| `build/` | `build:templates` | yes | yes |
| `demo/**/*.mu.js` | `build:demos` | no | no (committed) |
