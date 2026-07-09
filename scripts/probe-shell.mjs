/**
 * 以 CDP 連進執行中的 app，驗證 workspace-app-shell 的 spec scenario。
 *
 * 之所以走 CDP 而非在主行程塞驗證分支：驗收要檢查的正是產品實際傳給
 * BrowserWindow 的設定與 renderer 的真實全域環境，任何為了測試而加的分支
 * 都會讓被驗的東西不再是被出貨的東西。
 *
 * 用法：node scripts/probe-shell.mjs
 * 結束碼 0 表示全部 scenario 通過。
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const DEBUG_PORT = 9222
const STARTUP_TIMEOUT_MS = 30_000
const RENDER_TIMEOUT_MS = 15_000

/** renderer 內求值：回傳信任模型與樣式的實測結果 */
const PROBE_EXPRESSION = `(() => {
  const root = document.querySelector('[data-testid="app-root"]')
  if (!root) return { reactMounted: false }
  const style = getComputedStyle(root)
  return {
    reactMounted: true,
    preloadApi: root.dataset.preloadApi,
    requireExposed: typeof require !== 'undefined',
    processExposed: typeof process !== 'undefined',
    trustModelText: document.querySelector('[data-testid="trust-model"]')?.textContent ?? null,
    backgroundColor: style.backgroundColor,
    padding: style.padding,
    title: document.title,
  }
})()`

async function waitForPageTarget(deadline) {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
      const targets = await res.json()
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      // devtools endpoint 尚未就緒
    }
    await sleep(250)
  }
  throw new Error(`等待 CDP target 逾時（${STARTUP_TIMEOUT_MS}ms）`)
}

function cdpEvaluate(ws, id, expression) {
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id !== id) return
      ws.removeEventListener('message', onMessage)
      if (msg.error) return reject(new Error(msg.error.message))
      if (msg.result?.exceptionDetails) {
        return reject(new Error(msg.result.exceptionDetails.text))
      }
      resolve(msg.result?.result?.value)
    }
    ws.addEventListener('message', onMessage)
    ws.send(JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true },
    }))
  })
}

async function probeUntilSettled(ws) {
  const deadline = Date.now() + RENDER_TIMEOUT_MS
  let id = 1
  let last = null
  while (Date.now() < deadline) {
    last = await cdpEvaluate(ws, id++, PROBE_EXPRESSION)
    // preload 的 ping 是非同步的，等它從 'pending' 落定再判定
    if (last?.reactMounted && last.preloadApi !== 'pending') return last
    await sleep(200)
  }
  return last
}

function check(name, passed, detail) {
  console.log(`  ${passed ? '✓' : '✗'} ${name}${detail ? `：${detail}` : ''}`)
  return passed
}

const electron = spawn(
  process.platform === 'win32' ? 'electron.cmd' : 'electron',
  [`--remote-debugging-port=${DEBUG_PORT}`, '.'],
  { stdio: ['ignore', 'pipe', 'pipe'], env: process.env, shell: process.platform === 'win32' },
)

let stderr = ''
electron.stderr.on('data', (chunk) => (stderr += chunk))

let exitCode = 1
try {
  const target = await waitForPageTarget(Date.now() + STARTUP_TIMEOUT_MS)
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('CDP WebSocket 連線失敗')), { once: true })
  })

  const r = await probeUntilSettled(ws)
  ws.close()

  // spec 要求「檢查建立視窗時傳入的 webPreferences」——靜態驗證那兩個值是被明確寫出的，
  // 而非仰賴 Electron 當版的預設值。與下方的執行期效果檢查互補。
  const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  const declaresTrustModel =
    /contextIsolation:\s*true/.test(mainSource) && /nodeIntegration:\s*false/.test(mainSource)

  console.log('workspace-app-shell 驗收：')
  const results = [
    check('webPreferences 明確宣告信任模型', declaresTrustModel,
      'contextIsolation: true, nodeIntegration: false'),
    check('主行程開啟視窗且 renderer 載入', Boolean(r?.title), `title="${r?.title ?? ''}"`),
    check('React 根元件掛載', r?.reactMounted === true),
    // 不比對特定色值：Tailwind v4 預設輸出 oklch，寫死 rgb 會在色彩空間變動時假性失敗。
    // 判準是「utility class 確實產生了 computed style」——p-10 → 40px、bg-* → 非透明背景。
    check('Tailwind 樣式生效',
      r?.padding === '40px' && Boolean(r?.backgroundColor) && r.backgroundColor !== 'rgba(0, 0, 0, 0)',
      `p-10 → padding=${r?.padding}, bg-slate-950 → ${r?.backgroundColor}`),
    check('preload 白名單 API 可用', r?.preloadApi === 'pong', `ping → ${r?.preloadApi}`),
    check('renderer 看不到 require', r?.requireExposed === false),
    check('renderer 看不到 process', r?.processExposed === false),
    check('信任模型成立', r?.trustModelText === 'contextIsolation 生效', r?.trustModelText ?? ''),
  ]
  exitCode = results.every(Boolean) ? 0 : 1
} catch (err) {
  console.error(`probe 失敗：${err.message}`)
  if (stderr.trim()) console.error(`electron stderr:\n${stderr.trim().slice(0, 800)}`)
} finally {
  electron.kill('SIGTERM')
}

process.exit(exitCode)
