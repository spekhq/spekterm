## Why

When an agent session's turn has ended and been seen, its status dot says **idle** — even while the agent still has
background work running (a background shell, a `Monitor` wait, a background subagent that has not called a tool yet).
The user reads "idle" as "nothing is running" and stops watching a session that will report back later. The phone
shows the same word; the desktop already holds the agent's list of background tasks (`remote-background-tasks`) and
sends it to the phone, but the status dot does not read it.

## What Changes

- A new attention state, **idle · running in background**: the agent is not in a turn, its last turn end has been
  seen, and the agent's last report lists at least one background task of kind `agent`, `shell` or `other`. A task of
  kind `monitor` (a subscription the CLI keeps, such as an artifact's live updates) does not count; a `Monitor` tool's
  wait is reported as a `shell` and does count.
- It is still idle in meaning: the agent can take a prompt now. It is **not** working and **not** "needs you".
- Only the idle row changes. "Waiting for you", "asks for a choice", "working" and "running" (unknown) are unchanged,
  and "waiting for you" carries no background annotation.
- The desktop shows it with its own dot, its own words ("Idle · running in background" / 「閒置 · 背景執行中」), a
  rank between "working" and "running" for the rail item's dot, and its own entry in the main stage header's summary.
- The remote protocol document states the rule, so the phone derives the same state from fields it already receives
  (`wait`, `seen`, `background`). **No protocol change.**
- Notifications, the handoff lifecycle, the relations file and the hibernation and close idle checks are unchanged
  (the last end an idle session's background work today and still will; the design records it as a finding).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `session-wait-indicator`: the attention states gain "idle · running in background"; the rail item's ranking and the
  header summary's states gain it.

## Impact

- `src/main/agent-events.ts` (`isBackgroundWork`, with its test), `src/shared/wait/attention.ts` (the derivation, `URGENCY`), `src/shared/wait/summary.ts` (a bucket),
  `src/main/wait-attention.ts` and `src/main/ipc/wait.ts` (the projection reads the held background tasks through
  `backgroundOf`), `src/renderer/src/shell/terminal/session-badge.tsx` (words, dot),
  `src/renderer/src/shell/SessionSummary.tsx` (the bucket's dot), both dictionaries.
- `docs/remote-protocol.md` (the desktop's reading of `ready` + `seen` + `background`), the website's sessions and
  remote access pages in both languages, `docs/lessons/transcript.md` (the dots now rest on the task `kind`),
  CLAUDE.md's one-line description of the status dots.
- Tests: `agent-events.test.ts`, `attention.test.ts`, `wait-attention.test.ts`, `summary.test.ts`;
  `probe:agent-view`'s attention section and the idle assertions of `probe:remote`, which today match by substring;
  the scenario coverage table.
- The companion Android app derives the same state on its own (its own change, same rule); nothing here waits on it.
