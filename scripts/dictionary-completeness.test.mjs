/**
 * ui-localization：每一種受支援語言的字典 SHALL 與基準語言完整對應。
 *
 * ## 為什麼這道守衛非有不可
 *
 * i18next 找不到 key 時**靜默回退到基準語言**。少一條翻譯的徵狀因此不是錯誤、不是空白，
 * 而是**畫面上那一格突然變成英文** —— 一個半中半英的介面，而型別檢查、lint 與探針
 * 全部是綠的（探針一律在基準語言下執行，它永遠看不到別種語言的字典）。
 *
 * ## 四項檢查，缺一不可
 *
 * 1. **基底 key 相等**（去除複數後綴之後）。
 * 2. **複數後綴恰為該語言的 CLDR 類別。** `Intl.PluralRules('en')` 是 `one`/`other`，
 *    `zh-TW` 只有 `other` —— 因此 `en.json` 的 12 對 `_one`/`_other` 在 zh 只需 `_other`。
 *    **一道「key 集合完全相同」的守衛會對每一份正確的翻譯失敗**，於是第一次跑就會被
 *    改成 allowlist，然後就沒有守衛了。
 * 3. **插值變數集合相等。** 這是四項裡失效最不顯眼的一項：翻譯漏掉 `{{name}}` 時，
 *    畫面上是一句**少了檔名的話** —— 沒有錯誤、沒有紅字、沒有型別問題。
 * 4. **值不得為空字串**（空字串在畫面上與「這裡什麼都沒有」無法區分）。
 *
 * ## 沒有 allowlist
 *
 * 一個能宣告「這些 key 暫時不必存在」的守衛，與沒有守衛之間只差一次「先加進 allowlist
 * 之後再說」。字典改為**先落地完整的 key 骨架**（值暫為原文）再逐批替換值，於是這道守衛
 * 從第一天起就是綠的。
 */
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import en from '../src/shared/i18n/en.json' with { type: 'json' }
import zhTW from '../src/shared/i18n/zh-TW.json' with { type: 'json' }

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 基準語言的字典，與其餘語言各自的字典。**清單與產品的單一來源對齊。** */
const BASE = { language: 'en', dictionary: en }
const TRANSLATIONS = [{ language: 'zh-TW', dictionary: zhTW }]

/** i18next 的複數後綴。`_ordinal_*` 本 repo 未使用。 */
const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other']

function splitPlural(key) {
  for (const category of PLURAL_CATEGORIES) {
    const suffix = `_${category}`
    if (key.endsWith(suffix)) return { base: key.slice(0, -suffix.length), category }
  }
  return { base: key, category: null }
}

/** 攤平成 `{ '<基底 key 路徑>': { categories:Set, values:Map<category|'', string> } }`。 */
export function flatten(dictionary) {
  const out = new Map()
  const walk = (node, prefix) => {
    for (const [key, value] of Object.entries(node)) {
      if (value !== null && typeof value === 'object') {
        walk(value, `${prefix}${key}.`)
        continue
      }
      const { base, category } = splitPlural(key)
      const path = `${prefix}${base}`
      const entry = out.get(path) ?? { categories: new Set(), values: new Map() }
      entry.categories.add(category ?? '')
      entry.values.set(category ?? '', value)
      out.set(path, entry)
    }
  }
  walk(dictionary, '')
  return out
}

/** 一則文案引用的插值變數。 */
export function variablesOf(value) {
  return new Set([...String(value).matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)].map((m) => m[1]))
}

/** 語言 L 的複數後綴集合：無複數的 key 為 `['']`，有複數的為 L 的 CLDR 類別。 */
function expectedCategories(language, baseCategories) {
  if (baseCategories.size === 1 && baseCategories.has('')) return new Set([''])
  return new Set(new Intl.PluralRules(language).resolvedOptions().pluralCategories)
}

export function compare(baseFlat, language, translationFlat) {
  const problems = []

  for (const path of baseFlat.keys()) {
    if (!translationFlat.has(path)) problems.push(`缺少 key：${path}`)
  }
  for (const path of translationFlat.keys()) {
    if (!baseFlat.has(path)) problems.push(`多出基準語言沒有的 key：${path}`)
  }

  for (const [path, base] of baseFlat) {
    const translated = translationFlat.get(path)
    if (!translated) continue

    const expected = expectedCategories(language, base.categories)
    const actual = translated.categories
    const missing = [...expected].filter((c) => !actual.has(c))
    const extra = [...actual].filter((c) => !expected.has(c))
    if (missing.length > 0 || extra.length > 0) {
      problems.push(
        `${path} 的複數類別不符 CLDR（缺 ${JSON.stringify(missing)}、多 ${JSON.stringify(extra)}）`,
      )
    }

    // **變數的比對分兩層，而分層的理由來自一個真實的反例。**
    //
    // 天真的做法是拿基準語言該 key 的**所有複數形式的聯集**去要求每一個翻譯形式 ——
    // 但英文的 `_one` 形式本來就可以不帶 `{{count}}`（`one thing` vs `{{count}} things`），
    // 於是那個做法會把**每一份正確的字典**都判成漏了變數。這條是被自己的對照組抓出來的。
    //
    // - **交集**：基準語言每一個形式都有的變數，翻譯的每一個形式也都必須有。
    // - **聯集**：翻譯的聯集必須恰等於基準語言的聯集 —— 這一層抓的是「整個 key 都漏了
    //   那個變數」，也就是畫面上少一個檔名的那種情形。
    const baseForms = [...base.values.values()].map((v) => variablesOf(v))
    const baseUnion = new Set(baseForms.flatMap((s) => [...s]))
    const baseCommon = [...baseUnion].filter((v) => baseForms.every((s) => s.has(v)))

    const translatedUnion = new Set()
    for (const [category, value] of translated.values) {
      const label = `${path}${category ? `_${category}` : ''}`
      if (String(value).trim() === '') {
        problems.push(`${label} 的值為空`)
        continue
      }
      const vars = variablesOf(value)
      vars.forEach((v) => translatedUnion.add(v))
      const lost = baseCommon.filter((v) => !vars.has(v))
      if (lost.length > 0) {
        problems.push(`${label} 漏掉每一個形式都該有的插值變數 ${JSON.stringify(lost)}`)
      }
    }

    const lostAltogether = [...baseUnion].filter((v) => !translatedUnion.has(v))
    const invented = [...translatedUnion].filter((v) => !baseUnion.has(v))
    if (lostAltogether.length > 0 || invented.length > 0) {
      problems.push(
        `${path} 的插值變數不符` +
          `（漏 ${JSON.stringify(lostAltogether)}、多 ${JSON.stringify(invented)}）`,
      )
    }
  }

  return problems
}

test('每一種受支援語言的字典都與基準語言完整對應', () => {
  const baseFlat = flatten(BASE.dictionary)
  for (const { language, dictionary } of TRANSLATIONS) {
    const problems = compare(baseFlat, language, flatten(dictionary))
    assert.deepEqual(problems, [], `${language} 的字典與 ${BASE.language} 不對應`)
  }
})

test('字典清單與產品的單一來源一致', async () => {
  const { SUPPORTED_LANGUAGES } = await import(join(repoRoot, 'src/shared/i18n/languages.ts'))
  const covered = [BASE.language, ...TRANSLATIONS.map((t) => t.language)].sort()
  assert.deepEqual(
    covered,
    [...SUPPORTED_LANGUAGES].sort(),
    '新增了一種受支援語言卻沒有把它加進這道守衛 —— 那份字典從此無人檢查',
  )
})

test('對照組：四種違反各自被回報', () => {
  const base = flatten({ a: 'A {{x}}', n_one: 'one', n_other: '{{count}} things' })

  const missingKey = compare(base, 'zh-TW', flatten({ n_other: '{{count}} 個' }))
  assert.equal(missingKey.some((p) => p.includes('缺少 key：a')), true, JSON.stringify(missingKey))

  const wrongPlural = compare(
    base,
    'zh-TW',
    flatten({ a: 'A {{x}}', n_one: '一個', n_other: '{{count}} 個' }),
  )
  assert.equal(wrongPlural.some((p) => p.includes('複數類別不符')), true, JSON.stringify(wrongPlural))

  const lostVariable = compare(base, 'zh-TW', flatten({ a: 'A', n_other: '{{count}} 個' }))
  assert.equal(lostVariable.some((p) => p.includes('插值變數不符')), true, JSON.stringify(lostVariable))

  const emptyValue = compare(base, 'zh-TW', flatten({ a: '  ', n_other: '{{count}} 個' }))
  assert.equal(emptyValue.some((p) => p.includes('的值為空')), true, JSON.stringify(emptyValue))
})

test('對照組：正確的翻譯不被誤報（複數類別較少者尤然）', () => {
  const base = flatten({ a: 'A {{x}}', n_one: 'one thing', n_other: '{{count}} things' })
  assert.deepEqual(compare(base, 'zh-TW', flatten({ a: 'A {{x}}', n_other: '{{count}} 個東西' })), [])
  assert.deepEqual(
    compare(base, 'en', flatten({ a: 'A {{x}}', n_one: 'one thing', n_other: '{{count}} things' })),
    [],
  )
})
