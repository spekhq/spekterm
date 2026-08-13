/**
 * 極簡 CDP 客戶端，只依賴 Node 內建的 fetch 與 WebSocket。
 *
 * 驗收一律透過 CDP 連進執行中的 app，而不是在產品程式碼裡塞測試分支 ——
 * 要驗的正是被出貨的那份程式碼，任何為測試而加的岔路都會讓結論失效。
 */
import { noteCdp, pollFor, sectionToken } from './instrument.mjs'

// 斷言與等待原語的**唯一定義**在 `instrument.mjs`（它與 CDP 無關，`sections.mjs` 與
// `probe-native` 都要用）。這裡轉出，是為了讓既有的 `from './lib/cdp.mjs'` 一字不必改。
export { check, pollFor } from './instrument.mjs'

export async function waitForPageTarget(port, timeoutMs = 30_000) {
  // **這個呼叫端要拋錯**：等不到 CDP target 還往下走，只會紅在一個與根因無關的地方。
  // 原語一律回傳最後的值，升不升級為例外由呼叫端決定 —— 這裡就是那個「要」的呼叫端。
  const page = await pollFor({
    read: async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/list`)
        const targets = await res.json()
        return targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) ?? null
      } catch {
        // devtools endpoint 尚未就緒 —— 這是「還沒好」，不是「壞了」
        return null
      }
    },
    settled: (value) => value !== null,
    timeoutMs,
    label: `CDP target（port ${port}）`,
  })
  if (!page) throw new Error(`等待 CDP target 逾時（${timeoutMs}ms，port ${port}）`)
  return page
}

export async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('CDP WebSocket 連線失敗')), { once: true })
  })

  let nextId = 1

  function send(method, params = {}) {
    const id = nextId++
    // **往返計時在這裡，因為只有這裡看得到每一次往返。** 一次拖曳是十餘個 `Input.*`、
    // 一次輪詢是數十次 `Runtime.evaluate` —— 「300 次往返共 3 秒」與「300 次共 90 秒」
    // 是兩個不同的病，而其他任何尺度都分不出它們。
    // token 在**發起**時取得：殭屍段落飛在半空的往返，完成時不該記到下一個段落頭上。
    const token = sectionToken()
    const started = Date.now()
    const done = () => noteCdp(Date.now() - started, token)
    return new Promise((resolve, reject) => {
      const onMessage = (event) => {
        const msg = JSON.parse(event.data)
        if (msg.id !== id) return
        ws.removeEventListener('message', onMessage)
        done()
        if (msg.error) return reject(new Error(msg.error.message))
        resolve(msg.result)
      }
      ws.addEventListener('message', onMessage)
      ws.send(JSON.stringify({ id, method, params }))
    })
  }

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
    close: () => ws.close(),
  }
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
