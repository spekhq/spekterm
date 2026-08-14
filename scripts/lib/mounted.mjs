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
import { setTimeout as sleep } from 'node:timers/promises'
import { pollFor } from './instrument.mjs'
import { copy } from './copy.mjs'

/** 三個基本子條件。每一個都是一段會被送進 `Runtime.evaluate` 的 JS 片段。 */
const BASE = {
  rail: `document.querySelector('aside[aria-label="${copy('rail.label')}"]')`,
  root: `document.getElementById('root')?.children.length`,
  visible: `document.visibilityState === 'visible'`,
}

/**
 * **畫面時鐘** —— 隨每一個被產生的 frame 前進，沒有 frame 就不動。
 *
 * ## 它回答的問題
 *
 * 「視窗被判定為不可見」說不出**那對驗收意味著什麼**。真正致命的後果是 renderer 進入背景節流
 * 之後 **`requestAnimationFrame` 完全停擺** —— 而 Monaco 的 view 更新、xterm 的渲染與 fit、
 * 選單的呈現全部走 rAF。**一切以呈現為判準的等待都會落空**，而 CDP 往返照樣是 5ms 一次
 * （連線正常，只是畫面不更新）。那正是 issue #21 / #19 / #17 的形狀。
 *
 * ## 為什麼是同步讀取，而不是等一次 rAF 回呼
 *
 * 「等一次回呼」在**正好要偵測的那個狀態下**永遠不會完成 —— **一個為了診斷 hang 而寫的探測，
 * 自己會 hang**。而在頁面裡裝一個常駐計數器同樣不可取：探針不在產品程式碼裡塞測試分支，
 * 那條紀律一樣適用於執行期注入。
 *
 * ## 這是實測的（2026-08-14，Electron 43，以自建視窗 `hide()` 造出停擺）
 *
 * | | rAF ticks | `document.timeline.currentTime` | `performance.now()`（對照組） |
 * |---|---|---|---|
 * | 視窗可見（1.5 秒） | +85 | **+1539.7** | +1503 |
 * | 視窗隱藏（2.5 秒） | **+0** | **+0** | +2503 |
 *
 * 對照組是承重的：`performance.now()` 前進了 2503ms，證明兩次取樣確實隔了那麼久 ——
 * 於是「時鐘沒動」不可能是「取樣太快」。
 *
 * `?? -1`：`currentTime` 在 document 尚未 attach 時為 `null`，而那與「時鐘停住」是兩件事
 * （見 `describeFrameStall`）。
 */
const FRAME_CLOCK = `Math.round(document.timeline?.currentTime ?? -1)`

/**
 * 兩次取樣之間必須隔多久。
 *
 * **必須明顯大於一個 frame**（60Hz 下約 16.7ms）—— 間隔太短時兩次可能落在同一個 frame 內，
 * 畫面時鐘本來就相同，於是**誤報「沒有 frame」**。取 250ms（與 `pollFor` 的預設輪詢間隔同級）。
 */
const FRAME_SAMPLE_GAP_MS = 250

/**
 * **只帶回、不參與判定**的現場資料。
 *
 * issue #19 的建議 1 要的四樣裡有兩樣在這裡（另兩樣：console error 由 `lib/cdp.mjs` 收，
 * `did-navigate` 明確不做 —— 它是主行程的 `webContents` 事件，renderer 求值看不到，要拿到就得
 * 在 `src/` 印出來，那違反「產品程式碼零改動」）。
 *
 * **它們絕不可以進 `ok`。** `readyState === 'complete'` 不是掛載的必要條件；把它加進判定會改變
 * 那七條紅**自己的判定**，於是 #19 的對照組就毀了 —— 交付之後分不出「紅燈變了」是因為採證還是
 * 因為判準。子節點的**數量**同理：`root` 那個子條件本來就存在，這裡加的是它被 `Boolean()` 掉的
 * 那個數字。
 */
const DIAGNOSTICS = {
  readyState: `document.readyState`,
  rootChildren: `document.getElementById('root')?.children.length ?? 0`,
  frameClock: FRAME_CLOCK,
}

/**
 * 組出一段求值為 `{ ok, ...子條件, diagnostics }` 的 expression。
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
  const diagnosticFields = Object.entries(DIAGNOSTICS)
    .map(([name, expression]) => `${name}: (${expression})`)
    .join(', ')
  return `(() => {
    const parts = { ${fields} }
    return { ...parts, ok: Object.values(parts).every(Boolean), diagnostics: { ${diagnosticFields} } }
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
  // **`diagnostics` 必須排除在子條件之外。** 它是一個物件（恆為 truthy），混進來會讓「哪些子條件
  // 不成立」多出一個永遠成立的 `diagnostics=true`，而且與 `ok` 的計算對不上。
  const parts = Object.entries(value).filter(([name]) => name !== 'ok' && name !== 'diagnostics')
  const failed = parts.filter(([, ok]) => !ok).map(([name]) => name)
  const all = parts.map(([name, ok]) => `${name}=${ok}`).join(' ')
  const diagnostics = value.diagnostics
    ? ` ｜ ${Object.entries(value.diagnostics)
        .map(([name, v]) => `${name}=${v}`)
        .join(' ')}`
    : ''
  return `未成立：${failed.join('、') || '(無 —— ok 與子條件不一致)'}（${all}）${diagnostics}`
}

/**
 * 兩次畫面時鐘的取樣講成人話。**空字串表示「沒什麼好說的」。**
 *
 * 與 `describeMounted` 同一條性質：**純函式、拿不到 client**。取樣由呼叫端做 —— 這裡要的正是
 * 「兩個時點之間」的比較，而那在結構上不可能由一次事後求值取得。
 *
 * **負值表示時鐘讀不到**（`document.timeline` 不存在或 `currentTime` 為 `null`），那與「時鐘
 * 停住」是兩件事：前者無從判斷，**回傳空字串而不是誤報**。否定式的診斷寧可少說，不可亂說。
 *
 * @param {number} before 前一次的畫面時鐘
 * @param {number} after  後一次的畫面時鐘
 */
export function describeFrameStall(before, after) {
  if (typeof before !== 'number' || typeof after !== 'number') return ''
  if (before < 0 || after < 0) return ''
  if (before !== after) return ''
  return (
    `沒有任何 frame 被產生（畫面時鐘停在 ${before}）—— renderer 正被背景節流，` +
    `依賴動畫框的呈現不會更新，一切以呈現為判準的等待都會落空`
  )
}

/**
 * 等待掛載判定成立；**等不到時採一次現場**。
 *
 * ## 為什麼要有這個入口，而不是各探針自己 `pollUntil(client, MOUNTED, …)`
 *
 * 十一處呼叫端各寫一次，就是十一次「記得也採一下現場」的紀律 —— 而這個診斷存在的理由正是
 * 「下一次有人撞到時，輸出要說得出話」。收斂於此，它不可能漏掉。
 *
 * ## 回傳語意與現況**逐字相同**
 *
 * 回傳最後一次的判定物件（`pollFor` 的既有語意），呼叫端照樣把它餵給 `describeMounted`。
 * **診斷取樣一律不得改變這件事** —— 「等不到掛載」最常見的原因就是 renderer 已經不在了，
 * 而此時對它求值會拋；讓那個例外往外送，等於把呼叫端拿到的東西從「最後的判定值」換成「例外」，
 * 而 `describeMounted` 正是為前者準備的（它對 `undefined` 有專門的說法）。
 *
 * @param {{ evaluate: Function }} client
 * @param {object} [options]
 * @param {string} [options.expression] 判定用的求值運算式（`probe:package` 用不含可見性的那份）
 * @param {number} [options.timeoutMs]
 */
export async function awaitMounted(client, { expression = MOUNTED, timeoutMs = 20_000 } = {}) {
  const value = await pollFor({
    read: () => client.evaluate(expression),
    settled: (result) => result?.ok === true,
    timeoutMs,
    label: '掛載判定（awaitMounted）',
  })

  if (value?.ok !== true) {
    const note = await sampleFrameStall(client)
    if (note) console.log(`  ⏱ ${note}`)
  }

  return value
}

/** 取兩次畫面時鐘。**任何失敗都吞掉** —— 診斷不得改變呼叫端拿到的東西。 */
async function sampleFrameStall(client) {
  try {
    const before = await client.evaluate(FRAME_CLOCK)
    await sleep(FRAME_SAMPLE_GAP_MS)
    const after = await client.evaluate(FRAME_CLOCK)
    return describeFrameStall(before, after)
  } catch (error) {
    return `frame 診斷取樣失敗（${error?.message ?? error}）—— renderer 可能已經不在了`
  }
}
