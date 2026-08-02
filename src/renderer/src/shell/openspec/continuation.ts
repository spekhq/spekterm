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
   * focused session 是一個**全域 session**（不隸屬任何 folder，見 `global-session`）。
   *
   * 它沒有「自身所屬的 folder」，因此「側欄來源等於 session 自身的 folder」這個條件對它
   * **恆不成立** —— 這是一個獨立的原因，不是 `foreignSource` 的一種：後者的說明是「把側欄
   * 切回選中的 repo 就好了」，而那對全域 session 是一句做不到的建議（它切回哪裡都一樣）。
   */
  | 'globalSession'
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
  /**
   * 這個 change 住在**另一個工作目錄**（git worktree）裡，而 session 跑在 folder 的根目錄。
   *
   * 這是 `foreignSource` 在同一個 repo 之內的更細粒度版本，成立的理由完全相同：送進去的識別碼
   * 查無此 change，更糟的是 agent 會在 session 所在之處**建出一個同名的空 change**。
   *
   * **判準不是「來源是不是主工作目錄」** —— folder 本身就是一個 linked worktree 時（那正是
   * 「一個 change 一個 worktree」工作流的產物），session 的 cwd 就在該 worktree 裡，指示會成功。
   * 要問的是「來源與 session 所屬的 folder 是不是同一個工作目錄」，即 `worktree.isFolderRoot`。
   */
  | 'foreignWorktree'

/**
 * 續寫入口不可用的原因 —— **純函式，因為它必須被測試守住**。
 *
 * 這段判定此前寫在 `MainStage` 的 JSX 裡（一條三元鏈），於是它唯一的守衛是人的注意力。而
 * design D2 自陳「條件 1 是本 change 最危險的坑」：它比較的兩端**都可能缺席**，而樸素寫法的
 * 失效方向取決於今天恰好用了 `?.` 還是 `??` —— 誤停用只是少一顆按鈕，誤啟用會讓 agent 在
 * 家目錄建出一個空的 change。一個會在下一次無關重構中翻面的判定，不能只靠手動確認過一次。
 *
 * 條件的順序就是回報原因的優先序：先看有沒有對象，再看它是不是對的對象。
 */
export function continuationBlockOf(input: {
  /** focused 且正被顯示的 session。`undefined` ＝ 當前項目沒有 session。 */
  displayed?: {
    /** `null` ＝ 全域 session（不隸屬任何 folder）。 */
    folderId: string | null
    spawnTarget: 'claude' | 'shell'
    status: 'dormant' | 'running' | 'exited'
  }
  /** 側欄來源 repo 的識別碼。`undefined` ＝ 尚未選定。 */
  panelFolderId?: string
}): ContinuationBlock | null {
  const { displayed, panelFolderId } = input
  if (!displayed) return 'noSession'
  // **先問是不是全域，不讓兩個缺席值互相比較**（design D2）。
  if (displayed.folderId === null) return 'globalSession'
  if (panelFolderId !== displayed.folderId) return 'foreignSource'
  if (displayed.spawnTarget !== 'claude') return 'notClaude'
  if (displayed.status !== 'running') return 'notRunning'
  return null
}
