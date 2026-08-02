import { TerminalError } from './terminal'
import { t } from '@shared/i18n'

/** 一個工作目錄：core 算的不可逆識別碼，與它的絕對路徑。 */
export interface WorktreeChoice {
  key: string
  path: string
}

/**
 * 工作目錄識別碼 → 這次 spawn 的 cwd，以及 cwd 夾制的合法根集合。
 *
 * **這是本 change 唯一動到安全邊界的地方**，而它是純函式 —— 呼叫端負責供應列舉結果
 * （必須與側欄同源同參數，見 `ipc/openspec.ts` 的 `worktreesFor`）。
 *
 * 查表的兩個性質各自擔保不同的事：
 *
 * - **只對命中的值解析** → **圍堵性**：可達的位置集合恆等於列舉結果，renderer 表達不出別的位置。
 * - **建立時查無即拒絕** → **誠實性**：退回 folder 根其實逸出不了任何邊界（那是舊邊界之內），
 *   但它會讓使用者以為 session 開在他選的工作目錄裡。
 *
 * `strict` 區分建立與重建：**重建時查無對應不是錯誤** —— worktree 可能在應用程式沒開的時候被
 * 移除了，此時退回 folder 根且不使重建失敗。同一個問題，兩條路徑的正確行為相反。
 */
export function pickWorktree(
  worktrees: readonly WorktreeChoice[],
  worktreeKey: string | undefined,
  { strict }: { strict: boolean },
): { cwd?: string; worktreeRoots: string[] } {
  const worktreeRoots = worktrees.map((worktree) => worktree.path)
  if (!worktreeKey) return { worktreeRoots }

  const match = worktrees.find((worktree) => worktree.key === worktreeKey)
  if (match) return { cwd: match.path, worktreeRoots }

  if (strict) throw new TerminalError('UNKNOWN_WORKTREE', t('terminalError.unknownWorktree'))
  return { worktreeRoots }
}

/**
 * 建立 session 時的工作目錄解析 —— **含全域 session 那條分支**。
 *
 * 全域 session 不隸屬任何 repo，它的工作目錄集合因此是**空的**。於是「帶著識別碼來就拒絕」
 * 不是一條新的特例，而是上面那條「查無對應即拒絕」在空集合上的自然結果 —— 也因此**列舉
 * 根本不會被呼叫**（那是這裡與「先列舉再比對」在行為上唯一看得出來的差別）。
 *
 * 型別上 `folderId: null` 與 `worktreeKey` 是互斥的，但**型別互斥擋不到這裡**：IPC 的另一端
 * 是不受信任的輸入。這一層與那一層各自獨立。
 *
 * 抽成具名函式而不寫在 handler 裡，是為了讓它**測得到** —— `ipc/terminal.ts` 於模組載入時
 * 就 `import { ipcMain } from 'electron'`，node:test 進不去。
 */
export async function pickCreateWorktree(
  worktreesOf: (folderId: string) => Promise<readonly WorktreeChoice[]>,
  folderId: string | null,
  worktreeKey: string | undefined,
): Promise<{ cwd?: string; worktreeRoots: string[] }> {
  const worktrees = folderId === null ? [] : await worktreesOf(folderId)
  return pickWorktree(worktrees, worktreeKey, { strict: true })
}
