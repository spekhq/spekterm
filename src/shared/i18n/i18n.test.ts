import assert from 'node:assert/strict'
import test from 'node:test'

import { SUPPORTED_LANGUAGES, currentLanguage, i18n, languageLabel, setLanguage, t } from './index'

test('初始語言為基準語言', () => {
  assert.equal(currentLanguage(), 'en')
})

test('`setLanguage` 之後，module-level 的 `t` 解析到新語言', async () => {
  // **這是主行程整條路徑的地基**：主行程沒有元件，它全部走 `export const t = i18next.t`。
  // 若那個繫結在 `changeLanguage()` 之後仍指向舊語言，原生對話框與通知會停在英文，
  // 而畫面上是中文 —— 一個不會產生任何錯誤的分岔。
  const before = t('common.cancel')
  await setLanguage('zh-TW')
  assert.equal(currentLanguage(), 'zh-TW')
  assert.notEqual(t('rail.heading'), undefined)
  await setLanguage('en')
  assert.equal(t('common.cancel'), before)
})

test('不受支援的值無操作，不改變當前語言', async () => {
  await setLanguage('zh-TW')
  await setLanguage('fr-FR')
  assert.equal(currentLanguage(), 'zh-TW')
  await setLanguage('')
  assert.equal(currentLanguage(), 'zh-TW')
  await setLanguage('en')
})

test('語言選項的標籤不隨當前 UI 語言改變', async () => {
  // 若 `languageLabel` 誤用 `t()` 而非 `getFixedT(lang)`，中文介面下兩個選項會一起
  // 變成當前語言的自稱 —— 而一個看不懂當前語言的使用者就再也找不到自己的語言。
  const inEnglish = SUPPORTED_LANGUAGES.map(languageLabel)
  await setLanguage('zh-TW')
  const inChinese = SUPPORTED_LANGUAGES.map(languageLabel)
  await setLanguage('en')

  assert.deepEqual(inChinese, inEnglish)
  assert.equal(new Set(inEnglish).size, SUPPORTED_LANGUAGES.length, '每個語言的自稱必須相異')
  assert.equal(inEnglish.every((label) => label.length > 0), true)
})

test('每一種受支援的語言都有 resources', () => {
  for (const language of SUPPORTED_LANGUAGES) {
    assert.equal(i18n.hasResourceBundle(language, 'translation'), true, language)
  }
})
