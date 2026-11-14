## Why

A prompt that was touched on the desktop can no longer be answered from a phone: one key typed into the
session after the prompt appeared (even an arrow key, pressed and left) makes it `answerable: false` for good,
and the phone only says the choice cannot be answered there, without saying why. The maintainer hit it on an
agent's question that had been looked at on the desktop and left there. The rule is stricter than it needs to
be: the desktop cannot see what a key did, but it can tell a key that may have answered the prompt from one that
can only have moved within it, and for the second kind the user on the phone can be told and can decide.

## What Changes

- A prompt that is blocked **only** because keys that can only move within it were typed since it appeared
  (arrows, Tab, letters, Space) becomes answerable **after the phone warns the user and the user confirms**.
- Any other key, among them every key that may have answered or dismissed the prompt on the desktop (a digit,
  Enter, Esc, Shift+Tab, a control character, any other escape sequence, a paste) and every key not measured
  (punctuation, non-ASCII text, modified arrows), **stays a hard block**, as do the existing ones: more than one open
  request, a question too large for a device, an answer already written, other tool activity of the agent.
  Measured with the real CLI (2.1.325): after the desktop allowed a command with `1`, a device's Esc interrupted the
  running command, and its `1` stayed in the agent's input box for the next reply.
- `Prompt` gains `blockedBy` (protocol v1, a new optional field): present only when `answerable` is `false`, the
  first of `open`, `size`, `answered`, `stirred`, `decisive`, `typed` that holds. `answerable` keeps its meaning,
  so an older phone behaves as before.
- `conversation.answer`'s `p` gains `despiteTyped` (optional, `true`): the keystrokes written before the desktop
  received the call do not block that answer. A keystroke written after it still withholds the next key
  (`PROMPT_GONE` before the first, `partial` after), and every other block applies as before, with or without the
  flag. It applies to every decision, and the `confirmed` / `mismatch` check runs as today.
- Moving keys still warrant the warning. Measured: an arrow can leave the cursor on a text row, where a digit is
  typed as text and nothing is submitted; a move between a question's tabs makes the answer that follows submit
  wrong choices. The desktop cannot see the cursor (it does not read the screen).
- `docs/remote-protocol.md` states both fields, that they ship together (the companion app reads `blockedBy` as
  support for `despiteTyped`), and what the measured keys do after a prompt was typed into, so a client can word
  its warning.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `remote-protocol`: the open prompt states why a device may not answer it, and a key that may have answered it
  on the desktop is told apart from other typing; an answer may be sent despite earlier typing of the other kind,
  and is then checked only against typing after the desktop received it.

## Impact

- `src/main/pty-input.ts` (the last deciding keystroke), `src/main/remote-answer.ts` (`promptView`,
  `writeAnswer`), `src/main/remote-host.ts` (`answer`: the keystroke count when the call arrives), `src/main/remote-protocol.ts` (`conversation.answer` parameters, `HostApi.answer`).
- Unit tests: `pty-input.test.ts`, `remote-answer.test.ts`, `remote-protocol.test.ts`, `remote-host.test.ts`,
  `scripts/remote-protocol-doc.test.mjs`; acceptance: `scripts/probe-remote.mjs`;
  `scripts/scenario-coverage.test.mjs`.
- Docs: `docs/remote-protocol.md`, `docs/lessons/transcript.md` (the measurements), the website's remote access
  page in both languages, `CLAUDE.md`. The repo has no CHANGELOG.
- The companion Android app (its own repository) is built against these fields in parallel; an older app is
  unaffected.
