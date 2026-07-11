import { constants } from 'node:fs'
import { type FileHandle, lstat, open, realpath } from 'node:fs/promises'
import path from 'node:path'

export type FsBoundaryCode = 'ABSOLUTE_PATH' | 'ESCAPES_ROOT' | 'NOT_FOUND' | 'SYMLINK_RACE'

export class FsBoundaryError extends Error {
  constructor(
    readonly code: FsBoundaryCode,
    message: string,
  ) {
    super(message)
    this.name = 'FsBoundaryError'
  }
}

/**
 * `O_NOFOLLOW` 是 POSIX 的。Windows 上 Node 不提供它，取值為 `undefined`，
 * 而 `flags | undefined` 求值為 `NaN` —— 直接沿用會讓 `open` 在該平台一律失敗。
 *
 * 缺少它的平台退為「開啟之前再 `lstat` 一次」。那是窗口更窄的替代，**不是等價的防護**。
 */
const NOFOLLOW = constants.O_NOFOLLOW ?? 0

/** 供測試與診斷判斷當前平台是否具備核心層級的防護。 */
export const HAS_O_NOFOLLOW = NOFOLLOW !== 0

/**
 * target 是否位於 root 之內（root 自身視為在內）。
 *
 * 以 `path.relative` 判定，**不可**改寫成 `target.startsWith(root)` ——
 * 前綴比對會把 `/a/bc` 誤判為位於 `/a/b` 之內。
 */
export function isWithin(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  if (rel === '') return true
  if (path.isAbsolute(rel)) return false
  return rel !== '..' && !rel.startsWith(`..${path.sep}`)
}

async function realpathOrThrow(target: string): Promise<string> {
  try {
    return await realpath(target)
  } catch {
    throw new FsBoundaryError('NOT_FOUND', `path does not exist: ${target}`)
  }
}

/** 消去 `.` 與 `..` 之後的路徑。擋下字面上的逃逸，尚未解析任何 symlink。 */
function resolveLexical(realRoot: string, relPath: string): string {
  if (path.isAbsolute(relPath)) {
    throw new FsBoundaryError('ABSOLUTE_PATH', `relPath must be relative: ${relPath}`)
  }

  const lexical = path.resolve(realRoot, relPath)
  if (!isWithin(realRoot, lexical)) {
    throw new FsBoundaryError('ESCAPES_ROOT', `path escapes workspace folder: ${relPath}`)
  }
  return lexical
}

export interface ExistingTarget {
  /**
   * 解析 symlink 之後的真實路徑。**邊界判定一律以它為準**，最後一段也不例外
   * —— 於是 renderer 碰不到任何指向 folder 之外的 symlink（design D3）。
   * 寫入內容時開啟的也是它。
   */
  realPath: string
  /**
   * 僅消去 `.` / `..` 的路徑，最後一段可能仍是 symlink。
   *
   * 刪除與改名以它執行：那兩個操作**不跟隨**最後一段，作用在連結本身而非其目標。
   * 拿 `realPath` 去刪，會刪掉 symlink 指向的檔案而不是 symlink。
   */
  lexicalPath: string
  /** folder 根目錄的真實路徑。呼叫端據此擋下「刪除或改名 folder 自身」。 */
  realRoot: string
}

/**
 * 解析一個**必須已存在**的目標，並保證它沒有離開 workspace folder。
 *
 * 兩道檢查缺一不可：先看字面解析的結果（擋 `..` 逃逸），再看解析 symlink 之後的
 * 真實路徑（擋「folder 內的 symlink 指向 folder 外」）。只做前者會被 symlink 繞過；
 * 只做後者則會讓一個指向 folder 外、但當下不存在的路徑回報成 NOT_FOUND 而非越界。
 */
export async function resolveExistingWithin(root: string, relPath: string): Promise<ExistingTarget> {
  const realRoot = await realpathOrThrow(root)
  const lexicalPath = resolveLexical(realRoot, relPath)

  const realPath = await realpathOrThrow(lexicalPath)
  if (!isWithin(realRoot, realPath)) {
    throw new FsBoundaryError('ESCAPES_ROOT', `path escapes workspace folder via symlink: ${relPath}`)
  }

  return { realPath, lexicalPath, realRoot }
}

/**
 * 把 workspace folder 內的相對路徑解析成真實的絕對路徑，並保證它沒有離開該 folder。
 *
 * 讀取路徑（`listDir` / `readFile` / `watch`）的入口。寫入不得使用它 —— 它回傳的是
 * 一個路徑，而呼叫端拿路徑去 `open` 的那一刻，路徑已經可能不是檢查時的那個東西
 *（design D1）。寫入請用 `openExistingForWrite` / `resolveNewWithin`。
 */
export async function resolveWithinRoot(root: string, relPath: string): Promise<string> {
  return (await resolveExistingWithin(root, relPath)).realPath
}

/**
 * 解析一個**必須尚不存在**的目標：其父目錄要存在且位於邊界之內。
 *
 * 回傳的路徑以父目錄的**真實路徑**組成，因此中間段的 symlink 已在此解析完畢；
 * 最後一段留給呼叫端以 `O_EXCL`（檔案）或 `mkdir`（目錄）建立 —— 兩者都不會
 * 寫穿一個既存的 symlink。
 */
export async function resolveNewWithin(root: string, relPath: string): Promise<string> {
  const realRoot = await realpathOrThrow(root)
  const lexical = resolveLexical(realRoot, relPath)

  if (lexical === realRoot) {
    throw new FsBoundaryError('ESCAPES_ROOT', 'cannot create the workspace folder root itself')
  }

  // 父目錄不存在即 NOT_FOUND。**不自動建立中間目錄** —— 那會讓一次手誤長出一整條路徑。
  const realParent = await realpathOrThrow(path.dirname(lexical))
  if (!isWithin(realRoot, realParent)) {
    throw new FsBoundaryError('ESCAPES_ROOT', `path escapes workspace folder: ${relPath}`)
  }

  return path.join(realParent, path.basename(lexical))
}

/**
 * 開啟一個絕對路徑，並拒絕跟隨它的最後一段。
 *
 * 呼叫者應已確認該路徑位於邊界之內且非 symlink（它來自 `realpath`）。若開啟時它**是**
 * symlink，代表檢查之後被替換掉了 —— 也就是 TOCTOU 的那個窗口。這正是 `O_NOFOLLOW`
 * 要擋的事：實測 `open(symlink, O_NOFOLLOW)` 回 `ELOOP`。
 */
export async function openNoFollow(absPath: string, flags: number): Promise<FileHandle> {
  // 缺少 O_NOFOLLOW 的平台（Windows）只能退回 check-then-use，窗口更窄但仍存在。
  if (!HAS_O_NOFOLLOW) {
    const stats = await lstat(absPath).catch(() => null)
    if (stats?.isSymbolicLink()) {
      throw new FsBoundaryError('SYMLINK_RACE', `target became a symbolic link: ${absPath}`)
    }
  }

  try {
    return await open(absPath, flags | NOFOLLOW)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new FsBoundaryError('SYMLINK_RACE', `target became a symbolic link: ${absPath}`)
    }
    throw error
  }
}

export interface WriteHandle {
  handle: FileHandle
  /**
   * 已開啟的那個檔案在磁碟上的真實路徑。
   *
   * **僅供主行程內部使用**（抑制自寫的 watcher 事件需要它作為 key）。它是絕對路徑，
   * 不得跨越 IPC 交給 renderer —— renderer 沒有詞彙表達 workspace 之外的位置。
   */
  realPath: string
}

/**
 * 解析並開啟一個既有的寫入目標。**解析與開啟不可分割** —— 呼叫端拿到的是一個已經開啟的
 * handle，沒有機會拿一個字面路徑再去 `open` 一次（design D1）。
 *
 * 目標若是 folder 內的 symlink，寫入會落在它指向的真實檔案上，連結本身保留
 *（design D5：我們不以「暫存檔 + 改名」取代它）。
 */
export async function openExistingForWrite(root: string, relPath: string): Promise<WriteHandle> {
  const { realPath } = await resolveExistingWithin(root, relPath)
  // 不帶 O_TRUNC：截斷要等 mtime 樂觀鎖比對通過之後，在同一個 fd 上進行。
  const handle = await openNoFollow(realPath, constants.O_WRONLY)
  return { handle, realPath }
}
