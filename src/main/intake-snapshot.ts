import type { AgentCancelView } from './handoff-cancel'
import type { WaitingState } from './handoff-opener'
import { listView, type IntakeView } from './intake-projection'
import type { RoutingConfig } from './intake-routing'
import { OVERFLOW_KEY, type IntakeService } from './intake-service'
import type { IntakeRecord } from './intake-store'
import type { RecurrenceListing } from './recurrence-keeper'
import { TEAMMATE_ADAPTER } from './teammate-inbox'
import type { OutgoingView } from './teammate-outbox'

/**
 * The inbox's `list` answer, assembled from its sources. A pure function of its dependencies, so it can be tested
 * without Electron: `ipc/intake.ts` imports `ipcMain` when it loads, which `node:test` cannot.
 */

/** `list` 的回傳形狀。 */
export interface IntakeSnapshot {
  items: IntakeView[]
  /**
   * The approved recurrences (`recurring-handoff`'s Repeating section). Not inbox items, and not in a device's
   * `inbox.list`. Absent when no keeper is wired.
   */
  recurrences?: RecurrenceListing
  /**
   * The Outgoing tab (`teammate-handoff`): teammate handoffs of the current membership, narrowed (no `clientId`, no
   * membership stamp), and how many wait for the user — **from the same call as the pending items**, so the badge
   * and the tab cannot disagree. Absent when teams are not wired.
   */
  outgoing?: { items: OutgoingView[]; waiting: number; damaged?: boolean }
  /**
   * The intake ids of pending teammate items that may be declined (`teammate-handoff-return` D9). Desktop only:
   * outside `listView`, whose items a paired phone receives, and which has no such field in the remote protocol.
   */
  declinable?: string[]
  /**
   * What agents cancelled in the last 7 days (`handoff-cancel`, design D5), newest first. **Desktop only**: its own
   * field, never on `IntakeView`, which `remote-host.ts` passes to a device.
   */
  agentCancels?: AgentCancelView[]
  /**
   * Why due handoffs have not opened (`handoff-waits-for-network`, design D5): held for the agent's service, or a
   * backlog opening one at a time. **Desktop only**: never on `IntakeView`, which `remote-host.ts` passes to a device.
   */
  waitingForNetwork?: WaitingState
  /**
   * 拒絕的痕跡 —— **逐則**，不是一個總數。
   *
   * 一個計數器回答不了「哪一則」「為什麼」「我要怎麼辦」中的任何一個，
   * 而使用者對一則他自己交辦的工作正是要問這三件事。
   */
  notices: {
    key: string
    code: string
    count: number
    detail?: string
    at: number
    origin?: string
    target?: string
    permanent: boolean
    /**
     * 這是不是「其餘」那一桶。
     *
     * **由主行程標示，renderer 不認得那個主鍵** —— 讓 renderer 去比對一個主行程的內部常數
     * 會把 `intake-service`（連同它的 `node:fs`）整個拉進 renderer 的 bundle。
     */
    overflow?: boolean
  }[]
}

export interface SnapshotDeps {
  service: Pick<IntakeService, 'store' | 'notices'>
  routing: RoutingConfig
  knownFolderIds: ReadonlySet<string>
  recurrences?: { listing(): RecurrenceListing }
  agentCancels?: () => AgentCancelView[]
  outgoing?: { list(): OutgoingView[]; waitingCount(): number; loadIssue(): 'damaged' | null }
  /** Whether a pending teammate record may be declined. Unprovided ⇒ no `declinable` field. */
  reportable?: (record: IntakeRecord) => boolean
  waitingForNetwork?: () => WaitingState | undefined
}

export function buildIntakeSnapshot(deps: SnapshotDeps): IntakeSnapshot {
  const { service } = deps
  const records = service.store.list()
  const waiting = deps.waitingForNetwork?.()
  return {
    items: listView(records, deps.routing, deps.knownFolderIds),
    ...(deps.recurrences ? { recurrences: deps.recurrences.listing() } : {}),
    ...(deps.agentCancels ? { agentCancels: deps.agentCancels() } : {}),
    ...(deps.outgoing
      ? {
          outgoing: {
            items: deps.outgoing.list(),
            waiting: deps.outgoing.waitingCount(),
            ...(deps.outgoing.loadIssue() ? { damaged: true } : {}),
          },
        }
      : {}),
    ...(deps.reportable
      ? {
          declinable: records
            .filter((record) => record.adapter === TEAMMATE_ADAPTER && record.state === 'pending' && deps.reportable?.(record))
            .map((record) => record.id),
        }
      : {}),
    ...(waiting ? { waitingForNetwork: waiting } : {}),
    notices: service.notices().map((notice) => ({
      ...notice,
      ...(notice.key === OVERFLOW_KEY ? { overflow: true } : {}),
    })),
  }
}
