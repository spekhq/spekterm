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
 * ## 輪詢的判定依據：預設與監看目標一致，顯式才分開
 *
 * `shouldUsePolling(p)` 會 `realpath(p)` 再查 `/proc/mounts`，判定的是**那條路徑所在掛載點**的
 * 檔案系統。判定錯誤的後果是靜默的，而且**連底下的錯誤 handler 都救不到** —— `fs.watch` 只是
 * 永遠不觸發，沒有任何錯誤可以 emit。
 *
 * **服務單一目標的建立點佔絕大多數**，它們的正確答案就是自己的 `target`；只有 `watch-service`
 * 一個 watcher 服務 N 個動態增減的子目標，需要另一條路徑。`pollingRoot` 因此是**可省略**的：
 * 省略即以 `target` 判定。
 *
 * 目前的建立點（七個，服務單一目標的六個 ＋ 服務多目標的一個）：
 *
 * | 建立點 | 監看什麼 | `pollingRoot` |
 * |---|---|---|
 * | `branch-service` | folder 根（等 `.git` 出現） | 省略 |
 * | `branch-service` | gitdir 底下的 `HEAD` | 省略 |
 * | `openspec-service` | repo 的 `openspec/` | 省略 |
 * | `transcript-follow-service` | transcript 所在目錄 | 省略 |
 * | `transcript-follow-service` | transcript 檔本身 | 省略 |
 * | `intake-source` | 投遞落點 | 省略 |
 * | `watch-service` | N 個動態增減的子目標 | **顯式傳入共同根** |
 *
 * **這份清單是實作，條文只講比例。** 此前這段寫著「四個建立點裡有三個服務單一目標」，而落地後
 * 是七個 —— 那個數字連同它在 `watcher-error-reporting` 主 spec 裡的複本一起過時了（issue #42）。
 * **一個精確但過時的數字比一個含糊的敘述更糟**，因為它讀起來像是被查核過的。條文所倚賴的是
 * 比例（一對一佔絕大多數、服務多目標者為孤例），而那在 7 = 6 + 1 之下比在 4 = 3 + 1 之下更強。
 * 改動這份清單時**不必**回去改規格；規格不再提任何數目。
 *
 * 這個預設是有由來的 —— 它此前是必填，於是每個呼叫端都得自己想一次，而 `branch-service` 第二層
 * 想錯了：它監看 gitdir 底下的 `HEAD`（worktree／submodule 時可能在另一個掛載點），卻傳 folder
 * 根（issue #16）。**但預設值救得了「忘記想」，救不了「想錯」** —— 顯式傳入的那一處由
 * `watch-service` 自己的測試釘住。
 */
export interface CreateWatcherOptions {
  /** 要監看的路徑。 */
  target: string
  /**
   * 判定是否改用輪詢的依據路徑。**省略即以 `target` 判定**，那是一對一監看的正確答案。
   *
   * 顯式傳入是一個帶語意的宣告：**「我這個監看者服務多個目標，請以它們的共同根判定」**。
   * 產品程式碼中只有 `watch-service` 該這樣做。
   *
   * **限定**：共同根只在該根與其所有目標位於**同一掛載點**時成立。路徑上的包含關係不是同一
   * 檔案系統的保證 —— folder 內掛載網路儲存、`node_modules` 位於另一檔案系統、bind mount 都會
   * 讓兩者分家，那時會發生與 issue #16 同種的靜默失效。單一 watcher 的 `usePolling` 於建構時
   * 決定，服務跨掛載點的多個目標在結構上無解，其解法（每個掛載點一個 watcher）不在此處。
   */
  pollingRoot?: string
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
  const usePolling = shouldUsePolling(pollingRoot ?? target)
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
