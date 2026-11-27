import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import { HANDOFF_ADAPTER } from './handoff-delivery'
import { RELEASE_SPACING_MS, type HandoffOpener, type WaitingState } from './handoff-opener'
import { testOpener } from './handoff-opener.testkit'
import { configureHandoff, outboxDir, prepareOutbox, resetHandoffState } from './handoff-outbox'
import { HandoffService } from './handoff-service'
import { dismissIntake } from './intake-changes'
import { IntakeService } from './intake-service'
import { IntakeStore } from './intake-store'
import { whenAnnounced } from './handoff-opener'

/**
 * The opener's wait for the agent's service (`handoff-waits-for-network`, design D3–D5). Each test notes the
 * mutation that turns it red where it is a control group.
 */

const MINUTE = 60_000
const SOURCE = '11111111-2222-4333-8444-555555555555'

const bases: string[] = []
after(() => {
  for (const base of bases) fs.rmSync(base, { recursive: true, force: true })
})

/** A reachability check answered by the test: each call waits for `answer()`. */
function gate() {
  const waiting: ((value: boolean | null) => void)[] = []
  return {
    calls: 0,
    reachable(): Promise<boolean | null> {
      this.calls += 1
      return new Promise((resolve) => waiting.push(resolve))
    },
    /** Answers the oldest pending check. */
    answer(value: boolean | null): void {
      const next = waiting.shift()
      assert.ok(next, 'no check is pending')
      next(value)
    },
    pending: () => waiting.length,
  }
}

interface World {
  store: IntakeStore
  opener: HandoffOpener
  opened: string[]
  arrivals: string[]
  changes: { count: number }
  clock: { now: number }
  window: { receives: boolean }
  check: ReturnType<typeof gate>
  timers: { ms: number; fn: () => void }[]
  /** Bodies whose opening request throws (the window side failing). */
  failing: Set<string>
  /** Records due `minutesAgo` minutes before `clock.now` (oldest first by the order given). */
  schedule: (body: string, minutesAhead: number) => Promise<string>
  deliverNow: (body: string) => Promise<string>
  bodyOf: (id: string) => string | undefined
  /** Runs the scheduled release timers whose time has come, after moving the clock. */
  runTimers: () => void
}

/**
 * The clock starts at the real time (the handoff service reads the real clock for `at`), and moves by hand. The opener
 * is built with `#atStart` already used up by a first look with nothing due, unless `atStart` is asked for.
 */
async function world(options: { atStart?: boolean; reachable?: boolean } = {}): Promise<World> {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-opener-'))
  bases.push(base)
  resetHandoffState()
  configureHandoff(base)
  const archive = path.join(base, 'intake')
  fs.mkdirSync(archive, { recursive: true })
  const store = new IntakeStore(path.join(base, 'intake.json'))
  const service = new IntakeService({ store, archiveRoot: archive })
  const opened: string[] = []
  const arrivals: string[] = []
  const changes = { count: 0 }
  const clock = { now: Date.now() }
  const window = { receives: true }
  const check = gate()
  const timers: { ms: number; fn: () => void; at: number }[] = []
  const folders = [{ id: 'f2', name: 'beta', path: '/repos/beta' }]
  service.onArrival(whenAnnounced((record) => arrivals.push(record.id)))
  const failing = new Set<string>()
  const opener = testOpener(service, () => folders, (_a, id) => {
    if (failing.has(store.get(HANDOFF_ADAPTER, id)?.content?.authored.body ?? '')) throw new Error('the window refused')
    opened.push(id)
  }, {
    canReceive: () => window.receives,
    now: () => clock.now,
    changed: () => (changes.count += 1),
    ...(options.reachable === false ? {} : { reachable: () => check.reachable() }),
    schedule: (ms, fn) => timers.push({ ms, fn, at: clock.now + ms }),
  })
  // Start: a first look with nothing due ends the start's backlog, unless the test is about it.
  if (!options.atStart) opener.tick()
  const handoff = new HandoffService({
    service,
    sourceOf: () => ({ folderId: 'f1', label: 'alpha' }),
    candidates: () => folders,
    agentEventsEnabled: () => true,
    onDelivered: () => opener.tick(),
  })
  let n = 0
  const write = async (payload: Record<string, unknown>): Promise<string> => {
    prepareOutbox(SOURCE)
    const target = path.join(outboxDir(SOURCE), `h${(n += 1)}.json`)
    fs.writeFileSync(target, JSON.stringify(payload))
    const outcome = await handoff.deliverFile(fs.readFileSync(target, 'utf8'), target)
    assert.ok(outcome.ok && outcome.record, `refused: ${outcome.ok ? '' : outcome.code}`)
    return outcome.record.id
  }
  return {
    store,
    opener,
    opened,
    arrivals,
    changes,
    clock,
    window,
    check,
    timers,
    failing,
    schedule: (body, minutesAhead) =>
      write({ target: 'beta', title: body, body, at: new Date(clock.now + minutesAhead * MINUTE).toISOString() }),
    deliverNow: (body) => write({ target: 'beta', title: body, body }),
    bodyOf: (id) => store.get(HANDOFF_ADAPTER, id)?.content?.authored.body,
    runTimers: () => {
      for (const timer of timers.splice(0)) {
        if (timer.at <= clock.now) timer.fn()
        else timers.push(timer)
      }
    },
  }
}

/** Three scheduled handoffs, a, b, c (oldest first), all due now. */
async function threeDue(w: World): Promise<void> {
  await w.schedule('a', 1)
  await w.schedule('b', 2)
  await w.schedule('c', 3)
  w.clock.now += 4 * MINUTE
}

async function look(w: World, answer: boolean | null): Promise<void> {
  w.opener.tick()
  if (w.check.pending() > 0) w.check.answer(answer)
  await w.opener.settled()
}

const state = (w: World): WaitingState | undefined => w.opener.waitingState()

describe('the hold (handoff-waits-for-network, D3)', () => {
  it('unreachable: nothing opens, firedAt stays unset, the state is held since the check', async () => {
    const w = await world()
    await w.schedule('a', 1)
    w.clock.now += 2 * MINUTE
    const since = w.clock.now
    await look(w, false)
    assert.deepEqual(w.opened, [])
    assert.equal(w.store.list()[0].firedAt, undefined)
    assert.deepEqual(state(w), { kind: 'held', since })
    assert.deepEqual(w.arrivals, [], 'no notification while held')
  })

  it('then reachable: it opens and the line goes', async () => {
    const w = await world()
    const id = await w.schedule('a', 1)
    w.clock.now += 2 * MINUTE
    await look(w, false)
    w.clock.now += MINUTE
    await look(w, true)
    assert.deepEqual(w.opened, [id])
    assert.equal(state(w), undefined)
    assert.deepEqual(w.arrivals, [id], 'a scheduled handoff is announced when it opens')
  })

  it('nothing due: no check is made (control: check before reading the due list)', async () => {
    const w = await world()
    await w.schedule('later', 60)
    for (let i = 0; i < 5; i += 1) {
      w.clock.now += MINUTE
      w.opener.tick()
    }
    assert.equal(w.check.calls, 0)
  })

  it('two looks during one check make one request', async () => {
    const w = await world()
    await w.schedule('a', 1)
    w.clock.now += 2 * MINUTE
    w.opener.tick()
    w.opener.tick()
    w.opener.tick()
    assert.equal(w.check.calls, 1)
    w.check.answer(true)
    await w.opener.settled()
    assert.equal(w.opened.length, 1)
  })

  it('a record cancelled, or accepted, while the check runs is not opened (control: fire the list read before the check)', async () => {
    const w = await world()
    const a = await w.schedule('a', 1)
    const b = await w.schedule('b', 1)
    w.clock.now += 2 * MINUTE
    w.opener.tick()
    dismissIntake(w.store, HANDOFF_ADAPTER, a)
    // The user's accept marks the record fired when it issues the ticket.
    w.store.markFired(HANDOFF_ADAPTER, b, w.clock.now)
    w.check.answer(true)
    await w.opener.settled()
    assert.deepEqual(w.opened, [])
  })

  it('no window after the check: nothing opens', async () => {
    const w = await world()
    await w.schedule('a', 1)
    w.clock.now += 2 * MINUTE
    w.opener.tick()
    w.window.receives = false
    w.check.answer(true)
    await w.opener.settled()
    assert.deepEqual(w.opened, [])
  })

  it('an answer to a check sent before a sleep decides nothing (control: drop the generation)', async () => {
    const w = await world()
    await w.schedule('a', 1)
    w.clock.now += 2 * MINUTE
    w.opener.tick()
    w.opener.resumed()
    assert.equal(w.check.calls, 2, 'the wake makes a new check')
    w.check.answer(true) // the old one, answered after the wake
    await Promise.resolve()
    await Promise.resolve()
    assert.deepEqual(w.opened, [])
    w.check.answer(false)
    await w.opener.settled()
    assert.deepEqual(w.opened, [])
    assert.equal(state(w)?.kind, 'held')
  })

  it('null (no check applies) opens; a rejecting check is held, not thrown', async () => {
    const w = await world()
    await w.schedule('a', 1)
    w.clock.now += 2 * MINUTE
    await look(w, null)
    assert.equal(w.opened.length, 1)

    const v = await world()
    await v.schedule('a', 1)
    v.clock.now += 2 * MINUTE
    const opener = testOpener(
      { store: v.store } as never,
      () => [],
      () => {},
      { reachable: () => Promise.reject(new Error('boom')), now: () => v.clock.now },
    )
    opener.tick()
    opener.tick() // the start look
    await opener.settled()
    assert.equal(opener.waitingState()?.kind, 'held')
  })

  it('changed() once on entering the hold, not at every failing look', async () => {
    const w = await world()
    await w.schedule('a', 1)
    w.clock.now += 2 * MINUTE
    const before = w.changes.count
    for (let i = 0; i < 4; i += 1) {
      await look(w, false)
      w.clock.now += 30_000
    }
    assert.equal(w.changes.count - before, 1)
  })

  it('Run now does not wait for the check', async () => {
    const w = await world()
    const id = await w.schedule('tomorrow', 24 * 60)
    assert.equal(w.opener.runNow(HANDOFF_ADAPTER, id), true)
    assert.deepEqual(w.opened, [id])
    assert.equal(w.check.calls, 0)
  })

  it('an unscheduled handoff held is announced on arrival and not again when it opens', async () => {
    const w = await world()
    w.clock.now += MINUTE
    const id = await w.deliverNow('now')
    w.check.answer(false)
    await w.opener.settled()
    assert.deepEqual(w.opened, [])
    assert.deepEqual(w.arrivals, [id])
    await look(w, true)
    assert.deepEqual(w.opened, [id])
    assert.deepEqual(w.arrivals, [id])
  })
})

describe('the release (D4)', () => {
  it('after a hold the backlog opens one at a time, at the scheduled look (control: release one per look)', async () => {
    const w = await world()
    await threeDue(w)
    await look(w, false)
    await look(w, true)
    assert.deepEqual(w.opened.map(w.bodyOf), ['a'])
    assert.deepEqual(state(w), { kind: 'releasing', remaining: 2 })
    assert.equal(w.timers.length, 1)
    assert.equal(w.timers[0].ms, RELEASE_SPACING_MS)
    // Extra looks before the spacing has passed release nothing.
    w.clock.now += 5_000
    await look(w, true)
    await look(w, true)
    assert.deepEqual(w.opened.map(w.bodyOf), ['a'])
    w.clock.now += RELEASE_SPACING_MS - 5_000
    w.runTimers()
    w.check.answer(true)
    await w.opener.settled()
    assert.deepEqual(w.opened.map(w.bodyOf), ['a', 'b'])
    w.clock.now += RELEASE_SPACING_MS
    w.runTimers()
    w.check.answer(true)
    await w.opener.settled()
    assert.deepEqual(w.opened.map(w.bodyOf), ['a', 'b', 'c'])
    assert.equal(state(w), undefined)
  })

  it('a handoff arriving during the release opens at once (control: queue it behind the backlog)', async () => {
    const w = await world()
    await threeDue(w)
    await look(w, false)
    await look(w, true)
    const late = await w.deliverNow('late')
    w.check.answer(true)
    await w.opener.settled()
    assert.deepEqual(w.opened.map(w.bodyOf), ['a', 'late'])
    assert.ok(w.opened.includes(late))
  })

  it('a failed check during the release holds the rest, which keep their order', async () => {
    const w = await world()
    await threeDue(w)
    await look(w, false)
    await look(w, true)
    w.clock.now += RELEASE_SPACING_MS
    await look(w, false)
    assert.equal(state(w)?.kind, 'held')
    w.clock.now += MINUTE
    await look(w, true)
    w.clock.now += RELEASE_SPACING_MS
    await look(w, true)
    assert.deepEqual(w.opened.map(w.bodyOf), ['a', 'b', 'c'])
  })

  it('a backlog record dismissed leaves the count at once, without a fire', async () => {
    const w = await world()
    await threeDue(w)
    await look(w, false)
    await look(w, true)
    const b = w.store.list().find((r) => r.content?.authored.body === 'b')!
    dismissIntake(w.store, HANDOFF_ADAPTER, b.id)
    assert.deepEqual(state(w), { kind: 'releasing', remaining: 1 })
  })

  it('a release whose opening fails does not stop the rest', async () => {
    const w = await world()
    await threeDue(w)
    await look(w, false)
    w.failing.add('a')
    await look(w, true)
    assert.notEqual(w.store.list().find((r) => r.content?.authored.body === 'a')?.firedAt, undefined, 'a was attempted')
    w.clock.now += RELEASE_SPACING_MS
    await look(w, true)
    assert.deepEqual(w.opened.map(w.bodyOf), ['b'])
  })

  it('turning the check off during a hold opens everything at once (control: treat null as a successful check)', async () => {
    const w = await world()
    await threeDue(w)
    await look(w, false)
    await look(w, null)
    assert.deepEqual(w.opened.map(w.bodyOf), ['a', 'b', 'c'])
    assert.equal(state(w), undefined)
  })

  it('without a hold, several due open together', async () => {
    const w = await world()
    await threeDue(w)
    await look(w, true)
    assert.deepEqual(w.opened.map(w.bodyOf), ['a', 'b', 'c'])
  })
})

describe('the start (D4)', () => {
  it('what is due at the first look after start opens one at a time, checked or not (control: fire it together)', async () => {
    for (const answer of [true, null]) {
      const w = await world({ atStart: true })
      w.window.receives = false
      await threeDue(w)
      w.window.receives = true
      await look(w, answer)
      assert.deepEqual(w.opened.map(w.bodyOf), ['a'], String(answer))
      w.clock.now += RELEASE_SPACING_MS
      await look(w, answer)
      w.clock.now += RELEASE_SPACING_MS
      await look(w, answer)
      assert.deepEqual(w.opened.map(w.bodyOf), ['a', 'b', 'c'], String(answer))
    }
  })

  it('a handoff after a start look that found nothing due opens at once', async () => {
    const w = await world({ atStart: true })
    w.opener.tick()
    await threeDue(w)
    await look(w, true)
    assert.deepEqual(w.opened.map(w.bodyOf), ['a', 'b', 'c'])
  })

  it('no reachable dependency: no gate, no release, as before', async () => {
    const w = await world({ atStart: true, reachable: false })
    w.window.receives = false
    await threeDue(w)
    w.window.receives = true
    w.opener.tick()
    assert.deepEqual(w.opened.map(w.bodyOf), ['a', 'b', 'c'])
  })
})
