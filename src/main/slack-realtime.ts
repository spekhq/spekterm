import type { SlackApi, SlackFailure } from './slack-api'
import type { BackfillDeps, Candidate } from './slack-backfill'
import { NameCache, deliverCandidate } from './slack-backfill'
import { isCapturedMention } from './slack-mention'
import type { SlackMessage } from './slack-mention'

/**
 * 即時路徑 —— **加速器，不是主幹**（design D1）。
 *
 * ## 它壞掉不會讓本能力失效
 *
 * Socket Mode 沒有重送佇列，且桌面應用程式大多數時間是關著的 —— 所以「關機期間發生的提及」
 * 本來就只有回補救得回來。這一層只是把使用者在線時的延遲從「下一輪」縮成秒級。
 *
 * 因此它的每一種失敗都只是**降級**：連不上、斷了沒重連、事件格式變了 —— 全部退回「等下一輪
 * 回補」。這也是為什麼那條未查證的事實（user-scope 事件走不走 WebSocket）不承重。
 *
 * ## 投遞內容由**共用**的那個函式組出
 *
 * 這裡只負責「從事件裡挖出一個訊息座標」，其餘（討論串的上界、顯示名稱、截斷、去重）
 * 一律走 `deliverCandidate()` —— 與回補同一個函式。**兩條路徑各自組內容的話，先到的那一條
 * 會定案，而使用者讀到的與另一條會產出的不同**，那是一個難查的不一致。
 *
 * ## 兩份憑證
 *
 * Socket Mode 的 URL 要用 **app-level token** 取得（`apps.connections.open`），而讀訊息與
 * 名稱要用 **user token**。兩者是不同的 `SlackApi` 實例，由呼叫端注入 —— 把兩份憑證混在一個
 * 實例裡會讓「哪個方法用哪一份」變成一條紀律。
 */

/** Socket Mode 的信封類型（我們只在乎這幾種）。 */
type EnvelopeType = 'hello' | 'events_api' | 'disconnect'

export interface RealtimeDeps {
  /** 帶 **app-level token** 的用戶端 —— 只用來開連線。 */
  connections: SlackApi
  /** 回補所用的那一組依賴 —— 投遞走它的 `deliverCandidate()`。 */
  backfill: BackfillDeps
  /**
   * 頻道 id → 名稱。
   *
   * **Socket Mode 的事件裡沒有頻道名稱**，而少了它這條路徑會把 id 寫進投遞內容 ——
   * 於是同一則提及**依「哪條路先到」而呈現不同**，那是「卡片顯示識別碼對使用者不構成資訊」
   * 那個缺陷的另一種形式。來源是上一輪回補列舉到的清單。
   */
  channelNameOf: (channelId: string) => string | undefined
  /** 建立 WebSocket 的接縫（測試以替身注入；產品用全域的那個）。 */
  openSocket?: (url: string) => RealtimeSocket
  /** 回報降級 —— 呈現層據此讓「失效」與「閒置」可區分。 */
  onDegraded?: (failure: SlackFailure) => void
}

/** WebSocket 的最小介面 —— 只用到這幾個成員，於是替身很小。 */
export interface RealtimeSocket {
  send: (data: string) => void
  close: () => void
  addEventListener: (
    type: 'open' | 'message' | 'close' | 'error',
    handler: (event: { data?: unknown }) => void,
  ) => void
}

/** 事件裡的那一則訊息 —— 挖得出座標就算成功。 */
export interface RealtimeMention {
  channelId: string
  message: SlackMessage
}

/**
 * 從一個 Socket Mode 信封裡挖出「別人提及使用者本人」的那一則訊息。**純函式。**
 *
 * 回 `null` 的情形一律是「這個信封與我們無關」，不是錯誤 —— 頻道裡的絕大多數訊息都是。
 *
 * **不認得的事件型別一律略過，不當成失敗** —— Slack 隨時會加新的事件型別，
 * 把它當失敗會讓一條正常的連線被判定為壞掉。
 */
export function mentionFromEnvelope(envelope: unknown, selfUserId: string): RealtimeMention | null {
  if (typeof envelope !== 'object' || envelope === null) return null
  const outer = envelope as Record<string, unknown>
  const payload = outer.payload
  if (typeof payload !== 'object' || payload === null) return null
  const event = (payload as Record<string, unknown>).event
  if (typeof event !== 'object' || event === null) return null

  const entry = event as Record<string, unknown>
  if (entry.type !== 'message') return null
  // 編輯／刪除／加入頻道之類的子型別不是一則新訊息。
  if (typeof entry.subtype === 'string') return null
  if (typeof entry.channel !== 'string' || typeof entry.ts !== 'string') return null

  const message: SlackMessage = {
    ts: entry.ts,
    user: typeof entry.user === 'string' ? entry.user : undefined,
    text: typeof entry.text === 'string' ? entry.text : undefined,
  }
  if (!isCapturedMention(message, selfUserId)) return null
  return { channelId: entry.channel, message }
}

/** 信封要不要 ack —— `events_api` 必須 ack，否則 Slack 會重送而我們會處理兩次。 */
export function ackFor(envelope: unknown): string | null {
  if (typeof envelope !== 'object' || envelope === null) return null
  const outer = envelope as Record<string, unknown>
  const type = outer.type
  if (type !== ('events_api' satisfies EnvelopeType)) return null
  if (typeof outer.envelope_id !== 'string') return null
  return JSON.stringify({ envelope_id: outer.envelope_id })
}

/**
 * 一條即時連線。**它不重連** —— 重連的責任在呼叫端（它知道使用者還在不在、憑證還有沒有效）。
 *
 * 生命週期以 `start()` / `stop()` 表示，`stop()` 後不再處理任何事件。
 */
export class SlackRealtime {
  readonly #deps: RealtimeDeps
  readonly #open: (url: string) => RealtimeSocket
  #socket: RealtimeSocket | null = null
  #stopped = false
  /** 正在處理中的交付 —— `stop()` 要等它們結束才算真的停了（否則測試會看到懸空的寫入）。 */
  #inFlight: Promise<unknown>[] = []

  constructor(deps: RealtimeDeps) {
    this.#deps = deps
    this.#open =
      deps.openSocket ??
      ((url) => new WebSocket(url) as unknown as RealtimeSocket)
  }

  /**
   * 開始接收。**失敗只是降級** —— 回 `false`，呼叫端照常倚賴回補。
   *
   * 需要 `teamId` 與 `selfUserId`：兩者自憑證推導（design D14），由呼叫端在回補那一輪之後傳入
   * —— 於是即時路徑不必自己再打一次 `auth.test`。
   */
  async start(identity: { teamId: string; selfUserId: string }): Promise<boolean> {
    const url = await this.#deps.connections.appsConnectionsOpen()
    if (!url.ok) {
      this.#deps.onDegraded?.(url)
      return false
    }
    if (this.#stopped) return false

    const socket = this.#open(url.value)
    this.#socket = socket

    socket.addEventListener('message', (event) => {
      this.#handle(event.data, identity)
    })
    socket.addEventListener('close', () => {
      this.#socket = null
      // **斷線是降級，不是錯誤** —— 回補會補上這段期間的提及。
      this.#deps.onDegraded?.({ kind: 'transient', error: 'disconnected' })
    })
    socket.addEventListener('error', () => {
      this.#deps.onDegraded?.({ kind: 'transient', error: 'socket_error' })
    })
    return true
  }

  /** 停止接收，並等待正在處理中的交付結束。 */
  async stop(): Promise<void> {
    this.#stopped = true
    this.#socket?.close()
    this.#socket = null
    await Promise.allSettled(this.#inFlight)
    this.#inFlight = []
  }

  #handle(data: unknown, identity: { teamId: string; selfUserId: string }): void {
    if (this.#stopped) return
    if (typeof data !== 'string') return

    let envelope: unknown
    try {
      envelope = JSON.parse(data)
    } catch {
      // 看不懂的內容略過。**不當成連線壞掉** —— 那會讓一個新的信封型別把整條連線判死。
      return
    }

    // **ack 要先做，而且與我們是否關心這則事件無關。** 不 ack 的信封 Slack 會重送，
    // 而重送會讓我們對同一則訊息再跑一次（去重救得回來，但那是白做工，且掩蓋了問題）。
    const ack = ackFor(envelope)
    if (ack !== null) this.#socket?.send(ack)

    const mention = mentionFromEnvelope(envelope, identity.selfUserId)
    if (mention === null) return

    const candidate: Candidate = {
      channelId: mention.channelId,
      // 查得到就用名稱（與回補一致）；查不到才退回 id —— 與「查不到顯示名稱時保留 id」同一條：
      // 比留空誠實，但**那是最後手段，不是預設**。
      channelName: this.#deps.channelNameOf(mention.channelId) ?? mention.channelId,
      message: mention.message,
    }

    // 投遞走**與回補共用**的那個函式（design D1 的載體）。
    const work = deliverCandidate(this.#deps.backfill, identity.teamId, candidate, this.#names())
      .then((outcome) => {
        if (outcome.failure !== undefined) this.#deps.onDegraded?.(outcome.failure)
      })
      .catch(() => {
        // 呼叫端不 await 這個 promise，所以絕不能讓它變成未捕捉的 rejection ——
        // 主行程一死，它底下所有 pty 陪葬。
        this.#deps.onDegraded?.({ kind: 'transient', error: 'internal' })
      })
    this.#inFlight.push(work)
  }

  /**
   * 名稱快取。**每則事件一份，用的是與回補**同一個**類別。**
   *
   * 這裡曾經寫成一個匿名 class（把 `NameCache` 的邏輯抄了一遍）—— 那正是本模組檔頭警告的
   * 那件事：兩條路徑各自實作，於是它們會在某次改動後開始產出不同的東西，而沒有東西會紅。
   */
  #names(): NameCache {
    return new NameCache(this.#deps.backfill.api)
  }
}
