import type { HandoffBriefFile, SessionStore } from './session-store'

/** 交接單的本文與最新結果。**只以 session 識別碼查詢**（`handoff-brief`）。 */
export type HandoffBriefView = HandoffBriefFile

/**
 * 以 session 識別碼查詢交接單。
 *
 * **只對存在、且帶交接單的 session 回應** —— 查的是含暫定紀錄的視圖（剛建好的子 session 還沒被
 * renderer 送來持久化），`lineage.brief` 不在就回 `null`，不去磁碟上找一個沒有歸屬的檔。
 * 參數只收識別碼：它沒有任何可解析為路徑的形狀，而檔名的 UUID 驗證在 store 那一層。
 *
 * **本文不隨 restore 送出** —— 最長兩萬字元、每個交接 session 一份，整批送往一個只需要標題的地方
 * 等於把每個交接的全文持續放在 renderer 裡。
 */
export function readBriefFor(sessions: SessionStore, sessionId: unknown): HandoffBriefView | null {
  if (typeof sessionId !== 'string') return null
  const session = sessions.view().find((entry) => entry.session.id === sessionId)?.session
  if (!session?.lineage?.brief) return null
  return sessions.readHandoffBrief(sessionId)
}
