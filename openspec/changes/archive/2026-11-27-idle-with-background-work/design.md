## Context

The attention state is derived once, in the main process (`attentionOf` in `src/shared/wait/attention.ts`, fed by
`attentionProjection` in `src/main/wait-attention.ts`, wired in `src/main/ipc/wait.ts`), and sent to every window as a
complete projection; the renderer only maps it to dots and words (`session-badge.tsx`), the rail item's most urgent
dot (`mostUrgent`, `URGENCY`) and the header summary (`summary.ts`, `SessionSummary.tsx`).

Today `attentionOf` reads `wait`, `inTurn`, `seen` and `choiceTypedOver`. Whenever it does not return `choice`,
`working` or `unknown`, it returns `seen ? 'idle' : 'waiting'`. It does not read background work.

The main process already holds the agent's background tasks (`remote-background-tasks`): `backgroundOf(sessionId)` in
`agent-wait.ts`, replaced by every own `Stop` and every `SubagentStop`, cleared when the process ends
(`forgetRequests`, `clearWait`). Each task has `kind: 'agent' | 'shell' | 'monitor' | 'other'`. The phone receives the
same list as `Session.background` and shows "background running: N" next to the word "idle".

What was measured on 2026-11-26 (the handoff from the spekterm-android session, CLI 2.1.33x): the desktop dot and the
phone both said idle while the phone listed two background shells. An own `Stop` carries `background_tasks`. When a
non-shell task runs, `agent-events.ts` does not end the turn (`backgroundAgentRunning`), and a background subagent's
`PreToolUse` sets the wait state to busy — so a subagent that keeps calling tools already shows as working, or as
the turn-ended row when its tool start comes after the turn's end. The session reads idle while only shells
or monitors remain, or while a background subagent generates for a long time without calling a tool.

The user's decision (recorded in the handoff): change the rule on both the desktop and the phone, with the words
"閒置 · 背景執行中" ("Idle · running in background"), as a new state of its own, **not** counted as working: the agent
can take a prompt at that moment, and the user must not be led to think the session can be ignored.

The phone's session (spekterm-android) proposed the shared rule on 2026-11-26: count `agent`, `shell` and `other`,
not `monitor`; no annotation on "waiting for you"; only the idle row changes. This design adopts that rule (D1, D2),
so both ends derive the same state from the same facts.

## Goals / Non-Goals

**Goals:** a desktop status dot, tooltip, rail item dot and header summary that tell "idle, nothing running" from
"idle, background work still running", by the same rule the phone uses.

**Non-Goals:** a protocol change (the phone already has `wait`, `seen` and `background`); a background annotation on
any state other than idle; changing what holds a turn open or the wait state (`agent-event-bridge`); notifications;
the handoff lifecycle (`lifecycleOf`) and the relations file; the hibernation and close idle checks (see Risks); showing
which background tasks run on the desktop (the phone already lists them; the desktop's conversation view is another
change).

## Decisions

### D1. What counts as background work: every task in flight except a `monitor`

A session has background work when the held list (`backgroundOf`) has at least one task whose `kind` is `agent`,
`shell` or `other`. The held list is already only tasks in flight (`running`, `pending`, `paused`, or an unknown
status — `remote-background-tasks` D2), so no status filter is added here.

**Why not `monitor`.** `kind: "monitor"` is a subscription the CLI keeps for the session, not work the agent started
and will report on: the one capture that has it shows two artifact live-update subscriptions ("live updates for
artifact … (re-armed on session resume)"). Such a subscription lasts as long as the session, so counting it would make
every session with an open artifact read "running in background" for good — "idle" would never be shown again, and
the new state would stop meaning anything. The `Monitor` tool's waits, which are work the agent is waiting on, are
reported as `kind: "shell"` (measured, `remote-background-tasks`), so they count. The phone already hides `monitor`
tasks from its background list, so a phone that counted them in the state would say "running in background" with no
task listed.

**Why `other` counts.** `other` is a kind the desktop does not know (the SDK names `workflow`), which is work until
shown otherwise; leaving it out would bring the original symptom back for it.

**Rejected: only `agent`.** It would leave the measured case — two background shells — reading "idle", which is the
report this change exists for.

The predicate is one exported function (`isBackgroundWork(task)` beside `BackgroundTask`), used by the projection;
`docs/remote-protocol.md` states the same rule for clients.

### D2. Only the idle row changes

`attentionOf` gains one input, `background: boolean` (D1), and one result, `idleBackground`:

```
unknown                              → unknown
awaiting-choice, not typed over      → choice
busy, in a turn                      → working
otherwise, not seen                  → waiting
otherwise, seen, background          → idleBackground
otherwise, seen                      → idle
```

- **"Waiting for you" wins and is not annotated.** It is the state the user scans for; a turn that ended unseen needs
  the user whatever runs in the background. The phone shows its background row under it anyway, and the desktop's
  tooltip stays one state. (The user's handoff left the annotation open; the phone's proposal and this design both
  leave it out, so the two ends agree.)
- **"Working", "asks for a choice" and "running" (unknown) are unchanged.** Working already says something runs; a
  choice already needs the user; an unknown state cannot claim anything.
- The two paths that already fall into the turn-ended row — a busy state outside a turn (a background subagent's
  late tool start) and a choice typed over at the desktop — reach `idleBackground` like any other seen turn end
  when a task counts. A busy state outside a turn happens only after a `Stop` that listed no running non-shell task
  (one would have held the turn open), so the subagent is usually not in the held list then (at most pending or
  paused): whether the session says "running in background" depends on the other tasks listed. The phone reads
  `wait` directly and shows this case as working (a divergence that exists today and is not changed here).
- **A turn held open is "seen", so it is never "waiting".** When an own `Stop` lists a running task that is not a
  shell (`backgroundAgentRunning`, `agent-events.ts`), the turn is not ended: `inTurn` stays true, and the seen mark
  treats a batch in a turn as seen (`wait-seen.ts` `onBatch`). Such a session reads as the idle row today — which is
  the reported "idle while a background subagent runs" — and reads `idleBackground` after this change, whether or
  not anyone looked. So "waiting wins" holds exactly where the seen mark says unseen; the spec states it that way and
  pins the held-open case with a scenario.

### D3. A new value of `Attention`, not a flag beside it

`Attention` gains `'idleBackground'`; `RowState` follows (it includes `Attention`). The projection still sends one
value per session.

**Why a value and not a separate `background` flag in `AttentionView`.** Every presentation keyed by state is a
`Record<RowState, …>` or `Record<SummaryBucket, …>` (`TONE`, `URGENCY`, `BUCKET_OF`, `BUCKET_DOT`) or the
`ATTENTION_KEY` object indexed by attention, so the compiler names every one of them when a value is added. A flag
would have to be threaded to each of them by hand, and a forgotten one would quietly show plain idle. `AttentionBroadcaster`
compares attention values, so a change between idle and idle · running in background is sent with no change to it; a
flag would need the comparison extended, and missing it would be silent.

**The `===` sweep** (CLAUDE.md, "a new enum value"): the comparisons against attention values outside
`src/shared/wait/` are `QuickReplyRow.tsx` (`'choice'`, `'unknown'` — refusing a quick reply; idle · running in
background accepts one, as idle does — and `notice.attention !== attention`, which clears a refusal or "not sent"
notice when the state changes: a switch between idle and idle · running in background, such as at a `SubagentStop`,
clears it too, which is accepted, since the notice is about the state before) and `SessionSummary.tsx` (`'choice'`,
`'waiting'` — the tooltip's line per session; the new state takes the plain line). The probes hold their own lists
of states and words (`SUMMARY_BUCKETS`, `ANY_ATTENTION` in `probe-agent-view.mjs`), which drop an unknown bucket
silently, and match tooltips by substring — "Running · Idle" is a prefix of the new state's tooltip; they are part of
the sweep. `lifecycle.ts` and `lineage.tsx` compare `LifecycleState`, a separate type
derived from `wait` and `seen`, not `Attention`. The implementer greps again (tasks 1.5).

### D4. The projection reads the held list on every batch

`AttentionSources` gains `background: (sessionId) => boolean`, wired in `ipc/wait.ts` as
`backgroundOf(sessionId).some(isBackgroundWork)`. No new trigger is needed:

- every drained batch calls `noteWaitBatch` → `refreshAttention` (`index.ts`, `observeWaits`), including a batch with
  only a `SubagentStop` (the case `remote-background-tasks` D6 had to wire for the remote list);
- a process end resets the held list (`forgetRequests`) and `onPtyChange` refreshes the projection.

The broadcaster sends only when some session's value changed, so the 400 ms observer still reaches the window only on a
change.

### D5. The desktop's look: its own dot, ranked above idle, its own summary entry

The desktop has no status text that is always on screen — the state is a dot, and words only in tooltips — so a new
state that shares idle's dot would be visible only on hover, and the user glancing at the rail would still read
"idle". Therefore:

- **Dot**: the idle green ring, filled with a translucent green (`border border-green bg-green/40`) — between the
  ring (idle) and the solid glowing dot (working). No pulse and no amber: it does not need the user. Its exact look is
  for dogfood to settle; the spec requires only that it is distinct from idle, working and the needs-you dot.
- **Rank** (`URGENCY`, the rail item's dot): after working, **before running** — choice/waiting, error, working,
  **idle · running in background**, running/unknown, idle, hibernated/ended. Every shell session is "running", so
  ranked after running the new state would never show on the collapsed row of a folder that also has a shell; a
  running shell says less than an agent with work still running. A folder whose agents are idle but one still runs
  background work says so on its collapsed row, shell or not.
- **Header summary**: its own bucket, `idleBackground`, listed between working and running (the order follows
  `URGENCY`), with its own dot and words ("idle · running in background"). Activating it goes to the next session in
  that state, as for every other entry.
- **Words**: "Idle · running in background" (`sessions.attentionIdleBackground`), 「閒置 · 背景執行中」; the
  summary's state word in the dictionary's existing lower-case style. The tab's tooltip composes the process status
  with it (`sessions.statusRunningWith`), so the whole reads `<title> — Running · Idle · running in background` /
  `<title> — 執行中 · 閒置 · 背景執行中`. The repeated "running" / 「執行中」 is accepted: the first is the process, the
  second the background work, and every other state composes the same way.

**Rejected** (the user's review, 2026-11-27, chose the look above): share idle's dot, rank and summary bucket, and
change only the tooltip words. It is smaller, but on the desktop it shows the difference only on hover. The repeated
"running" in the tab's tooltip was accepted in the same review. The phone's change (`idle-in-background` in the
companion app) later took the same look — its own dot, its own summary entry — so the two ends agree on the rule and
on the shape of the presentation.

### D6. The protocol document states the rule; the protocol does not change

`docs/remote-protocol.md`'s `seen` paragraph says how the desktop shows `ready` + `seen`; it gains: `ready` +
`seen: true` with a `background` task whose `kind` is not `"monitor"` is shown as "Idle · running in background".
No field is added: a desktop older than this change sends the same fields and a client applying the rule shows the
same thing, which is correct for it too (the rule reads facts, not a desktop decision). The document also says that
idle · running in background is idle for `sessions.hibernate` and `sessions.close`: neither answers `SESSION_BUSY`
for it, and both end the background work (see Risks).

## Risks / Trade-offs

- **A stale task keeps the state.** The held list is the agent's last report (`remote-background-tasks` D5): a task
  that ends with no later report stays listed, and the session says "running in background" until the next `Stop` or
  `SubagentStop`, or until its process ends. Measured paths all report (a finished task's notice starts a turn, which
  ends in `Stop`). → Accepted, as for the phone's list; the state can be wrong only toward "something may still run",
  the safe direction for this report.
- **A task started during a turn shows only at the turn's end.** → No cost here: during the turn the session is
  working.
- **`/clear`.** If `/clear` stops background tasks and no turn follows, the session keeps saying "running in
  background" (`remote-background-tasks` keeps the list over a `SessionStart`). → Accepted, same reason.
- **A future CLI reports a real piece of work as `monitor`.** It would read idle, today's behavior. → The measurement to
  redo on a CLI upgrade is already in `docs/lessons/transcript.md`.
- **A late report after a process end.** For an end other than hibernation, a drain still subscribed can fold a
  `Stop` the agent wrote just before it ended, after `forgetRequests` reset the held list (`remote-background-tasks`
  D3's known gap). The held list then stays until the agent's next report after a wake — and now the desktop's dot
  says "running in background" for that woken session, not only the phone's list. Hibernation calls `clearWait` and
  stops the drain, so it has no such gap; the spec's process-end scenario is about hibernation only. → Accepted as
  rare and bounded by the next report, as before.
- **Finding, not changed here: a `monitor` holds the turn open.** `backgroundAgentRunning` counts every running task
  that is not a shell, a `monitor` included, so an own `Stop` while an artifact subscription runs does not end the
  turn (the finding `remote-background-tasks` recorded). Such a session never reaches "waiting for you", and with
  only the subscription listed it reads plain idle after this change (D1 does not count it). Whether
  `backgroundAgentRunning` should leave `monitor` out too is `agent-session-control` D3's rule, needs its own
  measurement (is a subscription's status `running`? only hand-written fixtures exist), and is a separate decision.
- **Finding, not changed here: hibernation and close end background work.** `busyReason` (`hibernation-policy.ts`)
  treats an agent whose wait state is ready as idle, for the automatic hibernation (default 24 h) and for a device's
  `sessions.hibernate` / `sessions.close` alike. An agent session idle · running in background is therefore
  hibernated after the threshold, or by a phone without `SESSION_BUSY`, and its dev server ends. That belongs to
  `session-hibernation` / `agent-session-control` and is a separate decision; this change states it (D6) and does not
  change it.

## Migration Plan

None. The projection's values are internal to one process and its windows; a window and its main process are always
the same build.

## Open Questions

- Whether a `monitor` should stop holding the turn open (Risks) — a separate change if wanted, after a measurement.
