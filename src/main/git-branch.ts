import fs from 'node:fs'
import path from 'node:path'

/**
 * 讀取 folder 的 git 當前分支。
 *
 * **以檔案讀取完成，不 spawn `git`。** 理由與 `workspace-store` 的 `hasOpenSpec` 同源：這是
 * 每個 folder、每次載入都要做的判定，而 rail 是使用者最先看到的東西 —— 它必須廉價。退一步說，
 * 若改用 `git rev-parse`，啟動時就是 N 個子行程；而 CLAUDE.md 已記過「core 的 `getTimestamps`
 * 會 spawn `git log`」如何污染「這段邏輯沒有 spawn 外部程式」的驗收。不要再增加一個。
 *
 * rail 是一個**旁觀者**：git 有各式各樣 HEAD 不指向分支的狀態（detached、rebase 中、bisect 中），
 * 而且使用者就在旁邊的 terminal 裡操作這些 repo。任何無法解讀的狀態一律回 `null`（＝沒有分支），
 * 絕不拋錯 —— rail 不該因為某個 repo 正在 rebase 就壞掉。
 */

/** detached HEAD 時顯示的短 sha 長度（git 的慣例）。 */
const SHORT_SHA_LENGTH = 7

/**
 * 找出 folder 的 git 目錄。
 *
 * `.git` 通常是目錄，但在 **git worktree 與 submodule** 中它是一個**檔案**，內容為
 * `gitdir: <path>` 指向真正的 git 目錄（實測：worktree 寫絕對路徑，submodule 寫相對路徑，
 * 兩者都要吃）。
 *
 * 那個目標**常在 folder 的邊界之外** —— 這是主行程自己的檔案存取，不經 renderer 的
 * `(folderId, relPath)` 詞彙，**不是 `filesystem-access` 白名單的擴大**：renderer 依然無從
 * 指定要讀哪個路徑，它只會收到一個字串。
 */
function resolveGitDir(folderPath: string): string | null {
  const dotGit = path.join(folderPath, '.git')

  let stats: fs.Stats
  try {
    stats = fs.statSync(dotGit)
  } catch {
    return null // 不是 git repo —— 合法狀態，不是錯誤
  }

  if (stats.isDirectory()) return dotGit
  if (!stats.isFile()) return null

  let content: string
  try {
    content = fs.readFileSync(dotGit, 'utf8')
  } catch {
    return null
  }

  const match = /^gitdir:\s*(.+)$/m.exec(content)
  if (!match) return null

  const target = match[1].trim()
  if (!target) return null
  return path.isAbsolute(target) ? target : path.resolve(folderPath, target)
}

/**
 * 找出 folder 所屬 repo 的 **common dir** —— 亦即 `git rev-parse --git-common-dir`。
 *
 * 這比 `resolveGitDir()` 多解一層，而那一層在「folder 本身就是一個 linked worktree」時決定生死：
 *
 * ```
 * <worktree>/.git      → "gitdir: <main>/.git/worktrees/<name>"   ← resolveGitDir 停在這
 * <gitdir>/worktrees   → 不存在，且永遠不會存在
 * <gitdir>/commondir   → "../.."  ⇒ <main>/.git                   ← 要的是這個
 * ```
 *
 * worktree 的清單住在 **common dir** 底下的 `worktrees/`。少了這一層，想監看「有沒有多一個
 * worktree」就會 attach 到一個永不存在的路徑 —— 而 chokidar 對此**不報錯、也不發事件**，
 * 於是整條「新建的 worktree 被納入」靜默失效（實測）。
 *
 * 主工作目錄沒有 `commondir` 檔案，此時 common dir 就是 gitdir 自身。
 *
 * 與 `resolveGitDir()` 同樣**不 spawn `git`**，且同樣可能指向 folder 邊界之外 —— 那是主行程
 * 自己的檔案存取，推給 renderer 的不會是路徑。
 */
export function resolveCommonDir(folderPath: string): string | null {
  const gitDir = resolveGitDir(folderPath)
  if (gitDir === null) return null

  let content: string
  try {
    content = fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8')
  } catch {
    return gitDir // 沒有 commondir ＝ 這本身就是主工作目錄的 git 目錄
  }

  const target = content.trim()
  if (!target) return gitDir
  return path.isAbsolute(target) ? target : path.resolve(gitDir, target)
}

/**
 * 解析 `.git/HEAD` 的內容（實測的三種形式）：
 *
 * | 狀態 | 內容 |
 * |---|---|
 * | 位於分支 | `ref: refs/heads/master` |
 * | 分支名含 `/` | `ref: refs/heads/feat/x` —— 取 `refs/heads/` **之後全部**，不可在第一個 `/` 斷開 |
 * | detached HEAD | `ef48cc91774f5718f672d97f1d0c365702cd57e6` —— 純 sha，取短 sha |
 */
export function parseHead(raw: string): string | null {
  const line = raw.trim()
  if (!line) return null

  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(line)
  if (ref) return ref[1].trim() || null

  // detached HEAD：純 sha（sha-1 為 40 字元，sha-256 的 repo 為 64）
  if (/^[0-9a-f]{40}$/i.test(line) || /^[0-9a-f]{64}$/i.test(line)) {
    return line.slice(0, SHORT_SHA_LENGTH)
  }

  // HEAD 指向 refs/heads 以外的東西，或內容損毀 —— 視為沒有分支
  return null
}

/**
 * folder 的 HEAD 檔案在磁碟上的絕對路徑。**監看用**（分支變動就是這個檔案被改寫）。
 *
 * 不是 git repo 時回 `null` —— 此時沒有東西可監看，改由 folder 根目錄的 watcher 等 `.git` 出現。
 */
export function headPath(folderPath: string): string | null {
  const gitDir = resolveGitDir(folderPath)
  return gitDir === null ? null : path.join(gitDir, 'HEAD')
}

/** folder 的當前分支；非 git repo、或任何無法解讀的狀態，一律為 `null`。 */
export function readBranch(folderPath: string): string | null {
  const head = headPath(folderPath)
  if (head === null) return null

  let raw: string
  try {
    raw = fs.readFileSync(head, 'utf8')
  } catch {
    return null // HEAD 不存在或讀不到（.git 剛被建立、或損毀）
  }

  return parseHead(raw)
}
