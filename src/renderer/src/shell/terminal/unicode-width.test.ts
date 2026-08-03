import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { REQUIRED_UNICODE_VERSION, pickUnicodeVersion } from './unicode-width'

/**
 * **這裡刻意不以 `@xterm/headless` 驗證實際的字元寬度**（tasks 3.3）。
 *
 * `@xterm/addon-unicode-graphemes` 於模組載入時解碼其 Unicode trie，讀 header 時漏了
 * `byteOffset`（upstream xtermjs/xterm.js#6079，未修）—— 在 Node 中 `Buffer.from(s,'base64')`
 * 可能回傳共用 pool 的一個 view，於是 `highStart` 讀到前面殘留的位元組。**失效方式是靜默的
 * 錯誤寬度**（也可能是 `Data error` 或多 GB 配置造成的 hang，取決於該行程先前配置過什麼）。
 *
 * 那條路徑只在有 `Buffer` 全域時走得到；產品的 renderer 是 `nodeIntegration: false`，走 `atob`
 * 分支，不受影響。**因此寬度本身一律在真實 renderer 中驗收（`probe:terminal`），不在這裡。**
 */
describe('pickUnicodeVersion：寬度判定的版本挑選', () => {
  it('指名的版本在清單中時回傳它', () => {
    assert.equal(
      pickUnicodeVersion(['6', '15', REQUIRED_UNICODE_VERSION]),
      REQUIRED_UNICODE_VERSION,
    )
  })

  it('清單順序不影響結果 —— 挑的是指名的那一個，不是某個位置', () => {
    assert.equal(
      pickUnicodeVersion([REQUIRED_UNICODE_VERSION, '15', '6']),
      REQUIRED_UNICODE_VERSION,
    )
  })

  it('指名的版本不在清單中時拋錯，SHALL NOT 回退到較舊的判定', () => {
    // 這正是「取陣列最後一個」那種寫法會靜默選到 '15' 的情形 —— 而 '15' 沒有 cluster 判定，
    // VS16／ZWJ／膚色修飾三類會悄悄壞回去。
    assert.throws(() => pickUnicodeVersion(['6', '15']), /15-graphemes/)
  })

  it('清單為空時拋錯', () => {
    assert.throws(() => pickUnicodeVersion([]), /not registered/)
  })

  it('只有內建 v6 時拋錯 —— 靜默沿用它與「從未實作」在畫面上無法區分', () => {
    assert.throws(() => pickUnicodeVersion(['6']), /Unicode 6/)
  })
})
