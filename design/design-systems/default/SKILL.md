---
name: pragmatic-labs-design
description: Use this skill to generate well-branded interfaces and assets for Pragmatic Labs, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Quick reference

- **Brand:** Pragmatic Labs — tools for enterprise / business / technology architects
- **Vibe:** technical, monospace-forward, minimal (peers: Linear, Vercel, Warp)
- **Voice:** plainspoken, direct, no marketing jargon, sentence case, no emoji
- **One brand color:** Signal Green `#2EA862` — used sparingly
- **Type:** Inter Tight (UI), JetBrains Mono (labels/code/data), Source Serif 4 (long-form)
- **Icons:** Lucide via CDN, 1.5px stroke, 14/16/20px sizes
- **Tokens:** see `colors_and_type.css` (single source of truth — light + dark)

## Files

- `README.md` — full system: content fundamentals, visual foundations, iconography
- `colors_and_type.css` — CSS variable tokens, font imports, helper classes
- `assets/` — logomark, wordmark, lockup, favicon, illustration SVGs
- `preview/` — design-system tab cards (one per token group)
- `ui_kits/marketing/` — Pragmatic Labs marketing site (Nav, Hero, FeatureGrid, Pricing, Footer)
- `ui_kits/app/` — Atlas product workspace (AppShell, Sidebar, Canvas, Inspector, CommandPalette, ADRList)

## Hard rules

- Sentence case everywhere except mono ALL-CAPS eyebrow labels
- No emoji in product, marketing, or docs
- 1px hairline borders only (except focus ring)
- No gradients on surfaces; flat fills only
- Cards have no shadow by default
- Default ease: `cubic-bezier(0.2, 0, 0, 1)` — no bounces, no springs
- Press states change color, never scale or shrink
- Radii cap at 14px (anything larger reads off-brand)
