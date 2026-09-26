/**
 * 「一個 session **存在**」的唯一定義（`session-lineage`「session 的存在有單一定義」）。
 *
 * 主行程（寫給 agent 讀的關係檔）與 renderer（rail 的樹、來源標示）各自持有不同的資料，
 * **但必須對同一個 session 得到同一個答案** —— 兩者分歧時，畫面會把子 session 縮排在一個
 * agent 看來已經不在的母 session 之下。資料來源無法共用，因此把規則抽成這個純函式，
 * 兩端各寫一層把自己的資料轉成 `ExistenceInput` 的轉接。
 */
export interface ExistenceInput {
  /** 在 session 清單中（主行程：SessionStore 或暫定紀錄；renderer：session state）。 */
  inList: boolean
  /** 行程已結束。**休眠不算結束**（休眠的 session 只是尚未啟動）。 */
  exited: boolean
  /** 所屬 folder 仍在 workspace 之中。全域 session 恆為 `true`。 */
  folderInWorkspace: boolean
  /**
   * 剛建立、renderer 尚未把它送來持久化。
   *
   * renderer 若在那之前重新載入，它**永遠不會**被持久化 —— 若仍算作存在，母 session 會一直看到
   * 一個不存在的子 session。因此暫定者另需 `ptyAlive`。
   */
  provisional: boolean
  /** 它的 pty 此刻仍在執行。只對暫定者有意義。 */
  ptyAlive: boolean
}

export function sessionExists(input: ExistenceInput): boolean {
  if (!input.inList || input.exited || !input.folderInWorkspace) return false
  if (input.provisional && !input.ptyAlive) return false
  return true
}
