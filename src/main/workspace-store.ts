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
  /**
   * 置頂。**這一個是使用者的意圖，因此要落盤** —— 與同一個檔案裡「衍生狀態一律不存」的
   * `hasOpenSpec` / `branch` 不同類：磁碟上沒有任何事實可以拿來重算它。
   *
   * 未置頂時**不寫入這個欄位**（缺席即未置頂）。舊設定檔沒有它，讀進來一律是未置頂，
   * 因此**不必升 `WORKSPACE_VERSION`**；反之若升版，舊版會因版號不符而把整個 workspace
   * 隔離，那是遠差的失效模式。
   */
  pinned?: boolean
}

interface PersistedWorkspace {
  version: number
  folders: PersistedFolder[]
}

export type FolderStatus = 'ok' | 'missing'

export interface WorkspaceFolder extends PersistedFolder {
  name: string
  status: FolderStatus
  /**
   * 對 renderer 一律是布林（不是 `boolean | undefined`）—— 落盤端省略即未置頂，那是儲存格式的
   * 細節，不該讓每一個消費點都去處理缺席。
   */
  pinned: boolean
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
    pinned: folder.pinned === true,
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
    const { id, path: folderPath, addedAt, pinned } = entry as Record<string, unknown>
    if (typeof id !== 'string' || typeof folderPath !== 'string' || typeof addedAt !== 'string') {
      return null
    }
    // 缺席 ⇒ 未置頂（舊設定檔的常態，SHALL NOT 因此被判為損毀）；存在但型別不符 ⇒ 比照其他
    // 欄位視為不可信任。
    if (pinned !== undefined && typeof pinned !== 'boolean') return null
    parsed.push(pinned === true ? { id, path: folderPath, addedAt, pinned } : { id, path: folderPath, addedAt })
  }

  return { version, folders: normalizePinnedPrefix(parsed) }
}

/**
 * 「置頂者恆佔清單前綴」——**穩定分割**，兩組各自的相對順序不變。
 *
 * 在**載入時**做一次，其後由 `WorkspaceStore.place()` 維持。人手改過、置頂散落在中間的設定檔
 * SHALL 被正規化而**不是**被判為損毀：那是外觀問題，不值得讓使用者的整個 workspace 消失。
 *
 * 有了它，「rail 上 folder 的呈現順序」與「清單順序」恆為同一件事 —— 呈現不必是清單的一個
 * 函數，於是不會生出第二種順序。
 */
/** 未置頂就不留欄位 —— 缺席即未置頂，落盤的內容因此不會累積一堆 `"pinned": false`。 */
function withoutPinned(folder: PersistedFolder): PersistedFolder {
  const { pinned: _pinned, ...rest } = folder
  return rest
}

function normalizePinnedPrefix(folders: PersistedFolder[]): PersistedFolder[] {
  const pinned = folders.filter((folder) => folder.pinned === true)
  if (pinned.length === 0 || pinned.length === folders.length) return folders
  return [...pinned, ...folders.filter((folder) => folder.pinned !== true)]
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
   *
   * **`pinned` 是必填，沒有「省略即維持現狀」。** 呼叫端有兩個（拖曳、`Shift+↑↓`），兩者都可能
   * 使 folder 跨越分界 —— 一個會被忘記的預設值在這裡的失效是靜默的：folder 移到了分界的另一
   * 側，狀態卻沒跟著改。
   */
  reorder(id: string, toIndex: number, pinned: boolean): void {
    this.place(id, toIndex, pinned)
  }

  /**
   * 切換置頂狀態。位置為**跨越分界的最小移動**：置頂 → 置頂段末端，取消 → 其餘段首端。
   *
   * 兩者都是「移除之後插在分界那一格」，因此目標序位同為 `pinnedCountWithout(id)`。
   */
  setPinned(id: string, pinned: boolean): void {
    const rest = this.folders.filter((folder) => folder.id !== id)
    if (rest.length === this.folders.length) return
    this.place(id, rest.filter((folder) => folder.pinned === true).length, pinned)
  }

  /**
   * **唯一**會改變位置或置頂旗標的地方 —— 「置頂者佔前綴」這條不變式由這裡單獨擔保，
   * 呼叫端無論送來什麼都無法違反它（目標序位會被夾制進該置頂狀態允許的範圍）。
   *
   * **早退的條件是「位置與置頂狀態**皆**未改變」，不是「位置未改變」。** 跨越分界的移動其序位
   * 前後**同值**（置頂段的最後一個變成其餘段的第一個），以「位置相同即返回」為早退條件會讓
   * 旗標不寫入、`save()` 也不發生 —— 使用者看到的是「拖了半天它沒有被取消置頂」。
   */
  private place(id: string, folderIndex: number, pinned: boolean): void {
    const from = this.folders.findIndex((folder) => folder.id === id)
    if (from === -1) return

    const requested = Math.trunc(folderIndex)
    if (Number.isNaN(requested)) return

    const rest = [...this.folders]
    const [moved] = rest.splice(from, 1)
    const pinnedCount = rest.filter((folder) => folder.pinned === true).length

    // 置頂者只能落在前綴之內，未置頂者只能落在其後 —— 夾制在這裡，不變式因此無從被違反。
    const lower = pinned ? 0 : pinnedCount
    const upper = pinned ? pinnedCount : rest.length
    const to = Math.min(Math.max(requested, lower), upper)

    if (to === from && pinned === (moved.pinned === true)) return

    rest.splice(to, 0, pinned ? { ...moved, pinned: true } : withoutPinned(moved))
    this.folders = rest
    this.save()
  }

  /** 只影響 workspace 設定，不更動磁碟上的檔案或目錄。 */
  remove(id: string): void {
    const next = this.folders.filter((folder) => folder.id !== id)
    if (next.length === this.folders.length) return
    this.folders = next
    this.save()
  }

  /**
   * 清單變動的訂閱者。
   *
   * **存在的理由只有一個**：agent 的自我介紹列著可交接的對象，而它必須取當下的值
   * （`handoff-injection` 的 `refreshIntros`）。沒有這個訊號，那份清單只在 session 建立的
   * 那一刻正確，而失效是靜默的。
   */
  readonly #listeners = new Set<() => void>()

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  private save(): void {
    writeWorkspaceFileAtomic(this.filePath, { version: WORKSPACE_VERSION, folders: this.folders })
    for (const listener of this.#listeners) listener()
  }
}
