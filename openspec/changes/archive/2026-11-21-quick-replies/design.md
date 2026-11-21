## Context

A reply reaches an agent session through the pty: the text, then the submit key. Two desktop paths exist today:

- The conversation view's composer (`workspace:conversation:send`, `src/main/ipc/conversation.ts`): only for the
  conversation the window follows, gated on the wait state, writes `encodeInput(text)` — text and `\r` in one write.
- A phone's reply (`conversation.send` → `remote-host.ts` `reply` → `sendReply`, `src/main/remote-conversation.ts`):
  bound to the watched conversation, gated on the wait state and on a pending prefill, run in the session's queue
  (`runQueued`), text then the submit key `SUBMIT_KEY_DELAY_MS` later with the gate re-checked, and arms the
  phone-origin note (`armOrigin`) and a model switch (`armModel`).

`docs/lessons/handoff.md` §13.1: a long text written together with `\r` is taken by the agent as a paste and the
`\r` joins it unsent. The phone's path already avoids this; the composer's does not (its texts are short and typed).

The agent session's default view on the desktop is the terminal. A button under the terminal is a send that does
not go through the user's keyboard, so the agent's input box may already hold what the user typed there.

## Goals / Non-Goals

**Goals:** one click sends a kept sentence to a running agent session, from either view, under the same gates as a
typed reply plus one for the user's own unsent typing; the list is the user's, edited in Settings.

**Non-Goals:** syncing the list with the phone (each device keeps its own — the user's decision); a protocol
change; keyboard shortcuts for quick replies; quick replies for shell sessions; a fill-then-confirm mode (the user
chose send-at-once); suggesting sentences from the transcripts at run time (the defaults are fixed).

## Decisions

### D1. One gate-and-write core, two callers

Extract from `sendReply` everything after its watched-conversation check into `deliverReply(deps, sessionId, text,
take?)`; `sendReply` = the watching check + `deliverReply`, behavior unchanged. The quick reply calls `deliverReply`
with deps that leave out `armOrigin` (the desktop's own click, not a phone's) and `armModel` (the desktop sees the
model box and answers it). It inherits the queue, the prefill refusal, the split submit key and its re-check,
`slashForm` / `cleanReply`.

`deliverReply` gains these deps:

- `keystrokeSeq(sessionId)` and `noteSubmitted(sessionId)` (rule 2 of D2), used by every caller (the phone's
  `sendReply` deps in `remote-host.ts` too), injected for tests;
- optional, the quick reply's only: `gate(sessionId)`, run inside the queue after `refreshWait` and the state and prefill
  checks, before the text is written (D2 "Order"); it may throw a `QuickReplyRefusal` (a desktop
  type, **not** a `RemoteError`: `RemoteError` codes are the remote protocol's vocabulary, `remote-frames.ts`
  `ERROR_CODES`, and the protocol does not change). The IPC handler maps both error types to its own result.
- optional, the quick reply's only: `holdSubmit(sessionId, afterText: number)`: called before the submit key with the `keystrokeSeq` read right after
  the text write; true ⇒ the key is not written and the outcome is `filled-not-submitted` (D2).

*Alternative:* reuse `workspace:conversation:send`. Rejected: it needs the window to follow that conversation (the
terminal view does not), and it writes text and `\r` together (`docs/lessons/handoff.md` §13.1).

### D2. Refuse while the user's own typing may be in the agent's box

**The quick reply's writes count as keystrokes, as every reply's do.** Hiding them (a new write origin) would break
what reads keystrokes besides this gate: `inTurnOf` ("a turn is in progress from the moment anything is typed",
`agent-session-control`), `session-control.ts`'s drop of a waiting close / hibernate and withdrawal of a close offer
("anything typed into the target SHALL drop the waiting command", which names a device's reply and the handoff's
first prompt), and `wait-seen.ts`'s manual-compact tracking. A quick reply clicked while a close waits must drop it,
as a typed question would.

**The baseline is the last Enter the agent confirmed as a submission — counted in keystrokes, not compared in
time.** A `Stop` leaves text typed during the turn in the box (`intake-prefill.ts`), so "typed since the turn ended"
misses the case to catch; the user's own prompt that started the current turn is typing after the last turn's end,
so that baseline refuses every quick reply while the agent works on it. The agent's own `UserPromptSubmit` is not a
baseline either: the CLI reports a finished background task's notice as one (`docs/lessons/transcript.md`, "Nothing in
the payload tells such a submission from a typed one"), so a notice arriving after the user typed "fix the" would
make the box look empty; and its event time is taken by the hook after the Enter, so text typed in between would
count as submitted.

So `pty-input.ts` keeps, per session:

- `enters`: the `keystrokeSeq` and time of the last few **submitting Enters** — a write that ends with `\r`, whose `\r`
  is not preceded by ESC (Alt+Enter, a line break in the agent's box) and is not inside a bracketed paste
  (`ESC [200~ … ESC [201~`: xterm turns a pasted line break into `\r`), written while no own permission request or
  question of the agent was open (an Enter then answers the prompt; the predicate is injected from `agent-wait.ts`).
  The user's Enter, the composer's text-and-`\r`, a reply's or a prefill's submit key all qualify. An `'answer'`
  write is excluded, as for every keystroke;
- `submittedSeq`: the baseline — the count up to which everything typed was submitted.

It moves in exactly three ways:

1. **An own `UserPromptSubmit` drained with a submitting Enter before it**: the drain reports each own submit's event
   time (`DrainResult.ownSubmitsAt`, so `drainEvents` stays free of pty state; `agent-wait.ts`'s tick calls
   `confirmSubmit`); the last submitting Enter at or before that time, if its seq is above `submittedSeq`, becomes the
   baseline. A submit whose prompt starts with `<task-notification>` (a finished background task's notice,
   `docs/lessons/transcript.md`) moves nothing — `parseEvent` keeps that one fact of the prompt, not the prompt. A
   notice (or, if it reports one, a peer message) that no submitting Enter preceded since the last baseline moves
   nothing either. Every exclusion errs toward refusing.
2. **A reply `deliverReply` submitted** — a quick reply or a phone's: right after it writes the submit key,
   `submittedSeq = keystrokeSeq` (the submit key sends the whole box, the user's draft included, so the box is
   empty). This lets a second quick reply through before the
   first one's `UserPromptSubmit` is drained (every 400 ms) and after a quick reply that is a slash command
   (`/compact`), which reports no submit. A reply whose submit key was withheld does not move it: its text is in the
   box.
3. **A new process**: at spawn, `submittedSeq = keystrokeSeq` — a new agent's box is empty, and `lastKeystroke` lives as
   long as the app (`forgetInput` is not called in production).

**Order inside the queue** (the wait state can be up to 400 ms old, `WAIT_TICK_MS`): the quick reply's job first calls
`refreshWait(sessionId)`, then checks the wait state, then a pending prefill, then the gate: `keystrokeSeq >
submittedSeq` ⇒ refuse `TYPED` with the current count, unless `typedSeq` equals the current count ("Send anyway").
A permission request that arrived but was not drained is thus seen before any text is written.

**Before the submit key** (`holdSubmit`): `refreshWait`, then the wait state re-checked, and any keystroke after the
text write withholds the key →
`filled-not-submitted`; the row says the sentence is in the agent's box and not sent (or was sent with a key the user
pressed, if they pressed Enter meanwhile — the desktop cannot tell).

**"Send anyway".** A keystroke cannot be taken back: typing and deleting, a `!cmd` or a slash command the user typed
(neither reports a submit), **and keys that answered a permission prompt or a question, Esc, Shift+Tab** (none of
them reports an event that confirms a submission, `agent-events.ts`) leave the gate refusing until the next
confirmed submit. The refusal offers "Send anyway"; it re-sends with `typedSeq` = the count from the refusal, and the
gate passes only while `keystrokeSeq` still equals it — nothing typed since the user saw the warning — the same
baseline idea as the phone's `despiteTyped` (`remote-answer-despite-typed`). Clearing the box after the warning is
itself typing, so it needs a fresh refusal and a second "Send anyway"; the reason says to clear the box first.

*Not done here:* telling keys that answered a prompt from keys that went into the box, so that answering a prompt on
the desktop does not cost a second click. Only the Enter that answers is told apart (it never confirms a
submission); the keys themselves still count as typing. Left out because the boundary is not measured; reported to the
user as a follow-up if it bites in use.

*Why only for the quick reply:* the phone's reply has the same exposure, but changing it changes protocol behavior
— out of scope, reported as a finding.

*To measure in implementation* (and record in `docs/lessons/transcript.md`): text typed during a turn is still in the
box after `Stop`, and after a permission prompt during the turn is answered; when a notice arrives after a prompt is
approved; that a notice's prompt starts with `<task-notification>`; a background task's notice reports an own `UserPromptSubmit` with no Enter before it; whether a peer
message reports one; a prompt submitted mid-turn reports `UserPromptSubmit` at once; the delay from the Enter's write
to the hook's timestamp (for reference only — the gate compares counts, and rule 1 only needs the event time not to
precede the Enter's write).

### D3. The IPC: main validates, the renderer passes text

Channel `workspace:quickReply:send(sessionId, text, typedSeq?)` → `{ ok: true, outcome } | { ok: false, code, state?,
seq? }`, code one of `WAIT_STATE` (with `state`), `PREFILL_PENDING`, `TYPED` (with `seq`), `NOT_FOUND`, `BAD_PARAMS`.
Main checks: `sessionId` a string naming a running claude session of the sender's terminal service; `text` a string
that, after `cleanReply`, is a valid sentence (D4); `typedSeq` absent or a non-negative integer. It does **not**
require the text to be on the stored list: the renderer can already write any byte to the pty, so a list check
guards nothing and would race an edit in Settings. Structured results, not throws (IPC drops `code`).

### D4. The list lives in the preferences, defaults from the dictionary

A sentence: after trimming, 1–200 UTF-16 units (JavaScript `length`, as the phone's Kotlin counts), no line break or
other control character. A list: valid sentences, at most 12, no two equal after trimming.
`TerminalPreferences.quickReplies?: string[]`, read through the single field source; **a list on disk that breaks
any rule makes the field unset** — never repaired in part (the editor cannot write one; only a hand edit or
corruption can). `get()` returns a copy of the array (it currently copies the object shallowly). **Unset ⇒ the
defaults**, three dictionary entries in the current UI language, so a language switch changes them; **set (even to
`[]`) ⇒ exactly that list**, each sentence stored trimmed. The Agents & sessions section's restore unsets it; the list has no reset of its own.

Defaults (`quickReplies.default.close` / `.risk` / `.remaining`), the same three as the phone's, with no quote
characters (probe selectors are built from strings): "Can this session be closed now?" / 「這個 session 可以關了嗎？」;
"Is there any risk, or anything I need to decide?" / 「會有什麼風險或我要特別決策的嗎？」; "Is there anything left to
do in this session?" / 「這個 session 還有什麼要做的嗎？」.

The sentences are the user's words sent as their reply, not agent-protocol copy (`agent-protocol-copy.ts` is for
text spekterm itself instructs the agent with), so they belong in the dictionary; the Chinese defaults live only in
`zh-TW.json`.

**The write path** is the preferences' own: a setter `setQuickReplies(list | null)` in the store (`null` unsets),
its IPC in `src/main/ipc/settings.ts`, `settings.*` in the preload, `PreferencesProvider`; the setter is registered in
`scripts/settings-projection.test.mjs`'s `fullObjectMethods` and the key in `probe-shell.mjs`'s settings-key check.
**Each edit is a queue entry that computes the next list when it runs, from the list last applied** (the defaults in
the current language while unset), locating its row by the sentence (sentences are unique), never by index — so a
quick "move up" then "remove" applies both (`preferences-queue.ts`, terminal-preferences "each SHALL be applied over
the result of the ones before it").

### D5. The strip

A fixed-height row under the session's view (in the terminal view a sibling of the xterm host, which becomes `flex-1
min-h-0`; in the conversation view under the composer: one row in `MainStage` below both views, whose area becomes `relative min-h-0 flex-1`), for an agent session (`target === 'claude'`) when the list
is non-empty — **a dormant one too, its buttons disabled**, so waking it does not resize the pty right after its spawn.
Without agent events the state is always unknown and the buttons stay disabled (the renderer cannot read the
`agentEvents` preference, `toRenderer: false`, and it applies per spawn anyway). It holds one button per sentence, truncated to one line with the full
sentence as accessible name and tooltip, then an "Edit" button that opens Settings at Agents & sessions (Settings'
open state lives in `ActivityBar.tsx`; this needs an opener the terminal can call, wired like the inbox's). It
scrolls sideways rather than wrapping. Hidden for shell sessions and when the list is empty, and hidden with the view
(`hidden`) when the session is not displayed.

**The row never changes height**: a refusal replaces the buttons in the same row with one line — the reason, "Send
anyway" for `TYPED`, and a dismiss — and the `filled-not-submitted` notice does the same; a `TYPED` refusal stays until the user
clicks "Send anyway" or dismisses it; a `WAIT_STATE` refusal and the not-sent notice go when the session's wait state
next changes, or on dismiss. A line appearing under the row would resize the terminal and make the
agent reflow for nothing (`docs/lessons/terminal.md`, "Covering must not resize"). Showing or hiding the whole row
(list emptied, session stopped) is a layout change like any other and refits the terminal.

**Focus never leaves the terminal or the composer**: the buttons call `preventDefault` on `mousedown`, so a click does
not move focus and a Space or Enter typed during the send goes where the user was typing, not to a button. A button
is disabled while its send is pending, so a double click sends once.

Buttons are disabled with the reason as tooltip while the renderer already knows the state forbids it (`unknown`,
`awaiting-choice`); the main process is still the authority (D3). The awaiting-choice reason says the agent may be
waiting for a choice in the terminal (after a permission prompt dismissed with Esc the main process keeps that state
until the next event, `docs/lessons/transcript.md`).

`aria-label`s from the dictionary; the row is a `role="toolbar"` with its own label so probes select it by name.

### D6. Settings editor

In Agents & sessions, after the agent session view: a list of the current sentences (the defaults when unset), each
an input applied on Enter or blur (the dialog's one save model), Esc restoring; a remove button and up / down buttons
per row; an "Add" button appending an empty row focused (not saved until it has text). An input whose text is not a
valid sentence or equals another sentence is not applied: it shows why and keeps the edit until fixed or Esc; an
existing row emptied and left restores its sentence (removing is the remove button's job). The field itself stops at
200 units; "Add" is not offered at 12. The section's restore covers the list (D4).

## Risks / Trade-offs

- [A click sends at once; a mis-click sends a question] → the sentences are questions to the agent, harmless by
  nature; the user chose send-at-once. A user who keeps an imperative ("go ahead") accepts that.
- [The `TYPED` gate refuses after the user typed and deleted, or after a typed `!cmd` / slash command] → a keystroke
  is a keystroke; the desktop cannot see the box. "Send anyway" (D2) costs one more click in those cases only; a
  sentence joined to a half-typed reply is the worse failure.
- [After answering a prompt on the desktop, the next quick reply needs "Send anyway"] → a known cost of not telling
  prompt keys from box keys (D2 "Not done here"); listed in the spec.
- [A backslash-Enter line break followed by a notice not marked `<task-notification>`] → rule 1 would take text before
  it as submitted. The Enter is a plain `\r`, indistinguishable from a submission; rare, accepted.
- [A submit key that did not take effect (`docs/lessons/handoff.md` §13, seen at an agent's start)] → rule 2 takes the
  box as empty and the next quick reply joins the previous sentence; both are the user's own sentences; accepted.
- [The phone's reply keeps reading a wait state up to 400 ms old before its write and its key] → the same window D2
  closes for the quick reply; reported as a finding, not changed here.
- [Defaults change with the UI language only while unset] → intended; stated in the docs.
- [Phone replies keep the merged-draft exposure] → reported as a finding, not fixed here.
