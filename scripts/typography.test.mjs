/**
 * typography-scale：renderer 的字級一律經由 token，不得寫死。
 *
 * 字級必須是**一個旋鈕**（`index.css` 的 `--text-base`）。這只有在「沒有任何元件繞過 token」
 * 時才成立 —— 一個 `text-[12px]` 就是一個轉不動的角落，而它們會增生：收斂前這個 repo 有
 * **70 處**寫死的字級，散在 15 個檔案，於是 `@theme` 裡的兩個 token 調了也沒用。
 *
 * 兩條規則：
 *
 * 1. **產品原始碼不得出現 arbitrary 字級**（`text-[13px]` / `text-[0.8rem]`）。
 * 2. **CSS 的 `font-size` 必須引用字級 token**，不得是字面的 px/rem。（尺度的**定義處**是
 *    `--text-*: 15px` 這種**變數宣告**，不是 `font-size` 宣告，因此不受此規則約束 —— 規則
 *    要禁的是「繞過尺度」，不是「定義尺度」。）
 *
 * **對照組不是裝飾。** 若偵測用的 regex 寫錯（或掃錯了目錄），正面斷言會靜默地永遠通過 ——
 * CLAUDE.md 記過 `naming.test.mjs` 因 ANSI 顏色碼讓路徑比對失準而全綠的實例。因此本檔案
 * 對每一條規則都餵一段**刻意違規的樣本**，要求它必須被抓到；同時餵一段**合法的樣本**，
 * 要求它不得被誤報。
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const rendererRoot = join(repoRoot, 'src/renderer/src')

/** Tailwind 的 arbitrary 字級：`text-[13px]`、`text-[0.8125rem]`。 */
const ARBITRARY_TEXT_SIZE = /\btext-\[[0-9.]+(?:px|rem|em)\]/g

/** 所有 `font-size` 宣告，連值一起取出來判斷 —— 不用 negative lookahead。 */
const FONT_SIZE_DECLARATION = /font-size:\s*([^;}]+)/g

/**
 * 一個 `font-size` 的值是否繞過了字級尺度。
 *
 * **放行相對單位（`em` / `%`）**：它們相對於父層字級，`--text-base` 一動它們就跟著動 ——
 * markdown 的標題正是這樣寫的（`font-size: 1.35em`），那是尺度的**使用者**，不是逃兵。
 *
 * **禁絕對單位（`px` / `rem` / `pt`）**：`px` 顯然繞過尺度；`rem` 是相對於 html 的字級
 * （瀏覽器預設 16px），而我們的旋鈕不動 html 的字級 —— 它一樣轉不動 `rem`。
 */
function bypassesScale(value) {
  const v = value.trim()
  if (v.startsWith('var(')) return false
  if (/^(inherit|initial|unset|revert)$/.test(v)) return false
  if (/^[0-9.]+(em|%)$/.test(v)) return false
  return true
}

function findViolations(source, pattern) {
  if (pattern === FONT_SIZE_DECLARATION) {
    return [...source.matchAll(pattern)]
      .filter((m) => bypassesScale(m[1]))
      .map((m) => m[0].trim())
  }
  return [...source.matchAll(pattern)].map((m) => m[0].trim())
}

/** 遞迴列出副檔名符合的檔案。 */
function walk(dir, extensions) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full, extensions))
    else if (extensions.some((ext) => entry.name.endsWith(ext))) out.push(full)
  }
  return out
}

test('對照組：偵測確實有效 —— 違規樣本必須被抓到，合法樣本不得誤報', () => {
  // 規則 1
  const badTsx = '<span className="shrink-0 text-[11px] text-ink-faint">x</span>'
  const goodTsx = '<span className="shrink-0 text-2xs text-ink-faint">x</span>'
  assert.deepEqual(findViolations(badTsx, ARBITRARY_TEXT_SIZE), ['text-[11px]'], 'arbitrary 字級沒被抓到 —— 規則 1 的偵測已失效，正面斷言是假綠')
  assert.deepEqual(findViolations(goodTsx, ARBITRARY_TEXT_SIZE), [], 'token 被誤報為違規')

  // 規則 2
  const badCss = '.spekui-tooltip { font-size: 11px; }'
  const goodCss = '.spekui-tooltip { font-size: var(--text-2xs); }'
  const relativeCss = '.markdown h1 { font-size: 1.35em; }'
  const scaleDefinition = '@theme { --text-base: 15px; --text-xs: calc(var(--text-base) - 3px); }'
  assert.deepEqual(findViolations(badCss, FONT_SIZE_DECLARATION), ['font-size: 11px'], '字面 font-size 沒被抓到 —— 規則 2 的偵測已失效')
  assert.deepEqual(findViolations(goodCss, FONT_SIZE_DECLARATION), [], '引用 token 的 font-size 被誤報')
  assert.deepEqual(findViolations(scaleDefinition, FONT_SIZE_DECLARATION), [], '尺度的定義處被誤報 —— 它宣告的是變數，不是 font-size')
  assert.deepEqual(findViolations(relativeCss, FONT_SIZE_DECLARATION), [], '相對單位被誤報 —— em 會跟著旋鈕走，它是尺度的使用者')
})

test('renderer 的產品原始碼不得寫死字級', () => {
  const files = walk(rendererRoot, ['.tsx', '.ts'])
  assert.ok(files.length > 0, `${rendererRoot} 下找不到任何原始碼 —— 這支測試的前提失效了`)

  const offenders = []
  for (const file of files) {
    const hits = findViolations(readFileSync(file, 'utf8'), ARBITRARY_TEXT_SIZE)
    if (hits.length > 0) offenders.push(`${relative(repoRoot, file)}: ${hits.join(', ')}`)
  }

  assert.deepEqual(
    offenders,
    [],
    '字級必須走 index.css 的字級 token（text-2xs / text-xs / text-sm / text-base / text-lg）。' +
      `寫死的字級不吃 --text-base 這個旋鈕：\n${offenders.join('\n')}`,
  )
})

test('renderer 的 CSS 不得以字面值宣告 font-size', () => {
  const files = walk(rendererRoot, ['.css'])
  assert.ok(files.length > 0, `${rendererRoot} 下找不到任何 CSS —— 這支測試的前提失效了`)

  const offenders = []
  for (const file of files) {
    const hits = findViolations(readFileSync(file, 'utf8'), FONT_SIZE_DECLARATION)
    if (hits.length > 0) offenders.push(`${relative(repoRoot, file)}: ${hits.join(', ')}`)
  }

  assert.deepEqual(
    offenders,
    [],
    `font-size 必須引用字級 token（var(--text-*)）：\n${offenders.join('\n')}`,
  )
})
