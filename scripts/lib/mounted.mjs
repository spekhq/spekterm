/**
 * 「app 還活著嗎」的共用判定 —— **求值結果是子條件的物件，不是一個布林**。
 *
 * ## 為什麼不是布林
 *
 * 這個判定曾在六支探針各定義一次（四份逐字相同），而且是三到五個子條件的 AND。紅的時候
 * 看不出是哪一個不成立 —— issue #19 的 `MOUNTED !== true` 卡在這裡：**「renderer 不見了」與
 * 「視窗被判定為不可見」是兩個完全不同的病，而輸出上分不開。**
 *
 * ## detail 必須與判定同源
 *
 * `describeMounted()` **只吃已求值的物件、拿不到 client** —— 於是「先斷言、失敗後再求值一次
 * 取樣」在結構上不可能。那件事之所以要擋死：事後補的那一次讀到的是**下一刻**的狀態，而它
 * 完全可能已經恢復；一個指向「沒有失敗的現場」的 detail，比沒有 detail 更糟。
 */
import { copy } from './copy.mjs'

/** 三個基本子條件。每一個都是一段會被送進 `Runtime.evaluate` 的 JS 片段。 */
const BASE = {
  rail: `document.querySelector('aside[aria-label="${copy('rail.label')}"]')`,
  root: `document.getElementById('root')?.children.length`,
  visible: `document.visibilityState === 'visible'`,
}

/**
 * 組出一段求值為 `{ ok, ...子條件 }` 的 expression。
 *
 * @param {object} [options]
 * @param {string[]} [options.omit] 這支探針**不要求**的子條件（要在呼叫端寫明理由）
 * @param {Record<string,string>} [options.extra] 這支探針**額外要求**的子條件
 */
export function mountedExpression({ omit = [], extra = {} } = {}) {
  const parts = { ...BASE, ...extra }
  for (const key of omit) delete parts[key]
  const fields = Object.entries(parts)
    .map(([name, expression]) => `${name}: Boolean(${expression})`)
    .join(', ')
  return `(() => {
    const parts = { ${fields} }
    return { ...parts, ok: Object.values(parts).every(Boolean) }
  })()`
}

/** 一般情形：rail 在、`#root` 有子節點、頁面可見。 */
export const MOUNTED = mountedExpression()

/**
 * **`probe:package` 不要求 `visible`。**
 *
 * 這是維持現狀，不是判斷：`git log -S visibilityState -- scripts/probe-package.mjs` 與
 * `openspec/changes/archive/` 全文都查不到任何說明，也就是說「當初為什麼沒有它」沒有紀錄。
 * AppImage 的視窗在 Xvfb 下會不會被判定為可見**未經驗證** —— 在沒有證據的情況下加上一個
 * 子條件，等於用一支換版前才跑的探針去賭一件沒人驗過的事。
 */
export const MOUNTED_WITHOUT_VISIBILITY = mountedExpression({ omit: ['visible'] })

/**
 * 把判定結果講成人話。**空字串表示「沒什麼好說的」**（判定成立時）。
 *
 * @param {object|null|undefined} value `MOUNTED` 那一次求值的結果
 */
export function describeMounted(value) {
  if (value === null || value === undefined) {
    return '判定沒有回傳值（求值本身失敗 —— renderer 可能已經不在了）'
  }
  if (value.ok === true) return ''
  const parts = Object.entries(value).filter(([name]) => name !== 'ok')
  const failed = parts.filter(([, ok]) => !ok).map(([name]) => name)
  const all = parts.map(([name, ok]) => `${name}=${ok}`).join(' ')
  return `未成立：${failed.join('、') || '(無 —— ok 與子條件不一致)'}（${all}）`
}
