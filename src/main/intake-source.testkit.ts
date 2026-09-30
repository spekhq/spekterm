import { EventEmitter } from 'node:events'
import type { TestContext } from 'node:test'
import type { FSWatcher } from 'chokidar'

import type { WatcherFactory } from './intake-source'

/**
 * Stand-ins for the drop point's watcher, and a clock helper for the periodic re-read.
 *
 * The case these exist for is a watcher that **reports nothing** — the state the dogfood outbox was
 * in (issue #48). A real chokidar watcher cannot be made to miss a directory from a test, so the
 * watcher is replaced; everything else in `IntakeSource` is the real code.
 */

/**
 * A watcher that reports `ready` and nothing else.
 *
 * **`ready` is emitted asynchronously**: `IntakeSource.start()` registers its `ready` listener only
 * after the factory returns, so emitting it synchronously would leave `start()` waiting forever.
 */
export const silentWatcher: WatcherFactory = () => {
  const emitter = new EventEmitter()
  setImmediate(() => emitter.emit('ready'))
  return Object.assign(emitter, { close: async () => {} }) as unknown as FSWatcher
}

/** A watcher that never becomes ready and reports nothing. */
export const neverReadyWatcher: WatcherFactory = () => {
  const emitter = new EventEmitter()
  return Object.assign(emitter, { close: async () => {} }) as unknown as FSWatcher
}

/** Counts the periodic re-reads through `onRescan`. */
export interface RescanLog {
  starts: number
  ends: number
  onRescan: (phase: 'start' | 'end') => void
}

export function rescanLog(): RescanLog {
  const log: RescanLog = {
    starts: 0,
    ends: 0,
    onRescan: (phase) => {
      if (phase === 'start') log.starts += 1
      else log.ends += 1
    },
  }
  return log
}

/** The spec's bound on detection: one minute. Tests advance the clock by this, not by the interval. */
export const DETECTION_BOUND_MS = 60_000

/** The clock advances in steps of this size, so the interval can be armed part-way. */
const CLOCK_STEP_MS = 1_000

/**
 * Advance the mocked `setInterval` — **by at most the detection bound in total** — until a re-read
 * has started, then wait (on the real clock) for that re-read to finish.
 *
 * - **At most one minute per call.** Ticking "until something happens" with no budget would let a
 *   default interval of five minutes pass as well (measured: the control group with a 300 s default
 *   stayed green that way). The budget is what makes these tests carry the spec's bound.
 * - **In steps**, with a real-clock pause between them: `start()` does an asynchronous `mkdir`
 *   before it arms the interval (and with a never-ready watcher it is not awaited at all), so the
 *   interval may be armed part-way through.
 * - `tick()` runs the interval callback synchronously, but the re-read is asynchronous — an
 *   assertion that something did **not** happen is only meaningful after `end`.
 *
 * Requires `t.mock.timers.enable({ apis: ['setInterval'] })` **before** `start()`.
 */
export async function rescanOnce(t: TestContext, log: RescanLog, timeoutMs = 4000): Promise<void> {
  const startsBefore = log.starts
  const endsBefore = log.ends
  const deadline = Date.now() + timeoutMs
  for (let advanced = 0; log.starts === startsBefore; advanced += CLOCK_STEP_MS) {
    if (advanced >= DETECTION_BOUND_MS) {
      throw new Error(`no periodic re-read started within ${DETECTION_BOUND_MS} ms of mocked time`)
    }
    t.mock.timers.tick(CLOCK_STEP_MS)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  while (log.ends === endsBefore) {
    if (Date.now() > deadline) throw new Error('timed out: the periodic re-read did not finish')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
