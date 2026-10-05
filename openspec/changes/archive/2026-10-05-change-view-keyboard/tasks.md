## 1. Acceptance first (red before 2)

- [x] 1.1 `scripts/lib/cdp.mjs`: add `PageUp` 33, `PageDown` 34, `End` 35, `Home` 36 and `Space` 32 (with `text: ' '`) to `KEY_CODES`, so native scrolling happens under CDP (design "Verification")
- [x] 1.2 `scripts/probe-openspec.mjs`: new section `runChangeViewKeyboard`, registered in `SECTIONS` with its `deps`; real mouse (`realClick`) and real keys only; viewport shrunk with `Emulation.setDeviceMetricsOverride` and the precondition asserted (every artifact overflows by more than the offset scrolled before a switch; the tab strip cannot show every tab). Assertions:
  - click inside the content, `PageDown` ⇒ `scrollTop` increased; `End` ⇒ at bottom (Clicking the content lets the keyboard scroll it)
  - scroll the current artifact down, click another tab ⇒ its `scrollTop` is 0 and focus is on its panel; `ArrowDown` ⇒ increased (A newly chosen artifact starts at the top; Choosing an artifact lets the keyboard scroll it right away)
  - scroll down, tick a task in the fixture's tasks file on disk, wait for the progress count to change ⇒ `scrollTop` and `document.activeElement` unchanged; restore the file (An update to the change does not move the reader)
  - focus in the proposal's content, `Ctrl+Tab` ⇒ next artifact selected, focus on its panel, focused session unchanged (Ctrl+Tab selects the next artifact; Ctrl+Tab in the change view does not switch sessions)
  - first artifact selected, `Ctrl+Shift+Tab` ⇒ last artifact selected and its tab inside the tab strip's visible bounds (Ctrl+Shift+Tab wraps to the last artifact)
  - open the Graph overlay, put focus in the change view and assert `document.activeElement` is inside it, `Ctrl+Tab` ⇒ selection unchanged (An open overlay blocks artifact switching)
- [x] 1.3 `scripts/scenario-coverage.test.mjs`: register `change-view-keyboard` in `COVERED_CHANGES` with a row for **every** scenario in the change's spec files — the 8 new ones (labels from 1.2) and the 11 copied with the MODIFIED requirements, whose labels are found in `scripts/probe-keyboard.mjs` (not filled in from memory; "no carrier" plus a reason where none exists) — each with `greenIfAbsent` and `mutation`
- [x] 1.4 Run `PROBE_ONLY=runChangeViewKeyboard npm run probe:openspec` against the unchanged code; record which assertions are red and why
  - Ran 2026-10-05 (build mode, product sources stashed): 8 red, all for the expected reason — focus stays on the tab button after a click (`clicking a tab puts focus on its content`, `ArrowDown after choosing…`), a click in the content leaves focus on the side-panel section (`PageDown`, `End`), Ctrl+Tab switches the session instead (`Ctrl+Tab selects the next artifact…`, `…does not switch sessions`: `shell 1 → add-oauth`), `Ctrl+Shift+Tab` leaves Proposal selected, and the refresh assertion (nothing focused the panel). Green: `a newly chosen artifact starts at the top` (the earlier scroll never happened, so it had nothing to reset — its power is the control group in 3.1), `Ctrl+Tab does nothing while an overlay is open` (expected; `greenIfAbsent`), and `the tab chosen with the keyboard is visible` — **a false green**: the selection never moved, so "the selected tab is visible" held trivially. Fixed by also requiring the selected tab to be the last one
  - First attempt located the panel by `role="tabpanel"`, which the old code does not have: the whole section stopped at the first lookup and said nothing about behavior. The probe now locates the scroller by structure (first scrollable sibling after the tab strip)

## 2. Implementation

- [x] 2.1 New module `src/renderer/src/shell/tab-cycle-scope.ts`: register / unregister `{ element, cycle(delta) }`, and a lookup by event target (design D3)
- [x] 2.2 `KeyboardNavigation.tsx`: in the `isTab` branch, after the dialog/menu check and after consuming the key, call the registered `cycle` when `event.target` is inside its element; otherwise cycle sessions as before
- [x] 2.3 `ChangeView.tsx`: content div becomes `role="tabpanel"`, `tabIndex={0}`, `aria-labelledby` the active tab (tabs get ids), with a `focus-visible` outline; tab click handler resets `scrollTop` to 0 when the artifact changes and focuses the panel with `preventScroll` (design D1, D2)
- [x] 2.4 `ChangeView.tsx`: register the root element and `cycle` while the artifact list is shown; `cycle` picks next / previous in tab-strip order with wrap, applies 2.3's reset and focus, and scrolls the selected tab into view (design D3, D4, D5)
- [x] 2.5 `npm run typecheck`, `npm run lint`, `npm test` green

## 3. Verification

- [x] 3.1 Full `npm run probe:openspec` green (existing sections click artifact tabs, which now move focus); then the control groups from design "Verification", each reverted and confirmed red, results recorded under this task
  - 2026-10-05: full `probe:openspec` 594/594 (build + dev). Control groups, build mode, each applied, confirmed different from the original, then restored:
    - `tabIndex` removed from the panel ⇒ red: `click in the content, then PageDown scrolls it`, `End scrolls the content to the bottom`
    - Ctrl+Tab routing removed from `KeyboardNavigation` ⇒ red: `Ctrl+Tab selects the next artifact…`, `…does not switch sessions` (`shell 1 → add-oauth`), `Ctrl+Shift+Tab … selects the last`, `the tab chosen with the keyboard is visible`
    - routing moved before the dialog/menu check ⇒ red: `Ctrl+Tab does nothing while an overlay is open` (`asyncapi.yaml → Proposal`)
    - `scrollTop` reset removed ⇒ red: `a newly chosen artifact starts at the top`
    - reset and focus on every render ⇒ red: `a refresh keeps the scroll position and focus`
    - tab `scrollIntoView` removed ⇒ red: `the tab chosen with the keyboard is visible in the tab strip` (`selectedVisible: false`)
- [x] 3.2 Full `npm run probe:keyboard` green (session `Ctrl+Tab` from the terminal and the editor) — 284/284
- [x] 3.3 Shortcut tables: `CLAUDE.md`, `README.md` and `README.zh-TW.md` — the `Ctrl+Tab` row notes that with focus in the change view it switches artifacts
