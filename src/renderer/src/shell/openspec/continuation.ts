/**
 * 側欄請 agent 續寫下一個 artifact 時，送進 pty 的那一行。
 *
 * **這不是 UI 文案，不進 `en.json`** —— 字典裝的是**應用程式介面**的語言，而這一行是**送給
 * agent 讀的命令**。把它放進字典會讓兩件不同的東西共用一個「語言」的概念。
 *
 * **為什麼是 slash command 而不是「繼續寫 design」這樣的自然語言**（design D1）：
 *
 * - OpenSpec 的續寫流程本來就會產生**恰好一個** artifact 然後停 —— 那正是使用者要的節奏，
 *   不必靠 agent 從一句話裡理解出來。
 * - **帶上 slug 可以省掉一次往返**：不指名 change 時，該流程必須反問「要哪一個 change」，
 *   而消除那種來回正是這個功能存在的理由。
 * - 它是 ASCII，於是「該用中文還是英文」這個沒有好答案的問題**根本不存在**。
 *
 * 代價是綁定了 `opsx` 這組 slash command 存在。那個賭注可以接受，因為**失敗是可見且無害的**
 *（agent 當場回報不認得這個命令，沒有檔案被改），而修正就是改這裡的一行。
 */
export function continuationCommand(slug: string): string {
  return `/opsx:continue ${slug}\r`
}

/**
 * 續寫入口不可用的原因。**入口在這些情況下是停用而非消失** —— 消失會讓使用者以為功能不存在
 * 或壞了，停用加說明才讓他知道怎樣它才會亮。
 */
export type ContinuationBlock =
  /** 當前 repo 沒有任何 session（沒有對象可以發話）。 */
  | 'noSession'
  /**
   * 側欄來源指向另一個 repo。**這是正確性要求，不是語意潔癖**：agent 的工作目錄是它自己的
   * repo，把另一個 repo 的 change 識別碼送進去會查無此 change；而兩個 repo 恰有同名 change 時，
   * 它會在**錯的 repo** 動手。
   */
  | 'foreignSource'
  /** focused session 跑的是 login shell —— 它只會回報一個找不到的命令。 */
  | 'notClaude'
  /** focused session 休眠或已結束，沒有 pty 可寫。 */
  | 'notRunning'
