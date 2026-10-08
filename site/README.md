# spekterm.com

The website: a landing page and the user documentation, in English (`/`) and Traditional Chinese
(`/zh-tw/`). Built with Astro and Starlight; a self-contained package — nothing here reaches the desktop
app (`openspec/specs/project-website`).

## Develop

```bash
cd site
nvm use            # the repository's Node version
npm ci
npm run dev        # http://localhost:4321
```

Pages live in `src/content/docs/` (English) and `src/content/docs/zh-tw/` (Traditional Chinese). **Every
page, every string in `src/i18n/*.json`, and every screenshot must exist in both languages** — the build
fails otherwise. The documentation pages the site must have are listed in `src/content-plan.json`.

## Brand images

The header logo, the tab icon, the home-screen icon, and the share preview of each language are all
derived from the app's icon (`build/icon.svg`); the share preview's title is the landing page's
`hero.title`. They are committed — regenerate them after either changes, and review them before
committing (text goes through the installed fonts):

```bash
node scripts/make-brand-images.mjs
```

The screenshots come from the repository root's `npm run capture:screenshots` (see the root `CLAUDE.md`).

## Build — the gate to publishing

```bash
npm run build            # what the hosting runs; a failure here means nothing is published
npm run build:structure  # same, minus check-content's content part (while pages are being written)
```

`scripts/build.mjs` runs, in order, stopping at the first failure:

| step | what fails it |
|---|---|
| `astro check` | a type error in the site |
| root content guards | an internal name or a maintainer home path anywhere in the repository; restrictive license wording (`../scripts/public-hygiene.test.mjs`, `../scripts/license.test.mjs` — they need git and the whole repository) |
| `astro build` | a broken link or anchor in Markdown content (`starlight-links-validator`) |
| `check-parity` | a page, string, or screenshot in one language only |
| `check-origins` | anything loaded from another origin (scripts, styles, fonts, images, frames — including inline styles) |
| `write-notices` | the third-party notices cannot be generated, or omit a package known to ship |
| `check-content` | canonical URLs, language switches, the disclaimer and notices link, the tab icon, header logo and share image (each page's own language), release links, version numbers (needs git tags), the landing page's required content, required topics, the data and network page |

Every check runs its own `--self-test` first (fixtures built to violate it), so a check that has gone
blind stops the build instead of passing it.

## After a deploy

```bash
node scripts/check-live.mjs --commit <deployed commit>
```

Builds that commit in a temporary worktree and checks that https://spekterm.com serves it byte for byte
with no cookie, and that the redirecting hosts keep the path. See `DEPLOY.md` for the hosting setup.
