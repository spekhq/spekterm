import type { Dirent } from 'node:fs'
import { lstat, readFile as readFileRaw, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { resolveWithinRoot } from './fs-boundary'
import type { FolderLookup, WorkspaceFolder } from './workspace-store'

export type DirEntryKind = 'file' | 'directory' | 'symlink' | 'other'

export interface DirEntry {
  name: string
  kind: DirEntryKind
  /**
   * 數值時間戳，不是「2 小時前」。格式化牽涉語言與「當下是何時」——
   * 前者不該由主行程決定，後者會在面板開著的每一分鐘失效。
   */
  mtimeMs: number
}

export interface FileContent {
  text: string
  mtimeMs: number
  size: number
}

/**
 * 讀檔的大小上限。
 *
 * 這個數字被 Monaco 由上方夾住，不是隨手挑的：超過 `LARGE_FILE_SIZE_THRESHOLD`（20 MB）
 * 編輯器會停止語法標記，超過 `_MODEL_SYNC_LIMIT`（50 MB）則不再與 worker 同步。若上限
 * 設在那之上，「檢視器提供語法高亮」這條 requirement 對某些被我們接受的檔案就是假的。
 */
export const MAX_READ_FILE_BYTES = 2 * 1024 * 1024

/** 二進位判定的取樣長度。與 git 一致：前 8000 bytes 內出現 NUL 即視為二進位。 */
export const BINARY_SNIFF_BYTES = 8000

export type FsServiceCode =
  | 'UNKNOWN_FOLDER'
  | 'FOLDER_UNAVAILABLE'
  | 'NOT_A_DIRECTORY'
  | 'NOT_A_FILE'
  | 'TOO_LARGE'
  | 'BINARY'

export class FsServiceError extends Error {
  constructor(
    readonly code: FsServiceCode,
    message: string,
    /** 供 UI 直接呈現的數字（例如檔案大小與上限），避免它自行解析錯誤訊息 */
    readonly detail?: Record<string, number>,
  ) {
    super(message)
    this.name = 'FsServiceError'
  }
}

// readdir 的 withFileTypes 走 lstat 語意，因此 symlink 不會偽裝成它指向的種類。
function kindOf(entry: Dirent): DirEntryKind {
  if (entry.isSymbolicLink()) return 'symlink'
  if (entry.isDirectory()) return 'directory'
  if (entry.isFile()) return 'file'
  return 'other'
}

/**
 * renderer 只認得一種分隔符。主行程負責在邊界上轉換，使 renderer 不必知道自己跑在哪個平台
 * —— `path.resolve` 在 Windows 上同樣接受 `/`，因此反向不需要轉換。
 */
export function toPosixRelPath(relPath: string): string {
  return relPath.split(path.sep).join('/')
}

function requireFolder(store: FolderLookup, folderId: string): WorkspaceFolder {
  const folder = store.list().find((candidate) => candidate.id === folderId)
  if (!folder) {
    throw new FsServiceError('UNKNOWN_FOLDER', `unknown folder: ${folderId}`)
  }
  if (folder.status !== 'ok') {
    throw new FsServiceError('FOLDER_UNAVAILABLE', `folder is unavailable: ${folder.path}`)
  }
  return folder
}

/**
 * 列出 workspace folder 內某個目錄的直接子項目。
 *
 * renderer 只能以 `(folderId, relPath)` 定址 —— 它沒有詞彙可以表達 workspace
 * 之外的位置。邊界仍在此處（主行程）強制執行；preload 與 renderer 同屬一個
 * 行程樹，於該處檢查等同沒有檢查。
 */
export async function listDir(
  store: FolderLookup,
  folderId: string,
  relPath: string,
): Promise<DirEntry[]> {
  const folder = requireFolder(store, folderId)
  const target = await resolveWithinRoot(folder.path, relPath)

  const stats = await stat(target)
  if (!stats.isDirectory()) {
    throw new FsServiceError('NOT_A_DIRECTORY', `not a directory: ${relPath}`)
  }

  const entries = await readdir(target, { withFileTypes: true })
  const described = await Promise.all(
    entries.map(async (entry): Promise<DirEntry | null> => {
      try {
        // lstat 而非 stat：種類已由 Dirent 以 lstat 語意判定，時間戳要與之一致。
        const entryStats = await lstat(path.join(target, entry.name))
        return { name: entry.name, kind: kindOf(entry), mtimeMs: entryStats.mtimeMs }
      } catch {
        // readdir 與 lstat 之間項目被刪除。它已經不在了，就不該出現在清單裡。
        return null
      }
    }),
  )

  return described
    .filter((entry): entry is DirEntry => entry !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** 前 8000 bytes（或整個檔案，取其小者）內出現 NUL 即視為二進位 —— 與 git 的判準相同。 */
function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(BINARY_SNIFF_BYTES, buffer.length)).includes(0)
}

function decodeUtf8(buffer: Buffer): string {
  const withoutBom =
    buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
      ? buffer.subarray(3)
      : buffer
  return withoutBom.toString('utf8')
}

/**
 * 讀取 workspace folder 內一個文字檔案的內容。
 *
 * 兩個拒絕條件（過大、二進位）都是**拒絕**，不是降級呈現：截斷後顯示一半的檔案，
 * 比不顯示更糟 —— 使用者會以為那就是全部。
 */
export async function readFile(
  store: FolderLookup,
  folderId: string,
  relPath: string,
): Promise<FileContent> {
  const folder = requireFolder(store, folderId)
  const target = await resolveWithinRoot(folder.path, relPath)

  const stats = await stat(target)
  if (!stats.isFile()) {
    throw new FsServiceError('NOT_A_FILE', `not a file: ${relPath}`)
  }

  // 先問大小再讀。反過來的話，一個 4 GB 的檔案會在得知它太大之前就炸掉主行程。
  if (stats.size > MAX_READ_FILE_BYTES) {
    throw new FsServiceError('TOO_LARGE', `file is too large: ${relPath}`, {
      size: stats.size,
      limit: MAX_READ_FILE_BYTES,
    })
  }

  const buffer = await readFileRaw(target)

  // stat 與 read 之間檔案可能長大。再確認一次的成本是一個比較。
  if (buffer.length > MAX_READ_FILE_BYTES) {
    throw new FsServiceError('TOO_LARGE', `file is too large: ${relPath}`, {
      size: buffer.length,
      limit: MAX_READ_FILE_BYTES,
    })
  }

  if (looksBinary(buffer)) {
    throw new FsServiceError('BINARY', `file appears to be binary: ${relPath}`)
  }

  return { text: decodeUtf8(buffer), mtimeMs: stats.mtimeMs, size: stats.size }
}
