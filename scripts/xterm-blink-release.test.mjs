/**
 * 守衛：**我們倚賴的那個上游修正必須還在，而版本必須是釘死的。**
 *
 * ## 背景
 *
 * `@xterm/addon-webgl` 的 `WebglRenderer` 曾把 `_cursorBlinkStateManager` 建成一個**沒有交給
 * disposable store** 的 `MutableDisposable`（同一個建構子裡其餘每一個都被 `this._register(...)`
 * 包住）。於是 renderer 被釋放時，它的 600ms 游標閃爍計時器不會停 —— 每一次釋放都留下一個
 * 不屬於任何存活終端的計時器，而它們每 600ms 要求一次畫面更新，使 renderer 永遠不進入閒置。
 * 實測：連續使用 24 小時累積 72 個，閒置時的合成器負載由 0.2% 升到 23.2%；跑滿 100 小時者
 * 吃滿一整顆核心。症狀是打字延遲與切換 session 變慢（issue #25 / #28、上游 xtermjs#5818）。
 *
 * ## 這道守衛擋什麼、不擋什麼
 *
 * **擋**：依賴被退回、被「順手」改成浮動版本（`^`）而滑到沒有修正的版本。
 * **不擋**：行為本身。**這件事在本 repo 目前沒有自動的行為層級載體** —— 探針環境下游標閃爍
 * 不會啟動（上游 xtermjs#6113），因此「釋放後不留下計時器」那條規格驗不到。缺口已登記。
 *
 * ## 為什麼比對的是安裝下來的產物，不是 `package.json` 的版本字串
 *
 * 版本號對得上不代表裝到的東西對 —— 而這道守衛要保護的是**那段程式碼**。比對產物同時涵蓋
 * 「版本寫對了但 lock 檔沒更新」這種情況。
 *
 * ## 對照組（**實際執行過**，不是以 grep 推論）
 *
 * 把 `@xterm/addon-webgl` 退回 `0.19.0`、`npm ci`，然後執行本檔：**兩條斷言都失敗**。
 * 第一條是因為該版本的產物裡沒有 `this._register`；第二條是因為退回時版本範圍一併變回
 * `^0.19.0` —— 順帶證明了「不得浮動」那條也咬得到東西。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 修正後的形狀：`MutableDisposable` 被交給 renderer 的 disposable store。 */
const REGISTERED = '_cursorBlinkStateManager=this._register'

test('@xterm/addon-webgl 的閃爍計時器有被交給 disposable store', () => {
  const lib = readFileSync(join(root, 'node_modules/@xterm/addon-webgl/lib/addon-webgl.mjs'), 'utf8')

  // **先確認欄位本身還在。** 少了這一條，上游若把欄位改名，下一條會因為「找不到舊形狀」而
  // 通過 —— 那時我們會以為修正還在，實際上是查詢失準。這是本 repo 反覆出現的假綠形狀。
  assert.ok(
    lib.includes('_cursorBlinkStateManager'),
    '在 addon-webgl 的產物裡找不到 _cursorBlinkStateManager —— 上游可能改名或重構了，' +
      '本守衛的判準已失效，需要重新確認它是否仍會外洩計時器',
  )

  assert.ok(
    lib.includes(REGISTERED),
    '安裝的 @xterm/addon-webgl 沒有把 _cursorBlinkStateManager 交給 disposable store —— ' +
      '游標閃爍計時器會在終端釋放後繼續執行（issue #25 / #28）。' +
      '請確認依賴未被退回到含此缺陷的版本。',
  )
})

test('@xterm/* 的版本一律釘死，不得浮動', () => {
  const { dependencies } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const floating = Object.entries(dependencies)
    .filter(([name]) => name.startsWith('@xterm/'))
    .filter(([, range]) => /^[\^~]/.test(range))

  // 它們釘在 beta channel，而該 channel 每天發版（8 個月 300 餘版）。`^0.20.0-beta.298` 在
  // semver 下**會往上飄**到更新的 beta —— 每次 `npm install` 都可能換一批程式碼。
  assert.deepEqual(
    floating,
    [],
    `這些 @xterm/* 使用了浮動版本：${floating.map(([n, r]) => `${n}@${r}`).join(', ')}`,
  )
})
