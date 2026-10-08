## Why

`spekterm.com` and `spekterm.app` were bought on 2026-07-12 and still resolve to nothing. The only
public face of the project is the GitHub README, which has to be a feature list, an install guide, and a
contributor entry point at once — and it cannot show what the app looks like or explain the OpenSpec side
panel, which is the whole reason spekterm exists instead of "four terminal tabs". With a published release
and the repo public, there is now something to point people at.

## What Changes

- **A website in `site/`**, a self-contained package (its own `package.json` and lockfile) that never
  enters the app's dependency tree or its packaged output. Lint and type checking of the site are the
  site's own; the root's content guards still read it.
- **A landing page** at `https://spekterm.com/`: what spekterm is in one sentence, a real screenshot of
  a terminal next to the side panel, the features that set it apart (OpenSpec side panel first), a short
  "how it works", a local-first and license section, an FAQ, a download call to action, links to the
  repository, releases, and documentation, and the same "not affiliated with Anthropic or OpenSpec"
  disclaimer the README carries. Platform status is stated next to the download button: builds are
  available for Linux today, macOS and Windows are not supported yet (planned, not ruled out), and the
  project is early. The site never calls spekterm a Linux-only app.
- **Positioned on the side panel, not on parallel agents.** The comparable workbenches surveyed for this
  change (Conductor, Superset, Sculptor, Nimbalyst, cmux) lead with running many agents at once; spekterm's
  distinct value is that every session sits next to the OpenSpec change it is working on. The FAQ answers
  "how is this different from running Claude Code in a terminal, or from those tools?" directly.
- **A documentation section** at `https://spekterm.com/docs/`: install, first workspace, terminals and
  sessions, the OpenSpec side panel, the conversation view, the inbox and handoffs, keyboard shortcuts,
  settings, data and network, and troubleshooting. The docs become the authoritative user guide; the
  READMEs keep a short overview and point to them instead of carrying a second copy of the details.
- **Two languages**, English (default, at `/`) and Traditional Chinese (at `/zh-tw/`), with a language
  switch on every page. **Both languages ship with the same content in this change** — every page
  exists in both, and a check fails the build when a page exists in only one. The generator's
  untranslated-page fallback stays as a safety net, not as a plan.
- **Hosting on Cloudflare Pages**, built from `site/` on this repository. `spekterm.com` is canonical;
  `www.spekterm.com`, `spekterm.app`, and `www.spekterm.app` redirect permanently to it, keeping the
  path; the Pages project's own `*.pages.dev` host points to it with `rel="canonical"`.
- **Downloads link to the latest GitHub release page**, so a new version needs no site rebuild and the
  site carries no version number of its own (asset names include the version, so a fixed direct-download
  URL does not exist).
- **No tracking, checked on the deployed site**: no cookies, and no script, style, or font loaded from
  another origin — verified against the live response, because Cloudflare zone features can inject them
  without any change to the repository.
- **The app stops downloading spell-check dictionaries.** Electron's built-in spell checker (the red
  underline in text inputs) fetches a dictionary from Google's servers **at every startup with a fresh
  profile** on Linux, before the user touches anything — a connection the user never asked for, serving a
  feature no part of the app needs (terminals and the editor do not use it). The spell checker is turned
  off, and Chromium's network stack is checked to make no connection at startup.
- **The site's statements about the network match what the app does.** After that change the app itself
  connects to Slack (or the endpoint the user set) only after Slack credentials are saved, and any
  markdown it renders (files, OpenSpec artifacts, the conversation view) may load remote `https:` images.
  Separately, it starts programs the user installed, which make their own connections: the `claude` CLI
  (agent sessions, and the conversation report when the user asks for one), which talks to its own
  service; the `openspec` CLI (the side panel), which sends anonymous usage statistics unless the user
  turns them off (`openspec config set telemetry.enabled false` — an environment variable in `.zshrc`
  does not reach it when spekterm is started from the desktop menu); and the user's login shell once at
  startup. The site says exactly that, including how to turn OpenSpec's statistics off. A unit guard lists
  the network-capable APIs and every imported module in `src/main`, `src/preload`, and `src/shared`
  against an allow-list that points at the site's
  page, so a new connection in the app's own code cannot ship without the page being revisited; what the
  started programs do is outside what the guard can see, and the page says so.
- **Screenshots are produced only by a capture script**, against an isolated user-data directory, a
  fixture home directory and shell prompt, fixture repositories, and the stub agent — never from the
  maintainer's own session. The existing content-hygiene guard skips binary files, so the pixels of a
  screenshot are otherwise unchecked.
- **Third-party notices**: the site publishes the licenses of the packages it ships to the browser (it
  uses no web fonts).
- The repository's GitHub "Website" field is set to `https://spekterm.com`; both READMEs link to it.

## Capabilities

### New Capabilities

- `project-website`: the public website — where it is built from and how it stays out of the app, the
  canonical domain and redirects, the two languages and their fallback, the landing page's required
  content, the documentation's required topics and its relation to the READMEs, how downloads are linked,
  the no-tracking rule checked on the deployed site, the network statement, how screenshots
  are produced, the third-party notices, and how the site is checked before it ships.

### Modified Capabilities

- `workspace-app-shell`: two new requirements — the app does not run Electron's spell checker and its
  browser engine opens no connection at startup that nothing asked for; and the app's own code connects
  only where an allow-list says, with the allow-list naming the site's data and network page.

Checked and unchanged: `public-content-hygiene` covers the site's text (it scans every tracked and
unignored file), but not images — the screenshot rule lives in `project-website`. `project-license`'s
guard against restrictive license wording also covers `site/` unchanged; the site's own third-party
notices are a `project-website` requirement because `project-license` is scoped to the desktop artifact.
`desktop-packaging` reads the README for the run prerequisites, the escape hatch, and the desktop install
commands; the README keeps those (and gains the first-build network note it has been missing), so that
requirement is met where it already points.

## Impact

- **New directory `site/`** with its own dependencies (a static-site generator) and its own
  `.gitignore` for build output and generated types. The root `package.json` has no workspaces, so the
  root `npm ci` does not install them, and `build.files` packs nothing from `site/`.
- **Root tooling**: `eslint .` ignores `site/**` (today it would lint the site's built bundle, since its
  `dist/**` only matches the root); the site has no `*.test.*` files of its own, so `test-glob` needs no
  change; the NUL-byte guard's roots gain `site`; the scenario-coverage table learns to find carriers in
  `site/scripts`.
- **The site's build is its gate.** Cloudflare runs the site's `build` script, so the type check, the
  page-parity, origin, and link checks, and the two content guards that read the site's text
  (`public-hygiene`, `project-license`'s wording guard) all run inside it — a page that fails any of them
  never deploys. A separate CI workflow runs the same script for the record.
- **Guards that constrain the site's text**: `public-hygiene` (internal names, home paths) and
  `project-license`'s restrictive-wording guard — the FAQ that compares spekterm with other tools must
  describe their licensing without the forbidden terms.
- **Deploying**: a push to `master` that changes `site/` becomes a production deploy. The maintainer
  commits directly to `master`, so CI cannot gate it the way it would a pull request. Deployment uses
  Cloudflare's Git integration, limited by build watch paths to `site/` and the few root scripts its
  build uses, and with branch previews off
  so stray branches do not get public URLs; a failed Cloudflare build leaves the live version in place.
  (Deploying from GitHub Actions after CI was the alternative; it needs a Cloudflare token in the
  repository's secrets, and once the build runs the same checks it gates nothing more.)
- **App code**: the session's spell-checker languages are emptied and `webPreferences.spellcheck` is
  off (`src/main/index.ts`); a probe check maps every host Chromium resolves to a local listener and
  asserts no connection at startup, with a positive control; a new unit guard covers `src/main`,
  `src/preload`, `src/shared`. The screenshot script needs the stub agent to start from a prepared
  transcript, and `public-hygiene`'s matching logic moves into `scripts/lib/` so the script can share it. Existing users
  keep the already-downloaded dictionary file in their user-data directory; it is inert and is not
  deleted.
- **Repo conventions and docs**: the site's Traditional Chinese pages become a third exception to
  "everything committed is English", next to `README.zh-TW.md` and the UI's `zh-TW` dictionary
  (`CLAUDE.md` records it). Both READMEs shrink to an overview that links to the docs, keeping the
  requirements, install, escape hatch, and desktop-install lines `desktop-packaging` reads them for; their
  "Linux only" wording becomes "Linux builds today; macOS and Windows not yet supported".
  `docs/PRD.md` §11 gains the website.
- **Outside the repository (done by the maintainer, documented step by step in the change)**: create the
  Cloudflare Pages project, attach `spekterm.com`, add proxied DNS records and redirect rules for
  `www.spekterm.com`, `spekterm.app`, and `www.spekterm.app`, check that no zone feature injects cookies
  or scripts, and set the GitHub repository's homepage.
- **Domain renewal** stays load-bearing (CLAUDE.md, product identity): the site now depends on it as well
  as the frozen `appId`.
