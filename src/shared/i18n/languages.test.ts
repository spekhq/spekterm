import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_LANGUAGE, isSupportedLanguage, resolveInitialLanguage } from './languages'

test('取偏好順序中第一個受支援的語言', () => {
  assert.equal(resolveInitialLanguage(['zh-TW']), 'zh-TW')
  assert.equal(resolveInitialLanguage(['zh-TW', 'zh', 'zh']), 'zh-TW')
  assert.equal(resolveInitialLanguage(['fr-FR', 'zh-TW', 'en-US']), 'zh-TW')
})

test('皆不受支援時退回基準語言', () => {
  // `zh-HK` **刻意不匹配** `zh-TW` —— 不做主語言的模糊匹配（`zh` 可能是簡體）。
  assert.equal(resolveInitialLanguage(['zh-HK', 'en-GB']), DEFAULT_LANGUAGE)
  assert.equal(resolveInitialLanguage(['fr-FR']), DEFAULT_LANGUAGE)
})

test('空陣列退回基準語言 —— 這是實測會發生的輸入', () => {
  // `LANG` 與 `LANGUAGE` 皆未設定時，`app.getPreferredSystemLanguages()` 就回空陣列
  //（2026-09-18、Electron 43.1.0、Linux 實測）。它不是假想的防禦。
  assert.equal(resolveInitialLanguage([]), DEFAULT_LANGUAGE)
})

test('吃得下底線與大小寫的形式', () => {
  // `LANGUAGE` 給的是 `zh_TW:zh` 這種以底線組成的形式。
  assert.equal(resolveInitialLanguage(['zh_TW']), 'zh-TW')
  assert.equal(resolveInitialLanguage(['ZH-tw']), 'zh-TW')
  assert.equal(resolveInitialLanguage(['zh_tw']), 'zh-TW')
})

test('對照組：`en` 之外的主語言標籤不被當成受支援', () => {
  assert.equal(isSupportedLanguage('zh'), false)
  assert.equal(isSupportedLanguage('en-US'), false)
  assert.equal(isSupportedLanguage(undefined), false)
})
