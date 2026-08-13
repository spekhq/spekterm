/**
 * 探針的儀器 —— 斷言輸出、等待原語、CDP 往返計時共用的那一份狀態。
 *
 * ## 為什麼獨立成一個模組，而不是塞進 `lib/cdp.mjs`
 *
 * 兩個消費者都與 CDP 無關：`lib/sections.mjs` 要讀這裡的累計（它管的是段落排程），
 * 而 `probe-native` 以 **Electron 主行程**執行、根本不連 CDP，卻一樣要 `check()`。
 * 把儀器與傳輸放在同一個檔案，那兩者就得為了一個計數器把 CDP 一起拉進來。
 *
 * ## 這裡的量在回答什麼
 *
 * | 尺度 | 誰輸出 | 回答什麼 |
 * |---|---|---|
 * | 段落耗時 | `sections.mjs` 的總結 | 哪一段吃掉了那一輪 |
 * | 距上一條斷言的耗時 | `check()` | 段落內哪一區慢 |
 * | 窗口耗盡的等待 | `pollFor()` | 那段時間**是被誰**燒掉的 |
 * | CDP 往返次數與總耗時 | `check()` 與段落總結 | 是**一件事卡住**，還是**每次往返都慢** |
 *
 * 第四個尺度不是錦上添花：`probe:terminal` 的 `runMode` 在 dev 曾觀測到 771 秒，而該段
 * **所有**等待窗口全部燒盡也只有約 597 秒 —— 至少一百多秒是真實的每步延遲，而前三個尺度
 * 對它只會呈現為「每一區都稍微慢一點」，那個形狀與「某處卡住」在輸出上分不開。
 */
import { setTimeout as sleep } from 'node:timers/promises'

/**
 * 段落 token —— **逾時的段落不會被中止**（JS 沒有辦法中止一個執行中的 Promise），它會繼續在
 * 背景呼叫 `check()` 與 `pollFor()`。少了歸屬，那些殘留活動會把**下一個**段落的耗時切碎，
 * 而下一個段落是無辜的。
 *
 * 丟棄的只有「對耗時歸屬的影響」—— `results` 照樣寫入，那是既有行為，改動它就改動了斷言。
 */
let currentToken = 0
let lastCheckAt = Date.now()
let counters = emptyCounters()

function emptyCounters() {
  return { timeouts: 0, timeoutMs: 0, cdpCalls: 0, cdpMs: 0, intervalCdpCalls: 0, intervalCdpMs: 0 }
}

/**
 * renderer 的 console 錯誤 —— 環形緩衝，**以段落為單位**。
 *
 * 住在這裡而不是 `lib/cdp.mjs`，理由與這個模組存在的理由相同（見檔頭）：讀它的是
 * `sections.mjs`，而那個模組不該為了一則訊息把 CDP 拉進來。推入的是 `cdp.mjs`，方向是對的。
 */
const CONSOLE_BUFFER_LIMIT = 20
let consoleEntries = []

/** 開始一個新段落：換 token、重置累計、把「上一條斷言」的時間拉到現在。 */
export function beginSection() {
  currentToken += 1
  counters = emptyCounters()
  consoleEntries = []
  lastCheckAt = Date.now()
  return currentToken
}

/**
 * 記一則 renderer 的 console 訊息。
 *
 * `token` 是**訊息抵達當下**的段落 —— 與 CDP 往返同一條紀律：逾時的段落不會被中止，它在背景
 * 產生的訊息不該記到下一段頭上。
 *
 * @param {{ level: string, text: string, source?: string }} entry
 * @param {number} token
 */
export function noteConsole(entry, token) {
  if (token !== currentToken) return
  consoleEntries.push(entry)
  if (consoleEntries.length > CONSOLE_BUFFER_LIMIT) consoleEntries.shift()
}

/** 本段落收到的 console 訊息（供段落總結在**有失敗時**輸出）。 */
export function sectionConsole() {
  return [...consoleEntries]
}

/** 目前的段落 token —— 呼叫端在**發起**非同步工作時取得，完成時帶回來。 */
export function sectionToken() {
  return currentToken
}

/** 本段落至今的累計（供段落總結輸出）。 */
export function sectionSummary() {
  return {
    timeouts: counters.timeouts,
    timeoutMs: counters.timeoutMs,
    cdpCalls: counters.cdpCalls,
    cdpMs: counters.cdpMs,
  }
}

/**
 * 記一次 CDP 往返。`token` 是**發起**該次往返時的段落 —— 殭屍段落的往返在這裡被丟棄。
 */
export function noteCdp(elapsedMs, token) {
  if (token !== currentToken) return
  counters.cdpCalls += 1
  counters.cdpMs += elapsedMs
  counters.intervalCdpCalls += 1
  counters.intervalCdpMs += elapsedMs
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`

/**
 * 一條斷言。**行首帶著距上一條斷言的耗時與該區間的 CDP 往返**。
 *
 * **「距上一條斷言」不是「本步驟耗時」** —— 兩條斷言之間可能夾著一次拖曳、一次選單開啟與
 * 三次等待。把那段時間叫做「本步驟耗時」，就是拿一個方便取得、看起來相關的量，冒充規格
 * 真正在乎的那個量。可歸屬到單一動作的資訊由 `pollFor()` 的窗口耗盡輸出承擔。
 *
 * **無門檻**（不是只印超過幾秒的）：門檻會藏掉基準線，而「dev 下每一步都比 build 慢」正是
 * 待證偽的假設之一 —— 它只有在每一條都有數字時才證偽得了。
 */
export function check(results, name, passed, detail) {
  const at = Date.now()
  const elapsed = at - lastCheckAt
  const calls = counters.intervalCdpCalls
  const callsMs = counters.intervalCdpMs
  lastCheckAt = at
  counters.intervalCdpCalls = 0
  counters.intervalCdpMs = 0

  results.push(passed)
  const meter = `[+${seconds(elapsed)} cdp ${calls}×${seconds(callsMs)}]`
  console.log(`  ${meter} ${passed ? '✓' : '✗'} ${name}${detail ? `：${detail}` : ''}`)
  return passed
}

/**
 * 探針中**唯一**的等待實作：反覆求值直到條件滿足，或時限到達。
 *
 * ## 逾時的兩件事分屬兩邊
 *
 * - **發聲屬於這裡**：窗口耗盡時印一行，載明等了多久與在等什麼。此前十七份手寫的迴圈全部
 *   靜默回傳最後的值 —— 而**靜默的等待落空正是「一個段落跑了幾百秒」的實際去向**。
 * - **回傳語意屬於呼叫端**：這裡**不拋錯**，回傳最後一次讀到的值。既有斷言倚賴這一點才能把
 *   該值印進 detail（`cols 68 → 68` 就是這樣得到的）；一律拋錯會讓一條紅得清楚的斷言變成
 *   一次段落中斷。要「等不到就不該繼續」的呼叫端（`waitForPageTarget`）自己在返回後拋。
 *
 * ## `tolerateErrors`
 *
 * 窗口內 `read()` 拋出的例外先吞下，**每次成功讀取即清掉**，只有**最後一次讀取仍失敗**才把它
 * 拋出去。這是 `pollTerminalText` 的既有語意，逐字對齊：實作成「窗口內出現過例外就拋」的話，
 * 今天只是讓斷言變紅的路徑會變成段落中斷。
 *
 * @param {object} options
 * @param {Function} options.read 取值（可為 async）
 * @param {Function} options.settled 收到的值算不算滿足
 * @param {number} options.timeoutMs 時限
 * @param {number} [options.interval] 每次取值之間的間隔
 * @param {string} options.label 這次等待在等什麼 —— **沒有標籤的逾時輸出等於沒有輸出**
 * @param {boolean} [options.tolerateErrors] 見上
 */
export async function pollFor({
  read,
  settled,
  timeoutMs,
  interval = 250,
  label = '(未命名的等待)',
  tolerateErrors = false,
}) {
  const token = currentToken
  const started = Date.now()
  const deadline = started + timeoutMs
  let last = null
  // 不給初值：迴圈在每一輪結束前必定寫入它，給了反而是一個永遠讀不到的值。
  let lastError

  // **先讀一次再判斷 deadline** —— 時限為 0 或極短時，仍然至少量測一次。
  for (;;) {
    // **每一輪只寫一次 `lastError`** —— 「成功讀取即清掉」是這個語意的全部：只有**最後一次**
    // 讀取仍失敗才會被拋出去。寫成「成功時 `lastError = null`、失敗時覆寫」語意相同，但那個
    // 形狀會讓靜態分析看成無用賦值，而把它「清理」掉就等於把語意改成「出現過例外就拋」。
    let error = null
    try {
      last = await read()
      if (settled(last)) return last
    } catch (thrown) {
      if (!tolerateErrors) throw thrown
      error = thrown
    }
    lastError = error
    if (Date.now() >= deadline) break
    await sleep(interval)
  }

  noteTimeout(Date.now() - started, token)
  console.log(`  ⏱ 等待窗口耗盡（${seconds(Date.now() - started)}）：${label}`)
  if (lastError) throw lastError
  return last
}

/**
 * **偶發會失手的取樣**：試到成功為止，窗口耗盡則把最後一次的例外拋出去。
 *
 * ## 它與 `pollFor` 的差別是「在等什麼」
 *
 * `pollFor` 等的是**畫面上的狀態**變成某個樣子（`settled` 判定），讀取本身被假定為可靠。
 * 這個入口等的是**讀取本身成功** —— 標的是那種「拒絕把讀不到當成讀到空」的取樣：它在取不到時
 * 刻意拋錯（否則否定式斷言會在探針瞎掉的情況下繼續發綠燈），而那個拋錯在語意上就是「還沒好」。
 *
 * ## 為什麼要有這個包裝，而不是各呼叫端傳 `tolerateErrors`
 *
 * 實測的現況：同一個讀取（`readTerminalText`）有**六個呼叫站點、三種姿態** —— 一個經
 * `pollTerminalText` 有容忍、三個是裸呼叫、其餘經 `pollUntilText` 沒有容忍。一次偶發的失手因此
 * 讓整支探針從那裡中斷，代價是一輪十幾分鐘，而症狀指向錯的地方（看起來像被測的功能壞了）。
 *
 * 把容忍收進讀取自己的入口，六個站點就都不必記得。**但這是「現況全覆蓋」，不是結構保證** ——
 * 它擋不住明天寫出的第二個哨兵式讀取。要真正結構化得先定義「哪些讀取算哨兵式」，而那個判準
 * 寫得出來就會誤判。
 *
 * @param {Function} read 取樣（可為 async）。**成功即返回，不看回傳值**
 * @param {object} options
 * @param {number} options.timeoutMs 時限 —— **取小**。這個窗口常常套在另一個窗口之內，
 *   兩層相乘會把一次失手的代價放大一個數量級
 * @param {string} options.label
 * @param {number} [options.interval]
 */
export async function retrySample(read, { timeoutMs, label, interval = 200 }) {
  // `settled` 恆真：這裡不判斷值長什麼樣 —— 那是呼叫端外層那個 `pollFor` 的事。
  return pollFor({ read, settled: () => true, timeoutMs, interval, label, tolerateErrors: true })
}

function noteTimeout(elapsedMs, token) {
  if (token !== currentToken) return
  counters.timeouts += 1
  counters.timeoutMs += elapsedMs
}
