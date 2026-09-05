import { homedir } from 'node:os'
import path from 'node:path'

import { encodeProjectDir } from './transcript-project'
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

/**
 * 委派（`conversation-report`）的工作目錄名。
 *
 * **這是一個單一來源常數**：它同時決定「委派在哪裡執行」與「掃描要排除哪個專案目錄」。
 * 兩者若各自寫一份字串，日後改動其中一個就會靜默漂移 —— 而漂移之後的徵狀是數字慢慢
 * 變得不對，沒有任何東西會紅。
 *
 * ## 為什麼委派需要自己的空目錄
 *
 * 一是空目錄不會載入任何 repo 的 `CLAUDE.md`、skill 或設定 —— 否則被分析的對象（使用者的
 * repo）能夠影響分析它的那份提示。二是它讓委派留下的紀錄落在一個**可預測**的專案目錄裡，
 * 因而排除得掉。
 *
 * ## 為什麼一定要排除
 *
 * 實測（2026-09-05，`claude` 2.1.261）：非互動模式下指令與標準輸入會被串成**同一則
 * `type: "user"` 記錄，且該記錄沒有 `isMeta`**。一趟委派因此會在來源目錄底下寫進一則長度
 * 等同整份語料的「使用者訊息」，而下一次掃描會把它當成使用者真的打的字 ——
 * 訊息則數灌水、長度分布的尾巴被自己拉長、最常說的那幾句被自己的提示詞佔據。
 */
export const DELEGATE_DIR_NAME = 'spekterm-report-delegate'

/** 委派的工作目錄。`spawn` 與排除規則的共同來源。 */
export function resolveDelegateCwd(userDataDir: string): string {
  return path.join(userDataDir, DELEGATE_DIR_NAME)
}

/**
 * 排除規則：來源專案目錄名的**編碼形態以委派目錄名結尾**。
 *
 * **刻意不綁單一絕對路徑。** dev 與打包產物的 userData 分家（`spekterm-dev` 對 `Spekterm`），
 * 於是兩者編碼出來的專案目錄名不同，而 `~/.claude/projects` 是**同一個**。綁單一路徑的話，
 * 在 dev 按一次讀後感就會弄髒正式產物的儀表板數字，而以「同一個安裝內」為前提的驗收必定全綠。
 *
 * 代價是一個恰好叫 `spekterm-report-delegate` 的使用者目錄也會被排除。目錄名取得夠具體正是
 * 為了讓這件事不會發生，而萬一發生，代價是少算一個專案 —— 遠小於反方向（髒資料永久寫進存檔，
 * 而來源已被 30 天輪替刪除，無法重算）。
 */
export function delegateDirSuffix(): string {
  return encodeProjectDir(`${path.sep}${DELEGATE_DIR_NAME}`)
}

/** 這個來源專案目錄是不是本應用程式的委派留下的。 */
export function isDelegateProjectDir(dirName: string, suffix = delegateDirSuffix()): boolean {
  return dirName.endsWith(suffix)
}
