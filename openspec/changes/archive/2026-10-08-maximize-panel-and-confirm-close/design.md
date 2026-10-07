## Context

This change carries two independent features. They share no code; they are in one change because
the maintainer asked for it. Decisions for the side panel are numbered M1…, for the close
confirmation C1….

### Maximizing the side panel

`MainStage.tsx` renders, top to bottom: the repo header (repo name, the `PanelSwitch` identity
switch, the collapse button), `SessionTabs`, and a `react-resizable-panels` `Group` holding the
terminal `Panel` (`minSize 240px`) and the side panel `Panel` (`collapsible`, `defaultSize 34%`,
`minSize 240px`). The side panel's content is `<section tabIndex={-1}>` (the quick-open focus
fallback, also carrying the `Ctrl+P` capture handler) wrapping `SidePanel`. The rail and the
activity bar live outside `MainStage`, in `AppShell`.

Facts that shape the design:

- **Every terminal of every session is mounted at once**; only the focused one of the selected item
  is `active`. `TerminalView` separates `active` (has a layout box — size sync depends on it) from
  `covered` (not visible — GPU renderer and focus depend on it). The conversation view already
  covers the terminal this way: it sits on top, the terminal keeps its box and its size.
- **On `covered` → not covered, `TerminalView`'s effect calls `fit()` and focuses the terminal.**
  `fit()` returns `null` when the size did not change (`xterm.ts`), so no `resize` is sent; and even a
  same-size `TIOCSWINSZ` sends no `SIGWINCH` (measured with dash and bash).
- **`TerminalView` only focuses itself when that effect runs** (`[active, covered, sessionId,
  status]`); `ConversationView` only moves focus when its dormant state changes. Nothing focuses the
  conversation view's input on "no longer covered".
- **`sessions.sendInput()` focuses the terminal directly** (`focusers`), bypassing `covered` — the
  continuation entry in the change view goes through it.
- **`sessions.create()` always makes the new session the focused one of its item**, including the
  creation by `IntakeAutoAccept` when a handoff arrives. User-initiated focus goes through
  `sessions.focus()` (rail row — also for the row that is already focused —, `Ctrl+Tab`, lineage
  links, the tab strip), user-initiated creation through `sessions.create()` (`MainStage`,
  `WorkspaceRail`, `IntakeOverlay`).
- **`SidePanel` mounts `<OpenSpecPanel key={folder.id}>`** and the two identities are mounted
  exclusively: changing the side-panel source or switching to Files and back remounts it and resets
  its local view state. Its views are rendered conditionally, so leaving This change unmounts
  `ChangeView` (selected artifact and scroll are lost).
- **The rail's session-rename dialog is `absolute inset-0 z-20` with no positioned ancestor** (its
  containing block is the viewport) and is rendered before `MainStage` in the DOM; `SessionTabs`'
  rename dialog likewise has no positioned ancestor inside `MainStage`.
- **None of the `react-resizable-panels` 4.12.3 wrappers is positioned.** The `Group` div has
  `overflow: hidden`, the `Panel` div `overflow: visible`, its inner div `overflow: auto`; none sets
  `position`, `transform` or `filter`. An absolutely positioned descendant whose containing block is
  outside the `Group` is therefore not clipped by them.
- **The Graph / Timeline overlay** (`VizOverlay.tsx`) is portaled to `document.body` as
  `role="dialog"`, fetches its own data (`useGraphData`, `useChanges`), closes on `Esc`, and on a
  chosen change or spec calls `viewInOpenSpec`, which switches the side panel to that target. Its
  reason (design D12 of `openspec-side-panel`): Timeline needs more than 900px, the side panel caps
  at about 620px. The mockup (`docs/workspace-mockup.html`, `#os-tab-graph`) drew Graph as a view
  of the OpenSpec identity; the overlay was a later deviation for width.
- `OpenSpecPanel` holds its view in local state (`tab`) and **derives** the shown view
  (`anchoredChange === null ? 'browse' : tab`) instead of overwriting the state — a load-order bug
  this already fixed once.
- `KeyboardNavigation` owns the window-capture shortcuts; `Ctrl+T` activates the existing creation
  entry with `querySelector` instead of reaching into `MainStage`'s state.
- Monaco is created with `automaticLayout: true`, so the editor follows its container's size.

### Confirming before closing

Facts verified in this repo or by experiment (2026-10-07):

- **The only close guard is `guardUnsavedChanges`** (`src/main/unsaved-changes.ts`, wired in
  `createWindow`). Its `close` handler must decide `preventDefault()` synchronously, so it reads a
  snapshot the renderer pushes (`DirtyStateStore`); then it shows `dialog.showMessageBox` (Save All /
  Don't Save / Cancel, default Save All) and calls `window.close()` again with `allowClose = true`.
  Requirement owner: `workspace-app-shell` "視窗關閉前確認未存的變更". **It has no automated carrier**:
  no probe or test references it (grep of `scripts/` for its copy and for `showMessageBox`: nothing).
- **Live ptys are known synchronously in main.** `ipc/terminal.ts` keeps `services: Map<contentsId,
  TerminalService>`; `TerminalService.#sessions` holds exactly the live ptys (removed on `onExit`), so
  dormant (restored or hibernated) and exited sessions are absent by construction.
  `liveSessionIds()` already exists.
- **Working state is available in main without a round trip.**
  - Shell: `idleFactsOf(id)` → `readShellFacts` (`/proc/<pid>/exe` identity + `/proc/<pid>/task/<pid>/children`):
    `idle` / `busy` / `unknown`. Synchronous `/proc` reads, Linux only (`unknown` elsewhere).
  - claude: `waitStateOf(id)` (`agent-wait.ts`): `ready` / `busy` / `awaiting-choice` / `unknown`.
    Since `session-hibernation` every running claude session is drained whether or not it is
    displayed — but only when the agent-events preference is on; otherwise it stays `unknown`.
- **Labels**: `SessionStore.view()` (includes provisional records) + `preferredTitle()`
  (`src/shared/lineage/label.ts`, custom name > handoff title > pty title), which the tab and the
  relations file use. The renderer's last fallback is `${spawnTarget} ${ordinal}`; the rail item name
  is the folder name or `rail.globalName`. Persisted titles lag the screen by the persist debounce
  (~500 ms) — acceptable for a list.
- **Event order, measured with Electron 43.5.0 under xvfb** (scratch experiment, not in the repo):
  - `BrowserWindow.close()` (documented as equivalent to clicking ✕): `close` → `window-all-closed` →
    `before-quit` → `will-quit` → `quit`.
  - `SIGTERM`: `before-quit` → `close` → … . With a `close` handler that calls `preventDefault()`, the
    first `SIGTERM` **does not exit** (the quit is aborted while the dialog is up); a **second
    `SIGTERM` exits**. So a guard that holds on every `close` makes logout/shutdown wait for the
    session manager's kill, and makes `quitAndWait` in the probes escalate to `SIGKILL` after 10 s.
  - ~~`window.close()` from the renderer closes the window without emitting `close`~~ — **wrong,
    corrected during implementation**: called through `executeJavaScript` and through CDP
    `Runtime.evaluate`, it emits `close` and the guard holds it. The first scratch experiment was
    mistaken. The seam still closes from main (`BrowserWindow.close()`), the documented equivalent of
    the ✕.
- **Probes quit the app with `SIGTERM`** (`scripts/lib/quit.mjs`, `quitGracefully()` in every probe)
  **while sessions are running**. A guard that held on `SIGTERM` would turn every probe's teardown
  into a 10 s escalation and break the "SIGTERM leaves no orphan pty" assertions.
- `docs/lessons/probes.md` says the unsaved dialog "blocks the main process message loop so SIGTERM
  has no effect". The experiment shows the mechanism is different: the loop runs; the first `SIGTERM`
  becomes a `close` that the guard prevents. (Conclusion — must kill — unchanged; wording to fix.)
- There is one window; `window-all-closed` calls `app.quit()` (non-darwin). No application menu, so
  no `Ctrl+Q`; nothing else calls `app.quit()`.
- Precedent for testing an OS surface: `intake-notify-stub.ts`, chosen by `usingThrowawayProfile()`
  (`!app.isPackaged` and `--user-data-dir=` in argv) — not an environment variable, because
  `ptyEnv()` spreads `process.env` into every pty.

## Goals / Non-Goals

**Goals:**

- One action gives the side panel the whole main stage, and one action takes it back, with nothing
  in the side panel or the terminal lost or resized.
- Graph and Timeline live in the same place as the rest of the OpenSpec content, at a usable width.
- A user-initiated close never ends a running session without an explicit answer; the default answer
  keeps them.
- At most one dialog per close, whatever combination of unsaved files and running sessions.
- Logout, shutdown and `kill` are not held by the new question.
- The dialog and the decision have an automated carrier.

**Non-Goals:**

- Covering the rail too (the maintainer chose to keep it, so repos can be switched while
  maximized).
- Remembering the maximized state or the side panel width across restarts.
- A detached window for the side panel.
- `Esc` as a way out of the maximized state.
- Keeping ptys alive past the app (session persistence beyond restore is a separate, deliberately
  deferred roadmap item).
- A "don't ask again" switch (see C7).
- Guarding reload (`did-navigate` kills ptys too, but nothing in the UI triggers it: navigation is
  blocked and there is no reload accelerator).
- macOS `Cmd+Q` (it arrives as `before-quit` first, so C3 would not ask — Phase 6 item).
- Changing the unsaved-changes behavior on the signal path.

## Decisions

### M1 — Cover with an absolutely positioned side-panel section; do not move or resize anything

While maximized, `MainStage` makes the container around `SessionTabs` and the `Group` `relative`,
and the side panel's `<section>` — the same element, in the same place in the React tree — gets
`absolute inset-0` and **`z-[15]`**. Its `Panel` keeps its width in the flex flow; the terminal
`Panel` is untouched.

- Same element, same tree position ⇒ React does not remount `SidePanel`. Monaco instances, dirty
  buffers, scroll positions, tree expansion survive by construction.
- The terminal's box does not change ⇒ no pty is resized.
- **`z-[15]`, not "anything above 10"**: above the conversation view (`z-10`), below the rail's
  rename dialog (`z-20`), which shares the stacking context and comes earlier in the DOM — at `z-20`
  the section would cover that dialog (reproduced in Electron by the reviewer: `elementFromPoint`
  hit the section).
- **`relative` only while maximized**: applied always, it would shrink `SessionTabs`' own rename
  dialog to the stage area. While maximized the tab strip is covered, so its dialog cannot be opened.

*Rejected:*

- **Collapse the terminal `Panel`.** Its width reaches the pty; an agent writes output for that
  width and the output stays in the history.
- **Resize the side panel to its maximum.** Still bounded by the terminal's minimum, and it resizes
  the pty.
- **Render the content into a full-window portal.** Moving a subtree to a different portal
  container remounts it: Monaco's undo stack and cursor are lost.
- **A second `BrowserWindow`.** Another `webContents`: the preload whitelist, navigation guard and
  CSP argument would all have to be redone for it.

The positioning relies on the panel wrappers being unpositioned (verified for 4.12.3). A future
`react-resizable-panels` that positions a `Panel` would clip the cover silently; the probe asserts
the section's rectangle equals the container's, so an upgrade turns it red.

### M2 — The covered terminal is `covered`; focus is handed over explicitly

The focused session's `covered` becomes `maximized || conversation view on top`. `TerminalView`
already drops the GPU renderer and does not take focus while covered, and on restore its effect
re-runs (`covered` changed) and focuses the terminal.

- **Maximize**: focus `sidePanelSectionRef` unless focus is already inside it, so keys never land in
  a hidden pty.
- **Covered conversation view**: `ConversationView` today gets `active` always true and focuses
  its Wake button on mount when dormant — under the cover, after a repo switch, that puts focus on a
  hidden button and `Enter` would wake a session the user cannot see. It gets a `covered` prop
  (`maximized`) and takes no focus while covered.
- **Restore to a conversation view**: the terminal's `covered` stays true (the view is still on top),
  so the terminal effect does nothing. On `covered` → false `ConversationView` focuses its input, or
  its Wake button when dormant — new logic: today it only focuses on leaving the dormant state.
- **Restore by `Ctrl+Shift+M` with focus in the editor** also moves focus to the session: restoring
  means "back to driving". The editor's content and cursor are untouched (no remount).
- **Found during implementation — covering resized the pty anyway** (63 → 57 columns). Releasing the
  GPU renderer switches to the DOM renderer, which lays the same columns out wider (9.63px vs 9px per
  cell); the panel wrapper's default `overflow: auto` then showed scrollbars, the terminal's box
  shrank by their width, and the resize observer sent the smaller size. Fixed twice over: the
  terminal `Panel` gets `overflow: hidden`, and `TerminalView` fits only when it becomes `active` or
  its status changes — never on a change of `covered` alone (the box is unchanged, and the renderer
  is swapped on that same transition). The same path applied to the conversation view. Recorded in
  `docs/lessons/terminal.md`.
- The GPU share follows `covered` as it does for the conversation view; `terminal-sessions` already
  requires that transition to return the share, and `workspace-layout` gets its own scenario and
  carrier (the context-lost observation the conversation-view probe uses).

### M3 — State lives in `MainStage`; the shortcut clicks the header entry

`maximized` is a boolean in `MainStage`. The header gets a button next to the collapse button: its
`aria-label` / `title` is "Maximize side panel" or "Restore side panel", with `aria-pressed`. Like
`Ctrl+T`, `Ctrl+Shift+M` in `KeyboardNavigation` finds that button — by **either** label — and
clicks it, after the shared dialog/menu check. One code path for mouse and keyboard.

Maximize: if the side panel is collapsed, `expand()` first (restore then returns to an expanded
panel at its old width — the `Panel` remembers it), then set `maximized`. The collapse button while
maximized clears `maximized` and collapses.

### M4 — An explicit "attention" signal from the sessions context ends the maximized state

The rule is "the user turned to a session". Inferring it from changes of the focused id fails both
ways (reviewer): selecting the row that is already focused changes nothing, and a handoff arriving
in the selected item changes the focused id although the user did nothing. So the sessions context
exposes an **attention counter**, incremented on every:

- `focus()` call — even when the id is unchanged;
- `create()` call, unless the caller passes `{ background: true }` — only `IntakeAutoAccept` does;
- `sendInput()` call (the continuation entry; it hands focus to the terminal).

`MainStage` remembers the counter value it last saw (state, compared during render — the pattern
`OpenSpecPanel` uses for its request nonce; not a ref written during render) and clears
`maximized` when it moves. Selecting a rail item does not call any of these, so it never ends the
state. For the continuation entry: `sendInput` synchronously focuses the still-covered terminal, the
counter moves, the next render restores, and the terminal effect focuses the same element again. No
key can arrive in between, so the result is the same. An asynchronous `create()` that completes after
the user maximized again restores the panel — an accepted edge.

*Rejected:* enumerating call sites in `MainStage` (misses `WorkspaceRail`, `lineage.tsx`,
`IntakeOverlay` and the next one); diffing focused ids per item (both failures above, and `null` is
both "global item" and "nothing selected").

### M5 — Graph and Timeline are a layer above `OpenSpecPanel`'s own view, owned by `MainStage`

`MainStage` keeps `viz: 'graph' | 'timeline' | null` (it already owns the overlay's `viz` today).
`OpenSpecPanel` receives `viz`, `onChooseViz(kind)` and `onLeaveViz()`:

- The view switch shows This change (when resolvable), Browse, Graph, Timeline. The selected entry
  is `viz ?? activeTab`, where `activeTab` is derived exactly as today — so "no resolvable change ⇒
  Browse" keeps applying to This change only, and Graph is available without an anchored change.
- Choosing Graph / Timeline: `onChooseViz` sets `viz` and maximizes. Its own `tab` is never touched,
  so "the view before Graph" is simply `tab` — no `beforeViz` to record, nothing that can point at a
  viz view, no render loop.
- **While `viz` is set the regular view stays mounted and is hidden**, and `VizView` renders beside
  it. **What is hidden is the scroll container itself** (`OpenSpecPanel`'s `min-h-0 flex-1
  overflow-auto`), with `VizView` as its sibling: the reviewer measured that a scroller hidden itself
  keeps its `scrollTop`, while an outer scroller whose content is swapped resets to 0 — and Browse
  scrolls in that outer container (This change and the spec detail have their own). Restoring (`viz = null`) shows it as it was: same artifact, same
  scroll.
- **Every way out of the maximized state goes through one `restore()`** in `MainStage` (the header
  entry, `Ctrl+Shift+M`, the collapse entry, the attention counter), and it clears `viz` — otherwise
  the next maximize would show Graph unasked. Choosing This change or Browse calls `onLeaveViz`.
- **`viewInOpenSpec` (cross navigation from Files) clears `viz`** as well: the user asked for a
  specific change or spec. A change chosen in the
  graph: `onLeaveViz()` + `anchorAndShow(slug)`; a spec: `onLeaveViz()` + `showSpec(topic)`.
- Because `viz` lives in `MainStage`, it survives the `key={folder.id}` remount of `OpenSpecPanel`
  (another repo while maximized ⇒ Graph for that repo) and the identity switch (Files and back ⇒
  Graph again). `MainStage` clears it on restore only.
- `GraphPane` / `TimelinePane` move out of `VizOverlay.tsx` into `VizView.tsx`; the overlay's
  header, tablist, close button, `Esc` handler and portal are deleted.

Dictionary: the view entries use `viz.graph` / `viz.timeline` with the existing tooltips;
`openspec.openGraph`, `openspec.openTimeline`, `viz.close`, `viz.closeTooltip`, `viz.label` are
removed if nothing else references them. New keys for maximize / restore.

### M6 — No `Esc`

The maximized panel can hold Monaco (find widget, suggestions, multi-cursor all use `Esc`) and the
quick-open entry. A window-level `Esc` would have to decide which of those owns the key. The
restore entry and `Ctrl+Shift+M` are enough; `CLAUDE.md`'s "`Esc` closes overlays / dialogs /
menus" stays true because this is none of those.

### C1 — One `close` handler owns the window's close; the dialog is built by a pure function.

`guardUnsavedChanges` becomes `guardWindowClose(window, { dirty, liveSessions, dialog, quitting })`
in `close-guard.ts`. In `close` it reads, synchronously, the dirty snapshot and the window's live
session count; if both are empty (or C3 applies and nothing is dirty) it returns. Otherwise it
`preventDefault()`s and builds the prompt with `closePrompt(facts)` (`close-prompt.ts`, pure: facts
in, `{ message, detail, buttons: Role[], defaultRole, cancelRole }` out; roles `saveAll | discard |
quit | cancel`). Two handlers on the same event would each `preventDefault()` and each show a dialog —
the "two surprise dialogs" this change must not produce.
**Re-entrancy**: an `asking` flag is set while a prompt is open; any `close` while it is set
`preventDefault()`s and returns — whatever the `quitting` flag says (a signal during an open question
waits for the answer). When the answer arrives and the window is already destroyed, nothing is
called on it. Unit test in `close-guard.test.ts` with a fake window and a dialog that resolves on
demand: two closes ⇒ one prompt; a `before-quit` + close during the open prompt, then cancel, then a
close ⇒ asks again. Probe: the stub's hold mode (C6) keeps the prompt open while the trigger fires a
second time and while `SIGTERM` is sent.
*Alternative rejected:* show the session question after the unsaved one. Two dialogs in a row; and
answering "Don't Save" in the first would read as "go ahead and close", making the second a surprise.

### C2 — The facts are read in main, at close time, with no renderer round trip.

`liveSessionsOf(contentsId)` in `ipc/terminal.ts` (built on `TerminalService.liveSessionIds()` /
`idleFactsOf()` in `src/main/terminal.ts` and `waitStateOf()` in `agent-wait.ts`) returns `{ id, railLabel, label, working: true |
false | null }[]` for that window's service: count and ids are synchronous Map reads; `working` comes
from `idleFactsOf` (shell `busy` ⇒ true, `idle` ⇒ false, `unknown` ⇒ null) and `waitStateOf`
(`busy` / `awaiting-choice` ⇒ true, `ready` ⇒ false, `unknown` ⇒ null). Labels from
`SessionStore.view()` + `preferredTitle`, falling back to the spawn target (+ ordinal when known).
The hold decision only needs the count; the rest is computed after `preventDefault()`.

### C3 — Only a close that starts the quit asks about sessions.

`index.ts` sets a `quitting` flag on `before-quit`. In the `close` handler, `quitting === true` means the quit came first (a signal or the
OS), so the session question is skipped; the unsaved-files question still applies exactly as today
(and its prompt is then built without the session part). A user close emits `close` before any
`before-quit` (measured), so the flag is false there. **The guard reads the flag and resets it on
every `close` it prevents** — that is the moment Electron cancels the quit (measured), so a flag left
set would make a later ✕ skip the session question. This covers both the unsaved dialog answered
Cancel on the signal path and a signal arriving while a dialog is already open (C1 re-entrancy):
that signal is dropped; answering close ends the app, answering cancel keeps it running.
*Alternative rejected:* listen to `SIGTERM` with `process.on`. Electron already turns the signal
into a quit; a second handler would race it, and the ordering fact above is simpler and covers any
OS-driven quit.

### C4 — Cancel is the default and the cancel answer whenever a session is running.

The sessions-only dialog: `[Quit, Cancel]`, default and cancel = Cancel. The combined dialog: `[Save All and Quit,
Quit Without Saving, Cancel]`, default and cancel = Cancel — the existing default (Save All) would
end every session on `Enter`. Without running sessions the unsaved dialog keeps Save All as default
(unchanged). Rule: **the default answer never ends a running session.**

### C5 — Content.

Message: "{{count}} sessions are still running" (combined: the unsaved message, and
the sessions line in the detail). Detail: up to 10 sessions, working ones first (stable otherwise:
tab order is not known in main, so rail order of folders then the store's order), one per line
`<rail item> · <label>` + " — working" when `working === true`; then "…and N more"; then a blank line
and the consequence sentence: "Closing spekterm ends them. Running commands and any reply an agent
is writing are lost; claude sessions resume their conversation and shells restart in their last
directory when you wake them." All strings in `closeConfirm.*`, en + zh-TW, plural categories per
`dictionary-completeness`. Labels are third-party-ish text (pty titles); the dialog is a native
message box whose text is plain (the existing dialog already prints repo paths) — each label is cut
to 80 characters so one long title cannot push the rest off the dialog.

### C6 — The acceptance seam.

Under `usingThrowawayProfile()` (moved out of `index.ts` into a small
shared module, or passed in as a boolean), `close-guard` gets `createStubDialog({ root:
<userData>/close-stub })` instead of `dialog.showMessageBox`: it appends each prompt (roles, default,
cancel, message, detail) to `dialogs.jsonl` and answers with the role written in `answer` (default
`cancel` — which keeps today's teardown behavior for probes that quit with dirty buffers). **Hold
mode**: when a `hold` file exists, the stub does not answer until `answer` is written — the only way
to have a prompt open while a second close or a signal arrives. A watched
`close` trigger file makes main call `BrowserWindow.close()` — the documented equivalent of the ✕.
The watcher follows the four rules in
`intake-notify-stub.ts` (watch the directory, `add` + `change`, existence check after `ready`,
basename filter). Shipped builds cannot construct this path.

### C7 — No "don't ask again".

Closing the app is rare and expensive; a suppressed question removes
the guard for exactly the click it exists for. Narrowing *when* it asks was considered and declined by the
maintainer (Open Questions).

## Risks / Trade-offs

- **The maximized panel is not a dialog, so `Ctrl+↓` etc. work while Graph is shown** → intended
  (switching repos while maximized is the reason the rail stays). Graph stays shown and draws the
  new source's data (M5).
- **Timeline on a narrow window** — with the rail kept, a 1280px window leaves about 960px; below
  that it scrolls horizontally inside the view → accepted by the maintainer in exchange for the rail.
- **M4 relies on every user-initiated focus going through `focus()` / `create()` / `sendInput()`**
  → a future path that sets focus another way leaves the panel maximized over that session. Visible
  (the user restores), not data loss; and a new background `create()` caller that forgets
  `{ background: true }` restores the panel under the user — also visible.
- **Closing the focused session (`Ctrl+Shift+W`) while maximized** moves focus to a neighbour
  without an attention call, so the panel stays maximized. Accepted: the user closed something they
  could not see only by keyboard, and nothing is lost.
- **M1 relies on the panel wrappers being unpositioned** → guarded by a probe assertion on the
  rectangle, not by a comment.
- **Logout/shutdown with unsaved files is still held** (existing behavior, now documented): the
  session manager waits, then kills. Not made worse; not fixed here.
- **`unknown` states** (agent-events off, non-Linux `/proc`) show no mark — the list still names the
  session; the count is always right.
- **The title can lag** by the persist debounce — a tab renamed in the last half second shows its
  old name in the list.
- **macOS `Cmd+Q`** would skip the session question by C3. Phase 6 must decide (add a menu role or
  handle `before-quit` with a dialog there).

## Verification

Side panel (all in existing probes, real mouse and keys, `aria-label` selectors from the
dictionary):

- **Cover geometry**: maximized section's `getBoundingClientRect()` equals the stage container's;
  the rail's rectangle is unchanged and visible; restore ⇒ the section's rectangle equals its
  `Panel`'s again.
- **No resize reaches the pty**: in a shell session (the probes' `/bin/sh` is dash),
  `trap 'echo WINCH-<marker>' WINCH`. dash and bash run the trap only at the next line read, so
  **every step is followed by an `Enter`**. Precondition: dragging the separator + `Enter` prints
  the marker. Then maximize + `Enter`, restore + `Enter`: no new marker. Mutation: collapse the
  terminal `Panel` instead of covering.
- **Keys do not reach a hidden pty**: maximize, then select another repo whose focused session was
  inactive (it becomes `active` under the cover), type a marker; neither pty's buffer has it.
  Mutation: leave `covered` false — the newly active terminal grabs focus and receives the marker.
  (Typing right after maximizing would not discriminate: M2 already moved focus to the section.)
- **Focus**: after maximize `document.activeElement` is inside the section; after restore it is the
  focused terminal's textarea; with the conversation view shown it is the conversation input.
  Mutation: drop the `ConversationView` focus on uncover.
- **GPU share**: with the GPU renderer on, capture the focused terminal's context, maximize ⇒
  `isContextLost()` true; restore ⇒ a new context is held. Same observation as the conversation-view
  carrier in `probe-agent-view.mjs`. Mutation: compute `covered` without `maximized`.
- **No remount**: in `probe:files`, type into a file (dirty), maximize, restore; the dirty marker
  and content are unchanged and `Ctrl+Z` undoes the edit. Mutation: key the section by
  `maximized`.
- **Exit rules**: rail row of **another** session ⇒ restored; rail row of the **already focused**
  session ⇒ restored; `Ctrl+T` ⇒ restored; continuation entry ⇒ restored and the command reached the
  pty; rail repo row ⇒ still maximized; `Ctrl+Shift+H` ⇒ still maximized; a handoff arriving in the
  selected item (`probe:intake` stubs) ⇒ still maximized. Unit test for the counter in the sessions
  context. Mutations: exit on focused-id change (the already-focused row and the handoff turn red);
  `IntakeAutoAccept` without `{ background: true }` (the handoff turns red).
- **Graph / Timeline**: choosing Graph from a restored panel maximizes and draws nodes — once on the
  single-change fixture and once on a fixture with several active changes and no anchor; a change
  node ⇒ This change shows it, still maximized; This change on design scrolled down → Graph →
  Timeline → restore ⇒ design at the same `scrollTop`; Graph + `Ctrl+↓` ⇒ repo switched **and**
  Graph still shown; Graph + Files + OpenSpec ⇒ Graph. Mutations: derive Browse for any tab when no
  change resolves (the several-changes case turns red); keep `viz` inside `OpenSpecPanel` (the
  repo-switch case turns red); conditional instead of hidden rendering (the scroll case turns red).
- **Suppression carriers that used the Graph overlay** move to the inbox overlay (it has
  `role="dialog"` and `aria-modal="true"`): navigation-key suppression and `Ctrl+P` (both in
  `probe-openspec.mjs`, with focus put back into the side panel / change view), and the change-view
  `Ctrl+Tab` block.

Close confirmation:

Carriers:
- `close-prompt.test.ts` (unit): roles/default/cancel for {sessions only, files only, both, neither,
  quitting}; ordering (working first); 10 + "…and N more"; `null` working has no mark; truncation.
- `probe-terminal.mjs`, new section `runCloseConfirm` (stub dialog via throwaway profile): running
  shell + close trigger ⇒ one prompt recorded, CDP still connected, shell pid alive (answer
  `cancel`); prompt's default and cancel roles are `cancel`; two shells, one running `sleep 600` ⇒ it
  is first and marked; a global shell ⇒ listed under `rail.globalName`; answer `quit` + trigger ⇒
  process exits without escalation, no pty remains, relaunch shows the session dormant; only dormant
  sessions (restart, don't wake) + trigger ⇒ no prompt recorded and the app exits; running shell +
  `quitAndWait` (SIGTERM) ⇒ `escalated === false`, no prompt recorded, no pty remains.
- `probe-agent-view.mjs`: an agent made busy by the hook-running stub (same helper as the hibernation
  "working agent stays running" assertion) + trigger ⇒ listed with the working mark.
- `probe-files.mjs`: dirty buffer only ⇒ unsaved prompt (default `saveAll`), `cancel` keeps the
  buffer, `discard` closes without touching the file — the four existing Chinese scenarios get their
  first carrier; dirty buffer + running shell ⇒ exactly one prompt with both, default `cancel`; cancel
  keeps both.

Control groups (each applied, confirmed red, reverted):
- Remove the session check from the guard ⇒ "closing with a running session asks first" red.
- Count `sessionStore` records instead of live ptys ⇒ "only dormant sessions close without asking" red.
- Default to `quit` ⇒ "the safe answer is the default" red.
- Drop the `quitting` check ⇒ SIGTERM assertion red (escalation + prompt recorded).
- Keep the old `guardUnsavedChanges` alongside the new guard ⇒ "exactly one dialog" red (two prompts).
- Sort by store order only ⇒ "working session listed first" red (the fixture creates the busy shell
  second).
- Map `awaiting-choice`/`busy` to `null` ⇒ "a working agent is marked" red.
- ~~Stub's `close` trigger calls the renderer's `window.close()`~~ — dropped: that path emits `close`
  too (see Context), so the mutation changes nothing.

## Open Questions

None. Decided by the maintainer (2026-10-07):

1. **Ask whenever any session has a running process**, not only when one is working — the default
   in C1–C5 stands.
2. **A quit that does not start with closing the window (logout, shutdown, `kill`) never asks about
   sessions** — C3 stands.
