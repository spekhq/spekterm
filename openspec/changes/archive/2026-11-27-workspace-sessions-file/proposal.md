## Why

An agent that hands work off cannot see what the workspace's other sessions are doing, so it opens a new session even
when one is already on that work. It sees the repo list and its own relatives (parent, children, siblings); every other
session is a bare fixed name (`api-server-6abb`) among those Claude Code's messaging can reach, with no task
attached. On 2026-11-27 this happened several times with upgrades handed to one repo: a library's session handed an
upgrade off while three sessions were already open in the target repo, none of them its relative.

## What Changes

- A **workspace sessions file**, one per workspace beside the other handoff files, kept up to date by the main process:
  every agent session in the workspace with its fixed name, its repo, its label, whether it is running, its state
  (working, waiting, idle, and done for a session opened by a handoff), how full its conversation's context is (the
  percentage the agent itself reports), and its latest completion summary when it has one.
  No path and no spekterm session identifier.
- The file **describes its own fields and carries the rule** (`about`, as the relations file does): before writing a
  handoff that opens now, look in this file for a session in the target repo that is already on the same work; if one is
  running, send the work to it with Claude Code's messaging instead of opening a new session, and tell the user which
  session got it; if it is dormant, wake it when it is a relative, or else ask the user; if there is none, hand off as
  before. A session labelled only by its fixed name is asked, not guessed at. A session whose context is nearly full
  does not take new work: a new session is opened, since more work there would soon be compacted mid-task.
- The introduction gains **one sentence** pointing to the file before a handoff (layered rules, `intro-layered-rules`).
  It stays within its size budget.
- What is related is **judged by the agent**, which can read the task; the desktop does not compare titles or hold
  handoffs back. Nothing about delivery, receipts or the wake's reach changes.

## Capabilities

### New Capabilities

- `workspace-sessions`: the workspace sessions file: which sessions it lists, the fields of each entry, what it never
  holds, when it is rewritten, and the rule its description carries.

### Modified Capabilities

- `agent-handoff-source`: the introduction points to the workspace sessions file, to be read before a handoff that opens
  now.

## Impact

- `src/main/handoff-relations.ts` (or a sibling module): the pure builder of the file's content, reusing
  `sessionExists`, `preferredTitle` and the lifecycle projection; written through the same single refresh trigger as the
  relations files, plus wait batches that change a wait value or a seen mark, and the attention change for a look.
- `src/main/agent-status.ts`: the context percentage is read from the payload the injected statusLine already writes
  (the status bar's source); nothing new is injected.
- `src/main/handoff-outbox.ts`: the file's location beside `schedules.json` / `commands.json`.
- `src/main/handoff-intro.ts`: one sentence; `handoff-intro.test.ts` budget.
- `src/main/index.ts`, `src/main/ipc/terminal.ts`, `src/main/ipc/wait.ts` (`noteWaitBatch` returns whether the seen mark changed): wiring the refresh (the relations trigger, wait batches that change a wait value or seen mark, and the attention change for a look).
- Tests: unit tests for the builder and the intro; `probe:intake` handoff section; `scripts/scenario-coverage.test.mjs`.
- Docs: `docs/lessons/handoff.md`, CLAUDE.md's handoff paragraph, the website's handoff docs in both languages.
- No new dependency, no network surface, no change to the remote protocol.
