import { readFileSync } from 'node:fs'
import path from 'node:path'
import { shouldUsePolling } from '@spekjs/core'

/**
 * 驗收用：找一條「位於需要輪詢的檔案系統上」的路徑。
 *
 * ## 為什麼需要它
 *
 * 「輪詢判定用了哪一條路徑」這件事，只有在兩條路徑得到**不同答案**時才驗得出來。本機一律是
 * ext4／tmpfs，兩者都不需要輪詢 —— 若不找出一個會觸發輪詢的掛載點，任何斷言在「用了 target」
 * 與「用了任何別的路徑」兩種實作下都會同樣通過，也就是一條保證會綠的測試。
 *
 * 可用的來源是 **FUSE**：core 對 `fuse` / `fuseblk` / `fuse.*` 一律判定需要輪詢，而桌面環境
 * 通常掛著幾個（`/run/user/<uid>/doc`、`gvfs`，AppImage 執行時自己也是一個）。
 *
 * **回傳的路徑不需要存在** —— core 的 `detectMountFsType` 在 `realpath` 失敗時沿用原字串去比對
 * `/proc/mounts`，所以掛載點底下一個虛構的檔名就夠了。驗收因此不必寫入任何東西。
 *
 * ## 自檢是承重的，不是防禦性程式設計
 *
 * `shouldUsePolling` 讀 `CHOKIDAR_USEPOLLING` 之類的環境覆寫，而那個短路發生在**看路徑之前**、
 * 對所有路徑一視同仁。覆寫生效時「需要輪詢的路徑」與「本機路徑」會得到相同答案，對比隨之消失。
 * 因此本函式要求呼叫端提供一條**預期不需要輪詢**的對照路徑，並確認兩者答案確實相反 —— 否則
 * 回傳 `null`（該驗收沒有鑑別力，應當略過而非通過）。
 *
 * @param localControl 一條預期**不需要**輪詢的本機路徑（通常是測試的 tmpdir fixture）
 * @returns 需要輪詢的路徑；找不到、或對照不成立時為 `null`
 */
export function findPollingPath(localControl: string): string | null {
  if (process.platform !== 'linux') return null

  let mounts: string
  try {
    mounts = readFileSync('/proc/mounts', 'utf8')
  } catch {
    return null
  }

  // 覆寫生效時對照組不成立，整個探測就沒有意義 —— 先確認控制組確實是「不需要輪詢」。
  if (shouldUsePolling(localControl)) return null

  for (const line of mounts.split('\n')) {
    const mountPoint = unescapeMountField(line.split(' ')[1] ?? '')
    if (!mountPoint || !path.isAbsolute(mountPoint)) continue

    const candidate = path.join(mountPoint, 'spekterm-polling-probe', 'HEAD')
    if (shouldUsePolling(candidate)) return candidate
  }

  return null
}

/** `/proc/mounts` 以八進位跳脫掛載點中的空白（`\040`）、tab（`\011`）等。 */
function unescapeMountField(field: string): string {
  return field.replace(/\\(\d{3})/g, (_, oct: string) => String.fromCharCode(Number.parseInt(oct, 8)))
}
