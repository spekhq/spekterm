## Context

See proposal.md for motivation. The state this change builds on:

- **Nothing serves the domains.** `spekterm.com` and `spekterm.app` use Cloudflare nameservers and have no
  DNS records. The GitHub repository has no homepage set. The latest published release is `v0.2.1`; its
  asset is `Spekterm-0.2.1.AppImage` (`build-identity` puts the version in the file name).
- **The README carries everything.** `README.md` (165 lines) and `README.zh-TW.md` (150 lines) have Why,
  Features, Requirements, Install, Install from source, Keyboard shortcuts, Troubleshooting,
  Documentation, Relationship to spek, Contributing, License, Disclaimer. `desktop-packaging` has two
  scenarios that read the README itself: (1) the `libfuse2` prerequisite, the `--appimage-extract-and-run`
  escape hatch, and the first-build network need; (2) `install:desktop` / `uninstall:desktop`. Today the
  escape hatch is only under Troubleshooting (`README.md:123-124`, `README.zh-TW.md:111-112`), and **the
  first-build network need is not written anywhere** — an existing gap.
- **Root tooling assumes one package.** `eslint .` ignores `out/**`, `dist/**`, `node_modules/**` — the
  `dist/**` pattern matches the root only (measured: `site/dist/a.js` is linted). `test-glob` requires
  every `*.test.*` in the repo to be matched by `test:unit`. The NUL-byte guard walks `src`, `scripts`,
  `docs`, `openspec` with `TEXT_FILE = /\.(ts|tsx|mjs|js|json|md|css|html|yaml|yml)$/` and does not skip
  `node_modules`. `public-hygiene` (`git ls-files --cached --others --exclude-standard`, binaries skipped)
  and `project-license`'s wording guard (`git grep --untracked`) scan every tracked and unignored file;
  both import only `node:*` and run `git`. `scenario-coverage.test.mjs` looks for carrier labels in
  `.ts`/`.tsx`/`.mjs` under `src/` and `scripts/` only. Root `package.json` has no `workspaces`;
  `build.files` packs `out/**` and `package.json`. CI (`ci.yml`) runs on pushes to `master` and on PRs.
- **The desktop artifact already has a third-party notices pipeline** (`scripts/lib/third-party-licenses.mjs`):
  `packageRootOf` maps bundler module ids to package roots, `licenseEntryOf` / `renderSummary` turn them
  into text. `renderSummary`'s heading names Spekterm's build, so the site cannot reuse it verbatim.
- **The app's own network surface** (read from the code): `src/main/slack-api.ts` holds the global
  `fetch` by reference (`options.fetchImpl ?? fetch`, then `this.#fetch(...)`) and `slack-realtime.ts`
  constructs a `WebSocket`, both inert until Slack credentials are saved; remote `https:` images are
  allowed by the CSP's `img-src` in every `MarkdownView`; `shell.openExternal` runs on a user's click.
  One window, default session only.
- **Measured during review — the spell checker downloads at startup.** With Electron 43.5.0, a fresh
  user-data directory, and no interaction, `en-US-10-1.bdic` is downloaded from
  `redirector.gvt1.com` within 8 seconds. `webPreferences.spellcheck: false` does not stop it;
  `session.setSpellCheckerEnabled(false)` does not stop it, even in `session-created`;
  **`setSpellCheckerLanguages([])` does**, and also stops a profile that already has `en-US` registered.
  The `Dictionaries/` directory is created in every configuration, including the fixed one. The built app
  (`out/`) made 2 connections to that host at startup with no interaction.
- **Measured during review — the side panel's `openspec` sends usage statistics.** `@spekjs/core`
  spawns the user's `openspec` with the inherited environment (`openspec-cli.js:62`); openspec 1.10.0
  sends a usage event per command unless opted out. `openspec status --change … --json` (what core runs)
  posted to `https://edge.openspec.dev/batch/`. The maintainer chose to state this on the site rather than
  change it; setting `OPENSPEC_TELEMETRY` in `process.env` is ruled out anyway (only `user-env.ts` may
  write `process.env`, and the value would reach every pty).
- **Starlight** (`@astrojs/starlight` 0.42.5 on Astro 7.3.6, Node `>=22.12.0`), measured in a scratchpad
  site: `/zh-tw/` routes, an English fallback page with an "untranslated" notice, `canonical` and
  `hreflang` (en / zh-TW / x-default) when `site` is set, a non-zero exit on a broken internal link, no
  third-party origin in the HTML, no absolute paths in `.astro/`. Starlight's CSS is built in Astro's
  **prerender** environment, not the client one; expressive-code's `ec.*.js` / `ec.*.css` are emitted as
  assets with no originating module id. `starlight-links-validator` 0.26.0 declares
  `starlight >=0.42.0`, `astro >=7.2.10`; it checks links in Markdown content only, and rejects a link to a
  file that does not exist before the build ends.

## Goals / Non-Goals

**Goals:**

- One project serves the landing page and the docs, in both languages, from `site/`, with nothing in it
  reaching the desktop artifact or the root tooling's scope.
- Every claim the site makes about the app (network, platforms) has a mechanism that turns red when the
  app changes under it — or is stated as a gap.
- Retaking the screenshots is one command that cannot pick up the maintainer's identity, and a
  mechanical check reads what each screenshot shows before a human does.
- Nothing reaches the live site without passing the same checks CI runs on it.

**Non-Goals:**

- A blog, changelog pages, newsletter, or waitlist. Releases stay on GitHub; "follow macOS/Windows
  support" links to a GitHub issue.
- Showing the real Claude Code TUI. Doing it needs a real `claude` session (paid, shows the account).
  The screenshots show spekterm's own UI rendering illustrative fixture content — a made-up exchange in
  the conversation view, made-up changes in the side panel — and the page captions say they are
  illustrative.
- Versioned docs. The docs describe the latest release.
- OS detection on the download button: there is one platform to offer.
- Machine-checking that a translation says the same thing as its source. The parity check guarantees
  the same pages exist; fidelity is reviewed by the maintainer.
- Changing what the `openspec` or `claude` CLIs send. The site states it.

## Decisions

### D1. Astro + Starlight, one project, the landing page is a Starlight page

The landing page is `src/content/docs/index.mdx` with Starlight's `splash` template and custom components
(`site/src/components/`), and the docs live beside it. The landing page therefore gets the header,
language picker, search, `hreflang` alternates, and the `/zh-tw/` route for free, and both languages are
the same kind of file. Strings used by the custom components come from `site/src/i18n/{en,zh-TW}.json`.

*Alternatives:* a hand-built Astro landing page plus Starlight for `/docs` — two routing and i18n
systems to keep in step, for a hero layout `splash` already allows. VitePress — every interface string
must be supplied by hand. Fumadocs (OpenSpec, Conductor, Superset use it) — brings Next.js for a static
site.

**No web fonts.** Starlight's system font stack is kept, so no font is downloaded from anywhere and no
font license has to be published. Versions are pinned exactly in `site/package.json` (Starlight is 0.x and
breaks between minors) with the lockfile committed; `site/.nvmrc` holds the repo's Node version.

### D2. URL layout

| path | content |
|---|---|
| `/` , `/zh-tw/` | landing page |
| `/docs/<topic>/` , `/zh-tw/docs/<topic>/` | documentation |
| `/third-party-notices.txt` | D11 |

English is Starlight's root locale (no prefix); `zh-tw` is the second locale with `lang: 'zh-TW'`. `site`
is `https://spekterm.com`, so every page carries `<link rel="canonical">` on that host and a sitemap is
generated.

### D3. Both languages ship complete, checked by parity

"A page" means a page listed in the built sitemap (the spec's definition). Starlight emits a single
English `404.html` whose language switch points to a `/zh-tw/404/` that does not exist and whose
canonical is `/404/` (measured); the not-found page is therefore outside the parity and canonical rules —
it still carries the disclaimer and the notices link, which `check-content` checks.

`site/scripts/check-parity.mjs` fails when:

- a page exists under one locale and not the other — judged on the **source content tree**
  (`src/content/docs/**` outside `zh-tw/` against `src/content/docs/zh-tw/**`), not on the sitemap:
  Starlight generates a fallback page for a missing translation and lists it in the sitemap (measured), so
  a sitemap comparison would always be equal;
- a component string key exists in one of `site/src/i18n/*.json` and not the other;
- a screenshot exists for one language and not the other (`src/assets/screenshots/<lang>/`, D13) —
  checked on the directories, so screenshots imported by components are covered as well as those in pages.

Starlight's fallback stays enabled as a safety net; with the parity check it never triggers on `master`.

*Alternative considered:* comparing heading counts as a proxy for "same content". Rejected — a convenient
number, not the property. Fidelity is a review step in tasks.

### D4. Landing page structure and wording rules

Sections, in order: hero (one-line claim, one sentence naming Claude Code and OpenSpec, download and docs
buttons, the hero screenshot) → the problem (terminal tabs plus an editor you switch to just to read the
spec) → the side panel → sessions that survive restarts, and hibernation → conversation view → inbox and
handoffs → how it works in three steps (add a repository, start a Claude Code session, follow its change)
→ local-first and MIT → FAQ → download → footer (repository, releases, license, third-party notices,
disclaimer).

Wording rules, each from a finding:

- **Platforms**: "Linux builds are available today. macOS and Windows are not supported yet." — never
  "Linux only". The download button reads "Download for Linux (AppImage)" and links to the latest release
  page.
- **No "one agent per repository"**: a rail item can hold several sessions, and handoffs create more. The
  claim is that every session sits next to the change it works on.
- **No parallel-agent vocabulary** ("orchestrate", "a team of agents").
- **Comparisons describe approach, not licenses** — `project-license`'s guard forbids the usual terms for
  other tools' licensing. The FAQ compares many agents in parallel vs. a workspace per repository next to
  its spec; the real `claude` CLI in a real terminal, never scraped.
- **"Local-first" is never "nothing leaves your machine"**: the local-first section links to the Data and
  network page (D9) and summarizes it accurately.
- **The disclaimer** (not affiliated with Anthropic or the OpenSpec project) appears in every footer.
- **No star counts, testimonials, or logos** while there are none to show.

### D5. Docs outline, and what the READMEs keep

| group | pages |
|---|---|
| (index) | Documentation home at `/docs/` — Starlight generates no directory index (measured), and the READMEs link here |
| Getting started | Install · First workspace |
| Using spekterm | Terminals and sessions (restore, hibernation, worktrees) · The OpenSpec side panel · Conversation view · Files and quick open · Inbox and Slack · Handoffs |
| Reference | Keyboard shortcuts · Settings · Data and network |
| Help | Troubleshooting · FAQ |

The docs become the authoritative user guide. The READMEs keep: the opening paragraph and status (with
D4's platform wording), one screenshot, **Requirements and Install** — which keep the `libfuse2` line and
gain the `--appimage-extract-and-run` escape hatch next to it — **Install from source**, which gains the
first-build network note, the `install:desktop` / `uninstall:desktop` lines, Contributing, License,
Disclaimer, and a Documentation line pointing to `https://spekterm.com/docs/`. **Features, Keyboard
shortcuts, and Troubleshooting move to the docs.** Every line `desktop-packaging` reads stays in the
README, so that spec needs no delta, and its existing gap (the network note) is closed. Both README
languages change together.

### D6. Downloads link to the release page, the site has no version number

`https://github.com/spekhq/spekterm/releases/latest`. A direct asset link would need a fixed file name,
which `build-identity` rules out; fetching the version at build time would make the site stale between
builds. Docs refer to `Spekterm-<version>.AppImage`, as the README does.

### D7. Cloudflare Pages through its Git integration

Project settings (by hand, recorded in tasks): production branch `master`; root directory `site`; build
command `npm run build`; output `dist`; `NODE_VERSION` set explicitly to `site/.nvmrc`'s value; build
watch paths include `site/` and `scripts/lib/third-party-licenses.mjs` (D11 imports it) plus the two root
guards D12 runs; preview deployments off for every non-production branch (branches created by the mobile
app would otherwise get public URLs).

Every push to `master` that changes those paths is a production deploy. A failed build keeps the previous
deployment live; Cloudflare's deployment list can roll back to any earlier one.

*Alternative:* `wrangler pages deploy` from GitHub Actions after CI. With D12 the build runs the same
checks, so it would gate nothing more, and it puts a Cloudflare API token in the repository's secrets.
Rejected.

**Unverified until setup, each a setup task with a fallback:** whether the build can read files outside
the root directory (`../scripts/...`) — fallback: root directory `/` with `cd site &&` in the build
command; whether the build image has `git` and a `.git` directory (the two root guards need them) —
fallback: same; the watch-path wildcard syntax; the exact name of the preview-branch control; whether the clone carries tags (D12's version check fails
without them) — fallback: a build command that fetches tags first.

**Redirects** (revised during apply): `www.spekterm.com`, `spekterm.app`, and `www.spekterm.app` are added
as custom domains of the same Pages project, and a Pages Function middleware
(`site/functions/_middleware.js`) answers them with a 301 to `https://spekterm.com`, keeping path and
query. The first plan used proxied placeholder DNS records and a Bulk Redirect list; that needs an API
token with DNS and ruleset permissions, while the middleware needs only the Pages permission the
maintainer's `wrangler` login already has, and its logic is unit-tested (`scripts/site-redirect.test.mjs`).
The cost is a Function invocation per request (well inside the free quota). The `*.pages.dev` host is
not redirected; `rel="canonical"` (D2) points it at `spekterm.com`, and it is where a deployment can be
checked before it is live.

### D8. No tracking, checked at build and on the live site

1. **At build** (`site/scripts/check-origins.mjs`): every `src`, `srcset` candidate, and `href` of
   `script`, `link`, `img`, `source`, `iframe`, and every `url(...)` in the emitted CSS files, in the
   pages' `<style>` elements (Astro inlines small component styles — measured), and in `style` attributes
   is same-origin or `data:`. Parsing, not a regex over the file — Starlight's CSS contains `data:image/svg+xml…` with an
   `http://www.w3.org/2000/svg` namespace inside it. Hyperlinks (`<a href>`) to other origins are allowed.
2. **On the live site** (`site/scripts/check-live.mjs`, given the commit that was deployed): for every
   page in the sitemap, `/third-party-notices.txt`, and a path that does not exist, the live body must
   equal the corresponding file of that commit's `dist/` byte for byte (the last: status 404 and
   `404.html`) — which catches anything a zone feature injects, same-origin `/cdn-cgi/` scripts (Email
   Address Obfuscation, Rocket Loader) included; no response carries `Set-Cookie`. Byte equality requires
   a build that does not depend on its environment, so Starlight's `lastUpdated` (git history, unknown
   clone depth on Cloudflare) stays off. For each of the three redirecting hosts, a request to a deep path
   with a query returns 301 to the same path and query on `https://spekterm.com`. Run after the first deploy and after any zone setting
   changes; it cannot run before a deploy, so it is a manual step and the spec says so.

The setup tasks switch off Web Analytics, Bot Fight Mode, Email Address Obfuscation, Rocket Loader, and
Automatic HTTPS Rewrites for the zone; the live check is what proves it.

### D9. The network statement and its guard

The page is a `project-website` requirement; the guard constrains the app's source and is a
`workspace-app-shell` requirement that names the page.

The "Data and network" page has two parts:

- **What spekterm itself connects to**: Slack (or the endpoint the user set), only after credentials are
  saved; remote `https:` images in rendered markdown; links the user clicks, opened in the browser.
- **Programs spekterm starts, which connect on their own**: `claude` (agent sessions; the conversation
  report when the user asks for one) talks to Anthropic's service; `openspec` (the side panel) sends
  anonymous usage statistics unless turned off with `openspec config set telemetry.enabled false`, which
  works however spekterm is started. `OPENSPEC_TELEMETRY=0` / `DO_NOT_TRACK=1` are mentioned only with
  their limit: they work when they are in the environment spekterm itself was started with — a value set
  in `.zshrc` does not reach `openspec` when spekterm is started from the desktop menu, because only
  `PATH` from the captured shell environment enters the main process (`user-env.ts`) and `@spekjs/core`
  spawns `openspec` without an `env`. The user's login shell runs once at startup to read the
  environment. The page says spekterm's checks cannot see what these programs do.

`scripts/network-surface.test.mjs` parses every non-test file in `src/main`, `src/preload`, and
`src/shared` (the main process imports it) with the TypeScript compiler (as `copy-language.test.mjs`
does) and reports:

- **every identifier, property name, or string-literal element access** spelled `fetch`, `WebSocket`,
  `EventSource` outside type positions — so `globalThis.fetch(...)`, `globalThis['fetch']`, `x ?? fetch`,
  and `const { fetch: f } = globalThis` all count (`slack-api.ts` only references `fetch`). Today the
  only other spellings in `src/main` are the private `#fetch` and `fetchImpl`, which are different
  names, so this is precise enough without a type checker; a parameter named `fetch` is a false positive
  in the safe direction;
- **every import of a bare module specifier** — static, `import()`, or `require` — with `node:`
  normalized away, against an allow-list —
  network modules (`net`, `tls`, `http`, `https`, `http2`, `dgram`) are never on it, and any new
  dependency (`ws`, `undici`, `axios`, …) fails until someone adds it and revisits the page. Today's list:
  `electron`, `chokidar`, `i18next`, `node-pty`, `@spekjs/core`, `@spekjs/core/graph-node-id`, `@shared/*`,
  and the `node:` modules in use;
- uses of Electron's `net`, `session.fetch` / `ses.fetch`, `autoUpdater`, `crashReporter.start`,
  `downloadURL`, `setSpellCheckerDictionaryDownloadURL`, `setSpellCheckerLanguages` with a non-empty
  argument, and `loadURL` with anything but the app's own page;
- `shell.openExternal` is **deliberately not listed**: it hands a URL the user clicked to their browser.
  The test's header says so.

Every hit must match an allow-list entry `{ file, api }`; an entry with no hit fails too (stale entries
would otherwise be permanent holes). The allow-list's header names the docs page. Control groups: an
unlisted `fetch` call, an `x ?? fetch` reference, an aliased `const f = fetch`, `globalThis.fetch`,
`globalThis['fetch']`, a bare `'https'` import, an allow-listed file using a second API, and a stale
entry — each must fail. The list of programs spekterm starts stays hand-written on the page; extending the
guard to `child_process` / `utilityProcess` / `node-pty` call sites is possible later and out of scope. The renderer is covered by its CSP (`connect-src
'self'`), which `probe:files` and `probe:package` already assert.

### D10. The spell checker is off, and Chromium makes no connection at startup

`session.defaultSession.setSpellCheckerLanguages([])` in `whenReady`, before the window is created —
the one measured setting that stops the download — plus `webPreferences.spellcheck: false` so no input
shows a spell-check underline. Users who already have a downloaded dictionary keep the file; it is inert.

Carrier: a `probe:shell` check. **The TCP listener (port registered in `lib/ports.mjs`) is open before
the app is spawned** — the dictionary connection was measured at ~604 ms, before the window appeared at
~612 ms. The app is launched with the argv element
`--host-resolver-rules=MAP * 127.0.0.1:<port>, EXCLUDE localhost` (one array element, no quotes — a
quoted value or a `;` separator makes Chromium ignore the rules silently, measured). After a fixed settle
window the check asserts the listener received **no** connection; then, in the same run, the renderer
loads an image from `https://control.invalid/` (allowed by `img-src https:`) and the check asserts the
listener receives at least one connection whose TLS SNI is that host — **the positive control**, without
which "the fix works" and "the rules were ignored" are indistinguishable (measured: correct rules, unfixed
app → 2 connections, SNI `redirector.gvt1.com`; fixed → 0; quoted rules → 0 either way; control image →
2 under correct rules, 0 under quoted rules). It needs no network and does not depend on the
`Dictionaries/` directory (created either way); CDP over `127.0.0.1` is unaffected (measured).

**Its reach is Chromium's network stack only.** Measured: under `MAP *`, `net.fetch` is redirected, but
the main process's global `fetch` (Node's undici — what Slack uses) goes straight to the network. Node-side
connections are D9's static guard's job. The settle window is a stated bound, not a proof of "never".

**The upgrade path gets its own launch.** A profile in which an earlier version registered `en-US` but
has no dictionary file (never finished downloading, or deleted) still makes the unfixed app download it;
a profile that already has the file does not connect even unfixed (measured), so it cannot discriminate
and is not used. The second launch seeds `Preferences` with
`{"spellcheck":{"dictionaries":["en-US"],"dictionary":""}}` (measured as what an unfixed run writes),
written by the probe itself — no committed fixture, no binary, no dictionary license to carry — and
asserts zero connections with the same positive control.

The existing `probe:shell` launch already uses a fresh profile and serves as the fresh-profile check; the
upgrade launch is the only new one. Its debugging port is registered in `PROBE_PORTS.shell`; the listener
uses an ephemeral port (`listen(0)`). The settle window is 10 seconds: the connection was measured at
~0.6 s and the download completed within 8 s. The new checks run after the existing whitelist checks so a
failure there does not hide them.

### D11. Third-party notices reuse the desktop pipeline's helpers

A Vite plugin in `astro.config.mjs` records module ids per environment (`this.environment.name`): every
id from the client environment, and the CSS ids from the prerender environment (where Starlight's styles
are built). Packages whose shipped files are not reached through module ids — Pagefind's UI and
`astro-expressive-code` / `@expressive-code/*` — are added by name. `packageRootOf`, `licenseEntryOf`, and
`renderSummary` (gaining a heading parameter, so the desktop summary keeps its wording) write
`dist/third-party-notices.txt`; `legalCommentsOf` adds preserved license comments, as for the desktop
artifact. Over-inclusion is harmless; omission is not, so ambiguity resolves toward inclusion.

The footer links the notices from a component, which the link validator does not inspect; the validator
excludes that path in case content links it.

### D12. The site's `build` is the gate

`site/package.json`'s `build` runs `site/scripts/build.mjs`, which orchestrates the steps below — a
script rather than an `&&` chain, so the scenario-coverage table can find its carrier labels and a step
removed from it is visible in review. **Every check runs its own `--self-test` (fixtures built to violate
it) before running on the real output**, so a check that has gone blind stops the build instead of
passing it. A root unit test asserts `build.mjs` still invokes each step.

- Steps: `astro check` → the two root content guards on the repository
  (`node --test ../scripts/public-hygiene.test.mjs ../scripts/license.test.mjs`) → `astro build` with
  `starlight-links-validator` (fails on a broken link or anchor **in Markdown content**) →
  `check-parity` → `check-origins` → write the notices → `check-content`.
- `site/scripts/check-content.mjs` reads the built HTML and carries the content scenarios no other check
  does: every page's canonical URL; every page's language switch targets its counterpart; the landing
  page's required elements in both languages; the disclaimer and the notices link on every page and on
  `404.html`; no "Linux only" phrase (the spec's list); every required docs topic has a page; every link
  to the repository's releases targets `/releases/latest`; no released version (`git tag -l 'v*'`) or the
  root `package.json` version appears in any HTML page, matched on word boundaries, **and an empty tag
  list fails** (a shallow clone without tags would otherwise pass silently; `v0.2.1` exists); `/docs/`
  and `/zh-tw/docs/` are in the sitemap; the data and network page names what the spec lists. Each check has a control in the script's own self-test mode, which runs it against a fixture page
  built to violate it. Cloudflare runs `build`, so a page that fails any
  of these never deploys — including a page that leaks an internal name, which CI alone would only report
  after the deploy.
- `.github/workflows/site.yml`, triggered by the same paths as the Cloudflare watch list, runs `npm ci`
  and `build` in `site/` — the record for direct pushes and the signal for pull requests.

Root: `eslint.config.js` ignores `site/**`; `site/.gitignore` covers `dist/`, `.astro/`, `node_modules/`;
the site has no `*.test.*` files, so `test-glob` is unchanged; a root unit test,
`scripts/site-boundary.test.mjs`, checks that the packaging configuration's `files` / `extraFiles` /
`extraResources` select no path under `site/` (mutation: add `site/**`), that the root `package.json` has
no workspace and the root lockfile no entry under `site/`, and that both READMEs link to the docs, contain
none of the "Linux only" phrases, and state what `desktop-packaging` requires of them — which also gives
those existing README scenarios their first carrier; the NUL-byte guard gains `site` as a root,
skips `node_modules`, `dist`, `.astro` by name, and adds `astro`, `mdx` to `TEXT_FILE`.

### D13. Screenshots: one script, an invented identity, both languages, read before committed

`scripts/capture-screenshots.mjs` (root, because it drives the built app with the probes' libraries, and
therefore under their guards: port in `lib/ports.mjs`, waits through `pollFor`, no hand-written retries)
starts the built app under Xvfb with:

- a fresh `--user-data-dir` seeded with the folder list, panel coordinates, and UI language
  (`seedLanguage`);
- an **allow-listed environment written for this script** (no probe does this today —
  `probe-agent-view.mjs` spreads `process.env`): `SHELL=/bin/zsh`, `HOME`, `CLAUDE_CONFIG_DIR`, display
  variables, and a `PATH` assembled from system directories plus the stub agent's directory — not the
  maintainer's `PATH`, which contains home-directory paths. `ptyEnv()` spreads `process.env`, so anything
  inherited would reach every pty;
- `HOME` pointing at a fixture home with a `.zshrc` whose prompt is a fixed `me@spekterm`, and a
  `.gitconfig` with a generic author; the startup shell-environment capture reads that home. The
  maintainer's `~/.fonts` disappear from the font list — fonts come from the system, which makes the
  images reproducible;
- fixture repositories at a **fixed generic path** (`/tmp/spekterm-shots/{api-server,web-app}` — the
  status bar shows the working directory), each with an OpenSpec change in progress;
- the stub agent as `claude`, **extended with an option that copies a fixture transcript into the
  session's transcript path at spawn**, since the path contains the session id only known then;
- the terminal's GPU renderer off (software GL under Xvfb proves resource lifecycles, not pixels) and
  `--force-device-scale-factor=2`.

Before each capture it reads `document.body.innerText`, the values of every `input` / `textarea`
(`innerText` omits them), and every terminal's buffer text, and runs them through the same word-hash and
home-path checks as `public-hygiene`; a hit aborts the capture. That logic is extracted from
`public-hygiene.test.mjs` (which exports nothing and runs `git ls-files` at import) into
`scripts/lib/public-hygiene.mjs`, shared by the test and the script. **Each read has a positive control**:
the fixture name `api-server` must be found in the text, or the capture aborts — an empty page or the
wrong target would otherwise pass with zero hits, the failure `public-hygiene`'s known-public-word check
exists for. It writes `site/src/assets/screenshots/<lang>/<name>.png` for `en` and `zh-TW`, plus
`site/src/assets/screenshots/manifest.json` with each file's SHA-256. A root unit test
(`scripts/screenshot-manifest.test.mjs`, inside the `test:unit` glob) checks both directions: every
committed screenshot is in the manifest with a matching hash, and every manifest entry exists — a weak but
real carrier for "only the script's output is committed" (it cannot prove where the manifest came from).
The maintainer still reviews every image before committing it.

### D14. Scenario coverage

This change registers in `COVERED_CHANGES`. `scenario-coverage.test.mjs` extends its carrier search to
`site/scripts/` and `site/astro.config.mjs` (skipping `node_modules`, `dist`). Scenarios that only a
human or the live site can check — the live check (D8), the redirects and publishing-branch rules (D7),
"a failed build leaves the site in place", screenshot review, translation fidelity — are registered as
"no carrier" with the reason. The notices scenario is registered `greenIfAbsent` for a package the
generator misses: the generator is its own carrier, the same gap the desktop notices row records.

### D15. Repo conventions

`CLAUDE.md`'s Conventions section lists the site's Traditional Chinese files —
`site/src/content/docs/zh-tw/**` and `site/src/i18n/zh-TW.json` — as the third exception to "everything
committed is English". The CJK guard only scans `src/`. `docs/PRD.md` §11 gains the website. CLAUDE.md's
domain-renewal note gains "the website depends on it", and its commands section states that a push to
`master` touching the watched paths deploys the site.

## Risks / Trade-offs

- [Translations drift as the app changes] → parity keeps page and string sets equal; content drift is
  caught only by review. CLAUDE.md's Workflow section adds: a change that alters documented behavior
  updates the docs in both languages.
- [Screenshots go stale as the UI changes] → retaking is one command; no automated staleness check.
- [The network guard sees only spekterm's own source] → native modules, Electron internals (as the spell
  checker was), and child processes are invisible to it. D10's startup check covers Chromium's own
  startup connections; the docs page states the guard's reach and lists the child processes by hand.
- [The OpenSpec CLI's statistics are on by default] → stated with the opt-out; changing it is a
  decision left to the user (Non-Goals).
- [Cloudflare behavior not verified: outside-root reads, git in the image, watch paths, preview control]
  → each is a setup task with a stated fallback (D7); the live check runs last.
- [Starlight is 0.x] → exact pins and a lockfile; upgrades are deliberate.
- [Push to `master` deploys] → stated in CLAUDE.md; the build runs the content guards first (D12).
- [The startup check's settle window] → a connection made later than the window is not seen; the bound is
  written into the check's message.

## Migration Plan

1. App side, independent of the site: turn off the spell checker with its probe check; add the network
   guard; extend the stub agent.
2. Build and check the site locally; capture, mechanically check, and review screenshots.
3. Create the Cloudflare Pages project (D7), resolving each unverified item; deploy; attach
   `spekterm.com`.
4. Add the three redirecting hosts as custom domains (the middleware redirects them); check the zone features in D8 with the live check.
5. Run the live check against `https://spekterm.com` and the three redirecting hosts.
6. Set the GitHub homepage; shrink the READMEs and link the site.

Rollback: Cloudflare's deployment list restores an earlier build; detaching the custom domain takes the
site offline without touching the repository. The app-side changes stand on their own.
