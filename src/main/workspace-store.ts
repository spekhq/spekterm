import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { readBranch } from './git-branch'

/**
 * 設定檔的結構版本。從第一天就寫入 —— 沒有版本欄位的舊檔日後無法安全遷移。
 */
export const WORKSPACE_VERSION = 1

/** 寫入磁碟的欄位。衍生狀態（是否含 openspec、路徑是否還在）一律不存。 */
export interface PersistedFolder {
  id: string
  path: string
  addedAt: string
}

interface PersistedWorkspace {
  version: number
  folders: PersistedFolder[]
}

export type FolderStatus = 'ok' | 'missing'

export interface WorkspaceFolder extends PersistedFolder {
  name: string
  status: FolderStatus
  /** 衍生狀態：每次讀取重算，不持久化。持久化衍生狀態就是持久化謊言。 */
  hasOpenSpec: boolean
  /**
   * git 當前分支。非 git repo、detached 以外無法解讀的狀態，皆為 `null`。
   *
   * 與 `hasOpenSpec` 同樣是衍生狀態 —— 而且它比誰都更不能持久化：使用者就在旁邊的 terminal
   * 裡切 branch，存下來的值下一秒就是假的。
   */
  branch: string | null
}

export interface FolderLookup {
  list(): WorkspaceFolder[]
}

/** 單次 stat。不遞迴、不呼叫外部程式。 */
function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory()
  } catch {
    return false
  }
}

function describeFolder(folder: PersistedFolder): WorkspaceFolder {
  const status: FolderStatus = isDirectory(folder.path) ? 'ok' : 'missing'
  return {
    ...folder,
    name: path.basename(folder.path),
    status,
    hasOpenSpec: status === 'ok' && isDirectory(path.join(folder.path, 'openspec')),
    // 單次檔案讀取，不 spawn `git`（見 git-branch.ts）—— 與 hasOpenSpec 同樣是「每個 folder、
    // 每次載入」都要做的判定，rail 是使用者最先看到的東西，它必須廉價。
    branch: status === 'ok' ? readBranch(folder.path) : null,
  }
}

/** 內容無法信任時一律回傳 null，由呼叫端隔離該檔並以空 workspace 啟動。 */
export function parseWorkspace(raw: string): PersistedWorkspace | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof data !== 'object' || data === null) return null
  const { version, folders } = data as Record<string, unknown>

  if (version !== WORKSPACE_VERSION) return null
  if (!Array.isArray(folders)) return null

  const parsed: PersistedFolder[] = []
  for (const entry of folders) {
    if (typeof entry !== 'object' || entry === null) return null
    const { id, path: folderPath, addedAt } = entry as Record<string, unknown>
    if (typeof id !== 'string' || typeof folderPath !== 'string' || typeof addedAt !== 'string') {
      return null
    }
    parsed.push({ id, path: folderPath, addedAt })
  }

  return { version, folders: parsed }
}

/**
 * 先寫暫存檔再更名。同一個檔案系統上 `rename` 是原子的，因此中途失敗只會留下
 * 舊內容或新內容，不會留下半截 JSON。
 */
export function writeWorkspaceFileAtomic(filePath: string, workspace: PersistedWorkspace): void {
  const tmp = `${filePath}.tmp`
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(tmp, `${JSON.stringify(workspace, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, filePath)
}

function quarantine(filePath: string): string | null {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = `${filePath}.corrupt-${stamp}`
  try {
    fs.renameSync(filePath, target)
    return target
  } catch {
    return null
  }
}

export class WorkspaceStore {
  private folders: PersistedFolder[] = []

  constructor(private readonly filePath: string) {}

  /**
   * 讀取設定。**任何讀取失敗都不得讓應用程式開不起來** —— 那是最糟的失敗模式。
   * 無法信任的檔案改名保留（不刪除），以空 workspace 繼續。
   */
  load(): void {
    let raw: string
    try {
      raw = fs.readFileSync(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`[workspace] config unreadable, starting with an empty workspace: ${String(error)}`)
      }
      this.folders = []
      return
    }

    const parsed = parseWorkspace(raw)
    if (!parsed) {
      const kept = quarantine(this.filePath)
      console.error(
        `[workspace] config unparsable, starting with an empty workspace` +
          (kept ? `; the original was kept at ${kept}` : `; the original could not be kept`),
      )
      this.folders = []
      return
    }

    this.folders = parsed.folders
  }

  list(): WorkspaceFolder[] {
    return this.folders.map(describeFolder)
  }

  /**
   * 加入一個目錄。路徑以解析 symlink 後的真實路徑保存，去重也以它為準 ——
   * 同一個目錄經由不同 symlink 加入兩次應視為同一個。
   */
  add(dirPath: string): WorkspaceFolder {
    const real = fs.realpathSync(dirPath)
    if (!isDirectory(real)) {
      throw new Error(`not a directory: ${dirPath}`)
    }

    const existing = this.folders.find((folder) => folder.path === real)
    if (existing) return describeFolder(existing)

    const folder: PersistedFolder = {
      id: randomUUID(),
      path: real,
      addedAt: new Date().toISOString(),
    }
    this.folders.push(folder)
    this.save()
    return describeFolder(folder)
  }

  /**
   * 重排 folder 的順序。**清單的順序就是 rail 上的呈現順序**，它是 workspace 狀態的一部分。
   *
   * **以識別碼定位，不以位置。** 這份清單的權威在主行程，renderer 手上是一份經推送的複本，而
   * `workspace:folders:changed` 隨時可能推來新的一份（分支變動、另一處移除了 folder）——
   * 一個飛行中的位置索引因此可能已經指向**另一個** folder。以 id 定位時，最壞情況只是落點偏
   * 一格，不會**移錯一個 repo**（design D5）。
   *
   * 未知的 id 靜默返回（比照 `remove`）；越界的目標位置夾制於清單範圍內。
   */
  reorder(id: string, toIndex: number): void {
    const from = this.folders.findIndex((folder) => folder.id === id)
    if (from === -1) return

    const to = Math.min(Math.max(Math.trunc(toIndex), 0), this.folders.length - 1)
    if (Number.isNaN(to) || to === from) return

    const [moved] = this.folders.splice(from, 1)
    this.folders.splice(to, 0, moved)
    this.save()
  }

  /** 只影響 workspace 設定，不更動磁碟上的檔案或目錄。 */
  remove(id: string): void {
    const next = this.folders.filter((folder) => folder.id !== id)
    if (next.length === this.folders.length) return
    this.folders = next
    this.save()
  }

  private save(): void {
    writeWorkspaceFileAtomic(this.filePath, { version: WORKSPACE_VERSION, folders: this.folders })
  }
}
