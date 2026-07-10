import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { resolveWithinRoot } from './fs-boundary'
import type { FolderLookup } from './workspace-store'

export type DirEntryKind = 'file' | 'directory' | 'symlink' | 'other'

export interface DirEntry {
  name: string
  kind: DirEntryKind
}

export type FsServiceCode = 'UNKNOWN_FOLDER' | 'FOLDER_UNAVAILABLE' | 'NOT_A_DIRECTORY'

export class FsServiceError extends Error {
  constructor(
    readonly code: FsServiceCode,
    message: string,
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
  const folder = store.list().find((candidate) => candidate.id === folderId)
  if (!folder) {
    throw new FsServiceError('UNKNOWN_FOLDER', `unknown folder: ${folderId}`)
  }
  if (folder.status !== 'ok') {
    throw new FsServiceError('FOLDER_UNAVAILABLE', `folder is unavailable: ${folder.path}`)
  }

  const target = await resolveWithinRoot(folder.path, relPath)

  const stats = await stat(target)
  if (!stats.isDirectory()) {
    throw new FsServiceError('NOT_A_DIRECTORY', `not a directory: ${relPath}`)
  }

  const entries = await readdir(target, { withFileTypes: true })
  return entries
    .map((entry) => ({ name: entry.name, kind: kindOf(entry) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
