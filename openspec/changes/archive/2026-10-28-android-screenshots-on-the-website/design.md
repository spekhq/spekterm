## Context

The site's screenshots all come from `scripts/capture-screenshots.mjs`: spekterm's are captured from the built
app on fixture repositories with a stub agent, spek's from a static spek page built from a clean spek checkout
at a release tag (`spekRelease()`). Before each capture the script reads the on-screen text through the
content-hygiene matcher and requires a known fixture text. `scripts/screenshot-manifest.test.mjs` fails on any
committed image whose hash is not in the manifest, and on a recorded image that is missing. Before its main
flow the script re-runs itself under a virtual display, refuses to start without a build in `out/`, and
recreates the fixture repositories under `/tmp/spekterm-shots`.

spekterm for Android lives in its own repository (`../spekterm-android` on the maintainer's machine). Its
`play-release` change (archived 2026-10-20) took five phone screenshots per language for the Google Play
listing — `play/listings/{en-US,zh-TW}/graphics/phone-screenshots/0N-<name>.png` — at 1080 × 1920 on an
emulator, against a demo desktop with a throwaway profile and throwaway repositories (`weather-app`,
`notes-api`, `landing-page`, desktop named `demo`), under the rule that nothing on them may name a real
repository, session, person, host or address. Its latest release tag is `v0.4.0` (lightweight, `v*` tags only);
`05-openspec` was retaken in that release's commit, and the repository does not record whether the retake used
the demo desktop — the maintainer's review (D4) is what settles it.

The landing page's phone section and the "spekterm on your phone" page (`docs/getting-started/phone`) are
already written, text only, in the working tree; `content-plan.json` already lists that page as a topic.

## Goals / Non-Goals

**Goals:**
- Phone screenshots on the landing page and the phone page, in both languages, with the same provenance
  record as every other screenshot (manifest hash, source tag, maintainer review).
- The landing page cannot lose the Android app's introduction without the build failing.

**Non-Goals:**
- Taking phone screenshots in this repository (an emulator, the Android SDK, a demo desktop and an agent
  account are the Android repository's business).
- Reading the text on a phone screenshot (no OCR; see D4).
- Changing how spek's shots are taken. `spekRelease()` stays as it is.
- A device frame around the screenshots.

## Decisions

### D1. Read the listing's files as committed at a release tag

The phone step reads, with `git -C <dir> show <tag>:<path>` into a buffer, each listing screenshot as committed
at a release tag — never the working tree. `<dir>` is `ANDROID_DIR` (default `../spekterm-android`) and must be
the top of a git repository: `rev-parse --show-toplevel` equals `realpathSync(resolve(dir))` (a relative path,
a trailing `/` or a symlink still match; `git -C` cannot climb into an enclosing repository). `<tag>` is
`ANDROID_TAG` when set, otherwise the highest `v<major>.<minor>.<patch>` tag, chosen by filtering with that exact
pattern first and then comparing numerically (git's `-v:refname` order puts `v1` above `v0.10.0`); none is a
problem. The tag must exist as a tag (`rev-parse --verify refs/tags/<tag>`), and files are read as
`git cat-file blob refs/tags/<tag>:<path>` (plumbing: no textconv, and a branch of the same name cannot stand in).
**Every git call's exit status is checked**: a non-zero status or a spawn error (`result.error`, e.g. `ENOBUFS`)
is a problem naming the call, the tag and the path, never an empty answer. Calls run with `LC_ALL=C` and a
`maxBuffer` of 64 MiB (the default 1 MiB fails on a large image with an empty stderr).

*Why not a clean checkout at a tag (as for spek)*: spek's shots build spek, so they need a working tree; the
phone step only needs files, and a tag names them exactly. Reading the tag removes the "is the working tree
clean" question altogether — the review found that the obvious way of asking it (`git status --porcelain
--no-color`) exits 129 with empty output and reads as "clean" — and lets the maintainer re-import while the
Android repository is mid-change, without a second clone.

*Alternatives*: capture here with an emulator (rejected: the Android SDK, a demo desktop and an agent run on
the maintainer's account, for images that already exist); copy by hand (rejected: the manifest would record
whatever was copied, with no tag); fetch from GitHub at the tag (rejected: a network step for files the
maintainer has locally).

### D2. The set, its names, and all or nothing

A fixed table, in display order: `01-sessions` → `phone-sessions`, `02-conversation` → `phone-conversation`,
`03-prompt` → `phone-prompt`, `04-inbox` → `phone-inbox`, `05-openspec` → `phone-openspec`; locales `en-US` →
`en/`, `zh-TW` → `zh-TW/`. A pure function `phoneSetProblems(files)` checks all ten buffers — present, PNG
signature, `IHDR` chunk type at bytes 12–15, width 1080 and height 1920 — and the step writes nothing (no image,
no manifest change, no tag file) unless it returns no problem. A partial import would leave the two languages
on different releases, and the component lays images out for 9:16. On success the step writes the ten files,
their hashes, and the tag to `site/src/assets/screenshots/ANDROID_SOURCE` (beside the images, outside the
manifest, as spek's tag goes to `neutral/SOURCE`).

### D3. Where the step runs, and who writes the manifest

The validate-then-write logic is one function, `importPhoneSet({ dir, tag, outDir, manifest })` in
`scripts/lib/phone-shots.mjs`: it reads and validates all ten, and only then writes the ten files and
`ANDROID_SOURCE` and sets their hashes on the **manifest object it is given**; on a problem it writes nothing and
leaves the object untouched. The capture script owns reading and writing `manifest.json`:

- `--only phone` is dispatched before the virtual-display re-run, the build check and `prepareFixtures()` (it
  needs none of them and must not delete `/tmp/spekterm-shots` or require `out/`); it reads the manifest, calls
  the import, writes the manifest back on success, and exits non-zero on a problem.
- The full run calls it inside the virtual-display child, after the main flow has read the manifest, with the
  same object, so the one final write holds the phone hashes. A problem marks the run failed; the other shots
  are still taken; the run exits 1. A full run therefore needs a spekterm-android repository with a release
  tag; the site README says so.
- Any other `--only <name>` skips the phone step and leaves the phone files and `ANDROID_SOURCE` alone.

### D4. No text read for imported screenshots; review holds it

The pre-capture read exists because the script renders the screen and can read it. An imported PNG has no DOM
and no terminal buffer; reading it would take OCR (`tesseract`, not installed, and its misreads would make the
forbidden-word check unreliable in both directions). The spec states the exemption outright. What carries it:
the Android repository's demo-desktop rule, the release tag, and the maintainer's review of all ten images
before commit (task 2.3). This is the one place a screenshot's text is not machine-checked.

### D5. What the manifest test adds

`screenshot-manifest.test.mjs` gains a check, with controls: the manifest keys whose **file name** starts with
`phone-` (keys look like `en/phone-sessions.png`) are exactly the D2 set × `en`/`zh-TW` (none extra, none
missing) — a phone screenshot is recognised by that prefix, which the spec's "outside the set" relies on — and when any is present `ANDROID_SOURCE` exists and is
`v<major>.<minor>.<patch>` and a newline. It shares the set table with the capture script through a small
module (`scripts/lib/phone-shots.mjs`, which also holds `phoneSetProblems` and the tag choice), so the two
cannot disagree.

### D6. A phone screenshot component

`site/src/components/PhoneScreenshots.astro` takes a list of `{ src, alt }` and one caption, lays the images side
by side (each at most 15rem wide, wrapping on narrow screens), and appends the same "illustrative example
content" note as `Screenshot.astro`. Images are served at widths 360, 540 and 1080. The landing page shows
sessions, conversation and prompt; the phone page shows all five. Alt texts are per language.

### D7. The landing check

`content-plan.json` gains `landing.phone: { screenshotPrefix: "phone-", links: [<Play URL>], page:
"docs/getting-started/phone", keywords: { en: ["spekterm must be running"], "zh-TW": ["必須開著"] } }`, and its
`$comment` explains it. `check-content` requires, in each landing page's main content (without the footer, as
for every landing check): an image whose name starts with the prefix, the Play link, a link to that language's
phone page (`/docs/…` or `/zh-tw/docs/…`), and that language's keyword. Self-test: the passing fixture
(`PLAN`, `landingMain`) gains the phone elements; failing fixtures for a missing phone image, the Play link only
in the footer, the zh-TW landing page linking the English phone page, and the keyword missing.

## Risks / Trade-offs

- [The Android repository retakes its screenshots and the site shows an older app] → the site README's "When
  spekterm-android releases" step re-imports from the new tag; `ANDROID_SOURCE` says which release is shown.
- [A screenshot shows something it should not, and no machine check reads it] → D4: review before commit, and
  the spec says this is unchecked.
- [Ten more images enlarge the site] → 1.4 MB of PNG sources in total; Astro serves resized WebP at three widths.
- [A full capture run now fails without a tagged Android repository] → stated in the README; `--only` runs the
  rest without it.
