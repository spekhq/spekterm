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
  return {
    evaluate(expression) {
      const id = nextId++
      return new Promise((resolve, reject) => {
        const onMessage = (event) => {
          const msg = JSON.parse(event.data)
          if (msg.id !== id) return
          ws.removeEventListener('message', onMessage)
          if (msg.error) return reject(new Error(msg.error.message))
          if (msg.result?.exceptionDetails) return reject(new Error(msg.result.exceptionDetails.text))
          resolve(msg.result?.result?.value)
        }
        ws.addEventListener('message', onMessage)
        ws.send(JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true },
        }))
      })
    },
    close: () => ws.close(),
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
