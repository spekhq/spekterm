# macOS packaging and behaviour — what was measured

Read before touching `build.mac` / `build.dmg`, `scripts/package-mac.mjs`, `scripts/after-pack.cjs`,
`scripts/release-check.mjs`, `scripts/probe-package-mac.mjs`, `src/main/app-menu.ts`, the close guard's
quit intent, or anything run on the build Mac. Every item here was measured (macOS 13.7.8, Apple Silicon,
Electron 43.5.0, electron-builder 26.15.7, 2026-10-08). Almost every one of them fails silently.

## Packaging

1. **A file at the top of the bundle's `Contents/` makes ad-hoc signing fail the build.**
   `codesign` reports "code object is not signed at all — In subcomponent: …/Contents/LICENSE". Non-code
   files belong in `Contents/Resources/` (`extraResources`). And electron-builder **adds** a platform's
   file set to the top-level one (`fileMatcher.js`), so a top-level `extraFiles` reaches macOS too. That is
   why the licences live in `build.linux.extraFiles` and `build.mac.extraResources`, and
   `packaging-config.test.mjs` forbids the other two places.
2. **`identity: null` does not give a sealed bundle; `identity: "-"` does.** Unset searches the keychain
   and signs nothing when it finds nothing. `null` leaves only the linker's signatures on the binaries
   (`Sealed Resources=none`): a downloaded copy is then "damaged". `"-"` with `hardenedRuntime: false`
   seals it (`Sealed Resources version=2`).
3. **electron-builder's own `electronDownload.checksums` is dropped when a mirror is configured.**
   `createDownloadOpts` keeps only `mirror` from `mirrorOptions`. A build with an altered checksum
   succeeded. The verification therefore lives in `package-mac.mjs`, through `@electron/get` with
   `node_modules/electron/checksums.json`.
4. **A zip given as `electronDist` skips the cleanup**, so `default_app.asar` ships. The `afterPack`
   hook deletes it, before signing.
5. **For macOS, electron-builder deletes the zip's `LICENSE` and `LICENSES.chromium.html` from the output
   directory before `afterPack` runs** (`electronMac.js`). The hook copies them from a directory that
   `package-mac.mjs` extracts from the archive it has just verified (`ELECTRON_LICENCES_DIR`).
6. **Electron 43 has no postinstall: `node_modules/electron/dist` does not exist after `npm ci`.** It is
   downloaded the first time something runs Electron. Nothing in a build may read from it.
7. **GitHub's Electron download from the build Mac's network runs at ~50 KB/s.** electron-builder gives
   up after 600 s, and `@electron/get` waits without a word. Use `ELECTRON_MIRROR`; the cache key includes
   the mirror URL, so a run without it downloads again.
8. **Copying the working tree to the Mac with `rsync --exclude out` also excludes every `out/` inside
   `node_modules`** (electron-builder's `out/cli/cli` went missing). Anchor it: `--exclude /out`.

## Launching and observing the app

9. **`open` passes the caller's environment on** ("Opened applications inherit environment variables just
   as if you had launched the application directly through its full path", `man open`). An app opened
   from an SSH shell has that shell's `PATH`, which is not a desktop launch. The probe launches through
   `env -i` with launchd's minimal set, and checks that `claude` does not resolve in it.
10. **`ps -E` / `ps eww` do not show another process's environment.** Identify a run's processes by their
    arguments (the unique `--user-data-dir`) and walk parent pids.
11. **The user's own shell may drop the first line typed into a new session** (zsh with the user's rc,
    still starting). The probe re-sends an idempotent command until its side effect appears.
12. **macOS attributes a child process's privacy prompts to the app.** `claude` in an agent session
    reading under the home directory made macOS ask, in Spekterm's name, for Calendars, Photos, Contacts,
    Reminders, Desktop, Documents, and Downloads. The privacy log (`log show --predicate 'subsystem ==
    "com.apple.TCC"'`) names the accessing process. Each ad-hoc build is a new identity, so the prompts
    can come back after an update. In zsh, `log` is a builtin; call `/usr/bin/log`.
13. **UI scripting from SSH needs Accessibility and Automation for `/usr/libexec/sshd-keygen-wrapper`.**
    Without them `osascript` to System Events waits two minutes and fails with `-1712`, and the prompt
    appears on the Mac's screen, where nobody may be.

## Quitting

14. **`SIGTERM` emits `before-quit` before `close`, as on Linux.** The close guard reads that order as "a
    quit that did not start with the window". The Quit *role* goes the same way, which is why the macOS
    Quit is a custom item that closes the window first (`closeForQuit`).
15. **On macOS, a quit whose close is held (to ask about unsaved changes) is abandoned by Electron**, and
    `window-all-closed` does not quit there. Without `onQuitClose` the user who chose Quit would be left
    with an app and no window.

Not yet measured (they need someone at the Mac, tasks 1.2 of `macos-dmg-packaging`): whether `Cmd+V` in
the terminal pastes twice once an Edit menu exists, whether macOS adds items to a menu named Edit, whether
a role item's `label` override shows, and the event order of the quit Apple event (the Dock's Quit, logout).
