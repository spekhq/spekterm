import path from 'node:path'
import type { FSWatcher } from 'chokidar'
import { isWithin, resolveWithinRoot } from './fs-boundary'
import { FsServiceError, toPosixRelPath } from './fs-service'
import { createWatcher } from './watcher'
import type { FolderLookup } from './workspace-store'

export type WatchEventType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'

const WATCH_EVENT_TYPES: readonly WatchEventType[] = [
  'add',
  'change',
  'unlink',
  'addDir',
  'unlinkDir',
]

export interface WatchEvent {
  type: WatchEventType
  /** 相對於 folder 根目錄，以 `/` 分隔。renderer 沒有詞彙表達絕對路徑。 */
  relPath: string
}

export interface WatchBatch {
  folderId: string
  events: WatchEvent[]
}

/** agent 一次寫十個檔案，不該讓 renderer 重繪十次。 */
const DEFAULT_DEBOUNCE_MS = 50

/**
 * 自寫紀錄的存活時間。
 *
 * 它只是清理機制，不承擔正確性 —— 正確性來自 mtime 的單調性：任何**後續**的外部寫入
 * 都會產生比紀錄值更新的 mtime，因而不會被抑制。
 */
const SELF_WRITE_TTL_MS = 5_000

interface SelfWrite {
  mtimeMs: number
  expiresAt: number
}

/** 尚未送出的事件。多帶兩個欄位供自寫比對，送出前會被剝除。 */
interface PendingEvent extends WatchEvent {
  absPath: string
  /** `unlink` 類事件沒有 stats。 */
  mtimeMs: number | null
}

interface FolderWatcher {
  watcher: FSWatcher
  root: string
  /** 訂閱者：正規化後的 relPath → 它解析出的絕對路徑。 */
  subscriptions: Map<string, string>
  /**
   * 絕對路徑 → 訂閱它的 relPath 集合。
   *
   * **兩者不是一對一的。** folder 內一個指向 `sub/` 的 symlink `link-to-sub/`，在樹上是
   * 兩個節點、在磁碟上是同一個目錄。少了這層參考計數，收合其中一個節點就會把另一個
   * 節點的監看一併關掉（chokidar 只認絕對路徑）。
   */
  watchers: Map<string, Set<string>>
  pending: PendingEvent[]
  timer: NodeJS.Timeout | null
}

/**
 * 監看集合的 key。**只做字面正規化，不碰檔案系統** —— `unwatch` 可能發生在目錄已被
 * 刪除之後，那時 `realpath` 會失敗，而我們仍必須找得到要關閉的那個訂閱。
 *
 * 於是 `.`、`./sub` 與 `sub` 會收斂到同一個 key，與 renderer 傳來的字面形式無關。
 */
function watchKey(root: string, relPath: string): string {
  return toPosixRelPath(path.relative(root, path.resolve(root, relPath)))
}

/** `''`（root）之下的 `a.txt` 是 `a.txt`，`sub` 之下的是 `sub/a.txt`。 */
function joinPosix(dir: string, name: string): string {
  return dir === '' ? name : `${dir}/${name}`
}

/**
 * 監看 workspace folder 內「使用者正在看的那些目錄」。
 *
 * 監看集合恆等於檔案樹上已展開的目錄集合，這靠 `depth: 0` 達成：每個被加入的目錄只回報
 * 它的直接子項目。於是沒展開的目錄一個 watcher 都不花，也就不需要猜測要排除哪些目錄
 *（`node_modules`？`.git`？—— 使用者展開了它，他就是想看它）。
 *
 * **訂閱以樹上的路徑定址，監看以磁碟上的真實路徑進行。** 兩者靠 `watchers` 這層參考計數
 * 對接：chokidar 只認絕對路徑，而樹上可能有多個節點指向同一個目錄（symlink）。
 *
 * 不依賴 Electron，因此可由單元測試直接驅動：推送的出口是建構時傳入的 `send`。
 */
export class WatchService {
  readonly #folders = new Map<string, FolderWatcher>()

  /**
   * 本 renderer 自己剛寫過的檔案：真實絕對路徑 → 寫入後的 mtime。
   *
   * 我們寫檔，chokidar 就會推一則 `change`，而檢視器收到 `change` 就顯示「檔案已在磁碟上
   * 變更」—— 每一次存檔都會變成一則自己造成的假警報（design D12）。
   */
  readonly #selfWrites = new Map<string, SelfWrite>()

  constructor(
    private readonly store: FolderLookup,
    private readonly send: (batch: WatchBatch) => void,
    private readonly debounceMs: number = DEFAULT_DEBOUNCE_MS,
    /**
     * 建立 watcher 的實作，預設即 `createWatcher`。與 `BranchService` 的同名參數同一個理由：
     * **這個服務餵給輪詢判定的是哪一條路徑，從它的外部行為看不出來**。
     *
     * 這裡的斷言只到「傳出的依據路徑是 folder 根」為止 —— 要驗到實際效果，得讓某個子目標落在
     * 與 folder 根不同的掛載點上，而那正是規格宣告不支援的組態（單一 watcher 服務跨掛載點的
     * 多個目標，`usePolling` 於建構時就定了）。**一個規格宣告不支援的情形，驗收造不出來。**
     */
    private readonly watcherFactory: typeof createWatcher = createWatcher,
  ) {}

  /** 目前被訂閱的樹節點總數。驗收「收合後不再監看」與「重新載入不累積」用得上。 */
  get watchedCount(): number {
    let total = 0
    for (const folder of this.#folders.values()) total += folder.subscriptions.size
    return total
  }

  /** 目前實際交給 chokidar 的絕對路徑數量。symlink 別名不會讓它翻倍。 */
  get watchedPathCount(): number {
    let total = 0
    for (const folder of this.#folders.values()) total += folder.watchers.size
    return total
  }

  /**
   * 記錄一次由本應用程式造成的寫入。以**真實絕對路徑**為 key —— 一次寫入在磁碟上是一個
   * 事件，即使樹上有多個 symlink 別名指向它。
   *
   * 呼叫端必須在寫入完成後立即呼叫。事件仍可能比它先抵達 chokidar，因此比對發生在
   * `#flush`（有 debounce 的窗口）而不是 `#enqueue`。
   */
  noteSelfWrite(realPath: string, mtimeMs: number): void {
    const now = Date.now()
    for (const [key, noted] of this.#selfWrites) {
      if (now > noted.expiresAt) this.#selfWrites.delete(key)
    }
    this.#selfWrites.set(realPath, { mtimeMs, expiresAt: now + SELF_WRITE_TTL_MS })
  }

  /**
   * 這則事件是不是我們自己剛才寫出來的？
   *
   * 比對用「**不新於**」而非「等於」：實測 chokidar 取得的 mtime 可能落在 truncate 與
   * write 之間，比我們 `fstat` 到的值略小。而任何後續的外部寫入，其 mtime 必然更新。
   */
  #isSelfWrite(event: PendingEvent): boolean {
    if (event.type !== 'change' || event.mtimeMs === null) return false

    const noted = this.#selfWrites.get(event.absPath)
    if (!noted) return false
    if (Date.now() > noted.expiresAt) {
      this.#selfWrites.delete(event.absPath)
      return false
    }

    return event.mtimeMs <= noted.mtimeMs
  }

  async watch(folderId: string, relPath: string): Promise<void> {
    const folder = this.store.list().find((candidate) => candidate.id === folderId)
    if (!folder) throw new FsServiceError('UNKNOWN_FOLDER', `unknown folder: ${folderId}`)
    if (folder.status !== 'ok') {
      throw new FsServiceError('FOLDER_UNAVAILABLE', `folder is unavailable: ${folder.path}`)
    }

    // 邊界檢查與 listDir 同源：解析 symlink 之後仍須位於 folder 之內。
    const target = await resolveWithinRoot(folder.path, relPath)
    const key = watchKey(folder.path, relPath)

    const existing = this.#folders.get(folderId)
    if (!existing) {
      this.#folders.set(folderId, this.#createFolderWatcher(folderId, folder.path, key, target))
      return
    }

    if (existing.subscriptions.has(key)) return
    existing.subscriptions.set(key, target)

    const subscribers = existing.watchers.get(target)
    if (subscribers) {
      // 這個絕對路徑已在監看中（另一個節點指向它）。只記一筆訂閱，不重複 add。
      subscribers.add(key)
      return
    }

    existing.watchers.set(target, new Set([key]))
    existing.watcher.add(target)
  }

  unwatch(folderId: string, relPath: string): void {
    const folder = this.#folders.get(folderId)
    if (!folder) return

    const key = watchKey(folder.root, relPath)
    const target = folder.subscriptions.get(key)
    if (!target) return

    folder.subscriptions.delete(key)

    const subscribers = folder.watchers.get(target)
    if (!subscribers) return

    subscribers.delete(key)
    // 還有別的節點指向同一個目錄時，不能真的取消監看它。
    if (subscribers.size === 0) {
      folder.watchers.delete(target)
      folder.watcher.unwatch(target)
    }

    if (folder.subscriptions.size === 0) void this.#closeFolder(folderId)
  }

  /**
   * 清空所有監看。renderer 重新載入時必須呼叫 —— 重新載入不會銷毀 `webContents`，
   * 因此只掛在銷毀事件上的清理不會被觸發，而新的頁面會重新訂閱它需要的目錄。
   */
  async unwatchAll(): Promise<void> {
    await Promise.all([...this.#folders.keys()].map((folderId) => this.#closeFolder(folderId)))
  }

  /** 某個 folder 自 workspace 移除時，它的 watcher 就沒有意義了。 */
  async releaseFolder(folderId: string): Promise<void> {
    await this.#closeFolder(folderId)
  }

  async dispose(): Promise<void> {
    await this.unwatchAll()
  }

  #createFolderWatcher(folderId: string, root: string, key: string, target: string): FolderWatcher {
    // `pollingRoot` 與 `label` 都用 folder 根，而不是 `target` —— **這個 watcher 服務 N 個動態
    // 增減的子目標**（見下方的 `watcher.add()` / `unwatch()`）：那些子目標都在 folder 之內，
    // 用根判定 polling 是正確的；而 chokidar 的錯誤事件不指出是哪一個目標失敗，印 `target`
    // 只會識別到「碰巧第一個被訂閱的目錄」。
    //
    // **這是產品程式碼中唯一顯式傳 `pollingRoot` 的地方**（其餘每一個建立點都是一對一，靠預設；
    // 完整清單見 `watcher.ts` 的檔頭 —— 那裡是唯一該維護那份清單的地方）。
    // 因此它看起來會像一個可以順手清掉的殘留 —— 刪掉它不會讓型別、既有測試或探針變紅，只會讓
    // 跨掛載點的使用者靜默受害。`watch-service.test.ts` 有一條測試專門釘住它，別繞過。
    const watcher = this.watcherFactory({
      target,
      pollingRoot: root,
      label: root,
      depth: 0,
      // 事件必須帶著 mtime 抵達，否則無從分辨「agent 改的」與「我們自己存的」。
      alwaysStat: true,
    })

    const folder: FolderWatcher = {
      watcher,
      root,
      subscriptions: new Map([[key, target]]),
      watchers: new Map([[target, new Set([key])]]),
      pending: [],
      timer: null,
    }

    for (const type of WATCH_EVENT_TYPES) {
      watcher.on(type, (absPath: string, stats?: { mtimeMs: number }) => {
        this.#enqueue(folderId, type, absPath, stats?.mtimeMs ?? null)
      })
    }
    return folder
  }

  /**
   * 把一個絕對路徑的變更，派送給每一個「正在看它所在目錄」的樹節點。
   *
   * chokidar 回報的是磁碟上的真實路徑（`<root>/sub/x.txt`）。而樹上看著它的節點可能叫
   * `sub`，也可能叫 `link-to-sub` —— 事件必須以**訂閱者的路徑**表達，否則 renderer 會拿
   * 一個它認不得的 relPath 去找節點，什麼也找不到。
   */
  #enqueue(
    folderId: string,
    type: WatchEventType,
    absPath: string,
    mtimeMs: number | null,
  ): void {
    const folder = this.#folders.get(folderId)
    if (!folder) return

    // 縱深防禦。followSymlinks 已關閉，理應不會有邊界外的路徑走到這裡 ——
    // 但推給 renderer 的每一個路徑，都必須是 renderer 有詞彙表達的路徑。
    if (!isWithin(folder.root, absPath)) return

    const parent = path.dirname(absPath)
    const name = path.basename(absPath)
    const subscribers = folder.watchers.get(parent)
    if (!subscribers) return

    for (const key of subscribers) {
      folder.pending.push({ type, relPath: joinPosix(key, name), absPath, mtimeMs })
    }
    if (folder.pending.length === 0) return

    if (folder.timer) return
    folder.timer = setTimeout(() => {
      folder.timer = null
      this.#flush(folderId)
    }, this.debounceMs)
    // 合批的計時器不該讓 Electron 的主行程無法結束
    folder.timer.unref?.()
  }

  #flush(folderId: string): void {
    const folder = this.#folders.get(folderId)
    if (!folder || folder.pending.length === 0) return

    const pending = folder.pending
    folder.pending = []

    // 自寫的比對留到此刻才做：事件可能比 `noteSelfWrite` 更早抵達 chokidar，
    // debounce 的窗口正好讓那筆紀錄趕上。
    const events = pending
      .filter((event) => !this.#isSelfWrite(event))
      .map(({ type, relPath }): WatchEvent => ({ type, relPath }))

    if (events.length === 0) return
    this.send({ folderId, events })
  }

  async #closeFolder(folderId: string): Promise<void> {
    const folder = this.#folders.get(folderId)
    if (!folder) return

    this.#folders.delete(folderId)
    if (folder.timer) clearTimeout(folder.timer)
    await folder.watcher.close()
  }
}
