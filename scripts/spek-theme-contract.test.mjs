/**
 * spek-theme-contract：`@spekjs/ui` 的顏色契約，宿主必須**逐一**覆寫。
 *
 * 套件把自己的每個顏色開成一個 `--spek-*` 變數，並在 `styles.css` 裡為它們宣告**深色預設值**；
 * 宿主換膚就是在自己的 `:root` 把它們接到自己的 token 上（`src/renderer/src/index.css`）。
 *
 * **漏接一個是靜默的** —— 那個變數不會變空、圖不會壞，它只是改用套件的顏色。實例：`@spekjs/ui`
 * 1.2 → 1.3 把契約從 8 個變數加到 9 個（新增 `--spek-node-active`，Graph 上進行中的 change 節點），
 * 而我們的 `:root` 當時只有 8 行 —— 升上去之後那顆節點會是套件的 `#22c55e` 而不是我們的綠，
 * 且 `probe:openspec` 的顏色契約斷言只驗 `--spek-accent` 一個值，**不會有任何一條變紅**。
 *
 * 因此這道守衛不比對顏色，比對的是**名單**：套件宣告的每一個變數，宿主都必須宣告。下一次套件再
 * 加變數時，`npm test` 就會紅在這裡 —— 不必有人記得回來看 `index.css` 的那段註解。
 *
 * **對照組不是裝飾。** 兩份名單若都被抽成空集合，「A ⊆ B」會恆真而靜默全綠 —— 這個 repo 記過
 * `naming.test.mjs` 因 ANSI 顏色碼讓比對失準而全綠的實例。因此下面同時要求兩份名單非空，
 * 並餵刻意漏接與刻意誤導的樣本，證明抽取器分得出「宣告」與「使用」。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const hostCssPath = join(repoRoot, 'src/renderer/src/index.css')
const packageCssPath = fileURLToPath(import.meta.resolve('@spekjs/ui/styles.css'))

/** 套件的 CSS 與我們的都以繁中註解說明變數，註解裡會提到變數名 —— 先剝掉，只看程式碼。 */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * 一份 CSS **宣告**了哪些 `--spek-*`。
 *
 * 只認 `--name:`（宣告），不認 `var(--name)`（使用）—— 兩者若混為一談，一份只讀取契約而從未
 * 覆寫它的 CSS 也會通過。
 */
function declaredSpekVars(css) {
  return new Set([...stripComments(css).matchAll(/(--spek-[a-z0-9-]+)\s*:/g)].map((m) => m[1]))
}

const packageVars = declaredSpekVars(readFileSync(packageCssPath, 'utf8'))
const hostCss = readFileSync(hostCssPath, 'utf8')
const hostVars = declaredSpekVars(hostCss)

test('對照組：兩份名單都抽得出東西 —— 空集合的包含關係恆真', () => {
  assert.ok(packageVars.size >= 8, `套件契約抽出 ${packageVars.size} 個變數（${packageCssPath}）`)
  assert.ok(hostVars.size >= 8, `宿主覆寫抽出 ${hostVars.size} 個變數（${hostCssPath}）`)
})

test('套件宣告的每一個顏色契約變數，宿主都有覆寫', () => {
  const missing = [...packageVars].filter((name) => !hostVars.has(name)).sort()
  assert.deepEqual(
    missing,
    [],
    `index.css 少了 ${missing.length} 個覆寫：${missing.join('、')}` +
      ' —— 它們會靜默沿用 @spekjs/ui 的深色預設值',
  )
})

test('宿主的覆寫排在套件的 styles.css 之後 —— 同為 :root，後者才勝出', () => {
  const importAt = stripComments(hostCss).indexOf("@import '@spekjs/ui/styles.css'")
  const firstOverrideAt = stripComments(hostCss).search(/--spek-[a-z0-9-]+\s*:/)
  assert.notEqual(importAt, -1, 'index.css 未 @import @spekjs/ui/styles.css')
  assert.notEqual(firstOverrideAt, -1, 'index.css 未覆寫任何 --spek-* 變數')
  assert.ok(importAt < firstOverrideAt, `@import 在 ${importAt}、首個覆寫在 ${firstOverrideAt}`)
})

test('對照組：抽取器抓得到漏接，也不把「使用」當成「宣告」', () => {
  const pkg = declaredSpekVars(':root { --spek-accent: #f59e0b; --spek-node-active: #22c55e; }')
  assert.deepEqual([...pkg].sort(), ['--spek-accent', '--spek-node-active'])

  // 漏接一個：必須被判定為缺。
  const partial = declaredSpekVars(':root { --spek-accent: var(--color-accent); }')
  assert.deepEqual(
    [...pkg].filter((n) => !partial.has(n)),
    ['--spek-node-active'],
  )

  // 只「讀」契約而從未覆寫：不得被當成宣告。
  const readsOnly = declaredSpekVars('.node { fill: var(--spek-node-active); }')
  assert.equal(readsOnly.size, 0)

  // 註解裡提到變數名（兩份 CSS 都這樣寫）：不得被當成宣告。
  const commented = declaredSpekVars('/* --spek-node-active: 這一行在註解裡 */ :root { --spek-accent: red; }')
  assert.deepEqual([...commented], ['--spek-accent'])
})
