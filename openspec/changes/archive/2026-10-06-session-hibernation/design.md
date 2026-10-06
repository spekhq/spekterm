## Context

See proposal.md for motivation. The state this change builds on:

- **One dormant state already exists.** `SessionStatus` is `'dormant' | 'running' | 'exited'`; restore
  produces `dormant`, and `MainStage` wakes the displayed session in an effect (`MainStage.tsx:178-181`).
  Waking is `workspace:terminal:wake`: the main process re-spawns under the **same** `sessionId` from the
  persisted record (claude with `--resume`, shell in its last recorded cwd).
- **The main process already distinguishes why a pty ended** (`ExitReason`, `terminal.ts:50`): `self` and
  `killed` end the session and drop it from persistence; `disposed` (window close / reload) does not, and the
  renderer ignores it entirely (`ipc/terminal.ts:164`). `kill()` additionally clears agent status, agent
  events, and ends the handoff drop point (`endHandoff`). `dispose()` does none of that — it only kills ptys.
- **Shell screens are persisted as snapshots** written by the renderer (debounced `serialize()`, plus a
  `beforeunload` flush); the snapshot handler also records the shell's last cwd (`ipc/terminal.ts:404`).
  Restore replays the snapshot with a separator line, from a renderer-side map that **only the startup restore
  fills** (`sessions.tsx:297-314`). claude sessions are never snapshotted: `--resume` redraws the conversation
  itself, and a replay would show it twice.
- **The agent's wait state** (`agent-wait.ts`) is `'ready' | 'busy' | 'awaiting-choice' | 'unknown'`,
  derived from injected hooks. `SessionStart` and `Stop` yield `ready`. **It is only evaluated while something
  subscribes** (`subscribeWait`, `agent-wait.ts:95`): today the conversation view of the displayed session,
  completion tracking for handoff-created sessions, and an in-flight prefill. For any other claude session the
  last value is stale or `unknown`.
- **`wake()` remembers every session it has woken** in a `waking` set and never removes a successful one
  (`sessions.tsx:395-421`) — correct today, because a session could not become dormant twice in one run.
- **Lineage already counts a dormant session as existing** (`session-lineage`, "session 的存在有單一定義").
  In the relations file a child or sibling that no longer exists is dropped and a parent that no longer
  exists is `{"closed": true}` (`handoff-relations.ts:85-121`); so a listed entry with `"running": false` is
  already, today, a dormant session.
- **A handoff report travels through the reporting child's own drop point**, not the parent's
  (`handoff-service.ts:139-152`).

Measured on Linux for the shell idle test (an interactive `zsh -i` in a pty, reading `/proc`):

| shell state | `tpgid` (stat field 8) | children of the shell |
|---|---|---|
| at the prompt | = shell pid | none |
| `sleep 30` in the foreground | = the job's pgid | `sleep`, plus a transient `preexec` hook process |
| `sleep 30 &` | = shell pid | `sleep` |

## Goals / Non-Goals

**Goals:**

- Hibernating a session produces **exactly** the state restore produces, so every downstream path (wake,
  replay, resume, persistence, lineage) is the one already exercised by restore.
- One execution path for manual and automatic hibernation.
- Automatic hibernation fails closed: whenever idleness cannot be established, the session stays awake.

**Non-Goals:**

- Keeping a process alive across hibernation (suspending with `SIGSTOP`, checkpointing). Hibernation ends the
  process; the memory is only reclaimed if the process ends.
- Per-session opt-out from automatic hibernation. The global switch and the idleness rules cover the cases
  found so far; a pin can be added later without changing this design.
- Auto-hibernation of shells on macOS and Windows (no `/proc`). Shells there are never auto-eligible; manual
  hibernation works everywhere.
- Waking from an agent. The introduction tells an agent what a hibernated peer is; only the user wakes it.

## Decisions

### D1. Hibernated ≡ restored-but-not-woken

After hibernation the renderer sets the session to `dormant` and **remounts its view** (a key bump on the
session's view), so the remounted view takes the restore path: a shell replays its snapshot plus the
separator; a claude view starts empty and `--resume` redraws on wake.

Three things make "the restore path" true for a session hibernated in this run, none of which hold today:

- **The replay map is filled by hibernation too.** The hibernate path puts the snapshot it just serialized
  into the renderer's restored-scrollback map **before** the key bump. Without it, a session created in this
  run remounts blank, and a restored one replays its startup history instead of the hibernation one.
- **Output queued from the dying process is dropped.** A process emits output around its exit; with no view
  attached, that output is queued and would be written into the remounted dormant view, ahead of the
  `--resume` redraw. On the `'hibernated'` exit the renderer discards the session's queue, and the main process stops forwarding data from a pty it has marked hibernated — marked **per pty** (the
  `#reasons` `WeakMap` pattern), so the pty a later wake creates under the same session id is unaffected.
- **The `waking` set forgets the session** on hibernation, so the next Wake actually wakes it. An explicit Wake
  click after a wake error also clears the entry first — the button is the retry (D6); the "no automatic
  retry on re-render" protection stays, because only the click clears it.

*Alternative rejected: keep the live xterm and only write a separator.* For claude that shows the whole
conversation twice after wake (the same reason claude is never snapshotted), and it creates a second dormant
shape — "dormant with live buffer" — that every consumer of `status === 'dormant'` would have to handle
separately. The codebase has been bitten twice by an extra enum value silently falling into an `else`.

### D2. Main process: hibernation is a per-session `dispose`, not a `kill`

`TerminalService.hibernate(sessionId)` sets `ExitReason` `'hibernated'` and kills the pty. The exit sink
forwards `'hibernated'` to the renderer (unlike `'disposed'`, which it swallows) so the renderer can move the
session to `dormant`. The exit channel today carries only `(sessionId, exitCode)` (`ipc/terminal.ts:170`); it
gains the reason, and must not reach `sessions.remove` for it (every reason except `disposed` does today,
`ipc/terminal.ts:164-168`). The persisted record is not rewritten; it already holds everything wake needs — **including
the shell's last cwd, which is current only because the snapshot flush of D3 also updates it.**

What `kill()` does and hibernation must not:

- **mark the exit `killed`**, which drops the session from persistence — the session would vanish on the next
  restart, and lineage would report it closed. This is the decisive difference;
- **end the drop point** (`endHandoff`). The session's own drop point, intro file and live-session entry must be
  there when it is woken and wants to hand off or report again — the same state a restored session has.
  (It is **not** what carries a child's report to a hibernated parent: that report travels through the child's
  drop point.)
- clear agent status. The status-line payload is harmless while dormant and is replaced on wake.

What hibernation does that `dispose()` does not: **it resets the session's wait state to `unknown`.** A
hibernated handoff child would otherwise keep its last `ready` and show "waiting for you"; the lifecycle
already defines a dormant session as having no state to show (`shared/lineage/lifecycle.ts:25-38`), and a
restored session gets `unknown`. The reset goes through `clearWait` (`agent-wait.ts:117-125`), and the
hibernated exit **also broadcasts the lifecycle** — the renderer's lifecycle mark only updates on
`broadcastLifecycle` (`ipc/handoff.ts:25`), which today fires only on a completion change, so without it the
tab keeps showing "waiting for you" even though the relations file is right. Wait-state subscriptions are
released with the pty and re-created on wake.

*Alternative rejected: reuse `kill()` with a flag.* `kill()` is the "session ends" path; a flag on it is the
shape where the next edit to `kill()` silently applies to hibernation too.

**Pre-existing gap this makes routine:** `kill()` returns early when the session has no pty
(`terminal.ts:718-720`), so closing a **dormant** session never ends its drop point or clears its events. It
already happens for restored sessions; with hibernation, closing a dormant session becomes common. `kill()` returns whether it had a pty; when it did not, the kill IPC
handler ends the drop point and clears events and status itself (only in that case, to avoid a second scan).

### D3. The renderer executes; the main process decides

Both triggers run the same renderer path: **flush the shell snapshot (and put it in the replay map) → invoke
`hibernate` → on the `'hibernated'` exit, drop queued output, clear `waking`, set `dormant`, remount**.

- **Manual**: the context menu / shortcut calls `hibernate(sessionId)` with no token. The main process does
  not re-check eligibility — the user may deliberately hibernate a displayed or busy session.
- **Automatic**: on its tick the main process sends `hibernate-request(sessionId, token)` to the renderer,
  which runs the same path and passes the token back. A token-bearing `hibernate` is **re-checked** against the
  policy at that moment and refused (no-op) if the session is no longer eligible — it may have become
  displayed or busy during the round trip. Tokens are single-use and expire with the next tick.

Why the renderer must be in the path: only it can serialize the shell's xterm, and the snapshot must be
current when the pty dies (the debounce can be up to two seconds behind). IPC messages from one renderer
arrive in order, so a `snapshot` sent before `hibernate` is written first.

*Alternative rejected: the main process kills directly and the renderer reacts.* The snapshot would be up to
one debounce interval stale, and a renderer that is reloading would lose it entirely.

### D4. What "idle" means, per target

A session is **auto-eligible** when all hold:

1. it is `running` and **not the displayed session** (the renderer reports the displayed session id on every
   change; a minimized window still counts its displayed session as displayed);
2. its **last activity** is older than the threshold. Activity is:
   - the session becoming or ceasing to be displayed;
   - shell: any pty output;
   - claude: a wait-state transition (the agent finishing a turn counts as activity at that moment).

   **User input is deliberately not a separate kind of activity.** Input can only reach a session while it is
   displayed (and the displayed session is exempt), or from the product itself (continuation, prefill,
   handoff delivery), which is followed by a wait-state transition. Counting the pty input stream would also
   count xterm's own automatic replies (focus reports, device-attribute and OSC answers), which go out through
   the same path — a session that queries its terminal periodically would never become idle.
   claude's own pty output is not activity either: a TUI redraws without the user being involved, and the
   agent's own state is the authoritative signal.
3. target-specific idleness:
   - **claude**: wait state is `ready` **and fresh** — the policy subscribes every running claude session to
     its wait state for as long as the session runs (the `trackCompletion` pattern), so the value is not a
     stale `ready`: a session watched in the conversation view until it was waiting, then left, then sent
     work, would otherwise still read `ready` while working. (A session never watched reads `unknown`, which
     already fails closed.) Cost: one 400 ms directory read per running claude session.
     **Consequence for the conversation view**: events are read-and-delete, and a drain now always happens
     whether or not a view is open. The relocation an event carries (`transcriptPath`, after `/clear` or a
     resume) would be consumed with no one to follow it, and a view opened later would follow the computed
     path (`ipc/conversation.ts:84,129`). This already happens for handoff children. So `agent-wait` keeps the
     last `transcriptPath` per session, and the conversation view relocates to it when it starts. Not idle when `busy`, `awaiting-choice` (resume does not restore an interrupted tool
     call), or `unknown`; **not idle while a filled-in first prompt is unconfirmed** (an intake accepted in
     fill mode, or a handoff whose send fell back to "pending send" — `watchSubmission`,
     `intake-prefill.ts:137-170`): the agent is `ready` but its input box holds text that resume would drop.
     `watchSubmission` keeps that state in a closure and only messages the renderer (`ipc/intake.ts:354`), so
     the main process gains a **per-session registry of unconfirmed submissions**: set when the text is
     written (in submit mode, including the window before "pending send" shows), cleared on `onSubmitted` or
     when the session ends.
   - **shell** (Linux): the process the pty spawned **is still the shell** (after `exec vim` or `exec ssh` the
     pid is the editor, which is foreground and childless). The pty's pid is the shell's own (spawned directly,
     `terminal.ts:195,557`). Identity is compared by **file identity, not path**: `(st_dev, st_ino)` of
     `realpath($SHELL)` recorded at spawn against `stat('/proc/<pid>/exe')`. Not by reading `/proc/<pid>/exe`
     at spawn — node-pty returns the pid right after `fork`, when the link may still name Electron's binary —
     and not by string: an upgraded shell binary makes the link read `… (deleted)`, which would silently turn
     auto-hibernation off for every older shell, while `stat` still follows it to the old inode, which still
     matches
     — **and** it has no children (`/proc/<pid>/task/<pid>/children`). Any foreground or background job is a
     child, so the children clause alone covers both; `tpgid` adds nothing and is not read. Transient hook
     processes (`preexec`) only make a tick fail; the next tick retries. Any read failure → not eligible.

*Alternative rejected: compare `pty.process` (foreground process name) with the shell's name.* It cannot see
background jobs, and a nested shell has the same name as the outer one.

### D5. Threshold preference

`autoHibernateSeconds: number` in the preferences store, **`0` = off**, default `86400`. Not `null` for off: the
store's setter convention already uses `null` to mean "reset to default" (`preferences-store.ts:450-518`), and
the spec requires off to persist as off. Settings offers presets (Off, 4 h, 24 h, 3 days, 7 days); the store
accepts any non-negative integer, so a probe seeds a few seconds — that is data, not a test branch in product
code. A stored value outside the presets is shown as such, formatted through `src/shared/i18n/locale.ts`. The
tick period is `clamp(threshold / 4, 1 s, 60 s)` and the tick reads the current preference each time, so a
change applies without restart. The field goes through the single-source field whitelist and the per-field
projection to the renderer.

### D6. Explicit wake replaces wake-on-display

The wake effect in `MainStage` is removed. The dormant screen (terminal view and conversation view) gets a
**Wake** button. A `wakeError` keeps showing as today, with the button as the retry (D1).

**Focus**: `TerminalView` already focuses the terminal when its session becomes active and is not covered
(`TerminalView.tsx:326-332`, dependencies `[active, covered, sessionId]`). That same effect, while the session
is dormant, focuses the Wake button instead — one rule, not two effects racing — and its dependencies gain the
status, so when the session becomes running the effect runs again and focuses the terminal (otherwise the
unmounted button leaves focus on `<body>`). `ConversationView` has no such effect today and gets the same rule
(Wake button while dormant, its input once running). So `Ctrl+Tab` → `Enter` wakes the session with no new key
handling, typing afterwards reaches it, and an `Enter` can never be written to a pty that does not exist.

Consumers that assumed "displayed ⇒ will be running":

- The continuation entry already reports `notRunning` for a dormant session (`continuation.ts:86`); unchanged.
- The conversation view already has no input while dormant (`ConversationView.tsx:140`).
- Dormant-screen copy that promises wake-on-display becomes false and is rewritten: `en.json` 260 ("resumes
  when shown"), 271, 272, 569 ("Open the terminal view to wake it"), and their `zh-TW` counterparts. So does
  the replay separator (273, "spekterm restarted"), which is false after a hibernation.
- Cold start now starts **zero** sessions; every probe section that relies on "select item ⇒ session starts"
  changes to an explicit wake (listed in tasks 1.2).

Intake acceptance and handoff arrival create **new** sessions and are unaffected.

### D7. Manual entry points and the shortcut

Context menu on a session tab and on a rail session row: **Hibernate** (shown for `running` sessions only).
Shortcut **`Ctrl+Shift+H`** hibernates the focused session of the selected rail item. It is in the
`Ctrl+Shift+<letter>` class — not encodable in a terminal, so it costs the pty nothing (same reasoning as
`Ctrl+Shift+W`). It follows the cross-shortcut rules (scope is the selected rail item including the global
one; suppressed while a dialog or menu is open; no-op on a dormant or exited session) and, as a navigation-
class shortcut, **takes effect with focus in the editor**. Monaco's keymap must be checked for a binding on it
during implementation (task 3.5); if one exists, the window-capture interception takes it from the editor,
which is acceptable for a read-mostly editor but must be stated. The rebinding cost is one condition in
`KeyboardNavigation.tsx` plus spec and probe.

### D8. Relations: no new field, a sharper introduction

The relations file already separates the three cases (Context). A `"hibernated"` field would be a second value
that must always equal `!running` for listed entries.

What changes is the introduction (`handoff-intro.ts`, agent-protocol copy: English, not in the dictionary):
the sentence about `"running": false` says such a session is hibernated, comes back when the user wakes it,
and that the agent must not try to wake it — the report path still reaches it. Hibernate and wake go through
the existing "pty changed" refresh that rewrites relations files.

### D9. Visible state

The rail and tab badges already render `dormant` (`session-badge.tsx`). No new badge. The dormant screen of a
**shell** session states what was not kept (unexported environment, in-memory history, background jobs).

## Risks / Trade-offs

- [More resumes means more exposure to resume failure] A claude session that fails to resume self-heals into a
  fresh conversation (known, bounded cost in `terminal.ts`). Hibernation makes resume routine instead of
  once-per-restart. → No new mitigation; called out so dogfood watches for it.
- [A shell loses state the snapshot cannot hold] → Auto only when the shell is unchanged and childless; the
  dormant screen says what is lost; manual hibernation is the user's informed choice.
- [A shell builtin waiting in the foreground — `read`, `select`] The shell is unchanged and childless, so it
  qualifies. → Accepted: not detectable from `/proc` without parsing shell state, rare in an interactive
  shell left alone for the threshold, and the snapshot keeps the screen.
- [A claude agent's own background jobs] A dev server the agent started belongs to the claude process tree and
  dies with it. The claude rule looks only at the agent's state. → Accepted for the first version: only an
  agent that is `ready` qualifies, and one that left a server running is usually not the one left alone for a
  day. Revisit if dogfood hits it.
- [Prompt frameworks with a persistent child daemon] A shell whose prompt keeps a long-lived child never
  becomes auto-eligible. → Fails closed (stays awake). The maintainer's zsh has only a transient `preexec`
  child.
- [Text typed but not sent] A command line typed in a shell, or a prompt typed into claude's input box, in a
  session the user then leaves, is lost when it auto-hibernates. Nothing outside the screen records it, and
  reading the screen is ruled out. → Accepted: the shell's snapshot still shows the typed line; for claude the
  draft is gone. Called out to the user.
- [A filled-in prompt the user clears by hand] The unconfirmed-submission registry is cleared only on
  `onSubmitted` or session end, so a session whose filled-in text the user deleted stays ineligible. → Fails
  closed; manual hibernation still works.
- [Agent events turned off] With the agent event bridge disabled in preferences, claude sessions report no
  wait state and never auto-hibernate. → Fails closed; manual hibernation still works.
- [Each hibernate/wake cycle adds a history separator to a shell] The snapshot keeps the previous separator
  and a new one is appended on each wake. → Same as repeated restarts today; bounded by the snapshot size cap.
- [Race between the auto decision and a change of state] → Token-bearing requests are re-checked (D3).
- [The behavior change surprises: switching to a session no longer starts it] → The Wake button takes focus,
  so the cost is one `Enter`. This was the user's explicit choice.
- [Probe cost] Auto hibernation needs a short seeded threshold and must not wait on the 60 s tick ceiling. →
  D5's tick period derives from the threshold.

## Migration Plan

No data migration: a hibernated session is persisted exactly as a restored-but-not-woken one already is, and
`autoHibernateSeconds` absent from an existing preferences file means the default. Rollback is a revert; any
session hibernated at that point is simply dormant, which the old code wakes on display.

## Open Questions

- Exact wording of the dormant-screen shell note and the rewritten dormant copy — settled in review of the
  dictionary diff.
