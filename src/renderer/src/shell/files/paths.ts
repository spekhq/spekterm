/**
 * 樹上的位址一律是「相對於 folder 根目錄、以 `/` 分隔」的字串，根目錄為空字串。
 *
 * renderer 沒有 `node:path`，也不該有 —— 它處理的不是檔案系統路徑，而是主行程發給它的
 * 一組不透明識別碼。主行程負責在邊界上把平台分隔符轉成 `/`。
 */
export const ROOT_PATH = ''

export function joinRelPath(dir: string, name: string): string {
  return dir === ROOT_PATH ? name : `${dir}/${name}`
}

export function parentOf(relPath: string): string {
  const index = relPath.lastIndexOf('/')
  return index === -1 ? ROOT_PATH : relPath.slice(0, index)
}

export function baseNameOf(relPath: string): string {
  const index = relPath.lastIndexOf('/')
  return index === -1 ? relPath : relPath.slice(index + 1)
}

/**
 * 樹根的前綴 —— 檔案樹以某個工作目錄為根時，它是那個工作目錄的 folder-relative 根
 * （`side-panel-worktree`）。folder 自身為 `ROOT_PATH`。
 *
 * **兩種座標系並存，而權威永遠是「完整的 folder-relative 路徑」**：`fs.*` 的參數、watch 的訂閱
 * 與事件、未存變更的鍵、`title` 屬性（它同時是探針的選擇器）、跨身分導覽的判定 —— 全部用完整
 * 路徑。只有「呈現給人看的那一段」才剝掉前綴，而換算集中在下面兩個函式，不散落到各個消費端。
 *
 * 這條紀律的回報是三件事免費成立：未存的變更跨工作目錄切換自然存活（鍵沒變）、反向交叉導覽的
 * 判定一行都不用改（它吃的本來就是完整路徑）、watch 不受影響。
 */
export type RootPrefix = string

/** 樹內位址 → 完整的 folder-relative 路徑。 */
export function joinRoot(prefix: RootPrefix, relPath: string): string {
  if (prefix === ROOT_PATH) return relPath
  return relPath === ROOT_PATH ? prefix : `${prefix}/${relPath}`
}

/**
 * 完整的 folder-relative 路徑 → 樹內位址（呈現用）。
 *
 * 不在該前綴之下時原樣回傳 —— 呈現一個帶前綴的路徑，好過靜默地把它裁成一個看起來合理、卻指向
 * 別處的位址。
 */
export function stripRoot(prefix: RootPrefix, relPath: string): string {
  if (prefix === ROOT_PATH) return relPath
  if (relPath === prefix) return ROOT_PATH
  return relPath.startsWith(`${prefix}/`) ? relPath.slice(prefix.length + 1) : relPath
}

const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd']

export function isMarkdown(relPath: string): boolean {
  const lower = baseNameOf(relPath).toLowerCase()
  return MARKDOWN_EXTENSIONS.some((extension) => lower.endsWith(extension))
}
