import path from 'node:path'
import type { FSWatcher } from 'chokidar'
import { headPath } from './git-branch'
import { createWatcher } from './watcher'
import type { FolderLookup, WorkspaceFolder } from './workspace-store'

/**
 * 監看每個 folder 的 git 分支變動。
 *
 * 使用者就在旁邊的 terminal 裡操作這些 repo —— 那是本 app 的前提。一個切完 branch 還顯示舊分支
 * 的 rail，比不顯示分支更糟：**它看起來像是真的**。
 *
 * ## 為什麼是兩層 watcher（兩者皆為實測，直覺會做錯）
 *
 * **第二層（HEAD 檔案）** —— `git checkout` 並非原地覆寫 `HEAD`，而是**寫 `HEAD.lock` 再 rename
 * 上去**：實測連續切三次分支，HEAD 的 inode 每次都變（`…526 → …534 → …551`）。這正是 CLAUDE.md
 * 警告過的「暫存檔 + 改名」模式，直覺會認為監看單一檔案的 watcher 第一次就失聯 —— **但實測它
 * 撐得住**（chokidar 會在 rename 後重新 attach，三次都收到 `change`）。因此監看**單一檔案**即可，
 * 不必退而監看整個 `.git/`（那會被 `index.lock`、`refs/`、object 寫入的事件淹沒）。
 *
 * **第一層（folder 根目錄）** —— 那為什麼還需要它？因為 `.git` **尚不存在**時（folder 還不是 git
 * repo），監看 `<folder>/.git/HEAD` 是**行不通的**：實測 `git init` 之後 800ms 內 chokidar 收不到
 * 任何事件（它連父目錄都不存在，無從 attach）。folder 根目錄恆常存在，因此以它來等 `.git` 出現或
 * 消失，再據以建立／銷毀第二層。
 *
 * 代價是 folder 根目錄的事件流會被 agent 的頂層寫檔活動打到 —— 以 basename 過濾即可，事件多但廉價。
 */

/** 一次 `git checkout` 會連續改寫多個檔案；rail 不需要為此重繪多次。 */
const DEBOUNCE_MS = 80

const GIT_ENTRY = '.git'

interface FolderWatchers {
  /** 監看 folder 根目錄，等 `.git` 出現或消失。 */
  root: FSWatcher
  /** 監看 HEAD 檔案。`.git` 不存在時為 null。 */
  head: FSWatcher | null
  /** 目前 head watcher 盯著的絕對路徑 —— 用來判斷 `.git` 換形式後要不要重建。 */
  headTarget: string | null
}

/**
 * 監看一組 folder 的分支變動。分支值本身不快取 —— 它由 `WorkspaceStore.list()` 每次重算
 * （單次檔案讀取，廉價）。這裡只負責「什麼時候該重算並通知」。
 */
export class BranchService {
  readonly #folders = new Map<string, FolderWatchers>()
  readonly #store: FolderLookup
  readonly #onChanged: () => void
  #debounce: NodeJS.Timeout | null = null
  #disposed = false

  constructor(store: FolderLookup, onChanged: () => void) {
    this.#store = store
    this.#onChanged = onChanged
  }

  /** 依當前的 folder 清單建立／銷毀 watcher。folder 新增或移除後呼叫。 */
  sync(): void {
    if (this.#disposed) return

    const folders = this.#store.list()
    const live = new Set(folders.map((f) => f.id))

    for (const [id, watchers] of this.#folders) {
      if (!live.has(id)) {
        void closeWatchers(watchers)
        this.#folders.delete(id)
      }
    }

    for (const folder of folders) {
      if (folder.status !== 'ok') continue
      if (this.#folders.has(folder.id)) this.#refreshHead(folder)
      else this.#watchFolder(folder)
    }
  }

  #watchFolder(folder: WorkspaceFolder): void {
    // 第一層：folder 根目錄，depth 0 —— 只關心 `.git` 這個直屬項目的出現與消失。
    const root = createWatcher({
      target: folder.path,
      pollingRoot: folder.path,
      label: folder.path,
      depth: 0,
    })
    root.on('all', (_event, changed) => {
      if (path.basename(changed) !== GIT_ENTRY) return // agent 在頂層寫檔的噪音
      const current = this.#folders.get(folder.id)
      if (current) this.#refreshHead(folder)
      this.#notify()
    })

    const watchers: FolderWatchers = { root, head: null, headTarget: null }
    this.#folders.set(folder.id, watchers)
    this.#refreshHead(folder)
  }

  /** 依 `.git` 的當前狀態建立／重建／銷毀 HEAD watcher。 */
  #refreshHead(folder: WorkspaceFolder): void {
    const watchers = this.#folders.get(folder.id)
    if (!watchers) return

    const target = headPath(folder.path) // null＝不是 git repo
    if (target === watchers.headTarget) return // 沒變，不動它

    if (watchers.head) {
      void watchers.head.close()
      watchers.head = null
    }
    watchers.headTarget = target

    if (target === null) return

    // 第二層：HEAD 檔案本身。git 以 rename 換掉它，chokidar 撐得住（見檔頭）。
    // worktree 的 HEAD 在 gitdir 底下，那**可能在 folder 邊界之外** —— 這是主行程自己的
    // 檔案存取，推給 renderer 的仍然只有分支字串。
    //
    // **`pollingRoot` 傳 folder 根而非 `target`，是刻意保留的現況，不是這裡的判斷** ——
    // gitdir 可能落在別的掛載點上，以 folder 根判定 polling 看起來是既有的 bug。它需要一個
    // 跨掛載點的 worktree 才驗得到，與本模組的錯誤回報無關，已開為 issue #16。
    const head = createWatcher({ target, pollingRoot: folder.path, label: target })
    head.on('all', () => this.#notify())
    watchers.head = head
  }

  #notify(): void {
    if (this.#disposed) return
    if (this.#debounce) clearTimeout(this.#debounce)
    this.#debounce = setTimeout(() => {
      this.#debounce = null
      if (!this.#disposed) this.#onChanged()
    }, DEBOUNCE_MS)
  }

  async dispose(): Promise<void> {
    this.#disposed = true
    if (this.#debounce) {
      clearTimeout(this.#debounce)
      this.#debounce = null
    }
    const all = [...this.#folders.values()]
    this.#folders.clear()
    await Promise.all(all.map(closeWatchers))
  }
}

async function closeWatchers(watchers: FolderWatchers): Promise<void> {
  await Promise.all([watchers.root.close(), watchers.head?.close()].filter(Boolean))
}
