## 1. Test seams

- [x] 1.1 `src/main/intake-source.ts`: add constructor options for a watcher factory (default `createWatcher`), an `onRescan(phase: 'start' | 'end')` observer, and the rescan interval (default 30 000 ms; must be finite and in `(0, 60 000]`, else the constructor throws). No behavior change yet. `HandoffServiceDeps` passes the watcher factory and `onRescan` through to its `IntakeSource` — **not the interval** (design D5)
- [x] 1.2 `src/main/intake-service.ts`: `hasRoom()` — true when the pending count is below the limit
- [x] 1.3 Test helpers in `src/main/intake-source.test.ts` (and reused by `handoff-service.test.ts`): a silent watcher factory whose watcher emits `ready` **asynchronously** and nothing else; a variant that never emits `ready`; a helper that advances mocked `setInterval` by 60 000 ms and waits for the next `onRescan('end')`

## 2. Tests first (red before 3 unless stated)

Each test enables mocked `setInterval` only, **before** `start()`, uses the default interval, and names itself after its scenario. Assertions that something did **not** happen are made only after the tick's `onRescan('end')`.

- [x] 2.1 `A delivery the watcher never reported is processed without a restart` — silent watcher, start, drop a valid intake, tick ⇒ pending in the store
- [x] 2.2 `The re-read runs even if the watcher never becomes ready` — never-ready watcher, `start()` not awaited, drop a valid intake, tick ⇒ pending
- [x] 2.3 `A delivery stuck on a full inbox is not counted again` — `maxPending` reached, drop a valid intake **before** `start()` (the startup scan handles it once) ⇒ one `CAPACITY` trace, count 1; tick three times, waiting for `end` each time ⇒ still count 1, file still present. Expected **green** before 3 (nothing re-reads yet); its power comes from the mutation in 3.6
- [x] 2.4 `A delivery stuck on a full inbox enters it once there is room` — as 2.3 with the silent watcher, then resolve one pending item, tick ⇒ the held-back intake is pending
- [x] 2.5 `A half-written delivery completed later is picked up` — silent watcher, drop unparseable JSON, tick (nothing in the store, file kept); rewrite it with a valid intake, tick ⇒ pending
- [x] 2.6 In `src/main/handoff-service.test.ts`, through `HandoffService.start()` with the silent watcher (auto-accept requested for the target folder stands for "a session is created", as in the existing tests):
  - `A handoff the watcher never reported creates its session` — outbox prepared **after** `start()`
  - `A restored session's handoff the watcher never reported creates its session` — outbox prepared **before** `start()`, handoff written after
  - ~~`A handoff written while the capability was off is delivered after turning it on`~~ — written and run, then removed with its scenario: the handoff switch is not in the UI and is being removed as its own change (the capability is core)
  - `A rejected handoff that cannot be removed is notified once` — write a handoff with an unknown target, `chmod 0555` the outbox (restored in `finally`), start, tick three times ⇒ one failure report (the path that becomes the OS notification) and a trace count of 1; `start()` resolves
- [x] 2.7 Unit tests without a scenario: the constructor rejects intervals `0`, `Infinity`, `NaN`, and `60 001`; after `dispose()`, a tick calls no `onRescan('start')` (checked synchronously); `scan()` meeting a file that a rescan is handling waits for it — a `deliver` that blocks on a gate keeps `scan()` pending until the gate opens, and the file is handled once (design D4)
- [x] 2.8 Run 2.1–2.7 against the unchanged implementation and record which are red and why (2.3 is expected green)
  - Ran (2026-09-30): all eleven red. Ten time out with "no periodic re-read started" (nothing re-reads yet). The cannot-remove test fails because `start()` rejects with `EACCES` from the unwrapped `rm` — the defect the review found. **2.3 is red too, not green as expected above**: it waits for a re-read to finish before asserting, and none ever starts; its discriminating power still comes from the 3.6 mutation

## 3. Implementation

- [x] 3.1 `start()`: create the watcher, start the `unref`'d interval, then await `ready` and run the startup scan. Each tick: skip if a rescan is running, otherwise rescan, reporting `onRescan('start')` / `('end')`, catching and logging errors. `dispose()` clears the interval before closing the watcher (design D1)
- [x] 3.2 `readBounded` returns the `stat` it took; `#handle` records `(mtimeMs, size)` from it when the file is still present afterwards and the outcome was visible without consuming, or `deliver` threw, or removal failed; it removes the entry when the file is consumed. `rm` is wrapped: a failure is logged, not thrown (design D3)
- [x] 3.3 Rescan: skip a recorded file whose `(mtimeMs, size)` is unchanged, unless it was recorded for `CAPACITY` and `service.hasRoom()` is true; hand every other file to `#handle`. Prune entries for missing paths only under directories whose `readdir` succeeded. The startup scan, `endSession`'s scan and watcher events do not consult the record
- [x] 3.4 `#inflight` becomes a map of path → promise; `scan()` awaits an in-flight file instead of skipping it; the rescan still skips it (design D4)
- [x] 3.5 Header comment of `intake-source.ts`: the third entry point and why it starts before `ready`, what gets recorded and why, and why "scan after preparing an outbox" was rejected
- [x] 3.6 Confirm 2.1–2.7 pass, then run the control groups, restoring after each, and record the results under this task:
  - interval never started ⇒ 2.1, 2.2, 2.4, 2.5 and the first three of 2.6 red
  - interval started after awaiting `ready` ⇒ 2.2 red
  - default interval set to 300 000 ⇒ 2.1 and the first 2.6 test red
  - nothing recorded ⇒ 2.3 and the last 2.6 test red
  - `CAPACITY` entries skipped even when there is room ⇒ 2.4 red
  - every non-consuming outcome recorded ⇒ the "capability off" 2.6 test red (**that test was removed afterwards with its scenario**; this mutation no longer has a red carrier — with the switch gone, recording an unparseable file only matters for a same-size rewrite within one millisecond)
  - `dispose()` not clearing the interval ⇒ the `dispose()` test in 2.7 red
  - `scan()` skipping in-flight files again ⇒ the in-flight test in 2.7 red
  - Ran (2026-09-30), each as planned. Two extras: "interval never started" also turns 2.3, the cannot-remove test, the `dispose()` test and the in-flight test red (they wait on a re-read that never comes); the 300 s default also turns every other re-read test red, and the validation test (the mutation had to raise the bound to accept it). **The first run of the 300 s mutation stayed green**: `rescanOnce` ticked "until a re-read started" with no budget, so five one-minute ticks passed. It now advances at most 60 000 ms of mocked time per call, in 1 000 ms steps — the budget is what makes the tests carry the spec's bound

## 4. Coverage table and docs

- [x] 4.1 `scripts/scenario-coverage.test.mjs`: add `intake-periodic-rescan` to `COVERED_CHANGES` and one row per new scenario with carrier, `greenIfAbsent`, and the mutation from 3.6; note on each that the missed-watch case has no probe carrier (design D5), and on the shared-inbox rows that `index.ts` gets the rescan by default (design D1)
- [x] 4.2 In the same table, the existing row for `暫時性拒絕於上限解除後被重新處理`: point its carrier at 2.4 and correct its note — until this change it was carried by a test that calls `scan()` by hand, while production only retried at the next start
- [x] 4.3 `docs/lessons/handoff.md`, in English: the dogfood case, why the fix is a rescan rather than a watcher fix, why 30 s and not five minutes, why it starts before `ready`, why a scan right after preparing an outbox finds nothing
- [x] 4.4 `docs/lessons/intake.md`, in English: the three entry points (startup scan, watcher, rescan), the recording rule and the two reasons behind it (visible re-reads; in-process retry after a failed save meeting its own half-applied first attempt), and the `CAPACITY` exception
- [x] 4.5 `CLAUDE.md`, the handoff paragraph under "現況", one sentence in English: the drop points are read at startup, on watcher events, and every 30 seconds, mirroring the Slack sentence

## 5. Verification

- [x] 5.1 `npm test`, `npm run typecheck`, `npm run lint` all green
- [x] 5.2 `npm run probe:intake` green (the normal-path handoff and shared-inbox sections go through the changed `IntakeSource`)
  - Ran (2026-09-30): first full run 179/183 — four checks in `runOpenedLifecycle` red. That section alone passed twice (13/13). Second full run with this change: 183/183. A full run with `intake-source.ts` put back to `HEAD`: 178/183, the same section red plus its own precondition — so the section is intermittent without this change, not caused by it
