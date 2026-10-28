## Why

spekterm has a companion Android app on Google Play, but the website only mentioned it deep inside the remote
access page. A text-only revision (a landing page section and a "spekterm on your phone" docs page) fixes where
it is said; what it still lacks is a picture of the app — and the site's rule that every screenshot comes from
the capture script has no way to produce one: the app is a native Android app, photographed on an emulator
against a demo desktop, in its own repository.

## What Changes

- The capture script **imports** spekterm for Android's phone screenshots — the five in its Google Play listing
  (`play/listings/<locale>/graphics/phone-screenshots/`) — as committed at a spekterm-android release tag, byte
  for byte, into the per-language screenshot directories as `phone-<name>.png`, records their hashes in the
  manifest like every other screenshot, and records the tag beside them. A tag that is not a release, or a
  listing that lacks one of the five or holds one of the wrong size, aborts the import with nothing changed.
- The manifest test also fails on a phone screenshot outside that set and on phone screenshots without a
  recorded tag.
- A phone screenshot component shows them side by side: three on the landing page's phone section, all five on
  the "spekterm on your phone" page.
- The landing page is **required** to introduce the Android app: a phone screenshot, a link to its Google Play
  listing, a link to the phone page, and the statement that it needs spekterm running on the computer — checked
  by the build, so the app cannot quietly slip back out of view.
- The documentation's required topics gain remote access and using spekterm on a phone.
- The site's README gets a "When spekterm-android releases" step (re-import from the new tag).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `project-website`: "Screenshots come only from the capture script" admits phone screenshots imported from a
  spekterm-android release tag (and states which of its checks they are exempt from: the allow-list environment
  and the on-screen text read); "The landing page states what spekterm is and where it runs" also requires the
  Android app's introduction; "The documentation is the user guide" lists remote access and the phone page.

## Impact

- `scripts/capture-screenshots.mjs` (the import, `--only phone`), a new `scripts/lib/phone-shots.mjs` with its
  test, `scripts/screenshot-manifest.test.mjs`, `scripts/scenario-coverage.test.mjs`, the root `CLAUDE.md`.
- `site/`: a `PhoneScreenshots.astro` component, both landing pages and both phone pages, `content-plan.json`,
  `scripts/check-content.mjs` (the landing check and its self-test fixtures), `README.md`, and ten new images
  plus their manifest entries and source file under `src/assets/screenshots/`.
- Reads a local spekterm-android repository at a tag (`ANDROID_DIR`, default `../spekterm-android`;
  `ANDROID_TAG`, default its highest release tag); no network, no new dependency. Nothing reaches the desktop app.
