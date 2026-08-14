/**
 * 極簡 CDP 客戶端，只依賴 Node 內建的 fetch 與 WebSocket。
 *
 * 驗收一律透過 CDP 連進執行中的 app，而不是在產品程式碼裡塞測試分支 ——
 * 要驗的正是被出貨的那份程式碼，任何為測試而加的岔路都會讓結論失效。
 */
import { noteCdp, noteConsole, pollFor, retryAction, sectionToken } from './instrument.mjs'
import { lookupHolder } from './preflight.mjs'

// 斷言與等待原語的**唯一定義**在 `instrument.mjs`（它與 CDP 無關，`sections.mjs` 與
// `probe-native` 都要用）。這裡轉出，是為了讓既有的 `from './lib/cdp.mjs'` 一字不必改。
export { check, pollFor, retryAction, retrySample } from './instrument.mjs'

/**
 * 一次 CDP 往返的時限。
 *
 * **它是癱瘓的防線，不是效能的閘門** —— 與段落時限同一條理由。實測的病態值是 5–10 秒級
 * （renderer 被背景節流時），而正常情形下 92 次往返合計 1.2 秒。訂 30 秒是為了擋住「永遠」，
 * 不是為了擋住「慢」。
 */
export const CALL_TIMEOUT_MS = 30_000

/** 建立連線（WebSocket 握手）的時限。 */
export const CONNECT_TIMEOUT_MS = 30_000

/**
 * 探詢 devtools endpoint 的時限。
 *
 * **必須明顯小於包住它的等待窗口**（`waitForPageTarget` 預設 30 秒）—— 它打的是 loopback 上的
 * `/json/list`，一次卡住的請求若能吃掉整個窗口，那就等於沒有時限。
 */
const TARGET_FETCH_TIMEOUT_MS = 3_000

/**
 * 問一次 devtools endpoint 有哪些可連線的 page target。
 *
 * **取不到回 `null`，取得到但沒有 page 回 `[]`** —— 兩者的意思不同（endpoint 沒回應 vs
 * app 還在但沒有可連線的頁面），而失敗現場要說得出是哪一種。
 */
async function fetchTargets(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(TARGET_FETCH_TIMEOUT_MS),
    })
    const targets = await res.json()
    return targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  } catch {
    return null
  }
}

export async function waitForPageTarget(port, timeoutMs = 30_000) {
  // **這個呼叫端要拋錯**：等不到 CDP target 還往下走，只會紅在一個與根因無關的地方。
  // 原語一律回傳最後的值，升不升級為例外由呼叫端決定 —— 這裡就是那個「要」的呼叫端。
  const page = await pollFor({
    // devtools endpoint 尚未就緒時 `fetchTargets` 回 `null` —— 那是「還沒好」，不是「壞了」。
    read: async () => (await fetchTargets(port))?.[0] ?? null,
    settled: (value) => value !== null,
    timeoutMs,
    label: `CDP target（port ${port}）`,
  })
  if (!page) {
    // **前置檢查涵蓋不到這裡，所以這裡要自己問一次。** 啟動前那道檢查有 TOCTOU 缺口：它通過之後
    // port 才被搶走，或 app 因為完全無關的原因死掉 —— 症狀又變回這句沒有主詞的逾時。
    // 再查一次持有者很便宜，而它涵蓋了前置檢查結構上涵蓋不到的每一種情形。
    const holder = lookupHolder(port)
    throw new Error(
      `等待 CDP target 逾時（${timeoutMs}ms，port ${port}）` +
        (holder
          ? `\n  這個 port 上有東西在 listen：${holder}\n` +
            '  —— app 大概沒起來，而 port 被別的行程抓著（啟動前它還是通的）。'
          : '\n  這個 port 上沒有人在 listen —— app 沒有起來，去看它的 stderr。'),
    )
  }
  return page
}

/** 單次握手的時限 —— 見 `connectToApp` 的三層時限說明。 */
export const HANDSHAKE_TIMEOUT_MS = 5_000

/**
 * **連上被測 app** —— 探針啟動路徑上唯一該用的入口。
 *
 * ## 為什麼要包一層，而不是各呼叫端自己 `waitForPageTarget` + `connect`
 *
 * 八個呼叫端此前各寫兩行，而 `connect()` 的握手**一次失敗就放棄**（issue #7：一次
 * relaunch 的握手失敗讓整支探針中斷，代價是一輪十幾分鐘，且要重跑才知道是 flake）。
 *
 * **重試必須重新探詢 target，這是整件事的關鍵而不是細節。** `waitForPageTarget` 交出來的是
 * 取得清單那一刻的**一次性快照**；target 若已消失（頁面重載換了新的 target id），重試同一個
 * `webSocketDebuggerUrl` **永遠不會成功** —— 那樣的重試比不重試更糟，它把一次快速失敗換成
 * 等滿整個窗口。
 *
 * ## 探詢失敗**不**被重試接住
 *
 * 兩種失敗的意思不同，處置也相反：
 *
 * | 失敗 | 意思 | 處置 |
 * |---|---|---|
 * | 握手失敗 | target 還在，只是握不上手 | **重試** |
 * | 探詢失敗 | app 已經不在 | **立即終止** |
 *
 * 重試探詢會把「app 根本沒起來」從一個窗口變成 N 個窗口，而 CLAUDE.md 的既有教訓正好相反
 *（前置不成立就立刻失敗並指出處置）。而且 `waitForPageTarget` 的錯誤訊息本來就會查出 port
 * 持有者並給出兩種不同的解釋 —— 那比任何一次重試都有用。
 *
 * ## 三層時限
 *
 * | 層 | 值 | 為什麼 |
 * |---|---|---|
 * | 單次 fetch（`TARGET_FETCH_TIMEOUT_MS`） | 3s | 既有：必須明顯小於包住它的探詢窗口 |
 * | 探詢窗口（`targetTimeoutMs`） | 呼叫端給（多為 30s） | 它等的是 **app 冷啟動**，不該縮 |
 * | 握手（`HANDSHAKE_TIMEOUT_MS`） | **5s** | app 已經在了；握手要 30 秒就是有問題 |
 * | 重試預算（`budgetMs`） | 探詢窗口 ＋ 4 × 握手 | 見下 |
 *
 * **預算必須明顯大於一輪的最壞內層耗時**，否則外層的顯式時限只是一個不生效的裝飾（實際返回
 * 時間由內層決定）。這是既有那條「網路探詢的時限須明顯小於包住它的等待窗口」同一條紀律升
 * 一層。取「探詢窗口 ＋ 4 × 握手」：第一輪最壞會吃掉整個探詢窗口（等 app 起來），其後每輪的
 * 探詢是「確認 target 還在」而非「等它出現」，快得多 —— 於是預算裡留下的空間夠再試三到四次
 * 握手，而那正是 issue #7 那種一次性失敗需要的。
 *
 * @param {number} port
 * @param {object} [options]
 * @param {number} [options.targetTimeoutMs] 探詢窗口。**呼叫端各自保留自己的值**
 *   （`probe:package` 等的是真正的 AppImage 冷啟動，比其他人長）
 * @param {number} [options.connectTimeoutMs] 單次握手時限
 * @param {number} [options.budgetMs] 重試預算。省略即由上面兩者推導
 * @param {Function} [options.createSocket] 注入點（可驗收性）
 * @param {number} [options.callTimeoutMs] 轉交給 `connect()`
 */
export async function connectToApp(
  port,
  { targetTimeoutMs = 30_000, connectTimeoutMs = HANDSHAKE_TIMEOUT_MS, budgetMs, createSocket, callTimeoutMs } = {},
) {
  const budget = budgetMs ?? targetTimeoutMs + 4 * connectTimeoutMs
  let client = null
  let lastError = null
  let scene = null

  const connected = await retryAction({
    act: async () => {
      client = null
      // **這一行的例外不被接住，是刻意的**（見上面的表）：`retryAction` 的外層 `pollFor`
      // 未開容忍，所以 `waitForPageTarget` 的 throw 會直接往外傳，終止整個重試。
      const target = await waitForPageTarget(port, targetTimeoutMs)
      try {
        client = await connect(target, { createSocket, callTimeoutMs, connectTimeoutMs })
      } catch (error) {
        // 握手失敗才是可重試的那一種 —— 記下來，讓這一輪不成立。
        lastError = error
      }
    },
    // 結果在 `act` 返回時就已經確定，沒有東西要等 ⇒ 內層窗口為 0（讀一次就返回）。
    read: () => client,
    settled: (value) => value !== null,
    attemptWindowMs: 0,
    timeoutMs: budget,
    label: `connectToApp（port ${port}）`,
    evidence: async () => {
      const alive = await fetchTargets(port)
      scene =
        `最後一次握手：${lastError ? lastError.message : '(沒有錯誤被記下來)'}；` +
        `target 當下${alive === null ? '探詢不到（endpoint 沒有回應）' : `有 ${alive.length} 個可連線的 page`}`
      return scene
    },
  })

  if (connected) return connected

  throw new Error(
    `連上被測 app 失敗（port ${port}，重試預算 ${budget}ms 耗盡）` + (scene ? `\n  ${scene}` : ''),
  )
}

/**
 * 連上一個 CDP target。
 *
 * ## 三個「永遠不返回」的缺口，全部收在這裡
 *
 * `docs/lessons/probes.md` 記載過其中一個：**對已 `close()` 的 client 求值會無限等待 ——
 * 不拋錯、不逾時**，而症狀看起來像「Electron 啟動很慢」。它記載了兩個月沒被修，代價是
 * issue #22：一輪 `test:e2e` 卡住 1 小時 30 分且永遠不會結束。
 *
 * **段落時限擋不住它**：那是十餘分鐘後才收屍的止血，而且逾時本身不帶任何資訊。更根本的是，
 * 共用等待原語的時限**只在兩次讀取之間檢查**（`instrument.mjs`）—— 一次不返回的 `read()`
 * 讓那個時限形同不存在。
 *
 * 於是這裡讓「一個永遠不返回的往返」**表達不出來**：
 *
 * | 缺口 | 處置 |
 * |---|---|
 * | 已送出、回應永不抵達 | 每次往返有時限，逾時拋出並**載明方法名** |
 * | 連線關閉，pending 掛在半空 | `close` / `error` 時把 pending **全部** reject |
 * | 連線關閉**之後**才發起 | 記已關閉旗標，**立即**拋（不等時限） |
 * | 握手本身不完成 | 握手也有時限 |
 *
 * ## 一次逾時 ＝ 一次段落中斷，這是刻意接受的代價
 *
 * `pollUntil` 沒有開 `tolerateErrors`，而 `pollFor` 在未開容忍時會把讀取的例外**直接往外拋**
 * —— 所以逾時不會被重試接住。**仍然接受**：段落中斷是有邊界、有堆疊、會被段落隔離接住的失敗，
 * 而 hang 讓整輪永遠不結束，兩者不同級。**不要順手把 `pollUntil` 改成容忍** —— 那會把每一條
 * 「等不到就紅」的斷言變成「等不到就重試到窗口耗盡」，改動的是數百條既有斷言的語意。
 *
 * @param {object} target `waitForPageTarget` 的回傳
 * @param {object} [options] **存在的理由是可驗收性**：不可注入的話，每條逾時測試都得真的跑滿
 *   預設時限，而單元測試層的定位是秒級、可隨時跑
 */
/**
 * WebSocket 的 `error` 事件帶著什麼，取決於實作 —— Node 內建的 WebSocket 把底層錯誤放在
 * `event.error`，有些實作只有 `event.message`。**取不到就說取不到**，不要回一個空字串
 * 假裝有內容（那正是這裡原本的病：一句沒有主詞的「連線失敗」）。
 */
function describeSocketError(event) {
  const error = event?.error
  if (error) return error.code ? `${error.code} ${error.message ?? ''}`.trim() : String(error.message ?? error)
  if (event?.message) return String(event.message)
  return '(事件未帶任何細節)'
}

export async function connect(
  target,
  {
    createSocket = (url) => new WebSocket(url),
    callTimeoutMs = CALL_TIMEOUT_MS,
    connectTimeoutMs = CONNECT_TIMEOUT_MS,
  } = {},
) {
  const ws = createSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    // **握手也要時限**：`open` 與 `error` 兩者都不來時（TCP 連上但沒有 upgrade 回應），
    // 這個 promise 永遠不 resolve —— 而它在每一支探針的啟動路徑上。
    const timer = setTimeout(
      () => failWith(new Error(`CDP WebSocket 握手逾時（${connectTimeoutMs}ms）`)),
      connectTimeoutMs,
    )
    const settle = (fn) => (arg) => {
      clearTimeout(timer)
      fn(arg)
    }
    // **失敗的 socket 要確實丟棄。** 這個入口現在會被重試（`connectToApp`），而一個沒有關掉
    // 的半死連線仍掛著 listener —— N 輪就是 N 個。`close()` 自己再拋沒有意義（它可能已經
    // 在關閉中），吞掉。
    const failWith = settle((error) => {
      try {
        ws.close()
      } catch {
        // 已經在關閉或從未開啟 —— 兩者都不需要處理。
      }
      reject(error)
    })
    ws.addEventListener('open', settle(resolve), { once: true })
    // **帶主詞地失敗。** 此前這裡是 `new Error('CDP WebSocket 連線失敗')` —— 事件的內容
    // 整個被丟掉，於是 issue #7 那次失敗至今分辨不出是連線被拒、是 target 在取得清單與握手
    // 之間消失、還是握手被拒。三者的處置完全不同。
    ws.addEventListener('error', (event) => failWith(new Error(`CDP WebSocket 連線失敗：${describeSocketError(event)}`)), {
      once: true,
    })
  })

  let nextId = 1
  /** id → 「以某個理由讓這次往返失敗」（已含清理）。 */
  const pending = new Map()
  let closed = false

  /**
   * 讓所有尚未完成的往返立即失敗。
   *
   * **先 `clear()` 再逐一 reject**：每個 rejector 自己會 `pending.delete(id)`，而在迭代中
   * 修改集合是找麻煩。
   */
  const failAllPending = (reason) => {
    const rejectors = [...pending.values()]
    pending.clear()
    for (const rejectWith of rejectors) rejectWith(new Error(reason))
  }

  const markClosed = (reason) => {
    if (closed) return
    closed = true
    failAllPending(reason)
  }

  ws.addEventListener('close', () => markClosed('CDP 連線已關閉'), { once: true })
  ws.addEventListener('error', () => markClosed('CDP 連線發生錯誤'))

  function send(method, params = {}) {
    // 連線關閉後發起的往返：**立即**拋，不等時限。等滿 30 秒才說「連線關閉了」是在浪費時間，
    // 而那件事在發起的當下就已經知道。
    if (closed) {
      return Promise.reject(new Error(`CDP 連線已關閉，不再送出：${method}`))
    }

    const id = nextId++
    // **往返計時在這裡，因為只有這裡看得到每一次往返。** 一次拖曳是十餘個 `Input.*`、
    // 一次輪詢是數十次 `Runtime.evaluate` —— 「300 次往返共 3 秒」與「300 次共 90 秒」
    // 是兩個不同的病，而其他任何尺度都分不出它們。
    // token 在**發起**時取得：殭屍段落飛在半空的往返，完成時不該記到下一個段落頭上。
    const token = sectionToken()
    const started = Date.now()
    return new Promise((resolve, reject) => {
      const finish = () => {
        noteCdp(Date.now() - started, token)
        clearTimeout(timer)
        pending.delete(id)
        ws.removeEventListener('message', onMessage)
      }
      const onMessage = (event) => {
        const msg = JSON.parse(event.data)
        if (msg.id !== id) return
        finish()
        if (msg.error) return reject(new Error(msg.error.message))
        resolve(msg.result)
      }
      // **不 `unref()` 這個計時器**（同 `sections.mjs` 的段落時限）：它可能是唯一撐住事件迴圈
      // 的東西，unref 之後 Node 會判定無事可做而直接結束 —— 逾時形同不存在，而症狀是探針
      // 靜默地提早結束。正常路徑上它一律被 `finish()` 清掉。
      const timer = setTimeout(() => {
        finish()
        // **訊息要載明方法名** —— 「某次往返逾時」對追查毫無幫助，而 `Input.dispatchMouseEvent`
        // 與 `Runtime.evaluate` 逾時是兩個不同的病。
        reject(new Error(`CDP 往返逾時（${callTimeoutMs}ms）：${method}`))
      }, callTimeoutMs)
      pending.set(id, (error) => {
        finish()
        reject(error)
      })
      ws.addEventListener('message', onMessage)
      ws.send(JSON.stringify({ id, method, params }))
    })
  }

  subscribeConsole(ws, send)

  return {
    send,
    async evaluate(expression) {
      const result = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
      if (result?.exceptionDetails) {
        // **`exceptionDetails.text` 幾乎恆為 `"Uncaught"`** —— 真正的訊息在
        // `exception.description`（`"Error: …\n    at …"`）。只丟 `text` 的話，頁面裡丟出來的
        // 錯誤到了這裡就只剩「Uncaught」三個字，等於什麼都沒說（同 CLAUDE.md 那條「一條沒有
        // `detail` 的 `check()`，失敗時等於什麼都沒說」）。哨兵式的 expression 全靠這條訊息說明
        // 自己為什麼失效。
        const { exceptionDetails: d } = result
        throw new Error(d.exception?.description ?? d.exception?.value ?? d.text)
      }
      return result?.result?.value
    },
    /**
     * 關閉連線。
     *
     * **主動關閉要立刻讓 pending 失敗，不能等 `close` 事件** —— 那個事件是非同步的，而
     * 「`client.close()` 之後那些 promise 永遠不 resolve」正是 issue #22 的形狀。
     */
    close: () => {
      markClosed('CDP 連線已由呼叫端關閉')
      ws.close()
    },
  }
}

/** 只收這兩級 —— `log` / `info` / `debug` 在 dev 模式下是一片雜訊（Vite 的 HMR 訊息）。 */
const COLLECTED_LEVELS = new Set(['error', 'warning'])

/** CDP 的 `RemoteObject` 陣列收成一行字。物件不展開（`preview` 夠用，深挖要多跑往返）。 */
function describeArgs(args = []) {
  return args
    .map((arg) => {
      if (arg.type === 'string') return arg.value
      if ('value' in arg) return JSON.stringify(arg.value)
      return arg.description ?? arg.className ?? arg.type
    })
    .join(' ')
}

/**
 * 訂閱 renderer 的 console 錯誤與未捕捉例外。
 *
 * ## 為什麼探針此前一個字都收不到
 *
 * `send()` 的 message handler 只認得帶 `id` 的回應 —— **事件訊息（沒有 `id`）被直接忽略**。
 * 於是 dev 模式那七條穩定失敗，至今沒有任何現場證據：子條件的 detail 能說出是 `rail` / `root` /
 * `visible` 哪一個不成立，卻說不出**為什麼**，而 dev 與 build 唯一的結構差異（多一層開發伺服器）
 * 的失敗正是留在 console 而不在 DOM 上。
 *
 * ## 捕捉窗口涵蓋 `enable` 之前 —— 這是實測，不是推論
 *
 * 直覺會認為「enable 之後才開始收」，那樣的話 renderer 在 CDP client attach 之前寫的東西全部
 * 拿不到 —— 而那正是模組載入失敗會出現的地方。**實測推翻了它**（2026-08-13，Electron 43，
 * 以「ws 連上但先不 enable → `Runtime.evaluate` 發出訊息 → 才 enable」模擬）：
 *
 * ```
 * enable 之前的訊息，重播收到：3
 *     Runtime.consoleAPICalled  {"type":"error","args":[…"BEFORE_ENABLE_CONSOLE"]}
 *     Log.entryAdded            {"source":"security","level":"error","text":"…CSP…"}
 *     Log.entryAdded            {"source":"javascript","level":"error","text":"Fetch API cannot load…"}
 * ```
 *
 * Chromium 兩個 domain 都會緩衝並在 enable 時重播。**這個性質是承重的**：日後 Electron 升版若
 * 改掉它，症狀是「採不到早期訊息」而不是任何一條紅燈。
 */
function subscribeConsole(ws, send) {
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id) return // 這是某次 send 的回應，不是事件

    const token = sectionToken()
    if (msg.method === 'Runtime.consoleAPICalled') {
      const level = msg.params.type === 'warning' ? 'warning' : msg.params.type
      if (!COLLECTED_LEVELS.has(level)) return
      noteConsole({ level, source: 'console', text: describeArgs(msg.params.args) }, token)
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      noteConsole(
        {
          level: 'error',
          source: 'exception',
          // 與 `evaluate` 同一條教訓：`text` 幾乎恆為 "Uncaught"，真正的訊息在 description。
          text: d?.exception?.description ?? d?.exception?.value ?? d?.text ?? '(未捕捉的例外)',
        },
        token,
      )
    } else if (msg.method === 'Log.entryAdded') {
      const entry = msg.params.entry
      if (!COLLECTED_LEVELS.has(entry.level)) return
      noteConsole({ level: entry.level, source: entry.source, text: entry.text }, token)
    }
  })

  // 不 await：`connect()` 的呼叫端在意的是 client 可用了沒。這兩個 enable 各是一次往返，
  // 而它們的效果（含重播）不需要被等待 —— 事件會自己抵達。
  //
  // **但「不 await」不等於「可以不接住」。** 往返有時限之後，這兩個 promise 是**會** reject 的
  // （逾時、或連線在它們回來之前就關閉），而一個沒有 handler 的 rejected promise 會讓 Node
  // 直接終結行程 —— 症狀是探針莫名其妙地死掉，且死在一個與被測行為無關的地方。
  // 這兩次往返的失敗不影響任何斷言（收不到 console 訊息只是少一份診斷），因此吞掉是對的。
  const ignore = () => {}
  send('Runtime.enable').catch(ignore)
  send('Log.enable').catch(ignore)
}

/** 在座標處按下、移動、放開 —— 用來拖動 role="separator" 的分界。 */
export async function dragMouse(client, from, to, steps = 8) {
  const base = { button: 'left', buttons: 1, clickCount: 1 }
  // 先 hover 再按下：拖動實作多半在 pointerdown 才 setPointerCapture，
  // 而沒有前置的 pointermove 時，某些版面在首次事件上不會建立拖動狀態。
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from, button: 'none', buttons: 0 })
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...from, ...base })
  for (let step = 1; step <= steps; step++) {
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(from.x + ((to.x - from.x) * step) / steps),
      y: Math.round(from.y + ((to.y - from.y) * step) / steps),
      ...base,
    })
  }
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...to,
    ...base,
    buttons: 0,
  })
}

const KEY_CODES = { ArrowLeft: 37, ArrowRight: 39, ArrowUp: 38, ArrowDown: 40 }

/** 對目前取得焦點的元素送出一次按鍵。 */
export async function pressKey(client, key) {
  const windowsVirtualKeyCode = KEY_CODES[key] ?? 0
  for (const type of ['keyDown', 'keyUp']) {
    await client.send('Input.dispatchKeyEvent', {
      type,
      key,
      code: key,
      windowsVirtualKeyCode,
      nativeVirtualKeyCode: windowsVirtualKeyCode,
    })
  }
}

/** 反覆求值直到 settled 回傳 true，或逾時後回傳最後一次結果 */
export async function pollUntil(client, expression, settled, timeoutMs = 20_000) {
  return pollFor({
    read: () => client.evaluate(expression),
    settled,
    timeoutMs,
    label: labelOf(expression),
  })
}

/**
 * 把一段 expression 收成一行標籤。
 *
 * 探針的 expression 動輒數十行（`RENDER_PATH_PRELUDE` 那種），原樣印出來會把逾時的那一行
 * 淹掉 —— 而那一行的用途正是「一眼看出是哪個等待燒掉了窗口」。
 */
function labelOf(expression) {
  const flat = String(expression).replace(/\s+/g, ' ').trim()
  return flat.length > 72 ? `${flat.slice(0, 72)}…` : flat
}
