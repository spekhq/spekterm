## Why

Two problems from daily use, bundled into one change at the maintainer's request.

**The side panel is too small to read in.** Reading a change's design or a file in the side panel
means reading it in about a third of the window. The panel can be dragged wider, but only until the
terminal reaches its minimum width, and the width is not remembered. The Graph and Timeline
visualizations dodge the problem with their own full-window overlay — but choosing a change there
closes the overlay and drops the user back into the narrow panel, which is exactly where the
problem is.

Closing the window (the title bar's ✕, `Alt+F4`) quits spekterm at once, even while sessions are
running. Every pty dies with the app — that is structural, the master fd has to be held by someone —
so one stray click ends a running build or dev server and cuts an agent off in the middle of a reply.
The only guard on that path today is the unsaved-files dialog, which says nothing about sessions and
does not appear at all when no file is dirty. Restore brings the sessions back as dormant (claude
resumes its conversation, a shell restarts in its last directory), which is exactly why the loss is
easy to miss: the tabs come back, the work in flight does not.

## What Changes

**Maximizing the side panel**

- A **Maximize / Restore** entry in the main stage header, and `Ctrl+Shift+M` from anywhere (not
  in dialogs or menus; the key cannot be encoded in the terminal protocol, so the pty loses nothing).
- Maximized, the side panel covers the session tab strip and the terminal. The header (with the
  OpenSpec / Files switch), the activity bar, the rail and the status bar stay — the user can switch
  repos while maximized.
- **It covers the terminal, it does not shrink it.** The terminal keeps its size, so no pty is
  resized by maximizing or restoring (a pty narrowed to nothing would make the agent write output
  for that width, permanently). The covered terminal is treated like one covered by the
  conversation view: no focus, no GPU renderer.
- **The side panel's content is not remounted.** An open file keeps its unsaved edits, undo
  history and cursor; an artifact keeps its scroll position.
- Turning to a session (selecting one — even the one already focused —, creating one, switching
  sessions with the keyboard, sending the continuation command) ends the maximized state; selecting
  a repo, or a handoff arriving on its own, does not. Not persisted.
- **Graph and Timeline become views of the OpenSpec identity**, next to This change and Browse,
  shown only while maximized: choosing one maximizes the panel, restoring returns to the view before
  it exactly as it was, a change chosen in the graph opens in the same maximized panel, and the
  graph stays shown across a repo switch. The full-window overlay
  is removed. This also brings the layout back in line with the mockup, which drew Graph as a view
  of the OpenSpec identity.
- **BREAKING (behavior)**: `Esc` no longer closes Graph / Timeline (the maximized panel may hold an
  editor that uses `Esc`); the restore entry or `Ctrl+Shift+M` does. Graph / Timeline are no longer a
  dialog, so shortcuts work while they are shown.

**Confirming before closing**

- **Closing the window while any session holds a running process asks first**, in a native dialog:
  how many sessions are running, which ones (rail item + tab label, working ones first and marked),
  and what closing loses (running commands, an agent's reply in progress) versus keeps (claude
  resumes, shells restart in their last directory). Two answers, **Cancel is the default** —
  `Enter` / `Escape` never end a session.
- **Dormant and exited sessions do not count** — closing loses nothing of theirs. With only those,
  the window closes as today.
- **One dialog, never two.** With unsaved files *and* running sessions, the existing unsaved-changes
  dialog becomes a combined one (files + sessions; Save All and Quit / Quit Without Saving / Cancel,
  default Cancel). Without running sessions it is unchanged.
- **A quit that does not start with closing the window is not held** by the session question —
  `SIGTERM` from the session manager at logout/shutdown, or `kill`. Nobody may be there to answer, and
  a held quit ends in a `SIGKILL` that skips the app's own cleanup. (The unsaved-files dialog keeps
  its current behavior on that path.)
- **An acceptance seam for the dialog**: under a throwaway profile (the gate the notification stub
  already uses) the dialog goes to a stub that records what it was asked and answers from a file, and
  a trigger file asks the main process to close the window the way the ✕ does. This also gives the
  existing unsaved-changes requirement its first carrier.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `workspace-layout`: new requirement for maximizing the side panel over the main stage; the
  identity requirement notes that a maximized identity covers the rest of the stage instead of
  sitting beside it.
- `openspec-panel`: Graph and Timeline become views of the maximized side panel (the overlay
  requirement is removed); the view-switch requirement counts them; the `Ctrl+Tab` requirement's
  "overlay blocks" scenario uses the inbox overlay instead.
- `keyboard-navigation`: new `Ctrl+Shift+M` requirement; the dialog-suppression requirement drops
  the Graph / Timeline overlay from its list and its scenario uses the inbox overlay instead.
- `quick-open`: the document-wide dialog check no longer cites the Graph / Timeline overlay as its
  example; its scenario uses the inbox overlay.
- `workspace-app-shell`: adds "Closing the window while sessions are running asks for
  confirmation" and "A quit that does not start with closing the window does not ask about
  sessions"; modifies "視窗關閉前確認未存的變更" (one combined dialog, Cancel as default when sessions
  run; the "closes directly" scenario now also requires no running session).

## Impact

- `src/renderer/src/shell/MainStage.tsx` — maximized state, the header entry, the cover layout,
  `covered` for the focused terminal, the exit rules; the overlay wiring is removed.
- `src/renderer/src/shell/openspec/OpenSpecPanel.tsx` — Graph / Timeline views and the restore
  fallback; `VizOverlay.tsx` becomes an in-panel view (its Graph / Timeline panes are reused).
- `src/renderer/src/shell/KeyboardNavigation.tsx` — `Ctrl+Shift+M`.
- `src/renderer/src/shell/terminal/sessions.tsx` — an "attention" counter moved by user-initiated
  focus, creation and input; `intake/IntakeAutoAccept.tsx` marks its creation as background;
  `ConversationView` takes focus when it is uncovered.
- `src/shared/i18n/en.json`, `zh-TW.json` — maximize / restore labels; overlay-only keys removed.
- Probes: `scripts/probe-openspec.mjs` (new maximize section; the Graph / Timeline helpers and both
  of their users, including `runWorktreeAggregation`; the overlay-based suppression checks),
  `scripts/probe-keyboard.mjs`, `scripts/probe-files.mjs`, `scripts/probe-agent-view.mjs`,
  `scripts/probe-intake.mjs`; `scripts/scenario-coverage.test.mjs`.
- Docs: shortcut tables and the graph/timeline feature line in `CLAUDE.md`, `README.md`,
  `README.zh-TW.md`; `docs/lessons/side-panel.md`; `docs/PRD.md` ("Graph and Timeline in a
  full-window overlay").
- `src/main/unsaved-changes.ts` → replaced by `src/main/close-guard.ts` (the one `close` handler) and
  a pure `src/main/close-prompt.ts` (builds the dialog from facts) with `close-prompt.test.ts`;
  `src/main/index.ts` wires it (and records `before-quit`).
- `src/main/ipc/terminal.ts`: exports a synchronous query of a window's live sessions with their
  working state (built on `TerminalService.liveSessionIds()` / `idleFactsOf()` in
  `src/main/terminal.ts` and `waitStateOf()` in `src/main/agent-wait.ts`; labels from
  `SessionStore.view()` via `preferredTitle`).
- New `src/main/close-dialog-stub.ts` (acceptance seam, gated like `intake-notify-stub.ts`).
- Dictionaries `src/shared/i18n/en.json` / `zh-TW.json`: new `closeConfirm.*` keys.
- `scripts/probe-terminal.mjs` (new section), `scripts/probe-agent-view.mjs` (working-agent mark),
  `scripts/probe-files.mjs` (combined dialog + the existing unsaved scenarios),
  `scripts/scenario-coverage.test.mjs`.
- `docs/lessons/probes.md` (corrects how the dialog defeats `SIGTERM`), `CLAUDE.md` / README if the
  close behavior is described there.
- The close confirmation needs no renderer change, no IPC channel and no persistence format change.
