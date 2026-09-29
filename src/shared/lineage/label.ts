import type { SessionLineage } from './types'

/**
 * session 標籤的取用順序（`terminal-sessions`、`handoff-brief`）：
 *
 * **使用者指定的名稱 > 交接的標題 > pty 宣告的終端標題**（再往下的本地標籤由各呼叫端自己給）。
 *
 * **三個計算點共用這一個函式** —— renderer 的分頁與 rail、提供給 agent 的關係檔、交接攝入時記下的
 * 來源標籤快照。分成三份的話，畫面、agent 與「← 來源」會對同一個 session 說出三個不同的名字，
 * 而沒有任何東西會紅。
 *
 * - **交接的標題高於 pty 標題**：交接出來的 session 以固定名字啟動，而固定名字把 pty 標題釘成那個
 *   名字（`agent-peer-name`）—— 讓 pty 標題勝出，等於讓交接的標題永遠不被看見。
 * - **不把交接的標題寫成使用者指定的名稱**：那樣「清空名稱＝交還命名權」就回不到它。
 * - **空白的交接標題不參與**：交接可以不帶標題（`parseHandoffPayload` 給 `''`），而 `??` 不會跳過
 *   空字串 —— 標籤會變成一片空白。
 */
export function preferredTitle(session: {
  customTitle?: string
  title?: string
  lineage?: Pick<SessionLineage, 'brief'>
}): string | undefined {
  const handoffTitle = session.lineage?.brief?.title
  return session.customTitle ?? (handoffTitle && handoffTitle.trim() !== '' ? handoffTitle : undefined) ?? session.title
}
