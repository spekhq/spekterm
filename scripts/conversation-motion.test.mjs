/**
 * 對話 view 的轉場動畫**不得宣稱進度**。
 *
 * 規格：訊息出現的轉場時長 SHALL NOT 隨訊息長度改變 —— 一旦隨長度變化，它就從「這裡多了一則」
 * 變成「內容正在產生」，而後者是一個**沒有來源**的宣稱（design D15）。
 *
 * ## 這是一條代理判準，限度寫在這裡
 *
 * 它擋得住：把時長寫成一個依內容計算的值、或在 JS 裡加一個依長度的延遲。
 * **它擋不住**：一個在 CSS 之外、以其他方式模擬逐字產生的實作（例如逐段插入 DOM）。
 * 那一層由 code review 與 `probe:agent-view` 的「訊息整則出現」承擔。
 *
 * 比照 `xterm-blink-release.test.mjs` 明寫限度的先例 —— **一條沒有寫下限度的代理判準，
 * 會被下一個人當成完整的保證。**
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const CSS = readFileSync(new URL('../src/renderer/src/index.css', import.meta.url), 'utf8')
const VIEW = readFileSync(
  new URL('../src/renderer/src/shell/terminal/ConversationView.tsx', import.meta.url),
  'utf8',
)

test('轉場的時長是一個字面常數', () => {
  const rule = /\.conversation-enter\s*\{[^}]*animation:\s*conversation-enter\s+(\d+)ms/.exec(CSS)
  assert.ok(rule, '找不到 .conversation-enter 的 animation 宣告')
  assert.ok(Number(rule[1]) > 0, `時長不合理：${rule[1]}ms`)
})

test('呈現層沒有任何依訊息長度計算的延遲', () => {
  // 依長度算延遲的典型寫法：`text.length` 出現在與計時相關的表達式裡。
  const suspicious = /(setTimeout|animationDuration|transitionDuration|delay)[^\n]*\.length/.test(VIEW)
  assert.equal(suspicious, false, '呈現層出現了依內容長度計算的時間值')
})
