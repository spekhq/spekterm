import { type Dirent, constants } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  readFile as readFileRaw,
  readdir,
  rename as renameRaw,
  rm,
  stat,
} from 'node:fs/promises'
import path from 'node:path'
import {
  openExistingForWrite,
  resolveExistingWithin,
  resolveNewWithin,
  resolveWithinRoot,
} from './fs-boundary'
import type { FolderLookup, WorkspaceFolder } from './workspace-store'
import { t } from '@shared/i18n'

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
  /** 磁碟上的檔案自開啟以來已被改動，寫入未執行。 */
  | 'CONFLICT'
  /** 建立或改名的目標已存在。既有的 symlink 亦視為已存在。 */
  | 'ALREADY_EXISTS'
  | 'INVALID_NAME'
  /** 不得刪除或改名 workspace folder 自身。 */
  | 'PROTECTED_ROOT'

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
    throw new FsServiceError('UNKNOWN_FOLDER', t('fsError.unknownFolder', { folderId }))
  }
  if (folder.status !== 'ok') {
    throw new FsServiceError('FOLDER_UNAVAILABLE', t('fsError.folderUnavailable', { path: folder.path }))
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
    throw new FsServiceError('NOT_A_DIRECTORY', t('fsError.notADirectory', { path: relPath }))
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
    throw new FsServiceError('NOT_A_FILE', t('fsError.notAFile', { path: relPath }))
  }

  // 先問大小再讀。反過來的話，一個 4 GB 的檔案會在得知它太大之前就炸掉主行程。
  if (stats.size > MAX_READ_FILE_BYTES) {
    throw new FsServiceError('TOO_LARGE', t('fsError.tooLarge', { path: relPath }), {
      size: stats.size,
      limit: MAX_READ_FILE_BYTES,
    })
  }

  const buffer = await readFileRaw(target)

  // stat 與 read 之間檔案可能長大。再確認一次的成本是一個比較。
  if (buffer.length > MAX_READ_FILE_BYTES) {
    throw new FsServiceError('TOO_LARGE', t('fsError.tooLarge', { path: relPath }), {
      size: buffer.length,
      limit: MAX_READ_FILE_BYTES,
    })
  }

  if (looksBinary(buffer)) {
    throw new FsServiceError('BINARY', t('fsError.binary', { path: relPath }))
  }

  return { text: decodeUtf8(buffer), mtimeMs: stats.mtimeMs, size: stats.size }
}

/** Windows 的保留裝置名稱。`CON.txt` 一樣開不了 —— 判定看第一個 `.` 之前的部分。 */
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Windows 不允許的字元。POSIX 本身只擋 `/` 與 NUL。空白與 `-` 不在其中。 */
const FORBIDDEN_CHARS = /[<>:"|?*]/

/** NUL 與其餘控制字元（含 DEL）。逐字元比對，勝過一個需要 lint 例外的字元類。 */
function hasControlChar(name: string): boolean {
  for (const character of name) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/**
 * 驗證一個新項目的名稱。
 *
 * 規則取**三個目標平台的交集**，而不是當下執行平台的規則。在 Linux 上放行一個
 * Windows 開不了的名稱（`aux`、`a:b`、`x.`），等於製造一個只在部分機器上損壞的 repo。
 */
export function validateName(name: string): void {
  if (name.length === 0) {
    throw new FsServiceError('INVALID_NAME', t('fsError.nameEmpty'))
  }
  if (name === '.' || name === '..') {
    throw new FsServiceError('INVALID_NAME', t('fsError.nameDotted', { name }))
  }
  if (name.includes('/') || name.includes('\\')) {
    throw new FsServiceError('INVALID_NAME', t('fsError.nameSeparator', { name }))
  }
  if (FORBIDDEN_CHARS.test(name) || hasControlChar(name)) {
    throw new FsServiceError('INVALID_NAME', t('fsError.nameForbidden', { name }))
  }
  // Windows 會靜默地把結尾的空白與句點吃掉，於是建立出的檔案叫別的名字。
  if (/[ .]$/.test(name)) {
    throw new FsServiceError('INVALID_NAME', t('fsError.nameTrailing', { name }))
  }
  if (WINDOWS_RESERVED.test(name.split('.')[0] ?? '')) {
    throw new FsServiceError('INVALID_NAME', t('fsError.nameReserved', { name }))
  }
}

export interface WriteResult {
  /** 寫入之後磁碟上的修改時間。呼叫端以它作為下一次樂觀鎖的基準，並抑制自寫事件。 */
  mtimeMs: number
  size: number
  /**
   * 實際被寫入的那個檔案的真實絕對路徑（目標是 symlink 時，即其目標）。
   *
   * **僅供主行程內部使用** —— IPC 接縫必須在回應 renderer 之前把它剝除。
   */
  realPath: string
}

/**
 * 覆寫 workspace folder 內一個既有檔案的內容。
 *
 * **就地寫入**，不以「暫存檔 + 改名」實作 —— 後者會把 folder 內的 symlink 取代為普通檔案、
 * 斷開 hard link，並讓一次存檔在 watcher 上呈現為「刪除後新增」（design D5，已實測）。
 *
 * 樂觀鎖的比對與截斷都發生在**同一個 fd** 上，因此路徑只被解析一次：`open` 之後就沒有
 * 任何一步需要再走一遍路徑查找。這比「先 stat 路徑、再 open 路徑」少掉一個窗口。
 *
 * 不帶 `O_TRUNC`：截斷必須等比對通過之後才做，否則一次被拒絕的寫入已經先清空了檔案。
 */
export async function writeFile(
  store: FolderLookup,
  folderId: string,
  relPath: string,
  text: string,
  baseMtimeMs?: number,
): Promise<WriteResult> {
  const folder = requireFolder(store, folderId)

  let opened: Awaited<ReturnType<typeof openExistingForWrite>>
  try {
    opened = await openExistingForWrite(folder.path, relPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EISDIR') {
      throw new FsServiceError('NOT_A_FILE', t('fsError.notAFile', { path: relPath }))
    }
    throw error
  }

  const { handle, realPath } = opened
  try {
    const before = await handle.stat()
    if (!before.isFile()) {
      throw new FsServiceError('NOT_A_FILE', t('fsError.notAFile', { path: relPath }))
    }

    if (baseMtimeMs !== undefined && before.mtimeMs !== baseMtimeMs) {
      throw new FsServiceError('CONFLICT', t('fsError.conflict', { path: relPath }), {
        diskMtimeMs: before.mtimeMs,
      })
    }

    const buffer = Buffer.from(text, 'utf8')
    await handle.truncate(0)
    await handle.write(buffer, 0, buffer.length, 0)

    const after = await handle.stat()
    return { mtimeMs: after.mtimeMs, size: after.size, realPath }
  } finally {
    await handle.close()
  }
}

/**
 * 建立一個空的普通檔案。
 *
 * `O_CREAT | O_EXCL` 一次擋下兩件事：目標已存在、以及目標是一個既存的 symlink ——
 * `O_EXCL` 的存在性判定看連結本身而非其目標，因此不會寫穿它（design D6，已實測回 `EEXIST`）。
 */
export async function createFile(
  store: FolderLookup,
  folderId: string,
  relPath: string,
): Promise<void> {
  const folder = requireFolder(store, folderId)
  validateName(path.basename(relPath))

  const target = await resolveNewWithin(folder.path, relPath)
  try {
    const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL)
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new FsServiceError('ALREADY_EXISTS', t('fsError.alreadyExists', { path: relPath }))
    }
    throw error
  }
}

/** 建立一個目錄。非遞迴 —— 父目錄不存在時由 `resolveNewWithin` 回報 `NOT_FOUND`。 */
export async function createDirectory(
  store: FolderLookup,
  folderId: string,
  relPath: string,
): Promise<void> {
  const folder = requireFolder(store, folderId)
  validateName(path.basename(relPath))

  const target = await resolveNewWithin(folder.path, relPath)
  try {
    await mkdir(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new FsServiceError('ALREADY_EXISTS', t('fsError.alreadyExists', { path: relPath }))
    }
    throw error
  }
}

/**
 * 刪除一個檔案或目錄（目錄為遞迴）。
 *
 * 以 **`lexicalPath`** 執行而非 `realPath`：`rm` 不跟隨最後一段，因此刪的是連結本身。
 * 拿 `realPath` 去刪，使用者點「刪除這個 symlink」會刪掉它指向的那個檔案。
 *
 * 遞迴刪除**不跟隨**其中的 symlink（已實測），因此 folder 外的內容不會因此消失。
 */
export async function deleteEntry(
  store: FolderLookup,
  folderId: string,
  relPath: string,
): Promise<void> {
  const folder = requireFolder(store, folderId)
  const { lexicalPath, realPath, realRoot } = await resolveExistingWithin(folder.path, relPath)

  if (realPath === realRoot) {
    throw new FsServiceError('PROTECTED_ROOT', t('fsError.cannotDeleteRoot'))
  }

  await rm(lexicalPath, { recursive: true })
}

/**
 * 變更一個項目的名稱或位置。來源與目標兩端都受邊界約束。
 *
 * **改名前必須先確認目標不存在** —— `rename` 會無聲覆蓋既有的目標（已實測）。此檢查與
 * `rename` 之間仍有窗口（Node 沒有 `renameat2(RENAME_NOREPLACE)`），其後果是覆蓋而非
 * 逸出邊界，落在威脅模型之外（design D8）。
 *
 * 來源以 `lexicalPath` 搬動：`rename` 不跟隨最後一段，搬的是連結本身。
 */
export async function rename(
  store: FolderLookup,
  folderId: string,
  fromRelPath: string,
  toRelPath: string,
): Promise<void> {
  const folder = requireFolder(store, folderId)
  validateName(path.basename(toRelPath))

  const from = await resolveExistingWithin(folder.path, fromRelPath)
  if (from.realPath === from.realRoot) {
    throw new FsServiceError('PROTECTED_ROOT', t('fsError.cannotRenameRoot'))
  }

  const to = await resolveNewWithin(folder.path, toRelPath)
  if (await lstat(to).catch(() => null)) {
    throw new FsServiceError('ALREADY_EXISTS', `already exists: ${toRelPath}`)
  }

  await renameRaw(from.lexicalPath, to)
}
