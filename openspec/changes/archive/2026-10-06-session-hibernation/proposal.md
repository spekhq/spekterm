## Why

A session only ever goes one way: restored sessions start dormant, and once displayed they run until the
app closes. Sessions that belong in the workspace but are used once every week or two therefore hold a
live process the whole time. Measured on the maintainer's machine: 22 `claude` processes holding about
6.9 GB of resident memory, 15 of them alive for over six days (230–500 MB each). The dormant state that
restore already uses is exactly the right resting state for them — there is just no way back into it.

## What Changes

- **Manual hibernation**: the user can put a running session to sleep (tab context menu, rail session row,
  and a keyboard path). Its process ends; the session keeps its identity, place, name, lineage, and handoff
  ticket, and becomes dormant — the same state restore produces.
- **Automatic hibernation**: a running session that has had no interaction for a threshold (default
  **24 hours**, configurable in Settings, can be turned off) is hibernated — but only when it is idle:
  - a `claude` session only while the agent is waiting for input (never while it is working);
  - a shell session only while its foreground process is the shell itself (no dev server, build, or other
    job running);
  - **never** the session currently displayed.
- **BREAKING (behavior)**: **every dormant session wakes only on an explicit wake action** (a wake button on
  the dormant screen, or `Enter` while it has focus). Displaying a dormant session no longer starts it. This
  applies to restored sessions too, so `Ctrl+Tab` / `Ctrl+↓` across items no longer starts processes as a
  side effect.
- A shell session is snapshotted at the moment it hibernates, so waking it replays the screen and respawns
  in its last directory, exactly as restore does today. What a shell loses (unexported environment, in-memory
  history, background jobs) is stated on the dormant screen.
- Hibernation is **not** closing: it does not end the session's handoff drop point, does not mark it
  exited, and does not remove it from persistence.

## Capabilities

### New Capabilities

- `session-hibernation`: putting a running session back to dormant — the manual action, the automatic
  idle policy (what counts as idle, the threshold, the displayed-session exemption), and what hibernation
  preserves versus what it ends.

### Modified Capabilities

- `session-persistence`: "dormant sessions start on first display" becomes "dormant sessions start on an
  explicit wake"; cold start and item switching start no process; the dormant screen offers the wake action.
- `global-session`: restored global sessions follow the same explicit-wake rule (its requirement restates the
  old "first display" wording); the rail-item requirement's reason for "no item selected at cold start" cited
  the removed "at most one session starts" rule and is re-grounded.
- `terminal-preferences`: Settings gains the auto-hibernate switch and threshold.
- `keyboard-navigation`: a shortcut to hibernate the focused session, and its place in the "shortcuts with
  focus in the editor" rule.
- `session-lineage`: one scenario's precondition ("C has been displayed", meaning running) becomes "C has been
  woken"; no requirement text changes.

Checked and otherwise unchanged: `session-lineage` already counts a dormant session as existing and lists it with
`"running": false`, while a closed one is dropped (child, sibling) or marked `"closed": true` (parent) — so
"listed and not running" already means hibernated. The relations file needs no new field; what changes is
the agent-facing introduction, which must say what that combination means (covered in
`session-hibernation`). `artifact-continuation` already disables the entry for a dormant session.

## Impact

- **Main process**: `src/main/terminal.ts` needs a hibernate path separate from `kill()` — `kill()` is the
  "session ends" path: it marks the exit as a close (dropping the session from persistence) and ends the drop
  point. Idle tracking (activity, the agent's wait state for every running claude session, the shell's
  process facts from `/proc`) lives in the main process; `src/main/ipc/terminal.ts` gains channels.
- **Renderer**: `sessions.tsx` (a `running → dormant` transition), `MainStage.tsx` (remove the
  wake-on-display effect), `TerminalView.tsx` / `ConversationView.tsx` (wake button and the shell-loss
  note), tab and rail context menus, `KeyboardNavigation.tsx`, Settings dialog.
- **Persistence**: `sessions.json` gains nothing structural — a hibernated session is persisted exactly as
  a restored-but-not-woken one already is. Shell snapshots are written at hibernation time.
- **i18n**: new strings in `en.json` and `zh-TW.json`, and the existing dormant-screen strings that promise
  wake-on-display are rewritten.
- **Probes**: every section that relies on "select ⇒ wakes" changes (in `probe:terminal`, `probe:intake`,
  `probe:agent-view`); new sections in `probe:terminal` (manual, shell auto), `probe:agent-view` (claude auto,
  on the stub agent), `probe:intake` (lineage), `probe:keyboard`, `probe:workspace` (Settings); `probe:shell`'s
  preload whitelist. The auto path uses a seeded threshold of seconds so no probe waits 24 hours.
- **Peer messaging**: a hibernated session cannot receive Claude Code local session messages. This does
  **not** cut the handoff reply path and needs no exemption from auto hibernation: a child reports through its
  **own** drop point, spekterm keeps the report, and the introduction already tells the child to skip
  `SendMessage` when its parent is not running. The relations file (`src/main/handoff-relations.ts`) is
  unchanged; the introduction text lives in `src/main/handoff-intro.ts`.
- **Closing a dormant session** today skips ending its drop point (`kill()` returns early without a pty). It
  already happens for restored sessions; hibernation makes it routine, so this change fixes it.
- **Preload surface**: `probe:shell` pins the exact set of terminal and settings methods the preload exposes;
  the new channels extend that list.
