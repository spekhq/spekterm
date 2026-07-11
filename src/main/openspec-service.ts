import { stat } from 'node:fs/promises'
import path from 'node:path'
import {
  type ChangeInfo,
  type GraphData,
  type HistoryEntry,
  type ParsedTasks,
  type ScanResult,
  type TaskStats,
  buildGraphData,
  pollingInterval,
  readChange,
  readSpec,
  readSpecAtChange,
  scanOpenSpec,
  shouldUsePolling,
  withAuthoritativeChokidarEnv,
} from '@spekjs/core'
import { type FSWatcher, watch as chokidarWatch } from 'chokidar'
import { isWithin } from './fs-boundary'
import type { FolderLookup } from './workspace-store'

export type OpenSpecErrorCode = 'UNKNOWN_FOLDER' | 'NOT_FOUND' | 'READ_FAILED'

export class OpenSpecServiceError extends Error {
  constructor(
    readonly code: OpenSpecErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'OpenSpecServiceError'
  }
}

/**
 * 送往 renderer 的 spec 摘要。
 *
 * core 的 `SpecInfo.path` 是**絕對路徑**，這裡一律翻成 folder-relative 的 `relPath`
 *（design D5）—— renderer 的全部設計前提是「它沒有詞彙可以表達 workspace 之外的位置」，
 * DTO 裡一旦出現絕對路徑，這個前提就破了。
 *
 * `relatedChangeCount` 直接取 core 的 `historyCount`：實測兩者恆等（`findRelatedChanges`
 * 的長度），因此不必為了這個數字再跑一次 N 個 topic 的查詢。
 */
export interface SpecSummary {
  topic: string
  relPath: string | null
  relatedChangeCount: number
}

export interface SpecDetailView {
  topic: string
  content: string
  relatedChanges: string[]
  history: HistoryEntry[]
  relPath: string | null
}

export interface SpecVersionView {
  topic: string
  slug: string
  content: string
}

export interface OverviewData {
  specCount: number
  activeChangeCount: number
  archivedChangeCount: number
  defaultSchema: string | null
  /** active change 的 tasks 加總。沒有任何 tasks 時為零。 */
  taskStats: TaskStats
}

export interface ChangesData {
  active: ChangeInfo[]
  archived: ChangeInfo[]
  defaultSchema: string | null
}

export interface DeltaSpecView {
  topic: string
  content: string
  relPath: string | null
}

export interface ChangeArtifactView {
  id: string
  title: string
  kind: 'markdown' | 'tasks' | 'specs'
  content?: string
  tasks?: ParsedTasks
  specs?: DeltaSpecView[]
  /** 該 artifact 的底層檔案（`kind: 'specs'` 沒有單一檔案，為 null）。供交叉導覽。 */
  relPath: string | null
}

export interface ChangeDetailView {
  slug: string
  status: 'active' | 'archived'
  createdDate: string | null
  archivedDate: string | null
  schema: string | null
  defaultSchema: string | null
  artifacts: ChangeArtifactView[]
  schemaOrder?: string[]
  /** change 的目錄。供交叉導覽。 */
  relPath: string | null
}

/** agent 的一次操作會寫入數個檔案（proposal + design + specs/*.md + tasks），不合批就會讓側欄連續重載。 */
const DEFAULT_DEBOUNCE_MS = 150

interface FolderWatch {
  watcher: FSWatcher
  timer: NodeJS.Timeout | null
}

function toRelPath(root: string, abs: string): string | null {
  if (!isWithin(root, abs)) return null
  const rel = path.relative(root, abs)
  if (rel === '') return null
  return rel.split(path.sep).join('/')
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

/**
 * 一個 change 的目錄，以 OpenSpec 的慣例推導。
 *
 * core 沒有把 change 的路徑放進 `ChangeDetail`，而 `listChangeMarkdownFiles()` 回的是
 * repo 根目錄的 markdown（`CLAUDE.md` / `README.md`），**不是** change 的 artifact ——
 * 已實測，不要拿它來推路徑。
 *
 * 因此這裡依慣例推導候選路徑，並以 `stat` 確認它真的存在。推不出來就回 `null`：
 * 側欄少一個「跳到檔案」的入口，好過送一個不存在或越界的路徑給 renderer（design D5）。
 */
async function changeDirRelPath(
  root: string,
  slug: string,
  status: 'active' | 'archived',
): Promise<string | null> {
  const rel =
    status === 'archived' ? `openspec/changes/archive/${slug}` : `openspec/changes/${slug}`
  const abs = path.join(root, rel)
  if (!isWithin(root, abs)) return null
  return (await exists(abs)) ? rel : null
}

async function artifactRelPath(root: string, changeDir: string | null, id: string): Promise<string | null> {
  if (!changeDir) return null
  const rel = `${changeDir}/${id}.md`
  const abs = path.join(root, rel)
  if (!isWithin(root, abs)) return null
  return (await exists(abs)) ? rel : null
}

async function deltaSpecRelPath(
  root: string,
  changeDir: string | null,
  topic: string,
): Promise<string | null> {
  if (!changeDir) return null
  const rel = `${changeDir}/specs/${topic}/spec.md`
  const abs = path.join(root, rel)
  if (!isWithin(root, abs)) return null
  return (await exists(abs)) ? rel : null
}

function sumTaskStats(changes: ChangeInfo[]): TaskStats {
  let total = 0
  let completed = 0
  for (const change of changes) {
    if (!change.taskStats) continue
    total += change.taskStats.total
    completed += change.taskStats.completed
  }
  return { total, completed }
}

/**
 * 主行程為每個 workspace folder 供應 OpenSpec 結構。
 *
 * 三件事貫穿整個類別：
 *
 * 1. **定址只認 `folderId`。** 絕對路徑既不進來（renderer 沒有詞彙說它）也不出去
 *    （DTO 的路徑欄位一律 folder-relative）。
 * 2. **`slug` / `topic` 是不受信任的輸入。** 它們會被 core 拿去拼路徑，因此一律先在掃描
 *    結果裡**查表**，查不到就不呼叫 core（design D6）。這是白名單，不是「過濾 `..`」那種
 *    黑名單 —— 後者總有漏網的編碼形式。
 * 3. **快取 + 監看。** 這個 app 的前提是旁邊有 agent 一直在寫檔，側欄不能是啟動時的快照。
 *
 * 不依賴 Electron，因此可由單元測試直接驅動：推送的出口是建構時傳入的 `send`。
 */
export class OpenSpecService {
  readonly #cache = new Map<string, ScanResult>()
  /** 同一個 folder 的併發請求共用一次掃描 —— 四個 tab 同時開，不該掃四次。 */
  readonly #inflight = new Map<string, Promise<ScanResult>>()
  readonly #watches = new Map<string, FolderWatch>()

  constructor(
    private readonly store: FolderLookup,
    private readonly send: (folderId: string) => void,
    private readonly debounceMs: number = DEFAULT_DEBOUNCE_MS,
    /**
     * 掃描的實作。預設即 core 的 `scanOpenSpec`。
     *
     * 之所以是個可注入的依賴：「快取命中時不重複掃描」是**效能特性**，從外部的回傳值看不
     * 出來 —— 不把掃描這件事顯式化，就只能靠計時之類的脆弱手段去猜它有沒有真的跑。
     */
    private readonly scan: (root: string) => Promise<ScanResult> = scanOpenSpec,
  ) {}

  /** 驗收「快取命中不重掃」與「重新載入不累積 watcher」用得上。 */
  get watchedFolderCount(): number {
    return this.#watches.size
  }

  async getOverview(folderId: string): Promise<OverviewData> {
    const { result } = await this.#scan(folderId)
    return {
      specCount: result.specs.length,
      activeChangeCount: result.activeChanges.length,
      archivedChangeCount: result.archivedChanges.length,
      defaultSchema: result.defaultSchema,
      taskStats: sumTaskStats(result.activeChanges),
    }
  }

  async getSpecs(folderId: string): Promise<SpecSummary[]> {
    const { root, result } = await this.#scan(folderId)
    return result.specs.map((spec) => ({
      topic: spec.topic,
      relPath: toRelPath(root, spec.path),
      relatedChangeCount: spec.historyCount,
    }))
  }

  async getSpec(folderId: string, topic: string): Promise<SpecDetailView> {
    const { root, result } = await this.#scan(folderId)
    const info = result.specs.find((spec) => spec.topic === topic)
    if (!info) throw new OpenSpecServiceError('NOT_FOUND', `unknown spec topic: ${topic}`)

    const detail = await this.#read(() => readSpec(root, info.topic), `spec not readable: ${topic}`)
    return {
      topic: detail.topic,
      content: detail.content,
      relatedChanges: detail.relatedChanges,
      history: detail.history,
      relPath: toRelPath(root, info.path),
    }
  }

  async getSpecAtChange(folderId: string, topic: string, slug: string): Promise<SpecVersionView> {
    const { root, result } = await this.#scan(folderId)
    const spec = result.specs.find((entry) => entry.topic === topic)
    if (!spec) throw new OpenSpecServiceError('NOT_FOUND', `unknown spec topic: ${topic}`)
    const change = this.#findChange(result, slug)

    const version = await this.#read(
      () => readSpecAtChange(root, spec.topic, change.slug),
      `spec ${topic} not present at change ${slug}`,
    )
    return { topic: spec.topic, slug: change.slug, content: version.content }
  }

  async getChanges(folderId: string): Promise<ChangesData> {
    const { result } = await this.#scan(folderId)
    return {
      active: result.activeChanges,
      archived: result.archivedChanges,
      defaultSchema: result.defaultSchema,
    }
  }

  async getChange(folderId: string, slug: string): Promise<ChangeDetailView> {
    const { root, result } = await this.#scan(folderId)
    const info = this.#findChange(result, slug)

    const detail = await this.#read(
      () => readChange(root, info.slug),
      `change not readable: ${slug}`,
    )
    const changeDir = await changeDirRelPath(root, info.slug, detail.status)

    const artifacts: ChangeArtifactView[] = await Promise.all(
      detail.artifacts.map(async (artifact) => ({
        id: artifact.id,
        title: artifact.title,
        kind: artifact.kind,
        content: artifact.content,
        tasks: artifact.tasks,
        specs: artifact.specs
          ? await Promise.all(
              artifact.specs.map(async (delta) => ({
                topic: delta.topic,
                content: delta.content,
                relPath: await deltaSpecRelPath(root, changeDir, delta.topic),
              })),
            )
          : undefined,
        // specs 是一整棵子目錄，沒有單一檔案可跳。
        relPath:
          artifact.kind === 'specs' ? null : await artifactRelPath(root, changeDir, artifact.id),
      })),
    )

    return {
      slug: detail.slug,
      status: detail.status,
      createdDate: detail.createdDate,
      archivedDate: detail.archivedDate,
      schema: detail.schema,
      defaultSchema: detail.defaultSchema,
      artifacts,
      schemaOrder: detail.schemaOrder,
      relPath: changeDir,
    }
  }

  async getGraphData(folderId: string): Promise<GraphData> {
    const { root } = await this.#scan(folderId)
    // 節點與邊只帶 `spec:<topic>` / `change:<slug>` 這類識別碼，沒有路徑欄位可洩漏。
    return this.#read(() => buildGraphData(root), `graph not available: ${folderId}`)
  }

  /** folder 自 workspace 移除，或 renderer 消失時釋放。 */
  async releaseFolder(folderId: string): Promise<void> {
    this.#invalidate(folderId)
    const watch = this.#watches.get(folderId)
    if (!watch) return
    this.#watches.delete(folderId)
    if (watch.timer) clearTimeout(watch.timer)
    await watch.watcher.close()
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.#watches.keys()].map((folderId) => this.releaseFolder(folderId)))
    this.#cache.clear()
    this.#inflight.clear()
  }

  /**
   * `slug` 的白名單查表（design D6）。
   *
   * 只有掃描確實發現的 change 才可讀 —— 一個 `slug = "../../../../etc"` 在這裡就被擋下，
   * 而且**不會**有任何以它拼接而成的檔案系統存取。
   */
  #findChange(result: ScanResult, slug: string): ChangeInfo {
    const change = [...result.activeChanges, ...result.archivedChanges].find(
      (entry) => entry.slug === slug,
    )
    if (!change) throw new OpenSpecServiceError('NOT_FOUND', `unknown change slug: ${slug}`)
    return change
  }

  /**
   * 呼叫 core 的讀取函式。
   *
   * core 的介面有兩個容易踩的點，都已實測：`readSpec` / `readChange` 找不到目標時**回 `null`
   * 而不是拋錯**；而 `readSpecAtChange` / `buildGraphData` / `findRelatedChanges` 是**同步**
   * 函式（會阻塞主行程做磁碟 IO）。這裡把兩者統一收斂為「拿不到就是 NOT_FOUND」。
   */
  async #read<T>(run: () => T | Promise<T | null> | null, missing: string): Promise<T> {
    let value: T | null | undefined
    try {
      value = await run()
    } catch (error) {
      throw new OpenSpecServiceError('READ_FAILED', String(error))
    }
    if (value === null || value === undefined) {
      throw new OpenSpecServiceError('NOT_FOUND', missing)
    }
    return value
  }

  async #scan(folderId: string): Promise<{ root: string; result: ScanResult }> {
    const folder = this.store.list().find((entry) => entry.id === folderId)
    if (!folder) throw new OpenSpecServiceError('UNKNOWN_FOLDER', `unknown folder: ${folderId}`)
    const root = folder.path

    const cached = this.#cache.get(folderId)
    if (cached) return { root, result: cached }

    const inflight = this.#inflight.get(folderId)
    if (inflight) return { root, result: await inflight }

    // **先訂閱、再掃描。** 反過來的話，兩者之間的窗口裡發生的變更會兩頭落空 ——
    // 掃描沒看到它，事件也還沒開始送（Phase 2 的教訓，這裡同樣適用）。
    this.#ensureWatch(folderId, root)

    const promise = this.scan(root)
      .then((result) => {
        // 掃描期間若有變更事件抵達，快取已被 invalidate 清掉 —— 此時不可把過期的結果塞回去。
        if (this.#inflight.get(folderId) === promise) {
          this.#cache.set(folderId, result)
          this.#inflight.delete(folderId)
        }
        return result
      })
      .catch((error) => {
        this.#inflight.delete(folderId)
        throw new OpenSpecServiceError('READ_FAILED', String(error))
      })

    this.#inflight.set(folderId, promise)
    return { root, result: await promise }
  }

  #ensureWatch(folderId: string, root: string): void {
    if (this.#watches.has(folderId)) return

    const target = path.join(root, 'openspec')
    const usePolling = shouldUsePolling(root)
    const interval = pollingInterval()

    // callback 必須同步（見 core 的 withAuthoritativeChokidarEnv）：env 的對齊只在
    // set → chokidar 建構 → restore 這段同步窗口內有效。
    const watcher = withAuthoritativeChokidarEnv(usePolling, interval, () =>
      chokidarWatch(target, {
        // chokidar 的預設是 true。folder 內一個指向邊界外的 symlink 被展開時，watcher 會
        // 跟著走出去 —— listDir 守住的邊界會從這道側門漏掉（Phase 2 的實測）。
        followSymlinks: false,
        ignoreInitial: true,
        usePolling,
        interval,
      }),
    )

    const watch: FolderWatch = { watcher, timer: null }
    this.#watches.set(folderId, watch)

    watcher.on('all', () => {
      this.#invalidate(folderId)

      if (watch.timer) return
      watch.timer = setTimeout(() => {
        watch.timer = null
        this.send(folderId)
      }, this.debounceMs)
      // 合批的計時器不該讓 Electron 的主行程無法結束
      watch.timer.unref?.()
    })

    // watcher 的錯誤（例如 openspec/ 不存在）不該讓主行程掛掉：掃描結果本來就會是空的。
    watcher.on('error', () => {})
  }

  #invalidate(folderId: string): void {
    this.#cache.delete(folderId)
    // in-flight 的掃描已經過時了。讓它跑完但不要把結果寫進快取（見 #scan 的比對）。
    this.#inflight.delete(folderId)
  }
}
