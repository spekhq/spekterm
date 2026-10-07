/**
 * `scripts/lib/quit.mjs` 的單元測試 —— 關閉被測 app 要等它真的結束。
 *
 * ## 兩條測試分別擋住兩個相反的失效方向
 *
 * - **不等**：與主行程的收尾競態，於是「損毀降級」那一族的斷言可能驗到一份被覆蓋回來的
 *   正常檔案（issue #8）。**失效方向是假綠。**
 * - **等到永遠**：把競態換成 hang（issue #22）。
 *
 * 第二條的對照組會**掛住**而不是變紅 —— 所以每條測試自帶 `timeout`。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { QUIT_TIMEOUT_MS, quitAndWait } from './lib/quit.mjs'

const TEST_TIMEOUT = 3_000

/**
 * 假的子行程。
 *
 * `exitAfterMs` 為 `null` 表示它**不回應**訊號（真實對應：with unsaved changes in the panel, the
 * quit's `close` is prevented to ask, which cancels the quit — the first SIGTERM does not end it）。
 */
function fakeChild({ exitAfterMs = 0 } = {}) {
  const child = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  child.signals = []
  child.kill = (signal) => {
    child.signals.push(signal)
    if (signal === 'SIGKILL') {
      child.exitCode = null
      child.signalCode = 'SIGKILL'
      queueMicrotask(() => child.emit('exit', null, 'SIGKILL'))
      return true
    }
    if (exitAfterMs !== null) {
      setTimeout(() => {
        child.exitCode = 0
        child.emit('exit', 0, null)
      }, exitAfterMs)
    }
    return true
  }
  return child
}

test('等到行程結束才返回', { timeout: TEST_TIMEOUT }, async () => {
  const child = fakeChild({ exitAfterMs: 60 })
  // **以順序旗標斷言，不以耗時斷言** —— 耗時會讓這條在忙碌的機器上變成 flaky，
  // 而要驗的本來就是順序（「返回」發生在「結束」之後）。
  let exited = false
  child.once('exit', () => (exited = true))

  const result = await quitAndWait(child, { timeoutMs: 1_000 })
  assert.equal(exited, true, 'quitAndWait 返回時，行程必須已經結束')
  assert.equal(result.escalated, false)
  assert.deepEqual(child.signals, ['SIGTERM'])
})

test('行程不回應時升級為 SIGKILL 並出聲', { timeout: TEST_TIMEOUT }, async () => {
  const child = fakeChild({ exitAfterMs: null })
  const escalations = []

  const result = await quitAndWait(child, {
    timeoutMs: 40,
    onEscalate: (info) => escalations.push(info),
  })

  assert.equal(result.escalated, true)
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL'])
  assert.equal(escalations.length, 1, '升級必須出聲 —— 那本身就是關於產品的資訊')
  assert.equal(escalations[0].timeoutMs, 40)
})

test('已經結束的行程不再送訊號', { timeout: TEST_TIMEOUT }, async () => {
  const child = fakeChild()
  child.exitCode = 0
  const result = await quitAndWait(child, { timeoutMs: 40 })
  assert.equal(result.escalated, false)
  assert.deepEqual(child.signals, [], '對一個已結束的行程送訊號沒有意義，也可能砸到別人的 pid')
})

test('預設時限是一個具名常數，且大到足以容忍原生對話框那條路徑', () => {
  assert.equal(typeof QUIT_TIMEOUT_MS, 'number')
  assert.ok(QUIT_TIMEOUT_MS >= 5_000, '太小會在關窗對話框那條路徑上誤殺')
  assert.ok(QUIT_TIMEOUT_MS <= 60_000, '太大就吃掉段落時限的預算（13 處呼叫）')
})
