import { encodePrefill } from './agent-events'
import { subscribeWait, waitStateOf } from './agent-wait'

/**
 * 預填 —— 把第一則 prompt 寫進 agent 的輸入處，**而不送出**。
 *
 * ## 落點是 pty，而且由主行程寫
 *
 * agent session 有兩種 view，各有一個可以打字的地方，**而只有使用者當下在看的那一個看得到**，
 * 終端 view 是預設。被否決的落點是對話 view 的文字框：它要成立必須配「接受時自動切到對話
 * view」，而 `agent-conversation-view` 明文要求 view 的選擇是**單一的全域偏好**。
 *
 * **由主行程執行寫入不是實作偏好**：prompt 含 context 檔的絕對路徑，交給 renderer 再寫回去
 * 等同把那個位置送過 IPC，而那是本能力明文避免的事。
 *
 * ## 時機：等待狀態**首次**成為就緒
 *
 * 太早寫入，內容會落進 agent 的啟動畫面而非輸入處，**而畫面上不會有任何錯誤**。
 * 判準不是固定延遲、不是重試次數、也不是看終端畫面。
 *
 * 實測（2026-09-11、CLI 2.1.267，見 `docs/lessons/transcript.md`）：`SessionStart` 恆晚於 TUI
 * 進入 alt-screen 約 200–300ms，也晚於 TUI 啟動時的輸入丟棄窗口；以它為閘重複 5 次，
 * **5 次全部落進輸入框**。而失效的是一個**窄帶**（約 1000ms 前後），不是「越早越糟」。
 *
 * ## 寫一次就退訂
 *
 * 狀態會再次成為就緒（agent 每講完一次話都會）。沒有 write-once 的話，使用者正在打字時
 * 會被插進第二份 prompt。
 *
 * ## 等不到就緒時要說話
 *
 * **判準以狀態為準，不以成因為準** —— 等待狀態始終不到的成因不只一種（事件回報未啟用、
 * 注入失敗、agent 啟動失敗、CLI 換版）。逾時之後：可見地說明，且該則 intake **回到可重新
 * 處理的狀態**。少了這條，使用者得到的是一個空的 session、一則已離開待處理清單的工作項目，
 * 以及零錯誤訊息。
 */

/** 等不到就緒的上限。**必須大於 drain 的 tick（400ms）數個數量級**，否則正常啟動會被判成逾時。 */
export const PREFILL_TIMEOUT_MS = 30_000

export interface PrefillDeps {
  /** 往 pty 寫入。由呼叫端注入，於是本模組不認識終端服務。 */
  write(sessionId: string, data: string): void
  /** 逾時的處置 —— 呈現說明，並把該則 intake 放回待處理。 */
  onTimeout(sessionId: string): void
  /** 成功填入。 */
  onFilled?(sessionId: string): void
}

interface PendingPrefill {
  unsubscribe: () => void
  timer: NodeJS.Timeout
}

const pending = new Map<string, PendingPrefill>()

/** 目前有幾個 session 在等預填。測試用。 */
export function pendingPrefillCount(): number {
  return pending.size
}

/**
 * 排定一次預填。
 *
 * 已就緒時**立刻寫**（那不是「太早」——狀態已經是就緒了）；否則訂閱等待狀態，
 * 首次就緒時寫一次即退訂。
 */
export function schedulePrefill(sessionId: string, prompt: string, deps: PrefillDeps): void {
  cancelPrefill(sessionId)

  let done = false
  const finish = (filled: boolean): void => {
    if (done) return
    done = true
    const entry = pending.get(sessionId)
    if (entry) {
      entry.unsubscribe()
      clearTimeout(entry.timer)
      pending.delete(sessionId)
    }
    if (filled) deps.onFilled?.(sessionId)
    else deps.onTimeout(sessionId)
  }

  const fill = (): void => {
    // **不附送出字元，且換行由編碼器濾掉** —— 單行是編碼器的性質，不是呼叫端的義務。
    deps.write(sessionId, encodePrefill(prompt))
    finish(true)
  }

  const timer = setTimeout(() => finish(false), PREFILL_TIMEOUT_MS)
  const unsubscribe = subscribeWait(sessionId, (snapshot) => {
    if (done) return
    if (snapshot.state === 'ready') fill()
  })
  pending.set(sessionId, { unsubscribe, timer })

  // 訂閱之前狀態就已經是就緒（例如重建一個早就在跑的 session）。
  if (waitStateOf(sessionId) === 'ready') fill()
}

/** session 被關掉或使用者自己送出時取消。 */
export function cancelPrefill(sessionId: string): void {
  const entry = pending.get(sessionId)
  if (!entry) return
  entry.unsubscribe()
  clearTimeout(entry.timer)
  pending.delete(sessionId)
}
