import { type WebContents, ipcMain } from 'electron'

import { TranscriptFollower, type FollowUpdate } from '../transcript-follow-service'
import { transcriptPathFor } from '../transcript-follow'
import { drainEvents, encodeInput, type WaitState } from '../agent-events'
import { existingTerminalService } from './terminal'

/**
 * 對話 view 的內容通道。
 *
 * ## 只跟一個 session
 *
 * 與 `session-status` 同一條理由：呈現的恆是當下顯示的那一個 session，因此 renderer 告訴主行程
 * 「現在看的是誰」，主行程就只為那一個建立跟進。開了 20 個 session 也只有一份監看。
 *
 * **這也是為什麼跟進不在 `TerminalService` 裡建立**：那樣每個 session 一建立就開始跟進，而
 * 絕大多數 session 的對話 view 從來沒有被打開過。
 *
 * ## 拆除的兩個來源，以及一個**不是**來源的東西
 *
 * 拆除發生於：renderer 換去看別的 session，或這個 renderer 消失（reload／關窗）。
 *
 * **agent 自己回報的「對話結束」不是拆除的來源。** 實測（2026-09-06、CLI 2.1.263）：使用者在
 * agent 之內清空對話時它就會回報結束，**而 pty 還活著**。接上拆除的話，使用者按一次清空，
 * 對話 view 就此停住 —— 而 session 正常、終端正常、沒有任何錯誤。
 */

export const CONVERSATION_CHANNELS = {
  /** renderer → main：現在盯著哪個 session 的對話（`null` ＝ 停止）。 */
  watch: 'workspace:conversation:watch',
  /** main → renderer：內容更新。單向推送，與 terminal 的 `data` 同類。 */
  update: 'workspace:conversation:update',
  /** main → renderer：等待狀態（能不能送）。 */
  wait: 'workspace:conversation:wait',
  /** renderer → main：送出一則訊息。**閘在主行程**。 */
  send: 'workspace:conversation:send',
} as const

/** 等待狀態的輪詢間隔。與狀態列的 tick 同量級 —— 事件是落盤的，沒有推送可訂閱。 */
const WAIT_TICK_MS = 400

interface Entry {
  follower: TranscriptFollower
  sessionId: string
  timer: NodeJS.Timeout
}

/**
 * 等待狀態 —— **per session，而不是 per 訂閱**。
 *
 * 這個區分是承重的：事件是**可消費的串流**（讀完即刪，去重由此保證），而狀態是它的摺疊結果。
 * 把狀態放在訂閱物件裡的話，使用者切走再切回時狀態重設為「未知」，**而重建它所需的事件早已
 * 被前一次訂閱讀走刪掉** —— agent 正閒著、不再產生新事件，於是狀態永遠停在未知、輸入框永遠
 * 送不出去。dogfood 的第二句話就撞上了。
 *
 * **一般形式：一個由可消費串流推導出來的狀態，其生命週期必須綁在被描述的對象上，
 * 不能綁在觀察者上。**
 */
const waitStates = new Map<string, WaitState>()

/** 等待選擇時「正在被問什麼」。與 `waitStates` 同一個生命週期。 */
const pendingRequests = new Map<string, { tool: string; arg: string | null } | null>()

/** 每個 renderer 至多一份 —— 見上。 */
const followers = new Map<number, Entry>()

function stop(contentsId: number): void {
  const entry = followers.get(contentsId)
  if (!entry) return
  clearInterval(entry.timer)
  entry.follower.dispose()
  followers.delete(contentsId)
  // **等待狀態刻意不清除** —— 它屬於那個 session，不屬於這次訂閱（見 `waitStates`）。
  // 清除的時機是 session 結束，那由 `agent-events` 的落點清理負責。
}

/**
 * 一次事件輪詢。
 *
 * **事件帶來的 `transcript_path` 是定位的權威來源** —— 它關掉了「使用者在 agent 之內清空或
 * 切換對話」那條路：那些操作發生在 pty 之內，pty 沒死，我們收不到任何自己發出的訊號
 * （實測 `/clear` 會換一份紀錄）。
 *
 * **而 `SessionEnd` 事件 SHALL NOT 觸發拆除** —— `drainEvents` 只把它翻成「狀態未知」，
 * 跟進器照常活著，等 `SessionStart` 帶來新位置。
 */
function tick(contents: WebContents, entry: Entry): void {
  if (contents.isDestroyed()) return
  const previous = waitStates.get(entry.sessionId) ?? 'unknown'
  const result = drainEvents(entry.sessionId, previous)
  if (result.transcriptPath) entry.follower.relocate(result.transcriptPath)
  // **監看負責延遲，這裡負責保證。** 監看有一整類靜默的失效方式，而它們的徵狀都是
  // 「畫面安靜地停住」—— 那比沒有 view 更糟。
  entry.follower.poll()
  if (result.count === 0 && result.state === previous) return
  waitStates.set(entry.sessionId, result.state)
  pendingRequests.set(entry.sessionId, result.pending)
  contents.send(CONVERSATION_CHANNELS.wait, entry.sessionId, result.state, result.pending)
}

function start(contents: WebContents, sessionId: string): void {
  const current = followers.get(contents.id)
  if (current?.sessionId === sessionId) return
  stop(contents.id)

  const source = existingTerminalService(contents.id)?.agentSourceOf(sessionId) ?? null
  if (!source) {
    // shell 目標沒有紀錄可跟。**明說**，不要讓呈現層停在「跟進中」。
    contents.send(CONVERSATION_CHANNELS.update, {
      sessionId,
      status: 'unavailable',
      events: [],
      truncated: false,
      reset: true,
    } satisfies FollowUpdate)
    return
  }

  const follower = new TranscriptFollower(sessionId, (update) => {
    if (contents.isDestroyed()) return
    contents.send(CONVERSATION_CHANNELS.update, update)
  })
  const entry: Entry = {
    follower,
    sessionId,
    timer: setInterval(() => tick(contents, entry), WAIT_TICK_MS),
  }
  followers.set(contents.id, entry)
  // 沿用這個 session 既有的狀態（切走再切回不該退回未知）。
  contents.send(
    CONVERSATION_CHANNELS.wait,
    sessionId,
    waitStates.get(sessionId) ?? 'unknown',
    pendingRequests.get(sessionId) ?? null,
  )
  // 算出來的位置是初始值；事件帶來的 `transcript_path` 一旦到達即取代它。
  follower.relocate(transcriptPathFor(source.cwd, source.conversationId))
}

/** renderer 消失時的清理。與 watcher／pty 的擁有者記帳同構。 */
export function disposeConversationFor(contentsId: number): void {
  stop(contentsId)
}

export function registerConversationHandlers(): void {
  ipcMain.on(CONVERSATION_CHANNELS.watch, (event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') {
      stop(event.sender.id)
      return
    }
    start(event.sender, sessionId)
  })

  /**
   * 送出的閘**在主行程**。
   *
   * renderer 那側的停用只是 UI 提示 —— 它不能是唯一的把關者，理由與檔案系統邊界相同：
   * preload 與 renderer 同屬一個行程樹，在那裡檢查等同沒有檢查。
   *
   * **未知時拒絕**。兩種失敗的代價不對等：「不確定就送送看」的失效是把內容打進一個正在等待
   * 其他輸入的位置（已知的真實後果包含替使用者做出未經同意的選擇）；「不確定就不送」的失效
   * 只是使用者多切換一次 view。
   */
  ipcMain.handle(CONVERSATION_CHANNELS.send, (event, sessionId: unknown, text: unknown) => {
    if (typeof sessionId !== 'string' || typeof text !== 'string') return { ok: false, reason: 'unknown' }
    const entry = followers.get(event.sender.id)
    if (!entry || entry.sessionId !== sessionId) return { ok: false, reason: 'unknown' }
    const wait = waitStates.get(sessionId) ?? 'unknown'
    // `awaiting-choice` 只接受選項，不接受自由文字（`agent-input-bridge`）。
    if (wait === 'unknown' || wait === 'awaiting-choice') return { ok: false, reason: wait }
    const service = existingTerminalService(event.sender.id)
    if (!service) return { ok: false, reason: 'unknown' }
    service.write(sessionId, encodeInput(text))
    return { ok: true }
  })
}
