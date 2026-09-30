## Context

`IntakeSource` (`src/main/intake-source.ts`) is the one implementation behind both file drop
points: the shared inbox (`depth: 0`, built in `src/main/index.ts`) and the handoff outboxes
(`depth: 1`, one directory per session, built in `HandoffService.start()`). It reads its drop point
in two ways: `start()` scans once after the watcher reports `ready`, and the watcher's `add` /
`change` events handle everything after that. `scan()` is also called from
`HandoffService.endSession()` before a session's outbox is cleared. Nothing else reads a drop point.

Every read goes through `#handle(file)`. What happens to the file, by outcome:

| Outcome | File afterwards | Visible to the user when it happens |
|---|---|---|
| accepted | removed | arrival (and, for handoffs, the session) |
| duplicate, same content | removed | nothing |
| permanent rejection (bad field, invalid id, too large, prefill impossible, …) | removed | a rejection trace; on the handoff path also an OS notification |
| completion report (adopted, rejected, or dropped) | removed | per report rules |
| not under a session directory | removed | nothing |
| unparseable JSON (may be half-written) | **left** | nothing |
| handoff feature turned off | **left** | nothing |
| inbox full (`CAPACITY`) | **left** | a rejection trace |
| file vanished before reading (`readBounded` → `null`) | — | nothing |
| `deliver` threw (e.g. the archive could not be written) | **left** | a log line |
| removal failed after a consuming outcome (`rm` threw) | **left** | whatever the outcome showed |

A rejection trace with the same key and code is merged, and its count is shown as "repeated N
times" (`IntakeOverlay.tsx`).

Facts that shape the design:

- **Re-reading a left-behind file is free for some rows and not for others.** Unparseable and
  turned-off files produce nothing when read again. A `CAPACITY` file adds 1 to its trace's count
  each time. A file whose removal failed repeats its whole outcome each time — for a permanent
  rejection on the handoff path, that is another OS notification.
- **The main spec already promises the `CAPACITY` retry.** `agent-intake` says a temporary
  rejection "SHALL 於上限解除後被重新處理", with the scenario "使用者處理掉數則待處理項之後，該投遞進入
  收件匣". In production nothing re-reads the drop point after startup, so today that only happens
  at the next start; the unit test that carries it calls `scan()` by hand. The rescan is what can
  make that promise true within one run.
- **Retrying after `deliver` threw is not safe within one run.** `IntakeStore` updates memory before
  it saves, and completion-report adoption records the delivery before its effects. A retry in the
  same process can then meet its own half-applied first attempt and be taken for a same-content
  duplicate — consumed silently, never arriving. Today the retry happens at the next start, with
  clean memory.
- **A rescan right after an outbox is prepared finds nothing.** `prepareOutbox` runs at spawn,
  before the agent exists; the agent writes a handoff seconds to hours later. The "scan after
  preparation" idea from issue #48 is dropped.
- **Nothing in production disposes a source.** `index.ts` never calls `dispose()` on the shared
  inbox source or `HandoffService`; the process exit ends everything. So there is no "stops at
  shutdown" behavior to specify — only a `dispose()` that tests call.

## Goals / Non-Goals

**Goals:**

- A delivery the watcher never reported is processed without an app restart, within one minute, for
  both drop points.
- The periodic re-read does not repeat anything the user already saw: no extra trace counts, no
  extra notifications for files unchanged since they were handled.
- A delivery held back by a full inbox enters it once there is room, without a restart — the main
  spec's existing promise.
- It is impossible to build an `IntakeSource` that does not rescan.

**Non-Goals:**

- Why the watcher missed a directory in the dogfood case. The rescan is meant to make that question
  non-load-bearing.
- The watcher itself (depth, polling, descriptor count — issue #9).
- Making the store and report adoption idempotent under a failed save. The rescan avoids depending
  on it (D3); making them idempotent is a separate change.

## Decisions

### D1. The rescan lives in `IntakeSource`, starts before anything that can fail, and is on by default

`start()` creates the watcher, **then starts the interval**, then awaits `ready` and runs the startup
scan. The interval therefore runs even if the watcher never reports `ready` or the startup scan
throws — both are among the failures this change exists for. Rescanning before `ready` is additive:
the startup scan and the rescan may see the same file, and deduplication plus `#inflight` absorb it,
exactly as they already absorb the startup-scan / watcher overlap. The header's "wait for `ready`
before scanning" argument is about the startup scan, which still waits.

The interval is a default of `IntakeSource`, so both drop points get it without either caller asking.
Each tick catches and logs its own errors (a rejected tick must not become an unhandled rejection),
and a tick that fires while the previous rescan is still running is skipped. The timer is
`unref`'d. `dispose()` clears it; production never calls `dispose()` (see Context), and the process
exit ends the timer.

The interval is a constructor option only so tests can check its validation: it must be a finite
number in `(0, 60 000]` (Node treats `0` and `Infinity` as 1 ms — a busy loop). Tests run with the
default.

### D2. Interval: 30 seconds

The Slack backfill runs every five minutes because each round spends Slack API quota. A local
rescan costs one `readdir` of the drop point, plus one per session directory on the handoff path,
plus a `stat` per file found. The drop points are normally empty because consumed files are deleted
(measured on this machine: 20 outbox directories, 0 files; shared inbox, 0 files). That cost does
not justify making a missed handoff wait five minutes while the user is looking at the source
session.

Alternatives considered:

- **5 minutes (as Slack).** The reason behind Slack's interval does not apply here.
- **Rescan a session's outbox when its agent finishes a turn** (the `Stop` hook event). Near-zero
  latency, but wait state is only polled for sessions somebody subscribes to (`agent-wait.ts`), and
  subscribing every session means a 400 ms `readdir` timer per session. It can be added on top of D1
  if 30 s proves too slow.

### D3. The rescan skips only files whose re-read would repeat something

`IntakeSource` keeps a record, per path, of the `(mtimeMs, size)` the file had **when it was read**
(the `stat` that `readBounded` already does, returned to the caller rather than re-taken afterwards
— a second `stat` could record a newer version that was never handled). A file is recorded when,
after handling, it is still on disk and one of these holds:

- the outcome was **visible** (`notify: true` without consuming — today only `CAPACITY`);
- `deliver` **threw** (retrying in-process is not safe, see Context);
- the outcome was consuming but **removal failed**.

Unparseable and turned-off files are **not** recorded: re-reading them is free. (The turned-off row
goes away with the handoff switch itself, which is being removed separately — the capability is
core and not meant to be turned off; the switch was never in the UI.)

A rescan skips a recorded file whose current `(mtimeMs, size)` matches — **except `CAPACITY`
entries while the inbox has room** (`IntakeService.hasRoom()`, true when pending is below the
limit). Those are handed to `#handle` again, which is the retry the main spec promises. If several
were waiting for one free slot, the ones that do not fit are rejected again and their traces count
once more; that is bounded by the number of times room frees up, not by the clock.

Entries are removed when the file is consumed. Pruning of entries for paths no longer present only
happens for directories whose `readdir` succeeded — a transient `readdir` error (`EMFILE`) returns
an empty list, and treating that as "everything is gone" would clear the record.

Only the periodic rescan consults the record. The startup scan, `endSession`'s scan, and watcher
events handle every file they see, as today. The requirement is worded for the periodic re-read for
that reason.

`#handle` also stops letting a removal error escape: `rm` is wrapped, the failure logged, and the
file recorded as above. Today an `rm` failure rejects `start()`, which — with the interval started
first (D1) — would no longer stop the rescan, but would still be an unhandled failure path.

Alternatives considered:

- **Record every non-consuming outcome** (the first draft). It blocks the `CAPACITY` retry the spec
  promises.
- **Re-read everything and make the service not count repeats.** Changes `count`, which other paths
  rely on, and repeats notifications for failed removals.
- **Track by path only.** A rewrite in place would never be retried if the watcher also missed its
  `change` event.

### D4. `scan()` waits for a file already in flight

`#inflight` becomes a map from path to the in-flight promise. When `scan()` (startup, `endSession`)
meets a file that is being handled, it awaits that handling instead of skipping it. Without this,
`endSession` can skip a file the rescan is handling and then `clearOutbox` deletes the directory
under it — a handoff lost with the watcher silent, which is exactly the case where the rescan is the
only reader. A rescan tick meeting an in-flight file still skips it (the owner will finish it).

### D5. Tests reach "the watcher missed it" by injecting the watcher, and wait on the rescan itself

`IntakeSource` takes an optional watcher factory (default `createWatcher` from `watcher.ts`) and an
optional `onRescan(phase: 'start' | 'end')` observer, both for tests. `HandoffServiceDeps` passes
these two through — **not the interval**, so the handoff tests exercise the same default production
uses.

- The silent watcher emits `ready` **asynchronously** (after `start()` has registered its listener)
  and nothing else.
- Tests enable mocked `setInterval` before `start()` (an interval created before `enable` is a real
  timer), and advance it by **60 000 ms** — the spec's upper bound — so a default drifting past a
  minute turns them red.
- `tick()` runs the interval callback synchronously, but the rescan is asynchronous. So a test that
  asserts something **did not** happen first waits for `onRescan('end')` of that tick; a test that
  asserts no rescan ran at all (after `dispose()`) checks synchronously that `onRescan('start')` was
  not called. Consecutive ticks are separated by waiting for `end`, or the running-rescan skip (D1)
  swallows them.

This does not touch the single-entry rule for watchers: `scripts/watcher-source.test.mjs` guards
chokidar imports, re-exports, and `followSymlinks`, not who calls `createWatcher`.

**No probe carries the missed-watch case.** Making the real app's watcher miss a directory needs
either a test-only switch in product code or a machine-level condition (exhausting inotify watches)
that needs root. The probe sections for handoff and the shared inbox keep verifying the normal path;
the coverage table records the missed-watch rows as unit-carried, with the reason.

## Risks / Trade-offs

- **[A 30 s tick in the main process for the life of the app]** → a few `readdir` calls on
  normally-empty directories; `unref`'d.
- **[A rewrite with identical size in the same millisecond looks unchanged]** → it only matters for
  recorded files; the watcher's `change` event still handles it.
- **[A `deliver` that threw is retried only at the next start or when the file changes]** → today's
  behavior, kept on purpose (Context, D3).
- **[Several `CAPACITY` files competing for one free slot re-count their traces]** → bounded by how
  often room frees up.
- **[The missed-watch case is only unit-tested]** → the tests drive the real `IntakeSource` and the
  real `HandoffService.start()` with only the watcher replaced and the default interval; what they
  cannot see is the shared inbox's construction in `index.ts`, which D1 makes irrelevant by putting
  the rescan in the default.
