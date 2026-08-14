/**
 * `scripts/lib/cdp.mjs` 的**傳輸層**單元測試 —— 每一次往返都必須在有限時間內返回。
 *
 * ## 為什麼這一族必須在單元測試層擋住
 *
 * 它們要防的是 **hang**，而 hang 在探針層的症狀是「還在跑」：issue #22 的代價是一輪
 * `test:e2e` 卡住 1 小時 30 分且永遠不會結束，`docs/lessons/probes.md` 更記載它「看起來像
 * Electron 啟動很慢」。**一個永遠不結束的失敗，沒有辦法在端到端層被觀察到。**
 *
 * ## 每一條都自帶 timeout，這不是形式
 *
 * 把機制拿掉時，這些測試會**掛住**而不是變紅 —— 那正是被修的失效形狀。沒有 `timeout` 的話，
 * 對照組會讓整輪 `npm test` 停住，而 `npm test` 的定位是「改完就跑」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CALL_TIMEOUT_MS, CONNECT_TIMEOUT_MS, connect } from './lib/cdp.mjs'

/** 每條測試的上限 —— 遠大於測試自訂的毫秒級時限，遠小於預設的 30 秒。 */
const TEST_TIMEOUT = 3_000

/**
 * 一個假的 WebSocket。
 *
 * `respond` 決定它怎麼回應送出的訊息：`'echo'` 立即回一個成功結果、`'silent'` 什麼都不回
 * （這是「回應永不抵達」）。
 */
function fakeSocket({ respond = 'echo', autoOpen = true } = {}) {
  const listeners = new Map()
  const socket = {
    sent: [],
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(handler)
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler)
    },
    send(raw) {
      socket.sent.push(JSON.parse(raw))
      if (respond === 'echo') {
        const { id } = JSON.parse(raw)
        queueMicrotask(() => socket.emit('message', { data: JSON.stringify({ id, result: { ok: 1 } }) }))
      }
    },
    close() {
      socket.emit('close', {})
    },
    emit(type, event) {
      for (const handler of [...(listeners.get(type) ?? [])]) handler(event)
    },
  }
  if (autoOpen) queueMicrotask(() => socket.emit('open', {}))
  return socket
}

const connectFake = (socket, options = {}) =>
  connect({ webSocketDebuggerUrl: 'ws://fake' }, { createSocket: () => socket, ...options })

test('回應永不抵達時，該次往返逾時且訊息載明方法名', { timeout: TEST_TIMEOUT }, async () => {
  const client = await connectFake(fakeSocket({ respond: 'silent' }), { callTimeoutMs: 40 })
  await assert.rejects(
    () => client.send('Runtime.evaluate', {}),
    // **方法名是承重的**：`Input.dispatchMouseEvent` 逾時與 `Runtime.evaluate` 逾時是兩個病。
    /CDP 往返逾時（40ms）：Runtime\.evaluate/,
  )
})

test('連線關閉使尚未完成的往返立即失敗', { timeout: TEST_TIMEOUT }, async () => {
  const socket = fakeSocket({ respond: 'silent' })
  const client = await connectFake(socket, { callTimeoutMs: 60_000 })

  // 時限訂成 60 秒：**這條驗的不是逾時，是關閉** —— 若它靠逾時才 reject，這條就會超過自己的
  // timeout 而失敗（而不是靜靜地通過）。
  const inflight = client.send('Runtime.evaluate', {})
  socket.close()
  await assert.rejects(() => inflight, /CDP 連線已關閉/)
})

test('呼叫端主動 close() 同樣讓 pending 立即失敗（不等 close 事件）', { timeout: TEST_TIMEOUT }, async () => {
  const socket = fakeSocket({ respond: 'silent' })
  const client = await connectFake(socket, { callTimeoutMs: 60_000 })
  const inflight = client.send('Runtime.evaluate', {})
  client.close()
  await assert.rejects(() => inflight, /已由呼叫端關閉|已關閉/)
})

test('連線關閉後發起的往返立即失敗，且耗時遠小於時限', { timeout: TEST_TIMEOUT }, async () => {
  const socket = fakeSocket({ respond: 'silent' })
  const client = await connectFake(socket, { callTimeoutMs: 60_000 })
  client.close()

  // **耗時的量測是這條的鑑別力**：少了它，一個「等滿時限才拋」的實作也會通過。
  const started = Date.now()
  await assert.rejects(() => client.send('Runtime.evaluate', {}), /不再送出：Runtime\.evaluate/)
  assert.ok(Date.now() - started < 100, `應立即失敗，實得 ${Date.now() - started}ms`)
})

test('一次逾時之後，連線仍然可用', { timeout: TEST_TIMEOUT }, async () => {
  // **逾時不判死整條連線**：呼叫端多半在輪詢之內，把連線判死會讓一次偶發的慢變成永久的失敗。
  let mode = 'silent'
  const socket = fakeSocket({ respond: 'manual' })
  socket.send = function send(raw) {
    const { id } = JSON.parse(raw)
    socket.sent.push(JSON.parse(raw))
    if (mode === 'echo') {
      queueMicrotask(() => socket.emit('message', { data: JSON.stringify({ id, result: { ok: 1 } }) }))
    }
  }
  const client = await connectFake(socket, { callTimeoutMs: 40 })

  await assert.rejects(() => client.send('Runtime.evaluate', {}), /逾時/)
  mode = 'echo'
  assert.deepEqual(await client.send('Runtime.evaluate', {}), { ok: 1 })
})

test('握手不完成時，connect() 逾時', { timeout: TEST_TIMEOUT }, async () => {
  // `open` 與 `error` 都不來 —— 現況會永遠等，而它在每一支探針的啟動路徑上。
  const socket = fakeSocket({ autoOpen: false })
  await assert.rejects(() => connectFake(socket, { connectTimeoutMs: 40 }), /握手逾時（40ms）/)
})

test('未注入時採用預設常數', { timeout: TEST_TIMEOUT }, async () => {
  // 以匯出的常數比對，**不重寫數字** —— 否則改了預設值而忘記改測試時，這裡會紅在一個
  // 與行為無關的地方。
  assert.equal(typeof CALL_TIMEOUT_MS, 'number')
  assert.equal(typeof CONNECT_TIMEOUT_MS, 'number')
  assert.ok(CALL_TIMEOUT_MS >= 10_000, '它是癱瘓的防線，不是效能的閘門')

  const socket = fakeSocket()
  const client = await connectFake(socket)
  assert.deepEqual(await client.send('Runtime.evaluate', {}), { ok: 1 })
  client.close()
})
