## Context

`ChangeView` (`src/renderer/src/shell/openspec/ChangeView.tsx`) renders a header, a `role="tablist"`
of artifact buttons (`overflow-x-auto`), and one scroll container
(`div.min-h-0.flex-1.overflow-auto`) holding the active artifact. The active artifact is local state
(`activeId`), defaulting to tasks. While the data loads or fails, the component returns `<Loading/>`
or `<ErrorNote/>` early, so the scroller unmounts.

The side panel is wrapped in a `<section tabIndex={-1}>` in `MainStage.tsx` (the focus fallback for
quick open), which carries the `Ctrl+P` capture handler. `KeyboardNavigation.tsx` registers a
**window capture** `keydown` listener that owns `Ctrl+Tab` / `Ctrl+Shift+Tab` (session cycling),
`Ctrl+↑↓`, `Ctrl+T`, `Ctrl+Shift+W`, and the `Shift+arrow` reorders. Its first check is "a dialog or
menu is open ⇒ return".

Facts that shape the design:

- **Browser keyboard scrolling follows the focused element up its ancestors.** With focus on the
  side-panel section or an artifact tab button, the artifact scroller is not an ancestor of the
  focused element, so nothing scrolls. A click on text inside a non-focusable scroller focuses the
  nearest focusable ancestor — the section.
- **The window capture phase runs before React's `onKeyDownCapture`** (React dispatches from its
  root container), and `KeyboardNavigation` calls `stopPropagation` on `Ctrl+Tab`. A handler on the
  change view never sees the key.
- The scroller is not keyed by artifact, so switching artifacts keeps the previous `scrollTop`
  (clamped to the new content's height). The same element survives artifact switches.
- `ContextMenu` moves focus to its first item when it opens; the Graph / Timeline overlay
  (`role="dialog"`) does not move focus.

## Goals / Non-Goals

**Goals:**

- Arrow keys, `PageUp` / `PageDown`, `Home` / `End` and `Space` scroll the artifact after a click in
  its content or on its tab.
- `Ctrl+Tab` / `Ctrl+Shift+Tab` cycle artifacts while focus is anywhere inside the change view,
  and keep cycling sessions everywhere else.

**Non-Goals:**

- Arrow-key roving between tab buttons (the full ARIA tabs keyboard pattern). `Ctrl+Tab` covers
  moving between artifacts; roving would take the arrow keys away from scrolling.
- Keyboard scrolling in the Browse view, spec detail, Files viewer or overlays — not asked for, and
  the Files viewer is Monaco, which already scrolls.
- A shortcut that moves focus *into* the side panel from the terminal.

## Decisions

### D1 — Make the scroller the tab panel and focusable; let the browser scroll it

The scroll container gets `role="tabpanel"`, `tabIndex={0}`, an `aria-labelledby` pointing at the
active tab (tabs get ids), and a visible `focus-visible` outline consistent with the rest of the
panel. Once it can hold focus, a click in its content focuses it and native scrolling does the
rest.

*Alternative rejected:* a `keydown` handler that calls `scrollBy` for each key. It would reimplement
line height, page size, `Space` / `Shift+Space`, `Home` / `End`, and would have to know when a
focused child (a button in the content) should get the key instead.

`tabIndex={0}` rather than `-1`: the panel's content is not reliably focusable (a proposal may have
no links), and a reader using `Tab` should be able to reach the text to scroll it.

### D2 — Choosing an artifact focuses its panel and resets it to the top, in the handler

The tab click handler and the `Ctrl+Tab` path (D3) do, synchronously: when the chosen artifact
differs from the current one, set `activeId`, set the panel's `scrollTop` to 0, and focus it with
`preventScroll: true`; when it is the current one, only focus the panel. The panel element survives
the switch, so no effect is needed — and because nothing runs on render, a refresh of the same
change's data cannot move focus or scroll by construction. (An effect keyed on a counter would also
run on mount, twice under StrictMode, and would have to sit above the early returns.)

Setting `scrollTop` before React commits the new content is fine: it is applied to the old content
and the new content renders from that offset, which is 0.

*Trade-off:* in the ARIA pattern focus stays on the tab after activation. Here the point of choosing
an artifact is to read it, and leaving focus on the button means the next `ArrowDown` does nothing —
the exact complaint. The tab buttons remain reachable with `Shift+Tab` (it lands on the last one;
there is no roving tabindex).

### D3 — `KeyboardNavigation` routes `Ctrl+Tab` to the change view; the change view registers itself

A small module (`src/renderer/src/shell/tab-cycle-scope.ts`) holds at most one registration
`{ element, cycle(delta: 1 | -1) }`. `ChangeView` registers its root element and a `cycle` that
picks the next / previous artifact in tab-strip order (wrapping) and applies D2; it unregisters on
unmount. **The registration happens only while the artifact list is shown** (not during loading or
error), so `cycle` always has a list.

In `KeyboardNavigation`'s `isTab` branch — after the existing dialog/menu check and after
`preventDefault` / `stopPropagation` — if the event's **target** lies inside the registered element,
it calls `cycle` instead of cycling sessions. `event.target`, not `document.activeElement`: the
target is where the key was actually dispatched.

So there is still one place that decides "a dialog or menu is open", one place that consumes the
key, and the change view carries no key handling of its own.

*Alternative rejected:* `KeyboardNavigation` returns early when focus is in the change view, and the
change view handles the key in its own `onKeyDownCapture`. It needs a second copy of the
dialog/menu rule, and CLAUDE.md records what happens when two such copies diverge: nothing turns red.

*Alternative rejected:* a second window capture listener in the change view, relying on
registration order. Listener order on `window` is an accident of mount order.

*Alternative rejected:* make `Ctrl+Tab` follow "the panel under the mouse". Focus is the model every
other shortcut here uses (`Ctrl+P`, the editable-text yield for `Shift+arrow`).

### D4 — The scope is the whole change view, not only the tab panel

Header, tab strip, content and the continuation bar are all inside the scope. After clicking
"continue" focus is on that button; the user is still looking at the change, so `Ctrl+Tab` meaning
"next artifact" is the expected reading.

### D5 — A keyboard-chosen tab is scrolled into view in the tab strip

The tab strip scrolls horizontally and the side panel can be 240px wide, so four standard tabs plus
data artifacts overflow it. Because D2 focuses the panel with `preventScroll`, nothing would bring
the newly selected tab into view. `cycle` calls `scrollIntoView({ block: 'nearest', inline:
'nearest' })` on the selected tab — the keyboard-navigation rule "the target is scrolled into every
scroll container it is in" applied to this new target. A mouse click on a tab does not need it (the
tab was visible to be clicked).

## Risks / Trade-offs

- **Focus left in the change view keeps `Ctrl+Tab` there.** A user who goes back to the agent by
  clicking the terminal moves focus there and `Ctrl+Tab` switches sessions again. One who doesn't
  click will be surprised once. Same model as `Ctrl+P`, accepted.
- **Collapsed side panel.** The panel stays mounted when collapsed, so focus left in the change view
  would send `Ctrl+Tab` to an invisible view. The collapse control takes focus when clicked, so this
  needs focus to have been left there by other means; accepted.
- **The panel becoming a tab stop** adds one stop to `Tab` traversal through the side panel.
- **Clicking a tab now moves focus.** Existing probe sections click artifact tabs; the full
  `probe:openspec` is re-run, not only the new section.

## Verification

All carried by `scripts/probe-openspec.mjs` in a new section `runChangeViewKeyboard`, registered in
`SECTIONS` with its `deps` (it needs two sessions in the current item, which exist after
`runAnchoringAndCoordinate`). Constraints from `docs/lessons/probes.md`:

- **Real input only.** Clicks with `realClick` (the existing `CLICK_ARTIFACT` uses a synthetic
  `.click()`, which does not move focus); keys through `pressKey`, whose `KEY_CODES` table
  (`scripts/lib/cdp.mjs`) must gain `PageDown` 34, `PageUp` 33, `End` 35, `Home` 36 and `Space` 32
  (with `text: ' '`) — without a virtual key code, native behavior does not happen and the red run
  would be red for the wrong reason.
- **Overflow by viewport, not by fixture.** Lengthening the fixture's tasks would break existing
  assertions (task sections, progress counts). The section shrinks the viewport with
  `Emulation.setDeviceMetricsOverride` so that every artifact overflows by more than the offset
  scrolled before a switch (otherwise the browser's clamping makes "starts at 0" pass by accident),
  and asserts that precondition.
- **Refresh with an observable.** "An update does not move the reader" ticks a task on disk and
  waits for the progress count to change before asserting `scrollTop` and the focused element.
- **The dialog check is tested where it can fail.** A context menu takes focus, so "menu open" never
  reaches the change view with real input. The scenario uses the Graph overlay, which does not take
  focus, after asserting that `document.activeElement` is inside the change view.

Assertions: click content → `PageDown` → `scrollTop` increased, `End` → at bottom; click another
tab → `scrollTop` 0 and focus on its panel → `ArrowDown` → increased; `Ctrl+Tab` → next artifact,
focus on its panel, focused session unchanged; `Ctrl+Shift+Tab` from the first → last, and that tab
is inside the tab strip's visible bounds; overlay open → `Ctrl+Tab` → artifact unchanged.

Control groups (revert, confirm red, restore): drop `tabIndex` from the panel; drop the routing in
`KeyboardNavigation` (Ctrl+Tab switches sessions); route before the dialog/menu check; drop the
`scrollTop` reset; reset and focus on every render instead of in the handler (the refresh assertion
turns red); drop the tab `scrollIntoView`.

`probe:keyboard` is re-run in full: session `Ctrl+Tab` from the terminal and the editor is the
regression this change must not cause.
