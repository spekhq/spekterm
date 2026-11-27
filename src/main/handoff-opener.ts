import { HANDOFF_ADAPTER } from './handoff-delivery'
import { resolveTarget, type TargetCandidate } from './handoff-target'
import type { IntakeFailure, IntakeService } from './intake-service'
import type { IntakeRecord } from './intake-store'

/**
 * The one owner of every automatic handoff opening (`scheduled-handoff`, design D3).
 *
 * ## Why one owner
 *
 * Opening is a request to a window (`intake:autoAccept`): session creation lives in the renderer. **A request no
 * window receives is lost**, and the handoff then sits in the inbox as if it had been refused — the state a
 * handoff read at startup, before the window listens, used to end in. And a handoff whose prefill timed out goes
 * back to pending: without a persisted "opened once" mark, any rule that opens pending handoffs would reopen it at
 * every start, and announce it again each time. So every opening — on arrival, when a schedule falls due, overdue
 * at start, Run now — goes through `#fire`, which persists `firedAt` before anything else.
 *
 * ## When it looks
 *
 * After each delivery, every 30 s, when a window's restore gate opens, when a window first lists the inbox, on
 * resume from sleep (`resumed()`), and at the next release of a backlog (below). A timer per record is not used:
 * `setTimeout` overflows past 2^31−1 ms (about 24.8 days, inside the scheduling bound) and fires at once, and the due
 * time is judged against the wall clock.
 *
 * ## Waiting for the agent's service (`handoff-waits-for-network`)
 *
 * With `reachable` wired, nothing opens automatically until a check says the agent's service answers (design D3):
 * a computer woken before its Wi-Fi came back, or one offline, would otherwise open sessions whose agents cannot
 * run — and spend each handoff's one automatic opening on them. One check is in flight per wake (`#generation`); an
 * answer to a check sent before a sleep decides nothing. **What is due is read again after every check**: the user
 * may have cancelled, accepted or run one meanwhile.
 *
 * **Backlogs open one at a time** (design D4): what is due at the first look after start, and what is due when the
 * service answers again after a hold, opens oldest first, `RELEASE_SPACING_MS` apart, each after its own check.
 * Anything else due meanwhile opens at once. The next release is scheduled (`schedule`), not left to the 30-second
 * tick, which would stretch the spacing to 30 or 60 s. A release that fails still counts, so one broken record
 * cannot stop the rest. Turning the check off during a hold (`null`) opens everything due at once.
 *
 * Electron-free: `index.ts` wires the window and the timer.
 */

export const OPENER_INTERVAL_MS = 30_000

/** The spacing of a backlog's releases (the user's decision, 2026-11-26). */
export const RELEASE_SPACING_MS = 15_000

/**
 * Why due handoffs have not opened, for the inbox's line (design D5): held for the agent's service, or a backlog
 * being opened one at a time. Desktop only — never on `IntakeView`, which devices receive.
 */
export type WaitingState = { kind: 'held'; since: number } | { kind: 'releasing'; remaining: number }

export interface HandoffOpenerDeps {
  service: Pick<IntakeService, 'store' | 'reject' | 'reportFailure' | 'announceArrival'>
  /** The folders a target resolves against: the same source as the introduction's list. */
  candidates: () => TargetCandidate[]
  agentEventsEnabled: () => boolean
  /** Some window has restored its sessions **and** listens to the inbox (`ipc/intake.ts`, `restore-gate.ts`). */
  canReceive: () => boolean
  /** Ask the window to create the handoff's session (`intake:autoAccept`, which also issues its ticket). */
  requestOpen: (adapter: string, id: string, folderId: string) => void
  /** The inbox changed (`notifyIntakeChanged`). */
  changed: () => void
  /**
   * Keeps each recurrence's upcoming occurrence (`recurring-handoff`, `RecurrenceKeeper`): all of them at the start
   * of every tick — so a repaired occurrence that is already due opens in the same tick — and one after its
   * occurrence fires or is refused.
   */
  keeper?: { ensureAll: () => void; ensureNext: (recurrenceId: string) => void }
  /**
   * Can the agent's service be reached (`handoff-waits-for-network`)? `null`: no check applies (turned off, or a
   * provider whose endpoint is not derived). Absent: no gate at all — every due handoff opens at once, as before.
   */
  reachable?: () => Promise<boolean | null>
  /** Run `fn` after `ms` (a backlog's next release). Absent: the next release waits for the next look. */
  schedule?: (ms: number, fn: () => void) => void
  now?: () => number
}

type Mode = 'open' | 'held' | 'releasing'

export class HandoffOpener {
  readonly #deps: HandoffOpenerDeps
  readonly #now: () => number
  /**
   * The records this run asked a window to open. A ticket is issued only for a handoff with a source, so the
   * recurrence keeper asks this too to tell an opening in progress from one the opener refused. In memory: after a
   * restart a fired, pending occurrence is one the user deals with.
   */
  readonly #requested = new Set<string>()

  #mode: Mode = 'open'
  #heldSince = 0
  /** The keys of a backlog being released one at a time (design D4). */
  #backlog = new Set<string>()
  #lastReleasedAt: number | undefined
  /** The first look after start that can receive has not happened yet: what it finds due is a backlog. */
  #atStart = true
  /** Incremented on wake: a check sent before a sleep decides nothing. */
  #generation = 0
  #checking: { generation: number } | null = null
  #pending: Promise<void> = Promise.resolve()
  #releaseScheduled = false

  constructor(deps: HandoffOpenerDeps) {
    this.#deps = deps
    this.#now = deps.now ?? Date.now
  }

  /** Opens what is due, oldest first, if a window can receive them and the agent's service answers. Never throws. */
  tick(): void {
    this.#deps.keeper?.ensureAll()
    if (!this.#deps.canReceive()) return
    const due = this.#due()
    if (due.length === 0) {
      this.#atStart = false
      this.#setMode('open')
      return
    }
    const reachable = this.#deps.reachable
    if (!reachable) {
      this.#fireAll(due)
      return
    }
    if (this.#checking && this.#checking.generation === this.#generation) return
    this.#startCheck(reachable)
  }

  /** From `powerMonitor`'s `resume`: an answer to a check sent before the sleep is discarded, and a new look made. */
  resumed(): void {
    this.#generation += 1
    this.tick()
  }

  /** Why due handoffs have not opened, computed now (design D5); `undefined` when nothing waits. */
  waitingState(): WaitingState | undefined {
    if (this.#mode === 'open') return undefined
    const due = this.#due()
    if (this.#mode === 'held') return due.length > 0 ? { kind: 'held', since: this.#heldSince } : undefined
    const dueKeys = new Set(due.map(keyOf))
    const remaining = [...this.#backlog].filter((key) => dueKeys.has(key)).length
    return remaining > 0 ? { kind: 'releasing', remaining } : undefined
  }

  /** Tests: resolves once no check is in flight (including the looks a settling check starts). */
  async settled(): Promise<void> {
    let pending: Promise<void>
    do {
      pending = this.#pending
      await pending
    } while (pending !== this.#pending)
  }

  #due(): IntakeRecord[] {
    const now = this.#now()
    return this.#deps.service.store
      .list()
      .filter((record) => isDue(record, now))
      .sort((a, b) => (a.opensAt ?? 0) - (b.opensAt ?? 0))
  }

  #startCheck(reachable: () => Promise<boolean | null>): void {
    const token = { generation: this.#generation }
    this.#checking = token
    this.#pending = (async () => {
      let answer: boolean | null
      try {
        answer = await reachable()
      } catch (error) {
        console.error(`[handoff] the reachability check failed: ${String(error)}`)
        answer = false
      }
      if (this.#checking === token) this.#checking = null
      if (token.generation !== this.#generation) {
        this.tick()
        return
      }
      this.#afterCheck(answer)
    })()
  }

  /** Step 5 of design D3: everything read again, then hold, release or open (D4). */
  #afterCheck(answer: boolean | null): void {
    try {
      this.#deps.keeper?.ensureAll()
      if (!this.#deps.canReceive()) return
      const due = this.#due()
      if (due.length === 0) {
        this.#atStart = false
        this.#setMode('open')
        return
      }
      if (answer === false) {
        this.#atStart = false
        if (this.#mode === 'open') this.#heldSince = this.#now()
        this.#setMode('held')
        return
      }
      if (answer === null && this.#mode === 'held') {
        // The user turned the check off during a hold: everything, now.
        this.#backlog.clear()
        this.#setMode('open')
        this.#fireAll(due)
        return
      }
      if (this.#mode === 'held' || this.#atStart) {
        this.#atStart = false
        this.#backlog = new Set(due.map(keyOf))
        this.#lastReleasedAt = undefined
        this.#setMode('releasing')
      }
      if (this.#mode !== 'releasing') {
        this.#fireAll(due)
        return
      }
      this.#release(due)
    } catch (error) {
      console.error(`[handoff] opening after the reachability check failed: ${String(error)}`)
    }
  }

  /** Design D4: what is outside the backlog at once; the backlog's oldest when its spacing has passed. */
  #release(due: IntakeRecord[]): void {
    const dueKeys = new Set(due.map(keyOf))
    for (const key of [...this.#backlog]) if (!dueKeys.has(key)) this.#backlog.delete(key)
    this.#fireAll(due.filter((record) => !this.#backlog.has(keyOf(record))))

    const now = this.#now()
    const next = due.find((record) => this.#backlog.has(keyOf(record)))
    if (next && (this.#lastReleasedAt === undefined || now - this.#lastReleasedAt >= RELEASE_SPACING_MS)) {
      this.#backlog.delete(keyOf(next))
      this.#lastReleasedAt = now
      this.#fireAll([next])
    }
    if (this.#backlog.size === 0) {
      this.#setMode('open')
      return
    }
    this.#scheduleRelease(Math.max(0, (this.#lastReleasedAt ?? now) + RELEASE_SPACING_MS - now))
  }

  #scheduleRelease(ms: number): void {
    if (!this.#deps.schedule || this.#releaseScheduled) return
    this.#releaseScheduled = true
    this.#deps.schedule(ms, () => {
      this.#releaseScheduled = false
      this.tick()
    })
  }

  /** A change of the state's kind re-lists the inbox; nothing else does (design D5). */
  #setMode(mode: Mode): void {
    // A hold during a release keeps the backlog; only "nothing waits" drops it.
    if (mode === 'open') this.#backlog.clear()
    if (mode === this.#mode) return
    this.#mode = mode
    this.#deps.changed()
  }

  #fireAll(records: IntakeRecord[]): void {
    for (const record of records) {
      try {
        this.#fire(record)
      } catch (error) {
        console.error(`[handoff] opening ${record.id} failed: ${String(error)}`)
      }
      this.#afterFire(record)
    }
  }

  /**
   * The desktop's Run now: opens a scheduled handoff at once, whatever its time. This is its one automatic
   * opening. `false` when the record is not a waiting handoff (already opened, cancelled, unknown).
   */
  runNow(adapter: string, id: string): boolean {
    const record = this.#deps.service.store.get(adapter, id)
    if (!record || record.state !== 'pending' || record.opensAt === undefined || record.firedAt !== undefined) return false
    const fired = this.#fire(record)
    this.#afterFire(record)
    return fired
  }

  /** This run asked a window to open the record (as opposed to refusing it). */
  wasRequested(adapter: string, id: string): boolean {
    return this.#requested.has(`${adapter} ${id}`)
  }

  /** An occurrence fired or was refused: its recurrence's next one, at once (`recurring-handoff`). */
  #afterFire(record: IntakeRecord): void {
    const recurrenceId = record.content?.verified.recurrenceId
    if (recurrenceId !== undefined) this.#deps.keeper?.ensureNext(recurrenceId)
  }

  #fire(record: IntakeRecord): boolean {
    const { service } = this.#deps
    const content = record.content
    // Persisted first: a crash or a failure below cannot make this record open again, in this run or the next.
    if (!content || !service.store.markFired(record.adapter, record.id, this.#now())) return false
    this.#deps.changed()

    const verified = content.verified
    const failure = { target: verified.targetText ?? '', origin: content.authored.originLabel }
    const label = verified.targetText ?? record.id
    // Resolved again from what the agent wrote: a folder removed and added back has a new id.
    const target =
      verified.targetText === undefined
        ? verified.targetFolderId !== undefined && this.#deps.candidates().some((c) => c.id === verified.targetFolderId)
          ? ({ ok: true, folderId: verified.targetFolderId } as const)
          : ({ ok: false, reason: 'NOT_FOUND' } as const)
        : resolveTarget(verified.targetText, this.#deps.candidates())
    if (!target.ok) {
      const code = target.reason === 'AMBIGUOUS' ? 'TARGET_AMBIGUOUS' : 'TARGET_NOT_FOUND'
      const detail = target.reason === 'AMBIGUOUS' ? target.candidates.join(', ') : undefined
      service.reject(code, label, detail, { adapter: record.adapter, ...failure })
      const reported: IntakeFailure = { code, ...(detail === undefined ? {} : { detail }), ...failure, at: this.#now() }
      service.reportFailure(reported)
      return false
    }
    // The non-notifying rejection of "預填不可能發生時不建立 session": agent events are a setting.
    if (!this.#deps.agentEventsEnabled()) {
      service.reject('PREFILL_UNAVAILABLE', label, undefined, { adapter: record.adapter, ...failure })
      return false
    }

    this.#requested.add(`${record.adapter} ${record.id}`)
    this.#deps.requestOpen(record.adapter, record.id, target.folderId)
    // A scheduled handoff is announced now, not when it was scheduled (design D4); an unscheduled one was
    // announced by `deliver` on arrival and is not announced twice.
    if (verified.scheduledAt !== undefined) service.announceArrival(service.store.get(record.adapter, record.id) ?? record)
    return true
  }
}

function keyOf(record: IntakeRecord): string {
  return `${record.adapter} ${record.id}`
}

function isDue(record: IntakeRecord, now: number): boolean {
  return (
    record.adapter === HANDOFF_ADAPTER &&
    record.state === 'pending' &&
    record.opensAt !== undefined &&
    record.opensAt <= now &&
    record.firedAt === undefined &&
    record.content !== null
  )
}

/**
 * "A window can receive" (design D3): **one** window that both lists the inbox and has restored its sessions. Tied
 * to one window because a request goes to the listing windows, and only a restored one keeps the session it creates
 * in a list that is persisted (two windows exist only on macOS).
 */
export function anyWindowReceives(listing: readonly number[], isRestored: (contentsId: number) => boolean): boolean {
  return listing.some((id) => isRestored(id))
}

/**
 * The arrival listeners' guard (design D4): a scheduled handoff is not announced when it is scheduled. Every
 * arrival listener is registered through it, so a third one cannot forget the rule.
 */
export function whenAnnounced(listener: (record: IntakeRecord) => void): (record: IntakeRecord) => void {
  return (record) => {
    if (record.content?.verified.scheduledAt !== undefined && record.firedAt === undefined) return
    listener(record)
  }
}
