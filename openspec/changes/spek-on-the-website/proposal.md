## Why

spekterm.com becomes the official website of both projects the maintainers ship: spekterm and spek, the
read-only OpenSpec viewer spekterm's side panel is built on. spek has no website today: its GitHub
Pages root (`spekhq.github.io/spek/`) answers 404, and the only pages a reader can reach are the README
and a live demo. The landing page's "Built on spek" section (shipped earlier today) introduces spek but
leaves the reader nowhere to go except GitHub.

## What Changes

- spek gets its own part of the site: a landing page at `/spek/` and documentation at `/spek/docs/`, in
  English and Traditional Chinese (`/zh-tw/spek/…`). spekterm keeps every URL it has (`/`, `/docs/…`).
- The header shows which product the reader is in — that product's logo and name — and offers a switch
  to the other product. The documentation sidebar and previous / next links stay within the product.
- Everything product-specific follows the page's product: logo, tab icon, home-screen icon, share image
  and its alt text, the page title's site name, the header and footer repository links; spekterm's
  platform status appears only on spekterm pages.
- spek's documentation covers: installing and using each form spek ships in (the web app, the VS Code
  extension, the JetBrains plugin), browsing (dashboard, specs, changes, schemas, timeline, search),
  worktree aggregation, the GitHub Action and its badges, data and network, and an FAQ. Every statement
  is checked against the spek repository (version 1.19.0, 2026-10-06).
- spek's data and network page states what spek actually does, including what its README does not
  say: the web app and the static pages load their font from Google Fonts; rendered markdown loads remote
  images (except in VS Code); the web app's API server (port 3001) — its address, the origins it accepts, and
  its directory listing, worded per the maintainer's decision (design Risks); spek runs `git`, `jj` (whenever installed), and the `openspec` CLI, which sends
  usage statistics unless turned off.
- spek's screenshots are captured by the site's capture script from the same fixture repository, using
  spek's own static-page builder from a local spek checkout — spek's committed screenshots show a
  maintainer home path and cannot be used. spek's interface has one language, so its screenshots are
  language-neutral.
- The non-affiliation statement names both projects.
- The spekterm landing page's "Built on spek" section links to `/spek/`.
- spek's repository is not changed by this change (its README, package metadata, and marketplace
  listings keep pointing at GitHub).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `project-website`: the site serves two products. Added: the two products and their navigation;
  product-specific parts; spek's landing page (no spek version number); spek's documentation topics; spek's
  data and network page. Modified: language parity (language-neutral screenshots); the spekterm landing
  page (link to spek; the disclaimer names both; content read without header and footer); the brand
  (per product); the documentation, downloads, and network requirements (scoped to spekterm); screenshots
  (spek captures, allow-list environment for both). The spec's Purpose is edited directly (OpenSpec does
  not apply a delta's Purpose to an existing spec).

## Impact

- `site/`: `astro.config.mjs` (sidebar groups, overrides), new `SiteTitle` and `SocialIcons` overrides,
  `src/product.mjs`, `src/routeData.ts` (per-product brand, title, sidebar, pagination), `Hero` and
  `Footer`, `src/content/docs/spek/**` and `src/content/docs/zh-tw/spek/**`,
  `src/i18n/*.json`, `src/content-plan.json`, `scripts/check-content.mjs` and `scripts/check-parity.mjs`
  (per-product brand, language-neutral screenshots, spek topics and network keywords),
  `scripts/make-brand-images.mjs` (spek's icon and share images), `src/assets/spek/`, `public/`.
- `scripts/capture-screenshots.mjs`: spek shots from a static spek page built by spek's builder in a
  spek checkout (`SPEK_DIR`, default `../spek`); `site/src/assets/screenshots/manifest.json`.
- `scripts/scenario-coverage.test.mjs`: rows for the new and modified scenarios.
- No change to the desktop app. No new dependency.
