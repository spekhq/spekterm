import { homedir } from 'node:os'
import path from 'node:path'

import { getUserEnv } from './user-env'

/**
 * 來源根與存檔根的解析。
 *
 * ## 為什麼不能只讀 `process.env`
 *
 * 本 repo 有一道承重的分界（見 `user-env.ts`）：使用者互動 shell 的環境**只有 `PATH`** 併進
 * `process.env`，其餘由 `getUserEnv()` 持有、只在建構 pty 環境時合併。那道分界不可為了這個能力
 * 放寬 —— 一個被注入的 `XDG_CONFIG_HOME` 會換掉 userData 的落點。
 *
 * 於是使用者若在 `.zshrc` 設了 `CLAUDE_CONFIG_DIR`，主行程與它 fork 的掃描行程**都看不到**：
 * 掃到一個空目錄、呈現「來源不可用」，而他的資料就在旁邊。**這個失效完全靜默**，而且會被
 * 「來源不存在時要說得出來」那條 requirement 包裝成一個看起來很正常的畫面。
 *
 * 因此解析順序是 `getUserEnv()` → `process.env` → `~/.claude`。
 * probe 的測試接縫仍然成立：它把變數設在被測 app 自己的行程環境上，也就是第二順位。
 *
 * （實測 2026-09-05：設了 `CLAUDE_CONFIG_DIR` 之後，`projects/` 與其中的 transcript 確實一併
 * 搬到新位置。）
 */

const CONFIG_DIR_VAR = 'CLAUDE_CONFIG_DIR'

export interface SourceEnv {
  userEnv?: Readonly<Record<string, string>>
  processEnv?: Readonly<Record<string, string | undefined>>
  home?: string
}

/** Claude Code 的設定目錄。 */
export function resolveConfigDir(env: SourceEnv = {}): string {
  const userEnv = env.userEnv ?? getUserEnv()
  const processEnv = env.processEnv ?? process.env
  const fromUser = userEnv[CONFIG_DIR_VAR]
  if (fromUser && fromUser.trim()) return fromUser
  const fromProcess = processEnv[CONFIG_DIR_VAR]
  if (fromProcess && fromProcess.trim()) return fromProcess
  return path.join(env.home ?? homedir(), '.claude')
}

/** transcript 的來源根。 */
export function resolveProjectsDir(env: SourceEnv = {}): string {
  return path.join(resolveConfigDir(env), 'projects')
}

/**
 * 存檔根。位於 userData 之下 —— 與其他設定同處，且**不會被 30 天的來源清理波及**。
 *
 * 注意 dev 模式的 userData 是 `~/.config/spekterm-dev`（`dev` script 的 `XDG_CONFIG_HOME`），
 * 因此 dev 與打包產物**各存一份**。那是既有隔離機制的必然結果，不是缺陷 —— 但 dogfood 時
 * 看到的歷史會比較短，別誤判成「資料掉了」。
 */
export function resolveArchiveRoot(userDataDir: string): string {
  return path.join(userDataDir, 'conversation-archive')
}
