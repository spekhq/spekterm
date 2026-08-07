import { pollingInterval, shouldUsePolling, withAuthoritativeChokidarEnv } from '@spekjs/core'
import { type FSWatcher, watch as chokidarWatch } from 'chokidar'

/**
 * 主行程建立檔案監看者的**唯一**入口。
 *
 * ## 為什麼要有這個模組
 *
 * 在它出現之前，三個站點（`branch-service` / `openspec-service` / `watch-service`）各自建構
 * watcher，於是對錯誤演化出三種姿態：一個回報、一個 `on('error', () => {})` 靜默吞掉、一個
 * **完全沒有 handler**。最後那個最嚴重 —— chokidar 的 `FSWatcher` 是 EventEmitter，Node 對沒有
 * listener 的 `'error'` 直接 throw，而主行程一死，它底下所有 pty 跟著死。
 *
 * 三份重複的建構樣板**正是三種姿態的成因**：沒有任何一處是「唯一該改的地方」。收斂到這裡之後，
 * 「建立一個沒有錯誤處理的 watcher」表達不出來。這道約束由 eslint（擋靜態 import）與
 * `scripts/watcher-source.test.mjs`（擋動態 import、擋本模組再導出 chokidar 的值）共同維持。
 *
 * ## 兩個路徑參數是分開的，不要合併
 *
 * `shouldUsePolling(p)` 會 `realpath(p)` 再查 `/proc/mounts`，判定的是**那條路徑所在掛載點**的
 * 檔案系統 —— 而三個站點餵給它的路徑本來就不同（有的傳 folder 根、有的傳監看目標）。合併成一個
 * 參數會讓「worktree 在網路檔案系統、folder 根在本機」的情形靜默退回 native watch，而那種失效
 * **連底下的錯誤 handler 都救不到**：`fs.watch` 只是永遠不觸發，沒有任何錯誤可以 emit。
 */
export interface CreateWatcherOptions {
  /** 要監看的路徑。 */
  target: string
  /**
   * 判定是否改用輪詢的依據路徑 —— 常常**不等於** `target`（見檔頭）。
   * 一個 watcher 服務多個子目標時傳它們的共同根，一對一時傳 `target` 自己。
   */
  pollingRoot: string
  /**
   * 錯誤回報時用來識別這個 watcher 的路徑。
   *
   * **不能一律用 `target`**：`watch-service` 讓一個 watcher 服務 N 個動態增減的目標，而 chokidar
   * 的 `'error'` payload 只帶 Error 本身、不指出是哪一個目標失敗 —— 對它印出 `target` 只會識別到
   * 「碰巧第一個被訂閱的目錄」。由呼叫端決定傳什麼，並在該 watcher 的生命週期內恆定。
   */
  label: string
  depth?: number
  alwaysStat?: boolean
}

export function createWatcher({
  target,
  pollingRoot,
  label,
  depth,
  alwaysStat,
}: CreateWatcherOptions): FSWatcher {
  const usePolling = shouldUsePolling(pollingRoot)
  const interval = pollingInterval()

  // callback 必須同步（見 core 的 withAuthoritativeChokidarEnv）：env 的對齊只在
  // set → chokidar 建構 → restore 這段同步窗口內有效。
  const watcher = withAuthoritativeChokidarEnv(usePolling, interval, () =>
    chokidarWatch(target, {
      ...(depth === undefined ? {} : { depth }),
      ...(alwaysStat === undefined ? {} : { alwaysStat }),
      // **不開放給呼叫端** —— 這是檔案系統邊界的一部分，不是偏好。chokidar 的預設是 `true`，
      // folder 內一個指向邊界外的 symlink 被展開時，watcher 會跟著走出去，把邊界外的檔名經事件
      // 推給 renderer；`listDir` 守住的邊界會從這道側門漏掉（Phase 2 實測）。
      followSymlinks: false,
      ignoreInitial: true,
      usePolling,
      interval,
    }),
  )

  // 少了這個 handler，錯誤會成為未捕捉例外（`src/` 下沒有任何 uncaughtException handler）。
  // 注意 `on('all', …)` **不算** error listener —— chokidar 的 emitWithAll 對 EV.ERROR 跳過
  // EV.ALL，所以掛了 'all' 的 watcher 一樣沒有保護。
  watcher.on('error', (error) => {
    console.error(`[watch] ${label}: ${String(error)}`)
  })

  return watcher
}
