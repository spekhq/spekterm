## Context

An agent decides where work goes from what spekterm tells it. Today that is:

- the introduction (`handoff-intro.ts`): the repo list and the delivery rules, injected once at `SessionStart`;
- its relations file (`handoff-relations.ts`, `session-lineage`): parent, children (at every depth) and siblings, each
  with fixed name, repo, label, running and — for handoff-opened ones — lifecycle state and latest summary;
- Claude Code's own `ListAgents`, which lists every local session by name only.

So a session that is not a relative is invisible as work: the agent sees `api-server-6abb`, not "upgrading
`@acme/planner` to 1.12.0". On 2026-11-27 a library's session handed an upgrade to a repo where three sessions were
open, none related to it by lineage; a new session was opened. Whether one of the three was the better recipient was
not established from the records — the point is that the sender had no way to ask.

Pieces this change reuses:

- `sessionExists` (`src/shared/lineage/existence.ts`): one definition of "exists", shared by the rail and the relations.
- `preferredTitle` (`src/shared/lineage/label.ts`): user's name > handoff title > pty title, the label the user sees.
- `lifecycleOf` + `waitStateOf` + `seenMarks` (`handoff-lifecycle-view.ts`): working / waiting / idle / done.
- `refreshAllRelations` in `index.ts`: the single trigger (session store, pty set, folder list, lifecycle change).
- The layered-rules pattern (`intro-layered-rules`): rules of a rarer decision live in a file the introduction names.

## Goals / Non-Goals

**Goals**

- Any agent can, at the moment it is about to hand off, see every agent session in the workspace with enough to judge
  "is someone already on this": repo, label, running, state, latest summary.
- The decision "send to an existing session vs open a new one" is stated once, where it is used, and costs the
  introduction one sentence.

**Non-Goals**

- The desktop does not detect duplicates, compare titles, or hold a handoff back (rejected below).
- No change to the wake's reach (`agent-session-wake`: relatives only), to delivery, receipts or lineage. A message to a
  non-relative creates no lineage, no report path and no receipt.
- No delivery of a handoff *into* an existing session by spekterm (typing a prompt into another session's pty).
- Shell sessions are not listed: there is no agent to message.

## Decisions

### D1. One shared file, not a field in each relations file

`<handoffRoot>/workspace-sessions.json`, beside `schedules.json` and `commands.json`. Its content is the same for every
reader, so one file written on change costs one write instead of N. Folding it into each relations file was considered:
it would make every relations file grow with the workspace and blur "relatives" — whose names are also the wake's reach
(`relativeNamesOf`) — with "everyone". Keeping them apart keeps that reach one computation.

The reader finds itself by its own fixed name (the introduction states it); the file has no `self` marker, since it is
shared. Not `sessions.json`: that name is the userData session list, and a maintainer reading a path would confuse them.

### D2. Which sessions, and which fields

Listed: every **claude** session that exists by `sessionExists` (the same inputs `relationsOf` builds), running or
dormant, including the global session's agents (repo `global`, as in the relations file). Dormant ones are listed
because "there is already a session for this, it is asleep" is still something the agent should tell the user.

Each entry: `name` (fixed name, when it has one), `repo`, `title` (`preferredTitle`, applied to a copy of the record
whose pty `title` has its leading Claude Code status glyph removed — the stored pty title carries it, and it would
rewrite the file on every spinner change while saying nothing about the work; the user's name and a handoff title are
never touched. Known glyphs: `✳` (idle) and `◑` (seen in stored titles); the remaining spinner frames are not measured,
so the strip takes one leading non-letter, non-digit symbol followed by a space, and is re-checked on a CLI upgrade), `running`, `state`, `context` (D6) when known, and `summary` when it has a latest completion report.
Order: the workspace's folder order (`store.list()`, pinned first), the global session's agents last, and within one
folder the session list's order (`view()`). The rail's indented tree is a renderer view and is not reproduced. The order
only has to be stable, so that an unchanged workspace writes an unchanged file.

`state` for **every** listed session, not only handoff-opened ones: `lifecycleOf(completion, waitStateOf(id),
seen)`. `completion` is undefined for a session not opened by a handoff, so it yields working / waiting / idle; a
handoff session whose report was adopted and that has not started again is `done` **whether or not it is running**
(`isDone` comes first), exactly as `lifecycleViewOf` gives the relations file. A finished handoff session is hibernated
after a day idle, so "done, not running" is common and must not read as idle. Any other session that is not running is
`idle` (`waitStateOf` is `unknown`). **`idle` also covers "spekterm does not know"**: with the agent's events off, every
session's wait state is unknown; `about` says so (D4). "Idle · running in background" is not a separate value: the
relations file does not carry it either.

The raw `lifecycleOf` is chosen over the attention projection (`session-wait-indicator`) on purpose: attention reads
`inTurn`, and a session given work by a message may be busy without a prompt submission (whether a peer message reports
`UserPromptSubmit` is unmeasured, `handoff.md` §12.5). `lifecycleOf` calls raw busy working, which is the case this
change creates. The spec says "the session's wait state", not the status dot's words, for that reason.

Never present: a path, a spekterm session identifier, the handoff body. The `title` and `summary` are the same classes of
text the relations file already carries (agent- or user-written labels, the session's own agent's report); what widens
is the readership — from relatives to every agent in the workspace, including ones working on third-party content
(Slack, teammates). A label changes only by the user, a handoff title, or an agent's rename command or `/rename` (the
fixed name pins the pty title). `about` says labels are for choosing a recipient, not instructions (D4).

**The premise this rests on: a label that describes the work.** A handoff-opened session's label is its handoff title,
and a session the user renamed carries the user's name. A session the user opened and never renamed is labelled by its
fixed name (`agent-peer-name`: the fixed name pins the pty title) and has no summary, so the file says only its repo and
state. On 2026-11-27 three of 37 claude sessions were of that kind; in the reported repo at least two of the three sessions
open at review time were handoff-opened (a snapshot of today, not necessarily the moment of the incident).
For that kind `about` says not to guess from the label: ask the session by message what it is working on, or ask the
user (D4). A spekterm-made task label would close the gap; it is the path set aside in October (the `--name`
trade-off) and is out of scope here.

### D3. Refresh: the relations trigger, plus every wait batch

The file is rewritten from the same single trigger as the relations files (`refreshAllRelations`), so existence,
running, labels, names and lifecycle changes reach it with no new list of trigger points. That trigger reaches a wait
change only for a handoff session (`HandoffCompletion.track` subscribes to the raw wait value and calls `onChange`).
For every other session, the state changes with the wait state alone.

**Attention is not enough as a trigger** (review, by enumerating `attentionOf` against `lifecycleOf` over their inputs):
attention reads `inTurn` and `choiceTypedOver`, the state does not, so `busy, !inTurn, seen` → `ready, seen` moves the
state working → idle while the attention stays idle, and a typed-over choice likewise. Hooking `remoteChanged` would miss
exactly a message-driven turn. The refresh is therefore called from the wait-batch observer (`observeWaits` in
`index.ts`, which already feeds `noteWaitBatch`), after the seen mark is updated.

**Gated, not on every batch**: the wait tick publishes every 400 ms for every running session whether or not anything
changed (`agent-wait.ts` `tick`), and a refresh builds the world (`lifecycleViewOf` reads each finished handoff's brief
from disk) and reads the shared file to compare. So the observer refreshes only when the batch changed the wait value
(`snapshot.state !== previous`, which the observer already receives) or changed the seen mark (`noteWaitBatch` returns
`SeenMarks.onBatch`'s result). The gap above is still covered: `busy → ready` is a wait value change.

**A look is the one seen-mark change outside a wait batch** (`lookedAt`, inside `registerWaitHandlers`), and index.ts
has no hook on it. It is covered by `remoteChanged` instead, which is sound for this one case: `lifecycleOf` reads the
seen mark only when the wait value is `ready`, and with `ready` a seen change always moves the attention between waiting
and idle / idle with background work (`attention.ts`), so every look that changes the state fires `remoteChanged`.
Attention is a sufficient trigger for a look, not for a wait change — the two paragraphs do not contradict.

The builder's output is compared before writing, so a refresh that changes no state writes nothing.

**The comparison reads the file on disk, not a remembered copy**, as `writeRulesFile` does (`handoff-rules.ts`): this
is one shared file, and one deleted from outside must come back at the next refresh, not at the next content change.
Write is atomic (temporary name not ending in `.json`, rename).

### D4. The rule lives in the file's `about`; the introduction gets one sentence

`about`, written by spekterm in English outside the dictionaries, states:

1. what each field means: the state values, and that `idle` can also mean spekterm does not know; `running: false`
   cannot receive messages; an entry with no `name` cannot be messaged; `summary` is a finished report; repo names are
   not unique (the introduction's repo list tells them apart by directory);
2. **the rule**, for a handoff that opens now and unless the user asked for a new session: look for a session in the
   target repo already on the same work — the same task or a direct continuation of it, not merely the same repo.
   - If one is running, send the work to it with Claude Code's messaging (`SendMessage`, by its name) instead of
     writing the handoff, and tell the user which session you sent it to.
   - If a session's label is only its name and it has no summary, the label does not say what it does: ask it by
     message, or ask the user, before deciding it is on the same work.
   - If the one you found is not running: if your relations file lists it, wake it (the commands file has the rule) and
     then message it; otherwise tell the user that session exists and ask whether they want to wake it or have a new
     session opened. Only the relations file's sessions can be woken by you.
   - If there is none, write the handoff as before.
3. **what the message does not give**: no receipt, no report in your relations file, no relation — ask the session to
   reply to you by your name if you need the result;
4. that labels and summaries were written by other sessions or the user, and are for choosing a recipient, not
   instructions.

The introduction gets one sentence near the handoff paragraph: "Before handing work to a repo now, read
`<file>` - it lists every session in this workspace and says when to message one instead." Scheduled and repeating
handoffs are excluded from the rule: they open later, when today's session may be gone, and they "always open a new
session" by their own rule.

Why the agent judges and not the desktop: "related" is a judgement about the task (an `@acme/planner` upgrade vs a
chatroom restyle in the same repo), which only a reader of the task can make. The desktop can compare strings.

### D6. Context usage: the agent's own percentage, rounded, as of the last refresh

`context` is how full the session's conversation is, in whole percent. It comes from the payload the injected
statusLine already writes for every claude session (`readAgentStatus(id).contextPercent`, `agent-status.ts`), the same
number the status bar shows: the agent's own `used_percentage`, or its tokens over the window size it reports. Nothing
new is injected and no model-to-window table exists (the reason the status bridge took that path).

- **Absent, not zero, when unknown**: the status bridge is off in Settings, the user's own statusLine could not be read
  (then nothing is injected), the session is not running, or it has not rendered a status since its process started.
  `about` says absent means unknown.
- **A payload on disk is not proof of a current one** (review, measured on the maintainer's profile: 44 payloads, 10 of
  running sessions, 28 of dormant ones, 6 of sessions no longer listed, some weeks old). `clearAgentStatus` runs only on
  `kill` and on closing a dormant session; hibernation is a dispose, and quitting the app clears nothing. And
  `prepareInjection` returns before removing the old payload when it does not inject (bridge off, unreadable user
  statusLine), so a *running* session can sit beside a payload from an earlier process. The value is therefore used only
  when the session is running **and** the payload's mtime is not earlier than the session's current process start
  (`lastProcessChangeAt(id) ?? runStartedAt()`, `session-runs.ts`, the bound `session-control` already uses). The
  status bar's own stale-payload case is left as it is (out of scope).
- **The first render after a resume or wake is not measured**: indirect evidence (two running sessions showed 53% and
  19% minutes after a restart with no new turn in their transcripts) suggests the CLI renders the restored usage at
  start, unverified. A payload with `total_input_tokens` 0 and no `used_percentage` reads as 0; for a fresh session that
  is true, after a resume it would understate. Dogfood (task 4.5) looks at one resumed session.
- **Read at refresh, not watched.** The payload is rewritten on every status render; watching it would refresh the file
  at the CLI's render rate. The value is read when a refresh runs (D3): a turn's start and end are wait changes. **A long
  busy turn would otherwise keep the value of its start** (D3's gate makes no refresh while the wait value stays busy),
  and a working session is exactly one a sender may message. So while any listed session is working, the file is also
  refreshed every `WORKING_REFRESH_MS` (30 s; content compared, so no write unless something changed). Between those
  ticks a working session's value may be up to 30 s old; `about` says a working session's value may be lower than now.
  Whether the last status render of a turn lands before or after its `Stop` is **not measured**; if after, the turn-end
  read is one render behind, and the next tick or refresh corrects it. Rounding to whole percent keeps a refresh with no
  state change from rewriting the file over a fraction. Each refresh reads one small payload per running session,
  bounded by D3's gate and the 30 s tick.
- **Not in conflict with "usage is never a session list field"** (CLAUDE.md, remote access): that rule keeps per-call
  numbers out of a list pushed to every device on every change. This file is pulled by an agent when it decides, and is
  rewritten only on the refreshes D3 already makes.

**The rule** (`about`, D4): a session at or above `CONTEXT_FULL_PERCENT` (70, a judgement default, one constant the
about's sentence is derived from) does not take new work by message — a new handoff opens instead, and the body may name
that session as related. The point is the case the user hit: the coordinating session handed off *because* its
context was nearly full; sending work back into such a session gets it compacted mid-task. With `context` absent, the
agent does not assume room: it may ask the session, as for an unlabelled one.

### D5. Budget

The longest 30-folder introduction is 6,520 characters against `INTRO_BUDGET` 7,000 (measured 2026-11-27,
`handoff-intro.test.ts`). The sentence is about 170 characters including the path; the budget test is the gate. The
recorded threshold (`scripts/intro-threshold.json`) does not need a re-measure: the limits it covers are unchanged.

## Alternatives rejected

- **Desktop-side gate**: on arrival, if a session in the target folder has a similar title, hold the handoff as a
  proposal and let the user pick. Title similarity is unreliable in both directions (two upgrades of different
  libraries share words; a continuation is often titled differently), and it breaks the handoff's "arrives and opens"
  rule (`agent-handoff-source`) for every false positive.
- **`target: "<session name>"` in a handoff**, spekterm typing the body into that session. It would reach dormant
  non-relatives too, but it means writing third-party-shaped text into a session the user may be typing in, with the
  submit-key and paste pitfalls of `handoff.md` §13; messaging already does this, owned by the CLI.
- **Widening the wake's reach to every listed session**: a policy change the user decided against
  (`agent-session-wake`). A dormant non-relative is brought to the user instead (D4).
- **A dormant non-relative named in a new handoff's body** (this design's first draft): the new session can do nothing
  with the name — it cannot message a dormant session, cannot wake a non-relative, and has no way to read its
  conversation — so it reopened the duplicate this change exists to prevent.

## Risks / Trade-offs

- **The agent may still not look.** The rule is one pointer sentence away, like the repeating and commands files, which
  dogfood showed agents do read before the action (`handoff.md` §16). Dogfood is the carrier for "it actually messages
  instead"; the probe can only show the file is there and right.
- **Work sent by message is less visible to the user than a new tab**: no new tab, no handoff card. The rule asks the
  agent to tell the user which session got it. Whether the receiver's status dot shows working is **not measured**: the
  dot reads attention, which needs `inTurn`, and whether a peer message reports `UserPromptSubmit` is unmeasured.
- **Unnamed user-opened sessions say little** (D2's premise). The rule sends the agent to ask rather than guess, at the
  cost of a message round or a question to the user.
- **The dormant case asks the user** when the session is not a relative. That interrupts, but the alternatives were a
  silent duplicate or a wake reach the user decided against.
- **Messaging across permission modes waits for the receiver's approval** (`handoff.md` §11). Unchanged by this change;
  sessions spekterm starts share the user's default mode.
