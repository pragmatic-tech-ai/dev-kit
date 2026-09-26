# Pragmatic Labs Design System

The design system now lives as a **Claude Artifact** (type "Design System"), not
as files in this repo:

**https://claude.ai/artifact/XkyJGVRjDhwq8rKh52Pz7R**

It replaces the earlier Claude Design export that used to sit in
`design-systems/default/`.

## How to read it (agents)

Use the Artifact tool's `read` action on the URL above — never WebFetch/curl.
The content is in the artifact's own files under `project/`:

| path | what |
| --- | --- |
| `project/README.md` | the brand book — start here (voice, colour, type, spacing, radii, shadows, motion, iconography, logos, a11y notes) |
| `project/tokens.json` | all tokens (color themes light/dark, type, spacing, radius, shadow) |
| `project/tokens.css` | generated CSS custom properties from `tokens.json` |
| `project/components/<Name>/README.md` | per-component guidelines; bundle is `window.PragmaticLabs` |
| `project/design-system.json` | index (asset groups: logos, illustrations, …) |

Read a file with `{ action: "read", url, path: "project/README.md" }`; list them
with `{ action: "list", url, scope: "files" }`.

## Quick reference

- **Brand:** Signal Green `brand-green` `#2EA862` (not purple), used sparingly —
  primary CTA, focus ring, key data-viz series. Neutrals do ~80% of the work.
- **Type:** Inter Tight (UI/body), JetBrains Mono (code, labels, wordmark),
  Source Serif 4 (long-form, sparingly). All from Google Fonts.
- **Grid:** 4px (`space-1`–`space-10`); radii 2/6/10/14px, never above 14px.
- Light and dark themes share the same semantic tokens (`bg-0`–`bg-3`,
  `fg-0`–`fg-3`, `border`, `border-strong`, `border-focus`).

Always read `tokens.json` for exact values rather than relying on this summary.
