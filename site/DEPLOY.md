# Deploying spekterm.com

The site is published by **Cloudflare Pages' Git integration**: Cloudflare builds `site/` from
`master` and publishes it only when the build — which is also the site's gate (`README.md`) — succeeds.
A failed build leaves the previous deployment live. These steps are done once, by hand, in the
Cloudflare dashboard (account that owns the `spekterm.com` and `spekterm.app` zones).

> Every push to `master` that changes a watched path (below) becomes a production deploy.

## 1. The Pages project

Workers & Pages → Create → Pages → Connect to Git → `spekhq/spekterm`.

| setting | value |
|---|---|
| Production branch | `master` |
| Framework preset | None |
| Root directory | `site` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variable | `NODE_VERSION` = the value in `site/.nvmrc` |

Then, under Settings → Builds:

- **Build watch paths** — include: `site/*`, `scripts/lib/third-party-licenses.mjs`,
  `scripts/lib/public-hygiene.mjs`, `scripts/public-hygiene.test.mjs`, `scripts/license.test.mjs`;
  exclude: nothing.
- **Branch control** — preview branches: **None** (branches pushed from elsewhere must not get public
  preview URLs).

### Items not verified before the first deploy

Record the outcome of each here after the first build.

| item | if it fails |
|---|---|
| The build reads files outside the root directory (`../scripts/...`) | Root directory `/`, build command `cd site && npm ci && npm run build`, output `site/dist` |
| The clone has `git` and a `.git` directory (the root content guards need them) | Same as above; if `git` itself is missing, report it — the gate cannot run without it |
| The clone carries tags (the version check fails on an empty tag list) | Build command prefixed with `git fetch --tags --force &&` |
| The watch-path syntax (`site/*` vs `site/**`) | Push a commit that touches only `src/` and confirm no build starts |
| The name and place of the preview-branch control | Note where it is |

## 2. The custom domain

Pages project → Custom domains → add `spekterm.com`. Cloudflare creates the DNS record in the zone.

## 3. Redirects

`www.spekterm.com`, `spekterm.app`, and `www.spekterm.app` are custom domains of the same Pages project
(Custom domains → add each). The Pages Function `functions/_middleware.js` answers them with a 301 to
`https://spekterm.com`, keeping the path and query; its logic is tested by
`scripts/site-redirect.test.mjs`. No DNS records or redirect rules are needed beyond what adding a custom
domain creates. The `*.pages.dev` host is not redirected; every page's `rel="canonical"` points at
`spekterm.com`.

## 4. Zone features that change what is served

In the `spekterm.com` zone, turn **off**: Web Analytics (for the Pages project as well), Bot Fight
Mode, Email Address Obfuscation, Rocket Loader, and Automatic HTTPS Rewrites. Each can inject a script,
a cookie, or rewrite the HTML without any change to the repository.

## 5. The live check

```bash
cd site
node scripts/check-live.mjs --commit <deployed commit>
```

It builds that commit in a temporary worktree and checks that every page, the notices file, and the
not-found response are served byte for byte as built, with no `Set-Cookie`, and that each redirecting host
answers 301 with the path and query kept. Run it after the first deploy and after any change to zone
settings.

## 6. The repository's homepage

```bash
gh repo edit spekhq/spekterm --homepage https://spekterm.com
```

## Rollback

Pages project → Deployments → pick an earlier deployment → *Rollback*. Removing the custom domain takes
the site offline without touching the repository.
