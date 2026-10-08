## 1. Product structure

- [x] 1.1 Add `site/src/product.mjs` (D1): the product of a path and each product's constants; cover it in `check-content`'s self-test over `/`, `/docs/x/`, `/spek/`, `/zh-tw/spek/docs/x/`, `/spekx/`, `404.html`; verify `node site/scripts/check-content.mjs --self-test`
- [x] 1.2 Override `SiteTitle` (product logomark and name to its landing page, switch to the other product; switch label in both dictionaries) and `SocialIcons` (repository link per product) (D2); verify in the built HTML of `/`, `/zh-tw/`, `/spek/`, `/zh-tw/spek/` that the targets match the spec scenarios
- [x] 1.3 Add spek's sidebar groups to `astro.config.mjs`; in `src/routeData.ts` filter `starlightRoute.sidebar` and recompute `starlightRoute.pagination` per product (D3); verify the last spekterm docs page's Next and the first spek docs page's Previous in the built HTML stay within their product
- [x] 1.4 In `src/routeData.ts` (D4, D5): replace the tab-icon `href`, add the home-screen icon (removed from the config `head`), choose share image and alt text, and on spek pages rewrite the `<title>` suffix and `og:site_name`; verify in the built head of a spek page and a spekterm page (one icon link each, one home-screen icon, alt text per product; spek's title ends "spek")
- [x] 1.5 `Hero`: print the platform status only on spekterm pages; `Footer`: source and license links per product (D5); verify the built spek landing page has no platform-status string and no link under `github.com/spekhq/spekterm`

## 2. spek's brand assets

- [x] 2.1 Copy spek's `logo/` marks (logomark, logomark-light, favicon, full logos) into `site/src/assets/spek/` from the spek tag the screenshots use, and record the tag in `site/README.md`; verify with `cmp` against spek's files at that tag
- [x] 2.2 Extend `site/scripts/make-brand-images.mjs` to write `public/spek-favicon.svg`, `public/spek-apple-touch-icon.png`, and `public/og/spek-en.png` / `spek-zh-tw.png` (title from spek's landing page `hero.title`); verify by viewing each generated image

## 3. spek screenshots

- [x] 3.1 Add the spek loop to `scripts/capture-screenshots.mjs` (D7): `SPEK_DIR`, the clean-and-release-tagged check (`v<major>.<minor>.<patch>`, recorded in `neutral/SOURCE`), the rebuild of spek's core and ui, the builder via the checkout's `tsx` in the allow-list environment, an Electron window at 1440×900 @2x, hash-route navigation, the per-shot fixture-text positive control, the font check, output to `site/src/assets/screenshots/neutral/`; verify `node scripts/capture-screenshots.mjs --only spek-change` (and each other spek shot) writes its file and manifest entry
- [x] 3.2 Verify the spek pre-capture read in both directions: a forbidden word injected into the fixture's spec text aborts the spek shot (non-zero exit), and pointing a shot at a route that does not show its fixture text aborts it; revert both
- [x] 3.3 Verify the checkout guard: with an uncommitted change in a scratch copy of the spek checkout, with HEAD on a commit carrying only `core-v…` / `v1`-style tags, and with HEAD off any tag, the spek shots abort and name the reason; at `v1.19.0` the recorded tag is `v1.19.0`
- [x] 3.4 Review every spek screenshot by eye for anything of the capturing machine (paths, names); verify `npm test` (`screenshot-manifest`) passes

## 4. Pages (English and Traditional Chinese)

- [x] 4.1 spek landing page `src/content/docs/spek/index.mdx` and `zh-tw/spek/index.mdx` per "spek's landing page states what spek is and how to get it"; verify with the landing check of 5.1 and by reading both pages for a spek version number
- [x] 4.2 spek docs index and topic pages under `spek/docs/` (both languages) for every topic of "spek's documentation is spek's user guide", each statement checked against the spek code at the recorded tag and on spek's default branch; verify with the topics check of 5.1
- [x] 4.3 spek's data and network page per "spek's documentation states its network behavior", per form, with the API server worded from the spek fix's report (design Risks); verify with the network-keyword check of 5.1
- [x] 4.4 spekterm landing page "Built on spek" (both languages): lead with a card to `/spek/`, move the GitHub and demo cards to spek's landing page, correct the aggregation sentence (D10); spekterm FAQ's spek entry links to `/spek/`; verify with the landing check of 5.1 (links read from main content)
- [x] 4.5 Footer disclaimer (both dictionaries) names spekterm and spek; verify with the disclaimer check of 5.1

## 5. Checks

- [x] 5.1 `check-content` per D9, each rule with a violating self-test fixture; verify `node site/scripts/check-content.mjs --self-test` reports every fixture and the real build passes
- [x] 5.2 `check-parity` self-test with a neutral screenshot that must not be reported; verify `node site/scripts/check-parity.mjs --self-test`
- [x] 5.3 `scripts/scenario-coverage.test.mjs`: register `spek-on-the-website`; add a row for each scenario new in this change, and revise the existing rows of the modified scenarios (carriers, mutations, and the green-if-absent column — including the spekterm landing row, whose footer blind spot 5.1 fixes); verify `npm test`

## 6. Documentation and verification

- [x] 6.1 Update the Purpose of `openspec/specs/project-website/spec.md` to name both products; verify by reading it
- [x] 6.2 `site/README.md`: the two products, the spek screenshot prerequisites (`SPEK_DIR`, clean tagged built checkout, network for the font, the builder's temporary directory), and a "when spek releases" step; root `CLAUDE.md` Website bullet: the site serves spekterm and spek; verify `npm test` (naming, hygiene) passes
- [x] 6.3 Site build passes (`cd site && npm run build`); root `npm test`, `npm run lint`, `npm run typecheck` pass
- [x] 6.4 Check the built site at 1440×900 and 390×844, light and dark, both languages, on `/`, `/spek/`, a spek docs page, and a spekterm docs page: no horizontal overflow, the product switch's bounding box lies inside the title wrapper and the viewport, the sidebar per product
