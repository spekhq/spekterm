import fs from 'node:fs'
import path from 'node:path'
import type { FSWatcher } from 'chokidar'

import { createWatcher } from './watcher'
import type { DeliverOutcome, IntakeService } from './intake-service'

/**
 * 檔案落點 —— `deliver()` 的 adapter。
 *
 * ## 兩個入口，而第二個是承重的
 *
 * 1. **建立監看並等它就緒**，2. **再掃描落點既有的內容**。
 *
 * 這個順序會讓中間抵達的檔案被處理兩次 —— **而那是可接受的**，去重的權威是狀態 index，
 * 且內容相同的重複是靜默的。相反的順序會**漏掉**中間抵達的檔案，而漏掉是靜默的。
 *
 * **「等它就緒」不是多餘的一步，少了它有一個會永久遺漏的窗口**（實測）：chokidar 在
 * `ready` 之前看到的檔案一律視為「初始」，而 `ignoreInitial: true` 會把它們全部吞掉。
 * 於是一份在「建立監看」與「掃描」之間抵達的投遞，**兩邊都收不到** —— 監看當它是初始、
 * 掃描還沒跑到那裡。先等 `ready` 再掃，這個窗口就不存在：`ready` 之前的由掃描負責，
 * `ready` 之後的由事件負責，兩者重疊的部分由去重吸收。
 *
 * **少了掃描，整條管線在它最主要的情境下失效**：`createWatcher` 的 `ignoreInitial: true`
 * 是寫死且不可覆寫的（`watcher.ts`），於是「app 關著的時候投遞」—— 正是外部 producer 存在的
 * 理由 —— 的東西會永遠躺在落點裡。producer 那端看起來投遞成功，使用者這端看起來沒有人找他，
 * **兩端都沒有錯誤**。
 *
 * 這與 `branch-service` / `openspec-service` 是同一個模式：**初始狀態自己求，watcher 只接後續**。
 *
 * ## 監看必須同時收 `add` 與 `change`
 *
 * 「寫到一半的項目不被消費，補完之後仍被採納」是一條 requirement，而補寫發生在**同一個路徑**
 * 上 —— 它不會再產生一次 `add`。只訂 `add` 的實作，其症狀是「補完之後那則永遠不出現，
 * 直到下次重啟」。
 *
 * ## 為什麼要分批
 *
 * 關機一週累積的 backlog 會在開機那一刻全部落在啟動掃描上。**投遞的處理不得阻塞主行程** ——
 * 主行程失去回應的代價是整個工作台卡住，而主行程結束時所有 pty 一併死亡。
 * 因此每一批之間讓出 event loop，**而不是用「速率上限」把 backlog 拒絕掉**（那會在開機那一刻
 * 吃掉一整週的合法投遞）。
 */

/** 只採納這個副檔名。**這是縮小窗口，不是防護** —— 見 design D1。 */
const ACCEPTED_EXTENSION = '.json'

/** 單檔大小上限。超限者**不解析** —— 解析一份無上限的輸入會讓主行程失去回應。 */
export const MAX_DELIVERY_BYTES = 512 * 1024

/** 啟動掃描的批次大小。每批之間讓出 event loop。 */
const SCAN_BATCH = 20

export function inboxRoot(userDataPath: string): string {
  return path.join(userDataPath, 'intake-inbox')
}

/**
 * 讀一份投遞。**大小檢查兩次**：`stat` 在前（省掉整份讀取），讀回的長度在後（擋邊讀邊長）。
 * 超限回 `null`，呼叫端據此消費掉它。
 */
async function readBounded(file: string): Promise<{ contents: string } | { tooLarge: true } | null> {
  let stats: fs.Stats
  try {
    stats = await fs.promises.stat(file)
  } catch {
    return null
  }
  if (!stats.isFile()) return null
  if (stats.size > MAX_DELIVERY_BYTES) return { tooLarge: true }

  let contents: string
  try {
    contents = await fs.promises.readFile(file, 'utf8')
  } catch {
    return null
  }
  if (Buffer.byteLength(contents, 'utf8') > MAX_DELIVERY_BYTES) return { tooLarge: true }
  return { contents }
}

export interface IntakeSourceOptions {
  root: string
  adapter: string
  service: IntakeService
  /** 供測試觀察每一次處理的結果。 */
  onProcessed?: (file: string, consumed: boolean) => void
  /**
   * 落點的層數。`0` ＝ 扁平（共用投遞落點），`1` ＝ 每個來源一層子目錄（交接的落點）。
   *
   * **監看與掃描兩邊都要吃它，而漏掉監看那一邊的失效特別惡劣**：啟動掃描照常運作，只有
   * watcher 收不到事件 —— 症狀是「即時不進來、重啟才出現」，看起來完全像一個時序問題。
   */
  depth?: number
  /**
   * 如何把一份讀回來的內容變成一次投遞。預設是 `service.deliver(contents, adapter)`。
   *
   * **它存在是因為有些 adapter 的投遞帶著只有接收端算得出來的參數** —— 交接的來源由它落在
   * 哪個子目錄決定、目標由查表解析，兩者都**不能**是投遞內容裡的欄位（否則任何放進落點的
   * 檔案都能自選 folder）。於是那些值只能經這條路徑以參數供應。
   */
  deliver?: (contents: string, file: string) => Promise<DeliverOutcome>
}

export class IntakeSource {
  #watcher: FSWatcher | null = null
  readonly #root: string
  readonly #adapter: string
  readonly #service: IntakeService
  readonly #onProcessed?: (file: string, consumed: boolean) => void
  readonly #depth: number
  readonly #deliver: (contents: string, file: string) => Promise<DeliverOutcome>
  #inflight = new Set<string>()

  constructor({ root, adapter, service, onProcessed, depth = 0, deliver }: IntakeSourceOptions) {
    this.#root = root
    this.#adapter = adapter
    this.#service = service
    this.#onProcessed = onProcessed
    this.#depth = depth
    this.#deliver = deliver ?? ((contents) => this.#service.deliver(contents, this.#adapter))
  }

  /** mkdir → 建立監看 → 掃描既有內容。**順序是承重的，見檔頭。** */
  async start(): Promise<void> {
    await fs.promises.mkdir(this.#root, { recursive: true })

    this.#watcher = createWatcher({
      target: this.#root,
      label: this.#root,
      // 一對一監看：**不傳 `pollingRoot`**（那是給服務多目標的 watcher 的例外）。
      // 深度由呼叫端決定：共用落點是扁平的（`0`），交接的落點每個來源一層（`1`）。
      depth: this.#depth,
    })
    // **`add` 與 `change` 都要**：補寫發生在同一個路徑上，不會再產生一次 `add`。
    this.#watcher.on('add', (file) => void this.#handle(file))
    this.#watcher.on('change', (file) => void this.#handle(file))

    // 見檔頭：`ready` 之前抵達的檔案會被 `ignoreInitial` 吞掉，而它們也還沒被掃描看到。
    await new Promise<void>((resolve) => {
      this.#watcher?.once('ready', () => resolve())
    })

    await this.scan()
  }

  /** 掃描落點既有的內容。**分批，每批之間讓出 event loop。** */
  async scan(): Promise<void> {
    const files = await this.#collect(this.#root, this.#depth)
    for (let i = 0; i < files.length; i += SCAN_BATCH) {
      const batch = files.slice(i, i + SCAN_BATCH)
      for (const file of batch) await this.#handle(file)
      await new Promise((resolve) => setImmediate(resolve))
    }
  }

  /**
   * 收集落點中的候選檔案，最多下探 `depth` 層。
   *
   * **只在 `dirent.isDirectory()` 為真時下鑽** —— 不跟隨 symlink 目錄，與 `listFiles` 的手寫
   * 遞迴同一條理由（`fs.readdirSync` 與 `fs/promises.readdir` 對 `{ recursive: true }` 的行為
   * 不一致，而那個差異未見於文件）。
   */
  async #collect(dir: string, depth: number): Promise<string[]> {
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }
    const files: string[] = []
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth > 0) files.push(...(await this.#collect(full, depth - 1)))
        continue
      }
      if (entry.isFile()) files.push(full)
    }
    return files
  }

  async dispose(): Promise<void> {
    await this.#watcher?.close()
    this.#watcher = null
  }

  async #handle(file: string): Promise<void> {
    if (!file.endsWith(ACCEPTED_EXTENSION)) return
    /**
     * **以點開頭的一律跳過** —— 那是「還沒寫完」的慣例。
     *
     * 只看副檔名是不夠的：producer 依指示「先寫暫存檔再改名」時，它挑的暫存檔名很可能仍以
     * `.json` 結尾（實測：agent 取的是 `.tmp-<x>.json`）。於是我們會把一份**寫到一半**的檔案
     * 當成正式投遞讀走，而更糟的是**它若恰好解析成功就會被消費掉** —— 與 producer 的改名互相
     * 競爭，結果不可預測。
     *
     * **這道守衛不倚賴 producer 照著做。** 指示仍然會說「暫存檔名不要以 `.json` 結尾」，但
     * 一個依賴對方守規矩的協定不是協定 —— 尤其對方是一個 agent。
     */
    if (path.basename(file).startsWith('.')) return
    if (this.#inflight.has(file)) return
    this.#inflight.add(file)
    try {
      const read = await readBounded(file)
      if (read === null) return
      if ('tooLarge' in read) {
        // 永久性拒絕：大小不會自己變小。拒絕的**呈現**仍經 service，於是它與其餘拒絕
        // 共用同一份合併與上限（「面向使用者的拒絕與警示 SHALL 有界」）。
        this.#service.rejectOversize(path.basename(file))
        await fs.promises.rm(file, { force: true })
        this.#onProcessed?.(file, true)
        return
      }
      // **失敗必須說話。** 少了這個 catch，一個投遞失敗會變成未捕捉的 rejection：
      // 投遞檔留在落點、收件匣空著、而畫面上與 log 裡都沒有任何線索
      //（dogfood 第一次投遞就踩到 —— 保存處的目錄尚未建立）。
      let outcome
      try {
        outcome = await this.#deliver(read.contents, file)
      } catch (error) {
        console.error(`[intake] delivery failed ${file}: ${String(error)}`)
        return
      }
      if (outcome.consume) await fs.promises.rm(file, { force: true })
      this.#onProcessed?.(file, outcome.consume)
    } finally {
      this.#inflight.delete(file)
    }
  }
}
