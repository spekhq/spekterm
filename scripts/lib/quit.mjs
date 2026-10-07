/**
 * 正常關閉被測應用程式 —— **等到它真的結束**。
 *
 * ## 為什麼「送出訊號就返回」是一個假綠的來源
 *
 * 主行程收尾時正在以原子寫（暫存檔 ＋ rename）更新它的持久化檔案。探針若在送出 SIGTERM 之後
 * 立刻動那些檔案，那次 rename 可能落在寫入之後 —— **把探針剛寫進去的內容蓋掉**。
 *
 * issue #8 的實例：驗「持久化檔案損毀時應用程式照常啟動」的段落，寫入損毀內容之後重新啟動，
 * 結果 app 讀到一份**正常**的檔案。**失效方向是兩邊都壞**：偶爾誤報紅燈，而在它「成功」的
 * 那些輪次裡也無法排除驗到的是被覆蓋回來的正常檔案 —— **產品的隔離邏輯真的壞掉時，這個競態
 * 可能讓它以綠燈通過**。
 *
 * ## 作用域不只是「會改檔的站點」
 *
 * 關閉之後以**同一個使用者資料目錄**重新啟動，等於讓舊行程的收尾寫入與新行程的讀取競態，
 * 而「跨重啟還原」那一族的斷言，被斷言的正是舊行程收尾時寫下的那份檔案。
 *
 * ## 時限與升級不可省
 *
 * 一個沒有時限的「等到結束」只是把競態換成 hang —— 而那正是 issue #22 的形狀（一輪
 * `test:e2e` 卡住 1 小時 30 分且永遠不會結束）。**With unsaved changes in the panel the first
 * SIGTERM does not end the app**: the quit's `close` is prevented to ask, which cancels the quit
 * (the message loop keeps running — `docs/lessons/probes.md`). Every quit on that path uses up the
 * whole limit, so the limit has to be bearable, but it has to exist.
 */
import { setTimeout as sleep } from 'node:timers/promises'

/**
 * 預設時限。
 *
 * `probe-terminal.mjs` 有 13 處呼叫，全部吃滿也只有 130 秒 —— 遠小於段落時限（8–14 分鐘），
 * 而正常關閉是幾百毫秒的事。
 */
export const QUIT_TIMEOUT_MS = 10_000

/** SIGKILL 之後再給的一小段時間 —— 讓行程真的從行程表上消失。 */
const REAP_GRACE_MS = 200

/**
 * 送出終止訊號並等到子行程確實結束。
 *
 * @param {import('node:child_process').ChildProcess} child
 * @param {object} [options]
 * @param {NodeJS.Signals} [options.signal] 先送出的訊號（預設 SIGTERM —— 要驗的正是 app
 *   自己收到它之後會不會把 pty 清乾淨）
 * @param {number} [options.timeoutMs]
 * @param {Function} [options.onEscalate] 升級為強制終止時呼叫，收到 `{ timeoutMs }`。
 *   **預設會輸出一行** —— 「app 沒有在時限內回應 SIGTERM」本身就是關於產品的資訊，
 *   不該被靜默吞掉
 * @returns {Promise<{ escalated: boolean }>}
 */
export async function quitAndWait(child, { signal = 'SIGTERM', timeoutMs = QUIT_TIMEOUT_MS, onEscalate } = {}) {
  if (child.exitCode !== null || child.signalCode !== null) return { escalated: false }

  const exited = new Promise((resolve) => child.once('exit', () => resolve(true)))
  child.kill(signal)

  // **等的是一個事件，不是輪詢** —— 因此不經 `pollFor`（那個原語與它的守衛管的是
  // 「輪詢直到條件滿足」）。把事件等待改寫成輪詢只是為了通過守衛，那是繞路。
  const finished = await Promise.race([exited, sleep(timeoutMs, false)])
  if (finished) return { escalated: false }

  const escalate = onEscalate ?? (() => {
    console.log(`  ⏱ 應用程式未在 ${timeoutMs / 1000} 秒內回應 ${signal}，改以 SIGKILL 終止`)
  })
  escalate({ timeoutMs, signal })
  child.kill('SIGKILL')
  await Promise.race([exited, sleep(REAP_GRACE_MS, false)])
  return { escalated: true }
}
