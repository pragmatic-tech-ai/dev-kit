# Pragmatic Labs Design System

> A design system for the **Pragmatic Labs** brand — tools and approaches for building complex solutions and architectures in enterprise, business, and technology architecture.

---

## About the brand

**Pragmatic Labs** is a (fictional, invented-from-scratch) software studio that makes tooling for enterprise architects, business architects, and technology architects. Their products help teams reason about, model, and ship complex systems — capability maps, domain models, architecture decision records, dependency graphs, and the workflows that connect strategy to delivery.

The brand sits at the intersection of:
- **Strategy consultancy** — frameworks, mental models, "thinking tools"
- **Developer tooling** — fast, keyboard-first, opinionated software
- **Enterprise software** — meets the rigor and scale demands of big orgs

Visually it leans **technical / monospace / minimal** (peers: Linear, Vercel, Warp, Railway). Tonally it is **plainspoken and direct** — no jargon, no marketing fluff. The core promise in the name itself: *pragmatic*. Things that work over things that sound impressive.

---

## Sources

This system was **invented from scratch** — no codebase, Figma file, or brand guidelines were provided. The user opted to proceed without source material with the intent to iterate from here.

Treat every choice in this system as a **starting point**, not a finished position:
- Logo, wordmark, and color palette → invented
- Typography choices → invented (open-license fonts, no substitutions needed)
- Iconography → Lucide via CDN (open-license, fits the stroke-based minimal vibe)
- Tone and copy examples → derived from the user's brief

---

## Products represented

Two surfaces are mocked in `ui_kits/`:

1. **`marketing/`** — Pragmatic Labs marketing website. Hero, feature grid, customer logos, footer.
2. **`app/`** — *Atlas*, the flagship product. A workspace for architecture artifacts (capability maps, ADRs, system diagrams). Sidebar + main canvas + properties panel layout.

A third surface — slide deck templates — lives in `slides/` for use in customer-facing presentations and conference talks.

---

## Index

Root files:
- `README.md` — this file
- `SKILL.md` — agent-skill manifest (cross-compatible with Claude Code)
- `colors_and_type.css` — CSS variables for colors, type, spacing, radii, shadows
- `fonts/` — webfont files (Inter Tight, JetBrains Mono, Source Serif 4)
- `assets/` — logos, marks, illustrations, sample imagery
- `preview/` — design-system tab cards (one HTML file per token group / component)
- `ui_kits/marketing/` — marketing website kit
- `ui_kits/app/` — Atlas product kit
- `slides/` — 16:9 slide templates

Sections below: **Content Fundamentals**, **Visual Foundations**, **Iconography**.

---

## Content Fundamentals

### Voice in one line
> Plainspoken, direct, technical. We say what something does, not what it feels like.

### Rules

**Person.** Second person ("you") to the reader. First-person plural ("we") for the company. Never first-person singular.

**Casing.** Sentence case everywhere — buttons, headings, nav, menus. Title Case is reserved for proper nouns (product names: *Atlas*, *Pragmatic Labs*) and document titles in legal/policy contexts. No ALL CAPS except for short eyebrow labels (e.g. `DOCS`, `CHANGELOG`) set in mono with letter-spacing.

**Sentence length.** Short. Often a fragment. A new line break does the work a comma might have.

**Jargon.** Technical terms are fine when accurate (`capability map`, `ADR`, `bounded context`). Marketing jargon is not (`leverage`, `unlock`, `synergy`, `revolutionary`, `next-generation`, `seamless`). When in doubt, write it the way you'd say it to a senior engineer over coffee.

**Numbers.** Numerals always (`3 architects`, not `three architects`). Use abbreviated units: `2 min`, `40 KB`, `1.2 GB`. ISO-ish dates in the product (`2026-05-02`); friendly dates in marketing (`May 2, 2026`).

**Emoji.** Not used in product UI, marketing, or docs. The visual language carries the warmth instead. Exception: `✓` and `→` as Unicode glyphs in dense lists, where loading an icon is overkill.

**Oxford comma.** Yes.

### Examples

| ✗ Don't | ✓ Do |
|---|---|
| Unlock the power of architecture-as-code with our revolutionary platform. | Architecture as code. Diff your capability map like you diff your services. |
| 🚀 Welcome aboard! We're so excited to have you. | Welcome. Your workspace is ready. |
| Click here to learn more about our amazing features. | See the docs → |
| Sorry, something went wrong! Please try again later. | Couldn't reach the server. Check your connection or try again. |
| Empower your enterprise to seamlessly transform. | For teams shipping complex systems. |

### Microcopy patterns

- **Buttons.** Verb-first, ≤ 3 words. `Save changes`, `Create map`, `Invite teammate`. Never `Click here` or `Submit`.
- **Empty states.** One line of context, one action. Example: `No ADRs yet. Capture your first decision.` + `[ New ADR ]`
- **Errors.** Lead with what failed, then what to do. `Couldn't save. Your session expired — sign in again.`
- **Success.** Past-tense, low-key. `Saved.` `Invited 3 people.` Not `Success! 🎉`

### Tagline candidates (pick one in iteration)

- *Architecture, the pragmatic way.*
- *Tools for building complex systems.*
- *Think in systems. Ship the parts.*

---

## Visual Foundations

The system is built on a **monospace-forward, high-contrast, low-chrome** aesthetic. It should feel like a tool an engineer would choose, not a brochure.

### Color

- **Neutrals are the workhorse.** A 12-step warm-cool neutral ramp from `#FAFAF9` (paper) to `#0A0A0B` (ink) does ~80% of the lifting. Backgrounds, text, borders, dividers — all neutrals.
- **One brand color: `Signal Green` `#2EA862`.** Pulled from the *pragmatic* energy — a warm engineered green, like a hazard sign or a circuit-board silkscreen marker. Used sparingly: primary CTA, focused field rings, the dot in the logomark, key data viz accent.
- **Two supporting accents** for state and data viz: `Signal Cyan` `#3AA6B9` (info, links in body copy) and `Signal Plum` `#7C6BAD` (success, "live" indicators). Reds and yellows are reserved for destructive/warning semantics — see `colors_and_type.css`.
- **No gradients on surfaces.** Flat fills only. The only gradient permitted is a subtle vertical "protection" fade behind sticky overlays (8% black → 0%) — used at most once per screen.
- **Dark mode is a peer, not an afterthought.** Both modes share the same semantic tokens; only the underlying values flip.

### Type

Three families, each with one job:

| Family | Role | Notes |
|---|---|---|
| **Inter Tight** | Body and UI | Tight tracking, sentence-case everything. Weights 400/500/600. |
| **JetBrains Mono** | Code, eyebrows, labels, data | Used at small sizes for `LABELS LIKE THIS` with +0.1em tracking. |
| **Source Serif 4** | Long-form prose, editorial moments, big quotes | Sparingly — docs body copy, the manifesto page, pull quotes. |

Display sizes lean **tight and big**: `letter-spacing: -0.02em` on anything over 32px. Body copy is `15px / 1.55` — slightly smaller than the SaaS default, denser by intent.

### Spacing

A **4px base grid**. Tokens at `4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96 / 128`. No half-steps. Layouts hug a 1280px max content width on marketing; the app uses fluid panels with hard 1px dividers between regions.

### Backgrounds

- **Default surface is paper-white** in light mode (`#FAFAF9`, very slightly warm) and near-black in dark mode (`#0A0A0B`).
- **Optional grid texture** — a 24px×24px dotted grid at 4% opacity — used behind hero sections and on the marketing site between bands. It hints at "engineering drawing" without being literal.
- **No photography of people in office settings.** No stock illustrations of abstract blobs. Imagery is either (a) product UI screenshots, (b) technical diagrams (capability maps, dependency graphs) rendered in the brand palette, or (c) high-contrast B&W documentary-style shots of physical infrastructure (server rooms, transit maps, blueprints) with the green used as a single-color overlay accent.

### Animation

- **Easing.** Default `cubic-bezier(0.2, 0, 0, 1)` — a strong out-curve that feels decisive. No bounces, ever. No springs.
- **Durations.** `120ms` for state changes (hover, focus). `200ms` for small layout shifts (menu open, popover). `320ms` for page-level transitions. Never longer.
- **Fades.** Most enter/exit is opacity + 4px translate. Not slides. Not scales.
- **Reduced motion.** Honored — all transitions drop to 0ms when `prefers-reduced-motion` is set.

### Hover & press states

- **Hover on surfaces.** Background lifts by one neutral step (e.g. `--bg-1` → `--bg-2`). No shadow change.
- **Hover on buttons.** Primary button darkens 6% in HSL lightness. Secondary buttons get a 1px border-color shift, no fill change.
- **Press.** No shrink, no scale. Background drops one further neutral step. The active state is darker, not smaller.
- **Focus.** A 2px solid `--accent` ring with a 2px offset. Always visible — never `outline: none` without a replacement.

### Borders

- **1px hairlines, always.** Dividers, card edges, input borders — all 1px. No 2px borders except focus rings.
- **Border color is `--border`**, a neutral that adapts per mode. Borders are visible but quiet — they're scaffolding, not decoration.

### Shadows

Shadows are **rare and small**. The system has only three:
- `--shadow-sm` — `0 1px 2px rgba(0,0,0,0.04)` for raised inputs in dense layouts
- `--shadow-md` — `0 4px 12px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)` for popovers and menus
- `--shadow-lg` — `0 12px 32px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.05)` for modals only

No glows, no colored shadows, no inner shadows, no neumorphism.

### Capsules vs protection gradients

Pragmatic Labs uses **capsules over gradients** for floating chrome (toolbars, command palette, toast). A capsule has: 1px border, soft shadow (`--shadow-md`), `border-radius: 12px`, and the page surface color as fill. The `backdrop-filter: blur(12px)` is used only when the capsule overlays content that can scroll behind it.

### Transparency & blur

- **Transparency** appears in modal scrims (`rgba(10, 10, 11, 0.4)` over light, `rgba(0,0,0,0.6)` over dark) and in disabled-state opacity (`0.5`).
- **Blur** is reserved for capsules-over-content (above) and the command palette overlay. Never as decoration.

### Corner radii

A small ramp: `2 / 4 / 6 / 10 / 14 / 999`. Most UI uses `6` (inputs, small buttons) or `10` (cards, modals). `14` for marketing-scale cards. `999` for pills. `2` is used only for code blocks and tag chips. **No 16/20/24px radii** — anything larger reads as consumer-y, off-brand.

### Cards

A card is: `1px solid var(--border)`, `border-radius: 10px`, `background: var(--bg-1)`, `padding: 24px`. **No shadow by default.** Add `--shadow-sm` only when a card is draggable or floats above another card. The hover state lifts the border to `--border-strong`, no fill change.

### Layout rules

- **Fixed top nav** on marketing — 56px tall, page surface color, 1px bottom border. No floating, no transparency-on-scroll.
- **App chrome** uses three columns: 240px left sidebar, fluid center, 320px right inspector. All separated by 1px hairlines, no shadows.
- **The grid is 12-column** at marketing scale, 24px gutters. The app ignores the grid — it's a tool, not a document.

---

## Iconography

**System: Lucide.** It's stroke-based, 1.5px stroke at 16/20/24, geometric, open-license, and matches the technical-minimal aesthetic exactly. Loaded from CDN (`https://unpkg.com/lucide@latest`) for the demos in this system; in production, install as a package and tree-shake.

**Sizes.** Three only: `14px` (inline with body text), `16px` (UI default), `20px` (page-level affordances like primary buttons or section headers). No 24px+ icons except in marketing illustration moments.

**Color.** Icons inherit `currentColor`. They are `--fg-2` (secondary text color) by default, `--fg-1` on hover or active, `--accent` only when paired with a destructive state or a brand moment.

**Custom marks.** Two SVGs are hand-built and live in `assets/`:
- The **Pragmatic Labs logomark** (`assets/logomark.svg`) — a hollow square with an green dot in one corner. Reads as "a system, with a signal."
- The **Pragmatic Labs wordmark** (`assets/wordmark.svg`) — set in JetBrains Mono Bold, with the `.` in `Pragmatic.Labs` rendered as the green dot from the mark.

**Emoji.** Not used. (See Content Fundamentals.)

**Unicode glyphs.** `→ ← ↑ ↓` (arrows) and `✓ ×` (check, dismiss) are used inline in dense lists where loading a Lucide icon would be overkill. Set in the same family as the surrounding text.

**Substitution flag.** Lucide is a substitute for a hypothetical custom icon set. If Pragmatic Labs ever commissions a proprietary icon family, swap it here and update this section.

---

*See `SKILL.md` for the agent-skill version of this system.*
