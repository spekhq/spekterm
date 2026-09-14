import { type WebContents, ipcMain } from 'electron'

import { bodyOf } from '../intake-schema'
import { buildContext, buildPrompt, createNonce, writeContext } from '../intake-context'
import { cancelPrefill, schedulePrefill } from '../intake-prefill'
import { subscribeWait } from '../agent-wait'
import {
  isAuthoredCriterion,
  resolveRouting,
  type RoutingConfig,
  type RoutingRule,
  type RoutingStore,
} from '../intake-routing'
import type { IntakeService } from '../intake-service'
import type { IntakeRecord } from '../intake-store'
import type { FolderLookup } from '../workspace-store'
import { existingTerminalService } from './terminal'

/**
 * 收件匣的 IPC。
 *
 * ## renderer 的詞彙不變
 *
 * renderer 拿到的只有 `intakeId`、通用欄位、與一個**已解析好的 `folderId`** ——
 * 收件匣的目錄、保存處、context 檔的路徑**不經 IPC 送往 renderer**。
 *
 * （**但路徑並非不出主行程**：prompt 含 context 檔的絕對路徑，它會被 pty 畫在終端上。
 * 那是刻意的，也不是破口 —— pty 輸出本來就含任意路徑，renderer 未因此獲得任何 `fs.*` 詞彙。）
 *
 * ## 建立 session 仍然由 renderer 發動
 *
 * session 清單的權威在 renderer：`SessionStore.replace()` 只從 renderer 推來的清單重建，
 * 主行程自行建立的 session 會在 500ms 後被抹掉，**而 pty 還活著**。因此「接受」的回應是
 * 一個**指示**（在哪個 folder 開一個 agent session），renderer 走它既有的 create 路徑，
 * 建好之後再回報 sessionId —— 主行程據此寫 context 檔並排定預填。
 */

export const INTAKE_CHANNELS = {
  list: 'workspace:intake:list',
  accept: 'workspace:intake:accept',
  /** renderer 建好 session 之後回報，主行程據此寫 context 檔並排定預填。 */
  attach: 'workspace:intake:attach',
  dismiss: 'workspace:intake:dismiss',
  dismissNotices: 'workspace:intake:dismissNotices',
  rules: 'workspace:intake:rules',
  setRules: 'workspace:intake:setRules',
  /** 主行程 → renderer：收件匣有變動。 */
  changed: 'workspace:intake:changed',
  /** 主行程 → renderer：某個 session 的預填狀態（等待送出／已送出／未能填入）。 */
  prefill: 'workspace:intake:prefill',
  /**
   * renderer → 主行程：使用者打開了收件匣。
   *
   * **這是通知上界的重置點**，而它必須是一個獨立的訊號 —— 不能拿 `list` 頂替：
   * 常駐的計數 provider 在啟動時就會呼叫 `list`，拿它當「使用者看過了」會讓那個上界
   * 每次開機自動重置，也就是形同沒有上界。
   */
  opened: 'workspace:intake:opened',
  /** 主行程 → renderer：把收件匣打開（使用者觸發了通知）。 */
  openInbox: 'workspace:intake:openInbox',
} as const

/** 送往 renderer 的投影 —— **逐欄位建構，不原樣轉手**。 */
export interface IntakeView {
  id: string
  adapter: string
  state: IntakeRecord['state']
  originKind: string
  originId: string
  originLabel: string
  title: string
  actor: string
  body: string
  bodyLength: number
  receivedAt: number
  sessionId?: string
  /** 解析結果 —— 已經是 renderer 的合法詞彙。 */
  folderId?: string
  unresolved?: 'NO_MATCH' | 'FOLDER_GONE'
}

export interface RuleView extends RoutingRule {
  /** 以第三方撰寫的欄位為判準時為真 —— 編輯介面據此標示它可被投遞者操縱。 */
  spoofable: boolean
}

function project(
  record: IntakeRecord,
  routing: RoutingConfig,
  knownFolderIds: ReadonlySet<string>,
): IntakeView {
  const content = record.content
  const base: IntakeView = {
    id: record.id,
    adapter: record.adapter,
    state: record.state,
    originKind: content?.verified.originKind ?? '',
    originId: content?.verified.originId ?? '',
    originLabel: content?.authored.originLabel ?? '',
    title: content?.authored.title ?? '',
    actor: content?.authored.actor ?? '',
    body: '',
    bodyLength: 0,
    receivedAt: content?.receivedAt ?? 0,
    ...(record.sessionId ? { sessionId: record.sessionId } : {}),
  }
  if (!content) return base

  const intake = { id: record.id, verified: content.verified, authored: content.authored, receivedAt: content.receivedAt }
  const body = bodyOf(intake)
  const resolved = resolveRouting(routing, intake, knownFolderIds)
  return {
    ...base,
    body,
    bodyLength: body.length,
    ...(resolved.ok ? { folderId: resolved.folderId } : { unresolved: resolved.reason }),
  }
}

function sanitizeRules(input: unknown): RoutingConfig {
  const rules: RoutingRule[] = []
  let fallbackFolderId: string | null = null
  if (typeof input === 'object' && input !== null) {
    const value = input as Record<string, unknown>
    if (typeof value.fallbackFolderId === 'string') fallbackFolderId = value.fallbackFolderId
    if (Array.isArray(value.rules)) {
      for (const entry of value.rules) {
        if (typeof entry !== 'object' || entry === null) continue
        const e = entry as Record<string, unknown>
        if (typeof e.id !== 'string' || typeof e.contains !== 'string') continue
        if (typeof e.folderId !== 'string') continue
        const criterion = e.criterion
        if (
          criterion !== 'originKind' &&
          criterion !== 'originId' &&
          criterion !== 'title' &&
          criterion !== 'body' &&
          criterion !== 'actor' &&
          criterion !== 'originLabel'
        ) {
          continue
        }
        rules.push({ id: e.id, criterion, contains: e.contains, folderId: e.folderId })
      }
    }
  }
  return { rules, fallbackFolderId }
}

/** `list` 的回傳形狀。 */
export interface IntakeSnapshot {
  items: IntakeView[]
  notices: { key: string; code: string; count: number; detail?: string }[]
}

/** `accept` 的回傳形狀 —— 成功時只帶一個**指示**（在哪個 folder 建立）。 */
export type IntakeAcceptResult =
  | { ok: true; folderId: string }
  | { ok: false; reason: 'unknown' | 'prefillUnavailable' | 'NO_MATCH' | 'FOLDER_GONE' }

/** routing 規則的回傳形狀。 */
export interface IntakeRulesSnapshot {
  rules: RuleView[]
  fallbackFolderId: string | null
}

export interface IntakeHandlerDeps {
  service: IntakeService
  routing: RoutingStore
  folders: FolderLookup
  contextRoot: string
  /** 事件回報是否啟用。**關閉時預填永遠不會發生，因此接受之前就要告知。** */
  agentEventsEnabled(): boolean
  /** 使用者打開了收件匣 —— 通知上界的重置點。 */
  onInboxOpened?: () => void
  /**
   * 把「打開收件匣」這個動作交出去，供通知被觸發時呼叫。
   *
   * **以回呼交出而不是導出一個函式**：送出的對象是這一層持有的 `senders`，而那個集合的
   * 生命週期綁在這次註冊上。
   */
  registerOpenInbox?: (open: () => void) => void
}

export function registerIntakeHandlers(deps: IntakeHandlerDeps): void {
  const { service, routing, folders, contextRoot, agentEventsEnabled, onInboxOpened } = deps
  const senders = new Set<WebContents>()

  const knownIds = (): ReadonlySet<string> => new Set(folders.list().map((f) => f.id))

  const broadcast = (): void => {
    for (const sender of senders) {
      if (sender.isDestroyed()) senders.delete(sender)
      else sender.send(INTAKE_CHANNELS.changed)
    }
  }
  service.subscribe(broadcast)

  ipcMain.handle(INTAKE_CHANNELS.list, (event) => {
    senders.add(event.sender)
    const config = routing.get()
    const ids = knownIds()
    return {
      items: service.store
        .list()
        .filter((record) => record.state !== 'dismissed')
        .map((record) => project(record, config, ids)),
      notices: service.notices(),
    }
  })

  // 無回應通道 —— 沒有負載，因此不需要型別 guard（`clipboard:writeText` 那條的成因是它收字串）。
  ipcMain.on(INTAKE_CHANNELS.opened, () => {
    onInboxOpened?.()
  })

  /**
   * 把收件匣打開。**重用既有的 `senders` 集合與其銷毀剪除** —— 另外持有一份參考的話，
   * renderer 重新載入之後那份就指向一個已銷毀的 `WebContents`。
   */
  const openInbox = (): void => {
    for (const sender of senders) {
      if (sender.isDestroyed()) senders.delete(sender)
      else sender.send(INTAKE_CHANNELS.openInbox)
    }
  }
  deps.registerOpenInbox?.(openInbox)

  ipcMain.handle(INTAKE_CHANNELS.dismissNotices, () => {
    service.clearNotices()
    return { ok: true }
  })

  ipcMain.handle(INTAKE_CHANNELS.rules, (): IntakeRulesSnapshot => {
    const config = routing.get()
    return {
      rules: config.rules.map((rule) => ({ ...rule, spoofable: isAuthoredCriterion(rule.criterion) })),
      fallbackFolderId: config.fallbackFolderId,
    }
  })

  ipcMain.handle(INTAKE_CHANNELS.setRules, (_event, input: unknown) => {
    routing.replace(sanitizeRules(input))
    broadcast()
    return { ok: true }
  })

  ipcMain.handle(INTAKE_CHANNELS.dismiss, (_event, id: unknown, adapter: unknown) => {
    if (typeof id !== 'string' || typeof adapter !== 'string') return { ok: false, reason: 'unknown' }
    service.store.setState(adapter, id, 'dismissed')
    broadcast()
    return { ok: true }
  })

  /**
   * 接受一則 intake。
   *
   * **只回傳一個指示**（要在哪個 folder 建立 agent session）—— 建立本身由 renderer 走它既有的
   * 路徑完成，理由見檔頭。狀態要等 `attach` 回報之後才轉為已接受。
   */
  ipcMain.handle(INTAKE_CHANNELS.accept, (_event, id: unknown, adapter: unknown) => {
    if (typeof id !== 'string' || typeof adapter !== 'string') return { ok: false, reason: 'unknown' }
    const record = service.store.get(adapter, id)
    if (!record?.content) return { ok: false, reason: 'unknown' }

    // **事件回報關閉時，預填永遠不會發生 —— 於是在建立 session 之前就告知。**
    // 少了這條，使用者得到一個空的 session、一則已離開待處理清單的工作項目，以及零錯誤訊息。
    if (!agentEventsEnabled()) return { ok: false, reason: 'prefillUnavailable' }

    const intake = {
      id: record.id,
      verified: record.content.verified,
      authored: record.content.authored,
      receivedAt: record.content.receivedAt,
    }
    const resolved = resolveRouting(routing.get(), intake, knownIds())
    if (!resolved.ok) return { ok: false, reason: resolved.reason }

    return { ok: true, folderId: resolved.folderId }
  })

  /**
   * renderer 建好 session 之後回報 —— 主行程據此寫 context 檔並排定預填。
   *
   * context 檔由**攝入當下正規化過的那份內容**產生，**不於此時重新讀取保存處** ——
   * 兩者之間隔著使用者思考的時間，而保存處的內容在那段時間內可能已經改變。
   */
  ipcMain.handle(
    INTAKE_CHANNELS.attach,
    async (event, id: unknown, adapter: unknown, sessionId: unknown) => {
      if (typeof id !== 'string' || typeof adapter !== 'string' || typeof sessionId !== 'string') {
        return { ok: false, reason: 'unknown' }
      }
      const record = service.store.get(adapter, id)
      if (!record?.content) return { ok: false, reason: 'unknown' }

      const intake = {
        id: record.id,
        verified: record.content.verified,
        authored: record.content.authored,
        receivedAt: record.content.receivedAt,
      }
      const nonce = createNonce()
      const target = await writeContext(contextRoot, record.id, buildContext(bodyOf(intake), nonce))
      const prompt = buildPrompt(target, nonce)

      service.store.setState(adapter, id, 'accepted', sessionId)
      broadcast()

      const sender = event.sender
      schedulePrefill(sessionId, prompt, {
        write: (target_, data) => existingTerminalService(sender.id)?.write(target_, data),
        onFilled: () => {
          if (!sender.isDestroyed()) sender.send(INTAKE_CHANNELS.prefill, sessionId, 'pending')
          /**
           * 「使用者送出了」**發生在 pty 之內** —— renderer 與主行程都收不到自己發出的訊號。
           * 唯一的線索是 agent 回報的等待狀態**離開就緒**（它開始工作了）。
           * 訂閱一次，見到就撤掉標示並退訂。
           */
          const stop = subscribeWait(sessionId, (snapshot) => {
            if (snapshot.state === 'ready') return
            stop()
            if (!sender.isDestroyed()) sender.send(INTAKE_CHANNELS.prefill, sessionId, 'sent')
          })
          /**
           * 「使用者送出了」**發生在 pty 之內** —— renderer 與主行程都收不到自己發出的訊號。
           * 唯一的線索是 agent 回報的等待狀態**離開就緒**（它開始工作了）。
           * 訂閱一次，見到就撤掉標示並退訂。
           */
        },
        onTimeout: () => {
          // **以狀態為準，不以成因為準。** 回到可重新處理的狀態，並說話。
          service.store.setState(adapter, id, 'pending')
          if (!sender.isDestroyed()) sender.send(INTAKE_CHANNELS.prefill, sessionId, 'timedOut')
          broadcast()
        },
      })

      return { ok: true }
    },
  )
}

/** session 結束或使用者自己送出時取消待填。 */
export function cancelIntakePrefill(sessionId: string): void {
  cancelPrefill(sessionId)
}
