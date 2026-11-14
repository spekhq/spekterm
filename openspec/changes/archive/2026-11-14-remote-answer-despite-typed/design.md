## Context

A device answers an open prompt with keys (`src/main/remote-answer.ts`, `remote-prompts-attachments-rename`).
`clear()` holds the checks behind `Prompt.answerable`, and `writeAnswer` re-runs them before every key. One of
them, "nothing was typed into the session since the request's tool call started", compares
`lastKeystrokeAt(sessionId)` (`src/main/pty-input.ts`, wall-clock ms of the last write that is not an answer's
own key or a terminal report) with `request.at`. Once it fails it never clears until the request closes.

The check exists because a prompt answered, dismissed or half-answered on the desktop reports nothing (or nothing
until its tool ends), and the desktop does not read the screen. What changes here is that the desktop tells the
two kinds of keys apart by their bytes: a key that may have answered or dismissed the prompt keeps the hard block,
and a key that can only have moved within it lets the user on the phone decide, after being told.

Every keystroke into a session with an open request already pokes its followers (`index.ts`, `onKeystroke` →
`pokeWait`), and the prompt view is passed through to the client as it is (`remote-protocol.ts`, the follow's
`wait`), so a `wait` update carrying the new reason goes out without new wiring.

The companion Android app is implemented in parallel against these fields.

## Goals / Non-Goals

**Goals:**

- A device learns why it may not answer, and can answer despite earlier typing when the typing could only have
  moved within the prompt and that is the only reason.
- Typing after the device's answer arrived still stops it, key by key, exactly as today.
- A client can word its warning from what was measured, not from guesses.

**Non-Goals:**

- Making the answer land correctly after the desktop moved within the prompt. That needs the cursor position,
  which only the screen holds (the screen is not read, `CLAUDE.md`).
- Lifting any other block (several requests, size, answered, stirred, a deciding key).
- A new operation or a protocol version bump.

## Measurements (CLI 2.1.325, 2026-11-14)

A real `claude` in tmux (`--setting-sources project --permission-mode default`), every `PreToolUse`,
`PostToolUse`, `PermissionRequest` and `Stop` payload logged. Keys were sent as tmux keys, a device's answer
keys one at a time 300 ms apart. Each row was run once. The harness is not part of the change.

**The prompt still on screen, the desktop moved within it:**

| Desktop did, then the device's keys | Result |
|---|---|
| single-choice question: ↓↓ (cursor on option 3), then `1` | recorded `Apple` (right) |
| single-choice question: ↓ then `yn` then Space, cursor on option 2 | the letters and Space did nothing |
| single-choice question: → then Tab, then `2` | → and Tab did nothing; recorded `Banana` (right) |
| two single-choice questions: ← (on the first question), then `2` `3` `1` | ← did nothing; recorded `Banana` / `Blue` (right) |
| single-choice question: ↓↓↓ to "Type something", typed nothing, then `2` | the field read `2`; nothing submitted |
| single-choice question: ↓↓↓ to "Type something", typed `hello`, then `1` | the field read `hello1`; nothing submitted |
| the same with text in the field, then Esc | declined (deny works) |
| two single-choice questions: → (on the second question), then `2` `3` `1` | `2` answered the **second** question and moved to the review; `3` did nothing; `1` **submitted** `{ "Pick a color?": "Green" }`, the first question unanswered |
| two single-choice questions: → ↓↓↓ to the second's "Type something", typed `hi`, then Esc | declined (deny works) |
| one several-choice question: ↓↓, then `1` Tab `1` | recorded `Apple` (right) |
| one several-choice question: ↓↓↓ to "Type something", then `1` Tab `1` | the field read `1` and was checked; Tab moved to Submit; the last `1` did nothing; nothing submitted |
| one several-choice question: ↓↓↓ to "Type something", typed `hi`, then Esc | declined (deny works) |
| Bash permission prompt: ↓↓↓ (cursor on "No"), then `1` | the command ran (right) |
| Bash permission prompt: typed `abc`, then `1` | the letters did nothing; the command ran (right) |
| Bash permission prompt: typed `xyz`, then Esc | "Interrupted" (deny works) |
| Bash permission prompt: Tab ("Tab to amend"), then `1` | option 1 read `Yes, 1`; the command did not run; the prompt stayed open |
| the same, then Esc | "Interrupted" (deny works) |
| Bash permission prompt: ←, then `1` | ← did nothing; the command ran (right) |
| Write permission prompt: ↓↓ (cursor on "No"), then `1` | the file was written (right) |
| WebFetch permission prompt: ↓↓ (cursor on "No, and tell Claude…"), then `1` | the fetch ran (right): that row is not a text field |
| plan approval: `yn` then Space, cursor on option 1 | nothing happened |
| plan approval: ←, then `2` | ← did nothing; approved, the agent entered `default` (right) |
| plan approval: ↓↓ to "Tell Claude what to change", then `2` | the field read `2`; nothing approved |
| the same, then ↑ (cursor on option 2), then `2` | approved, the agent entered `default`; the leftover `2` was not sent as feedback |
| plan approval: ↓↓ to "Tell Claude what to change", typed `2`, then Esc | "User rejected Claude's plan" (deny works) |

**The desktop's key already answered the prompt** (the reviewer's case):

| Desktop did, then the device's keys | Result |
|---|---|
| Bash permission prompt for a 20 s foreground command: `1` (it runs), then Esc | the running command was **interrupted** ("Interrupted · What should Claude do instead?"); no `PostToolUse` or any other event followed, so the request stays open |
| the same for a 15 s command: `1`, then `1` | the device's `1` sat in the agent's input box; the command finished; the `1` was still there, unsent |

(`sleep 25` was not usable: the CLI moved it to the background on its own.) A digit, Enter and Esc are the keys
that answer or dismiss a prompt (`docs/lessons/transcript.md`, "Answering a question" and the permission rows).

So, after the desktop typed into a prompt, a device's answer does one of four things:

1. **lands right**: ↑/↓ that leave the cursor on a listed option; → or Tab on a single single-choice question;
   ← on the first question; letters and Space on an option row (they did nothing);
2. **does not take**: the cursor was on a text row (a question's "Type something", a plan's "Tell Claude what to
   change", a Bash prompt's amend field). The keys become text, nothing is submitted, the prompt stays open.
   The outcome is `sent` (no record within 3 s);
3. **submits wrong choices**: a question with several questions after the desktop moved to another question, or a
   several-choice question with an option already toggled. The outcome is `mismatch` when the agent records within
   3 s;
4. **acts on something else**, when the desktop's key had already answered or dismissed it: Esc interrupts the
   allowed tool that is running, and a digit stays in the agent's input box, where the next reply would carry it.

Esc dismissed the prompt in every state of the first table, text in a field included. These claims hold for the
tools, states and keys measured only. Not measured: Edit, Read, WebSearch, EnterWorktree and MCP prompts after a
key; → or Tab on a single several-choice question (the review follows, `docs/lessons/transcript.md`); arrows with a
modifier, punctuation (`?` may open a help screen), digits typed full-width, non-ASCII text outside a text row;
screens a key opens (a prompt's help, the external editor, the transcript view); mouse clicks (a mouse report is not
a keystroke, `pty-input.ts`).

## Decisions

### D1. `blockedBy` is computed where `answerable` is, in a fixed order with `typed` last

`clear()` becomes a function returning the first block that holds, or `null`: `open` (more than one request),
`size` (a question outside 1–4 questions / 1–8 options), `answered` (a device answer was written), `stirred`,
`decisive` (D4), `typed`. `promptView` sets `answerable: block === null` and adds `blockedBy` only when it is not.
Moving the question-size test into that function keeps `answerable` exactly what it was for every input (plan and
permission prompts never get `size`; a question with `questions: null` does).

`typed` is last so that `blockedBy: "typed"` means "this is the only block", which is what a client needs to
decide whether to offer the override. `open` comes first because it is the one the user sees on the desktop
("1 of 2"), and `size` before the transient ones because it never clears.

*Alternative*: a list of every block that holds. Rejected: the client needs one fact ("only typing?"), and a
list invites clients to reason about combinations the desktop does not promise.

### D2. The override's baseline is the keystroke count when the call arrives, not a time

`HostApi.answer` takes `despiteTyped`. When it is set, `remote-host.ts` reads `keystrokeSeq(sessionId)`
**before** `runQueued`, and passes it to `writeAnswer`. Before every key, the typing check is then "the
session's keystroke count still equals the baseline" instead of "no keystroke after `request.at`". Every other
check, `decisive` included, is unchanged.

- **Before the queue**: the warning the user accepted covers the typing they were told of, and a keystroke
  written while the answer waits behind another write to the session is not part of it. Between the button and
  the call's arrival (network, relay) the baseline cannot reach; a key in that window is let through. The client's
  warning is about "keys typed on the computer", not about a list of them, so that window does not change what the
  user agreed to. Closing it would need a count in the wait update echoed back by the client, a protocol change not
  worth its cost here.
- **A count, not a time** (the precedent of `remote-prefill-send` D4): a key in the same millisecond as the
  call's arrival is still told apart, and no clock step can hide one. `request.at` stays a time because it is
  an event file's time.

With the flag set and nothing typed, the check is still correct: no keystroke after the prompt means none after
the call either.

### D3. The flag is validated, and `false` means absent

`conversation.answer` accepts `despiteTyped` absent, `true` or `false`; any other value is `BAD_PARAMS`, with
nothing written. `false` behaves as absent. The flag never turns another block into a success: a block in the
checks is refused `PROMPT_GONE` before the first key (or `partial` after it), and a question outside the size, or
a decision that does not fit the prompt, is refused `NOT_ANSWERABLE` by `planKeys`, as today.

### D4. A key that may have answered or dismissed the prompt stays a hard block (`decisive`)

Outcome 4 is the case the typing check was built for, and an override there acts on something the user cannot see
from the phone: it interrupts a command the user just allowed, or leaves a digit for the next reply. The desktop
cannot see whether the prompt is still on screen, but it can see what was typed: `pty-input.ts` classifies each
write.

- **Moving** (overridable after a warning): a write made only of the four arrow keys without a modifier
  (`ESC [ A`–`D`, `ESC O A`–`D`), Tab, ASCII letters and Space. These are exactly the keys measured on every kind of
  prompt (first table): none of them answered or dismissed one, the worst being text in a field (outcome 2) or a
  move to another question (outcome 3).
- **Deciding** (hard block, `blockedBy: "decisive"`): any other write — a digit, Enter, Esc, Shift+Tab (the plan
  approval's "approve with this feedback"), a control character (Ctrl+C, Backspace), an arrow with a modifier, any
  other escape sequence (Alt+letter is Esc then the letter), punctuation, non-ASCII text, full-width digits. **A
  paste is always deciding**: the agent turns bracketed paste on (`BRACKETED_PASTE`, mode 2004, found in the CLI
  2.1.325 executable), so xterm.js wraps every paste in `ESC [ 200~ … ESC [ 201~`, an escape sequence. Classifying an
  unmeasured key as deciding only costs the override; a key can move to the moving set once it is measured (Chinese
  text typed into a "Type something" row is the likeliest candidate).

xterm.js writes one key per `onData` call (`TerminalView.tsx`), so the classes describe keys, not batches.

`pty-input.ts` keeps the last deciding keystroke's time per session beside the last keystroke's, under the same
exclusions (an answer's own keys, terminal reports), and **records both before it tells its listeners**: the
listener in `index.ts` pokes the follow, which reads the prompt view synchronously, so a deciding key recorded after
the listeners would go out as `typed` and no later update would correct it.

*Alternatives considered*:

- **Every key overridable** (the first draft). Rejected by outcome 4.
- **Exempt ↑/↓ from "typed" altogether** (no warning). Rejected: a plan approval's third row and a question's "Type
  something" row are one or two ↓ away (outcome 2), and → moves between a question's tabs (outcome 3).
- **Reset the cursor before the answer** (← and ↑ enough times). Rejected: whether ↑ wraps at the top is
  unmeasured, and a toggled option or typed text survives the reset.
- **Reuse `answered` for a deciding key.** Rejected: `answered` means a device's answer, which the app checks against
  its own state first; a distinct value lets it say "answered or dismissed on the computer".

### D5. A confirmed override may still submit wrong choices, and the protocol says so

Outcome 3 is real: after the desktop moved to another question, or toggled a several-choice option (with Enter,
a deciding key, the prompt is blocked; whether Space toggles one was not measured), the device's keys submit an answer the user did not
mean. The user's decision is to warn and then allow; the desktop cannot tell outcome 3 from outcome 1. The
`mismatch` check (already there) tells the client afterwards, and `docs/remote-protocol.md` states the outcomes so
the warning can name them.

### D6. Compatibility comes from the fields alone, and the document guarantees they come together

`OPERATIONS` is unchanged. An older desktop sends no `blockedBy` and ignores `despiteTyped` (its answer is refused
`PROMPT_GONE` as today). The companion app has no operation flag to check, so **it reads `blockedBy` as "this
desktop honors `despiteTyped`"**. The two therefore ship in one release, and `docs/remote-protocol.md` states that
guarantee; `scripts/remote-protocol-doc.test.mjs` checks the document states both fields and the guarantee, as it
does for the relay statements. An older client ignores `blockedBy` and never sends the flag, so it behaves as
before. A client that does not know a `blockedBy` value treats it as a hard block.

### D7. The flag applies to every decision

The protocol accepts `despiteTyped` on all five decisions, and the Android app sends it on all of them. Its first
plan was to send it only on the decisions a record confirms or contradicts (a question's `answer`, a plan's
`approve` / `approve-auto`), out of concern that an Esc swallowed by a field would leave a prompt open for the next
reply's text and Enter. The first table removed that concern within what was measured (Esc dismissed the prompt in
every state there), and the case where Esc would act on something else (outcome 4) is the deciding-key block's.

An answer the desktop cannot confirm stays `sent`. The app shows such an answer, sent despite earlier typing
(`deny` excepted), with a warning kept until the user dismisses it ("sent, but it could not be confirmed; check the
computer"), which covers outcome 2. The desktop needs nothing for that.

## Risks / Trade-offs

- [A confirmed answer that does not take (outcome 2) is reported `sent`, and the prompt then shows `blockedBy:
  "answered"`] → The protocol document says so, and the app keeps a warning; the user answers on the desktop.
  Clearing `answeredAt` when no record arrives is not done: it would allow a second answer into a prompt whose
  state is now unknown.
- [A wrong answer is submitted (outcome 3)] → `mismatch` reports it when the agent records it within 3 s; the
  warning names the cases (D5).
- [A moving key reached a state the measurements did not cover (another tool's prompt, a several-choice question's
  review), where the device's keys act differently] → Recorded as unmeasured (Measurements); the moving set holds
  only keys measured on every kind of prompt to answer nothing.
- [A prompt answered on the desktop with the mouse is not `decisive`] → Mouse reports are not keystrokes today
  either (an existing gap, recorded as unmeasured in the lessons); not widened here.
- [The measurements are one run each, on CLI 2.1.325] → Recorded in `docs/lessons/transcript.md` with the other
  answer measurements, under the same "re-measure after a CLI upgrade" rule.
- [A client sends the flag without warning anyone] → Not preventable by the desktop; the protocol document makes
  the warning a client obligation (section 9).

## Migration Plan

None: new optional fields. Rollback is reverting the change; clients keep working against `answerable`.
