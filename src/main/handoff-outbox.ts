import fs from 'node:fs'
import path from 'node:path'

/**
 * 交接的投遞落點 —— **每個 agent session 各一個目錄**。
 *
 * ## 目錄名決定來源，而那**不是**不可偽造的
 *
 * 一則交接的來源由「它落在哪一個 session 的目錄」推導，於是「payload 自稱來源」這件事在型別上
 * 表達不出來 —— 收件匣「可驗證／第三方撰寫」的分類因此不被破壞。
 *
 * **但它擋不掉「agent 直接寫進別人的目錄」**：落點的根位置算得出來（`SPEKTERM_EVENT_DIR` 已經
 * 把 userData 交給它了，argv 上還有 `--settings` 的路徑），而 agent 有完整的檔案系統寫入權。
 * **這不是一道安全邊界**，任何倚賴「來源不可偽造」的下游設計都不成立 —— 交接次數的上限因此
 * 必須是全域的，見 `handoff-throttle`。
 *
 * ## 兩個目錄分開，而那是承重的
 *
 * - `outbox/<sessionId>/` —— agent 寫進來的地方，落點來源以 `depth: 1` 監看它的**父層**。
 * - `intro/<sessionId>.json` —— 我們寫給 agent 讀的自我介紹。
 *
 * 自我介紹**不能**放在 outbox 之內：它的副檔名是 `.json`，會被當成一份投遞讀進去。
 */

/** 落點的根。`configureHandoff()` 於主行程啟動時設定一次。 */
let handoffRootPath: string | null = null

/** 目前活著的 session —— 清單變動時要重寫它們的自我介紹。 */
const live = new Set<string>()

export function configureHandoff(userDataPath: string): void {
  handoffRootPath = path.join(userDataPath, 'handoff')
}

/** agent 寫進來的地方的**父層** —— 落點來源監看的就是它。 */
export function outboxRoot(): string {
  return handoffRootPath ? path.join(handoffRootPath, 'outbox') : ''
}

/** 某個 session 的投遞目錄。 */
export function outboxDir(sessionId: string): string {
  const root = outboxRoot()
  return root ? path.join(root, sessionId) : ''
}

/** 某個 session 的自我介紹檔。**在 outbox 之外** —— 放進去會被當成一份投遞。 */
export function introFile(sessionId: string): string {
  return handoffRootPath ? path.join(handoffRootPath, 'intro', `${sessionId}.json`) : ''
}

/**
 * 由一份投遞檔的位置推出它的來源 session。
 *
 * **這是來源身分唯一的依據** —— 不看檔案內容、也不看目錄裡的任何檔案（agent 對自己的目錄有
 * 寫入權，那些東西不比 payload 可信）。
 *
 * 不在 `outbox/<sessionId>/` 正下方的檔案一律回 `null`。
 */
export function sourceSessionOf(file: string): string | null {
  const root = outboxRoot()
  if (!root) return null
  const rel = path.relative(root, file)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  const parts = rel.split(path.sep)
  if (parts.length !== 2) return null
  return parts[0] || null
}

/** 建立某個 session 的投遞目錄。失敗回 `null`（呼叫端據此不注入）。 */
export function prepareOutbox(sessionId: string): string | null {
  const dir = outboxDir(sessionId)
  if (!dir) return null
  try {
    // 上一輪的殘留會讓一則早就處理過的交接在重建之後又被投遞一次。
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    return null
  }
  live.add(sessionId)
  return dir
}

/** 目前活著的 session（自我介紹要重寫時用）。 */
export function liveSessions(): string[] {
  return [...live]
}

/**
 * 清除某個 session 的落點與自我介紹。
 *
 * **呼叫端必須先把落點裡既有的項目處理完** —— 否則一則已經投遞、尚未被讀到的交接會隨 session
 * 的結束而消失，而投遞端與使用者兩邊都不會知道。那個順序住在 `handoff-service`。
 */
export function clearOutbox(sessionId: string): void {
  live.delete(sessionId)
  for (const target of [outboxDir(sessionId), introFile(sessionId)]) {
    if (!target) continue
    try {
      fs.rmSync(target, { recursive: true, force: true })
    } catch {
      // 清不掉不影響任何人：下次 spawn 同一個 id 時 `prepareOutbox` 會再清一次。
    }
  }
}

/** 供測試重置。 */
export function resetHandoffState(): void {
  live.clear()
}
