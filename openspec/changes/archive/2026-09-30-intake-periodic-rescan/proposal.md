## Why

Both file drop points — the shared intake inbox and the per-session handoff outboxes — read their
contents in exactly two ways: one scan when the app starts, and a file watcher after that
(`IntakeSource.start()`). **Nothing ever reads a drop point again after startup.**

So as soon as the watcher misses a directory, every delivery into it disappears until the app is
restarted, and neither side is told. This has happened in dogfood (issue #48): a handoff was written
correctly into a session's outbox, parsed fine, named a valid target — and was never read. The
inotify watch list showed that session's outbox was the only one not being watched. A restart picked
it up at once.

The cause of that particular miss was never pinned down (the three product-logic hypotheses were all
disproved by minimal reproductions; the likeliest trigger was a polluted dev environment). That is
the point: a watcher can miss a directory for reasons we cannot enumerate — a broken stdout, inotify
exhaustion, a network filesystem, something not yet seen. The Slack source already went through the
same family of problem and settled on "backfill is the backbone, real-time is the accelerator",
with three triggers (startup, every five minutes, the moment credentials are saved). The file drop
points only have the first of those.

The existing requirement "落點的偵測不因它被重新準備而失效" says detection SHALL NOT rely on the next
app restart — but it only covers the one failure it was written for (the outbox being re-prepared).
It does not require detection to recover from a watcher that missed a directory for any other
reason.

## What Changes

- **Periodic rescan.** Each `IntakeSource` rescans its drop point every 30 seconds, through the
  same handling path the watcher and the startup scan already use. Both drop points get it — the
  shared inbox and the handoff outboxes — because it is on by default in the one implementation they
  share. (Slack's backfill interval is five minutes because each round spends API quota; a local
  rescan is a few `readdir` calls on normally-empty directories.)
- **The rescan does not repeat what the user already saw.** A delivery stuck in the drop point with
  a visible rejection (inbox full), or one the app could not remove, is not counted or notified again
  every 30 seconds. Files whose re-read has no visible effect (half-written) are simply read again,
  so they are picked up as soon as they become valid.
- **A delivery held back by a full inbox enters it once there is room**, without a restart. The main
  spec already promised this; until now it only happened at the next start.
- **The rescan does not depend on the watcher.** It starts before the watcher is ready and keeps
  running if the startup scan fails — a watcher that never becomes ready is one of the failures this
  change is for.
- ~~Rescan after an outbox is prepared~~ — dropped during design: the outbox is prepared at spawn,
  before the agent has written anything, so that scan would always be empty.
- **Spec:** a new requirement in each of `agent-intake` and `agent-handoff-source` says that a delivery the watcher never
  reported is still processed without an app restart, within a bounded time. The acceptance carrier
  must reproduce "the watcher missed it" directly, and its control group is removing the rescan —
  that assertion must then go red.

Not in this change:

- Finding out why the watcher missed that directory in the first place. The rescan is meant to make
  that question non-load-bearing, not to answer it.
- Changing the watcher itself (depth, polling). Issue #9 (watch-descriptor count) is separate.
- A reply channel from spekterm to the delivering agent (still the documented gap in
  `agent-handoff-source`).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `agent-intake`: a new requirement — a delivery is processed without a restart, within one minute,
  even if the watcher never reported it or never became ready, for every drop point on the shared
  implementation; the periodic re-read does not re-count a visible rejection for an unchanged file,
  except that a delivery held back by a full inbox is retried once there is room; the carrier must
  reproduce a watcher that reports nothing.
- `agent-handoff-source`: a new requirement — the per-session case of the above, for sessions created
  after startup and for restored ones; a rejected handoff that cannot be removed is notified once.

## Impact

- `src/main/intake-source.ts` (interval, the record of handled files, removal errors, in-flight
  waiting, test-only watcher factory and rescan observer), `src/main/intake-service.ts` (`hasRoom()`),
  `src/main/handoff-service.ts` (passes the two test-only options through). `index.ts` does not
  change.
- Unit tests for `IntakeSource` (the missed-watch case is carried there; design D4 explains why no
  probe can carry it), plus rows in `scripts/scenario-coverage.test.mjs`.
- Visible behavior changes, all toward the spec: a delivery held back by a full inbox now enters it
  once there is room; a file the app cannot remove no longer repeats its rejection on every read.
- `docs/lessons/handoff.md` / `docs/lessons/intake.md` gain the trigger list, mirroring the Slack
  one in CLAUDE.md.
