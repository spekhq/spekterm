import { useEffect, useRef } from 'react'

import { useSessions } from '../terminal/sessions'

/**
 * 到達即接受，以及「通知把我帶到那個 session」。
 *
 * ## 為什麼建立在 renderer
 *
 * session 清單的權威在 renderer（見 `ipc/intake` 檔頭）—— 主行程自己建的 session 會在下一次
 * `replace` 時被抹掉，**而 pty 還活著**。於是「到達即接受」與「使用者按下接受」走的是
 * **同一條建立路徑**，那正是既有條款要求的（啟動參數逐項相同、一樣被持久化、一樣可重建）。
 *
 * ## 為什麼是一個常駐而不渲染任何東西的元件
 *
 * 收件匣的 overlay 只在被打開時掛載，而交接**在使用者沒有打開它的時候到達**。
 * 與 `KeyboardNavigation` 同一個姿態。
 *
 * ## 焦點
 *
 * **建立不搶焦點**：`create()` 只更新「該 folder 當前聚焦的 session」，不動 rail 的選取、
 * 也不呼叫終端的 focus。使用者在來源 session 交辦之後，那邊的 agent 通常還在收尾 ——
 * 未經他的動作而改變焦點是在打斷他。
 *
 * **通知被觸發時才切過去** —— 那是他的動作。
 */
export function IntakeAutoAccept({
  onReveal,
}: {
  /** 把 rail 的選取移到某個 folder（`null` ＝ 全域項目）。 */
  onReveal: (folderId: string | null) => void
}): null {
  /**
   * **訂閱只建立一次，變動的東西放在 ref 裡。**
   *
   * `onReveal` 是呼叫端的 inline arrow function、`sessions` 是 context 的 API 物件 ——
   * 把它們放進依賴陣列，等於把「什麼時候訂閱」改寫成「任何一次重繪」：每次重繪都退訂再訂閱，
   * 而**落在那個窗口裡的 IPC 訊息就此消失**（實測三次有一到兩次，症狀是「通知偶爾沒反應」）。
   *
   * 這正是 CLAUDE.md 那條「依賴陣列就是某條 requirement 的觸發條件」的實例。
   */
  const sessions = useSessions()
  const latest = useRef({ sessions, onReveal })
  // **在 effect 裡更新，不在渲染期間** —— 渲染期間寫 ref 在 concurrent 之下不安全，
  // 而這個 effect 每次重繪都跑（那是刻意的：它更新的是值，不是訂閱）。
  useEffect(() => {
    latest.current = { sessions, onReveal }
  })

  useEffect(
    () =>
      window.workspace.intake.onAutoAccept((adapter, id, folderId, ticket) => {
        void (async () => {
          const outcome = await latest.current.sessions.create(folderId, 'claude', { ticket })
          // 建不起來時**不回報 attach** —— 那則交接於是留在待處理，使用者仍可自己接受它。
          // 靜默地把它標成已接受才是最糟的：一件工作從清單上消失，而沒有 session 對應它。
          if (outcome.status !== 'created') return
          await window.workspace.intake.attach(id, adapter, outcome.sessionId)
        })()
      }),
    [],
  )

  useEffect(
    () =>
      window.workspace.intake.onFocusSession((sessionId) => {
        const { sessions: api, onReveal: reveal } = latest.current
        const session = api.all().find((candidate) => candidate.id === sessionId)
        // 已經不在了 ⇒ **無操作**。SHALL NOT 重建它，也 SHALL NOT 改為打開收件匣
        // （主行程在送出這則訊息之前就已經查過，這裡是第二道 —— 兩者之間隔著一次 IPC）。
        if (!session) return
        reveal(session.folderId)
        api.focus(session.folderId, sessionId)
      }),
    [],
  )

  return null
}
