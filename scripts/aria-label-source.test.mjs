/**
 * ui-localization：以文案定位介面元素的程式碼，其文案自字典取得，不得硬編。
 *
 * **`aria-label` 在這個 repo 裡同時是選擇器。** 驗收不得為此在產品 UI 上掛 `data-*`（既有
 * 紀律），於是 probe 只能靠 `role` 與 `aria-label` 定位元素；而 `Ctrl+T` 的實作是「找到既有的
 * 建立入口並觸發它」，靠的正是 `document.querySelector('[aria-label="…"]')`。
 *
 * 文案與選擇器一旦分離為兩份字面值，它們就會在某一次改文案時失去同步 —— **而失去同步的徵狀
 * 是「選不到元素」，不是「斷言失敗」**：探針拿到 `null`，然後以一種看起來像產品壞掉的方式紅掉。
 * `Ctrl+T` 更是連紅燈都不會有（字串比對不會使型別檢查失敗，快捷鍵直接靜默失效）。
 *
 * **這道守衛與 `copy-language.test.mjs` 是互補的，不是重複的**：那一道擋的是「非英文」，
 * 這一道擋的是「硬編」。`ui-copy-i18n` 的第一輪實作正好漏掉了 `Side panel`、`Change artifact`、
 * `Specs`、`Tasks` 這幾個**本來就是英文**的 `aria-label` —— CJK 守衛看不見它們。
 *
 * 規則：`src/**` 與 `scripts/probe-*.mjs` 中，字面的 `aria-label="…"` 一律禁止。
 *
 * - 產品程式碼要寫 `aria-label={t('…')}`（JSX 的插值，不會被這裡的 pattern 命中）。
 * - 驗收腳本要寫 `aria-label="${copy('…')}"`（模板插值，同樣不會被命中）。
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 字面的 `aria-label="…"` —— 值以 `${` 開頭的（插值）不算。 */
const HARDCODED = /aria-label="(?!\$\{)([^"]*)"/g

/**
 * **以樣板字面值合成的 `aria-label`**（`` aria-label={`${label} changes`} ``）。
 *
 * 上面那條 pattern 只認 `aria-label="…"`，對 JSX 的 `aria-label={…}` 完全不匹配 ——
 * 於是一個把字典的值與一段**硬編的英文**拼起來的標籤整個逃掉了，而驗收腳本另一頭
 * 硬編著同一個後綴。**兩份字面值就此各自為政，而它們失去同步的徵狀是「選不到元素」。**
 *
 * `${…}` 之外的每一段字面文字都算硬編 —— 含字母才回報（只有空白與標點的分隔符不算）。
 */
const TEMPLATE_LABEL = /aria-label=\{`([^`]*)`\}/g

/**
 * **來自 `@spekjs/ui` 套件內部的 `aria-label`。**
 *
 * 那不是我們的文案，不歸我們的字典管 —— 它是外部套件的契約，探針硬編它是對的。
 * 這是白名單而非「含 `spekjs` 就跳過」：一個具體的字串豁免，換掉套件就會在這裡現形。
 */
const FROM_PACKAGE = new Set(['Change lifecycle timeline'])

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.isFile()) yield full
  }
}

function* targets() {
  for (const path of walk(join(repoRoot, 'src'))) {
    if (/\.tsx?$/.test(path)) yield path
  }
  for (const name of readdirSync(join(repoRoot, 'scripts'))) {
    if (/^probe-.*\.mjs$/.test(name)) yield join(repoRoot, 'scripts', name)
  }
}

/** 回傳 `[{ line, label }]` —— 行號自 1 起算。 */
export function findHardcodedAriaLabels(source) {
  const found = []

  source.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(HARDCODED)) {
      if (FROM_PACKAGE.has(match[1])) continue
      found.push({ line: index + 1, label: match[1] })
    }
    for (const match of line.matchAll(TEMPLATE_LABEL)) {
      for (const literal of match[1].split(/\$\{[^}]*\}/)) {
        if (!/\p{L}/u.test(literal)) continue
        if (FROM_PACKAGE.has(literal.trim())) continue
        found.push({ line: index + 1, label: literal.trim() })
      }
    }
  })

  return found
}

test('aria-label 不得硬編（產品與驗收腳本皆自字典取得）', () => {
  const offenders = []

  for (const path of targets()) {
    for (const hit of findHardcodedAriaLabels(readFileSync(path, 'utf8'))) {
      offenders.push(`${relative(repoRoot, path)}:${hit.line}: aria-label="${hit.label}"`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `aria-label 同時是選擇器 —— 硬編它，一次文案改動就會讓探針靜默地選不到元素，\n` +
      `而 Ctrl+T 連紅燈都不會有。產品用 aria-label={t('…')}，探針用 aria-label="\${copy('…')}"。\n\n` +
      offenders.join('\n'),
  )
})

test('對照組：硬編的 aria-label 會被抓到（含本來就是英文的）', () => {
  const source = [
    `<span aria-label="工作區" />`,
    `<nav aria-label="Side panel" />`,
    `document.querySelector('[aria-label="New session"]')`,
  ].join('\n')

  const hits = findHardcodedAriaLabels(source)

  assert.equal(hits.length, 3, `三種都要抓到，實得 ${JSON.stringify(hits)}`)
  // **英文的也要抓** —— CJK 守衛看不見它們，這正是第一輪漏掉 `Side panel` 的原因。
  assert.equal(
    hits.some((h) => h.label === 'Side panel'),
    true,
    '本來就是英文的硬編 aria-label 也必須被抓到',
  )
})

test('對照組：自字典取得的 aria-label 不被誤報', () => {
  const source = [
    `<span aria-label={t('rail.label')} />`,
    `<nav aria-label={t('openspec.sidePanel')} />`,
    'document.querySelector(`[aria-label="${copy(\'sessions.new\')}"]`)',
    `const svg = q('svg[aria-label="Change lifecycle timeline"]')`, // 來自 @spekjs/ui，豁免
  ].join('\n')

  assert.deepEqual(findHardcodedAriaLabels(source), [])
})

test('對照組：以樣板合成的 aria-label 中，`${}` 之外的英文被回報', () => {
  const found = findHardcodedAriaLabels('    <section aria-label={`${label} changes`}>')
  assert.deepEqual(found, [{ line: 1, label: 'changes' }])
})

test('對照組：完全來自字典的樣板不被回報', () => {
  // 分隔符（空白、標點）不含字母 —— 它們不是文案。
  assert.deepEqual(findHardcodedAriaLabels('<b aria-label={`${a} — ${b}`}>'), [])
  assert.deepEqual(findHardcodedAriaLabels("<b aria-label={t('rail.label')}>"), [])
})
