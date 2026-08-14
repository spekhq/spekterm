/**
 * `scripts/lib/display.mjs` 的單元測試 —— 探針傳給 Electron 的旗標。
 *
 * ## 為什麼這件事需要一道測試
 *
 * 兩組旗標的失效方式**都是靜默的**：少了 GPU 那組，整條 webgl 路徑降級而斷言紅在「產品壞了」
 * 的位置；少了背景節流那組，renderer 被節流之後 rAF 停擺，於是每一個「等畫面變成某個樣子」
 * 的等待都等滿窗口 —— 而那曾經是三張票、七條紅、一次段落中斷（issue #21 / #19 / #17）。
 *
 * **這裡驗的是「引數組出來了」，不是「處置有效」。** 後者是一個偶發現象的統計問題，只能由
 * 多輪觀測建立（見 `probe-execution-scope` 的「處置的有效性以多輪觀測建立」）。兩者不可混為
 * 一談 —— 這一條全綠不代表探針不會再撞到節流。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

/** 每次都要重讀模組：`useVirtualDisplay()` 讀的是**當下**的環境變數。 */
async function argsWith(display) {
  const previous = process.env.PROBE_DISPLAY
  if (display === undefined) delete process.env.PROBE_DISPLAY
  else process.env.PROBE_DISPLAY = display
  try {
    // query string 讓每次 import 都拿到新的模組實例（ESM 的模組快取以 URL 為鍵）
    const module = await import(`./lib/display.mjs?display=${display ?? 'unset'}`)
    return module.electronExtraArgs()
  } finally {
    if (previous === undefined) delete process.env.PROBE_DISPLAY
    else process.env.PROBE_DISPLAY = previous
  }
}

const BACKGROUNDING = ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding']
const GPU = ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']

test('虛擬螢幕模式停用背景節流', async () => {
  const args = await argsWith(undefined)
  for (const flag of BACKGROUNDING) {
    assert.ok(args.includes(flag), `缺少 ${flag}；實得 ${JSON.stringify(args)}`)
  }
})

test('虛擬螢幕模式同時帶著 GPU 旗標（既有行為未被破壞）', async () => {
  const args = await argsWith(undefined)
  for (const flag of GPU) {
    assert.ok(args.includes(flag), `缺少 ${flag}；實得 ${JSON.stringify(args)}`)
  }
})

test('實體螢幕模式同樣停用背景節流', async () => {
  const args = await argsWith('physical')
  for (const flag of BACKGROUNDING) {
    assert.ok(args.includes(flag), `缺少 ${flag}；實得 ${JSON.stringify(args)}`)
  }
})

/**
 * **這條是上一條的鑑別力自檢，不是額外的覆蓋。**
 *
 * 少了它，一個「一律回傳全部旗標」的實作也會讓上一條通過 —— 而那個實作會在實體螢幕上要求
 * 軟體 GL，把 `PROBE_DISPLAY=physical` 這個「用真實驅動看畫素」的逃生口變成沒有用的東西。
 */
test('對照：實體螢幕模式不帶 GPU 旗標（否則上一條沒有鑑別力）', async () => {
  const args = await argsWith('physical')
  for (const flag of GPU) {
    assert.ok(!args.includes(flag), `實體螢幕不該帶 ${flag}；實得 ${JSON.stringify(args)}`)
  }
})
