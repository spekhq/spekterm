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

/**
 * **帶副作用的動作，做了之後等它生效；沒生效就重做。** 開一個選單並點其中一項就是這個形狀。
 *
 * ## 它與另外兩個入口的差別是**頻率**，不是「有沒有副作用」
 *
 * 直覺會說「動作有副作用，所以不能塞進 `pollFor` 的 `read`」—— **那是錯的**，本檔案裡就有
 * 反例：`retrySample` 唯一的實質用途 `readTerminalText` 其動作是「真滑鼠拖曳 ＋ 右鍵 ＋ 點複製
 * ＋ 寫剪貼簿」，副作用滿載，而那個形狀是可行的。
 *
 * 真正的差別是**動作與生效之間有沒有外部延遲**：
 *
 * | 入口 | 在等什麼 | 動作與檢查的頻率 |
 * |---|---|---|
 * | `pollFor` | 畫面變成某個樣子 | 沒有動作 |
 * | `retrySample` | 讀取本身成功 | **同頻**（動作即讀取，做完就知道成不成） |
 * | `retryAction` | 一個帶副作用的動作生效 | **異頻** —— 做完還要等 renderer 把結果畫出來 |
 *
 * 同頻重做在這裡會**自己製造失敗**：選單剛要出現時再點一次入口，那一下就把它關掉了。
 *
 * ## 為什麼是 `pollFor` 的組合，而不是第二份輪詢實作
 *
 * 「等待必須經由單一原語實作」那條要求的守衛（`scripts/wait-source.test.mjs`）以**函式名**
 * 豁免原語自身，而那個豁免是**單一硬編的 `'pollFor'`**。任何第二份「自己算 deadline」的實作
 * 都會逼那個豁免從一個名字變成一組名字 —— 而那是對既有要求的實質改動，不是實作細節。
 *
 * 組合起來還順帶把「外層何時檢查總時限」變成確定的：`pollFor` 的迴圈是**先讀一次再判斷
 * deadline**，因此**第一輪必定完整執行**，其後每輪之間檢查一次。實際輪數 ＝ 在 `timeoutMs`
 * 內跑得完幾輪，最少一輪。
 *
 * ## 上界是時限，而且沒有次數參數
 *
 * 這不是風格。收斂之前有九個站點各自為政（重試 0 到 5 輪、一輪的內層預算 1.7 到 17 秒），
 * 而**沒有任何一處把「總共願意等多久」寫下來過** —— 那個數字藏在「次數 × 內層窗口」的乘法裡，
 * 連算都沒有人算過（第一版的提案就把其中一個站點算少了八倍）。
 *
 * @param {object} options
 * @param {Function} options.act 每輪執行一次的動作（可為 async）。**帶副作用**
 * @param {Function} options.read 檢查動作有沒有生效的讀取
 * @param {Function} options.settled 讀到的值算不算生效。**必須是純函式** —— 內外兩層各會呼叫它，
 *   有狀態的判定（例如「連續三次不變」）在這裡會被呼叫的次數騙到
 * @param {number} options.attemptWindowMs 單輪等生效的窗口
 * @param {number} [options.attemptIntervalMs] 單輪之內的輪詢間隔。省略即沿用 `pollFor` 的預設；
 *   **窗口小於一個間隔時，一輪的實際耗時由間隔決定**（見實作處的註解）
 * @param {number} options.timeoutMs **總預算**。呼叫端顯式給定，且其推導要寫在呼叫端
 * @param {string} options.label
 * @param {number} [options.interval] 兩輪之間的額外間隔。預設 0 —— 內層本來就已經花掉時間了
 * @param {Function} [options.evidence] 耗盡時取一次現場（可為 async，回傳字串）。
 *   **它自己失敗不會改變回傳值** —— 「重試最終失敗」最常見的原因就是 renderer 已經不在，
 *   而此時對它求值會拋；把那個例外往外送，呼叫端就從「拿到最後一次的值」變成「收到一個
 *   指向錯地方的例外」
 */
export async function retryAction({
  act,
  read,
  settled,
  attemptWindowMs,
  attemptIntervalMs,
  timeoutMs,
  label,
  interval = 0,
  evidence,
}) {
  const startedAt = Date.now()
  let rounds = 0
  // **記在外層 `settled` 裡，不在返回後重判** —— 重判會多呼叫一次呼叫端的判定式，而那對
  // 有狀態的判定不等價；更實際的是，那一次重判讀到的是**下一刻**的狀態。
  let succeeded = false

  const last = await pollFor({
    read: async () => {
      rounds += 1
      await act()
      return pollFor({
        read,
        settled,
        timeoutMs: attemptWindowMs,
        // **省略即沿用 `pollFor` 的預設**（250ms）—— 真實站點的內層窗口是秒級，預設沒問題。
        // 可注入是為了可驗收性：`pollFor` 只在兩次讀取之間檢查 deadline，因此內層窗口小於
        // 一個 interval 時，**一輪的實際耗時由 interval 決定而不是由窗口決定**。單元測試層
        // 的定位是毫秒級，不可注入的話這個入口的多輪行為就只能靠真的等幾秒來驗。
        ...(attemptIntervalMs === undefined ? {} : { interval: attemptIntervalMs }),
        label: `${label}（第 ${rounds} 輪）`,
      })
    },
    settled: (value) => {
      const ok = settled(value)
      if (ok) succeeded = true
      return ok
    },
    timeoutMs,
    interval,
    label: `${label}（重試預算）`,
  })

  if (succeeded) return last

  // **匯總的存在理由**：以時限為界之後，輪數由環境決定，於是輸出裡會出現 N 行內層的窗口耗盡。
  // 少了這一行，那 N 行讀起來像 N 件事，而它們是一件事。
  console.log(
    `  ↻ 重試耗盡（${label}）：${rounds} 輪／${seconds(Date.now() - startedAt)}，` +
      `每輪內層窗口 ${seconds(attemptWindowMs)}`,
  )

  if (evidence) {
    let scene
    try {
      scene = await evidence()
    } catch (error) {
      scene = `（現場採樣自己失敗：${String(error)}）`
    }
    if (scene) console.log(`  🔍 現場：${scene}`)
  }

  // 與 `pollFor` 同一條語意：回傳最後一次讀到的值，**升不升級為例外由呼叫端決定**。
  // 九個站點裡八個要拋、一個（`anchorChange`）要拿這個值去讓斷言紅得有話可說。
  return last
}

function noteTimeout(elapsedMs, token) {
  if (token !== currentToken) return
  counters.timeouts += 1
  counters.timeoutMs += elapsedMs
}
