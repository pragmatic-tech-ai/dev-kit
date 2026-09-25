# dev-kit

Documentation hub for the **Architecture Agentic Suite** (`pragmatic-tech-ai`).
The published site lives at
**<https://pragmatic-tech-ai.github.io/dev-kit/>** and is rebuilt on every push
to `main` that touches `docs/**`.

## How it works

The docs are plain Markdown under [`docs/`](docs/). GitHub's
[`jekyll-build-pages`](https://github.com/actions/jekyll-build-pages) action
renders them with the github-pages gem and publishes the result via
[`.github/workflows/deploy-docs.yml`](.github/workflows/deploy-docs.yml). No npm,
no package registry, no secrets.

Because the build uses the github-pages default plugins, front-matter-less
Markdown renders as-is and relative `.md` links are rewritten to page URLs — so
documents can be dropped in verbatim.

## Adding docs

1. Add or edit Markdown under `docs/`.
2. Link it from [`docs/index.md`](docs/index.md).
3. Push to `main` — the workflow rebuilds and deploys.

## One-time Pages setup (repo owner)

In **Settings → Pages → Build and deployment**, set **Source = "GitHub
Actions"**. Until then the deploy job reports "Pages not enabled".
