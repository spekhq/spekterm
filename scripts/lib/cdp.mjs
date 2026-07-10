/**
 * 極簡 CDP 客戶端，只依賴 Node 內建的 fetch 與 WebSocket。
 *
 * 驗收一律透過 CDP 連進執行中的 app，而不是在產品程式碼裡塞測試分支 ——
 * 要驗的正是被出貨的那份程式碼，任何為測試而加的岔路都會讓結論失效。
 */
import { setTimeout as sleep } from 'node:timers/promises'

export async function waitForPageTarget(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await res.json()
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      // devtools endpoint 尚未就緒
    }
    await sleep(250)
  }
  throw new Error(`等待 CDP target 逾時（${timeoutMs}ms，port ${port}）`)
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
    return new Promise((resolve, reject) => {
      const onMessage = (event) => {
        const msg = JSON.parse(event.data)
        if (msg.id !== id) return
        ws.removeEventListener('message', onMessage)
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
      if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text)
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
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = await client.evaluate(expression)
    if (settled(last)) return last
    await sleep(250)
  }
  return last
}

export function check(results, name, passed, detail) {
  results.push(passed)
  console.log(`  ${passed ? '✓' : '✗'} ${name}${detail ? `：${detail}` : ''}`)
  return passed
}
