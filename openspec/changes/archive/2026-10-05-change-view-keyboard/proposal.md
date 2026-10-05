## Why

The "this change" view in the side panel can only be read with the mouse.

- **Its content cannot be scrolled from the keyboard.** The scroll container is not focusable.
  Clicking on the artifact text moves focus to the side-panel `<section>` (the nearest focusable
  ancestor, `tabIndex={-1}`), and the browser only scrolls the focused element's own scroll
  containers — the artifact scroller is a *descendant* of it, so arrow keys, `PageDown` and `Space`
  do nothing. Clicking an artifact tab is no better: focus lands on the tab button, a sibling of the
  scroller.
- **There is no keyboard way to move between artifacts.** `Ctrl+Tab` / `Ctrl+Shift+Tab` is the
  natural gesture for "next / previous tab", but the window-level capture listener in
  `KeyboardNavigation` claims it for session switching no matter where focus is — so pressing it
  while reading the change switches the terminal session instead.

Reading proposal → design → tasks while driving an agent is the side panel's main use; having to
reach for the mouse for every page and every artifact undercuts it.

## What Changes

- **The artifact content area is focusable and keyboard-scrollable.** It becomes the tab panel of
  the artifact tabs (`role="tabpanel"`, in the tab order). Clicking anywhere in it lets the arrow
  keys, `PageUp` / `PageDown`, `Home` / `End` and `Space` scroll it — native browser scrolling, no
  key handling of our own.
- **Choosing an artifact moves focus to its content and starts it at the top.** After clicking a
  tab (or switching with the keyboard) the next arrow key scrolls the artifact just chosen, and a
  new artifact does not open at the previous one's scroll offset. A refresh of the change while an
  agent edits it does not move focus or scroll.
- **`Ctrl+Tab` / `Ctrl+Shift+Tab` switch artifacts while focus is inside the change view.** Same
  order as the tab strip, cyclic, same as session switching; the chosen tab is scrolled into view
  when the strip overflows. Everywhere else (terminal, editor, rest of the side panel) they keep
  switching sessions. This follows the `Ctrl+P` precedent: focus decides who owns the key. The
  routing stays inside `KeyboardNavigation`, so the existing yield rule (a dialog or menu is open ⇒
  nothing happens) is applied in one place.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `openspec-panel`: adds a requirement that the change view's artifact content is
  keyboard-scrollable, and one that `Ctrl+Tab` / `Ctrl+Shift+Tab` cycle the artifact tabs while
  focus is inside the change view.
- `keyboard-navigation`: the session-switching requirement hands `Ctrl+Tab` / `Ctrl+Shift+Tab` to
  the change view when focus is inside it; the terminal-focus and editor-focus requirements say
  where the change view falls (both ask for that whenever a shortcut group changes).

## Impact

- `src/renderer/src/shell/openspec/ChangeView.tsx` — tab panel semantics, focus and scroll reset on
  selection, registers itself for `Ctrl+Tab`.
- New `src/renderer/src/shell/tab-cycle-scope.ts`; `src/renderer/src/shell/KeyboardNavigation.tsx`
  routes `Ctrl+Tab` to the registered view when the key is dispatched inside it.
- `scripts/lib/cdp.mjs` (scrolling key codes), `scripts/probe-openspec.mjs` (new section),
  `scripts/scenario-coverage.test.mjs` (rows for every scenario in the deltas).
- Shortcut tables in `CLAUDE.md`, `README.md`, `README.zh-TW.md`.
- No main-process, IPC or persistence change.
