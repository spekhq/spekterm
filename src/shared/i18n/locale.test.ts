import assert from 'node:assert/strict'
import test from 'node:test'

import { setLanguage } from './index'
import { collator, formatDate, formatNumber, formatTime, localeOf, relativeTime } from './locale'

test('locale 取自當前語言', async () => {
  assert.equal(localeOf(), 'en')
  await setLanguage('zh-TW')
  assert.equal(localeOf(), 'zh-TW')
  await setLanguage('en')
})

test('格式化器在語言改變後重建，而不是回傳快取的舊值', async () => {
  // 快取是必要的（檔案樹每一列每次重繪都要用它），但一個以模組層級持有、
  // 永不失效的快取會讓「切換語言」對整棵樹毫無作用 —— 而畫面上不會有任何錯誤。
  const enRelative = relativeTime(Date.now() - 2 * 3_600_000)
  await setLanguage('zh-TW')
  const zhRelative = relativeTime(Date.now() - 2 * 3_600_000)
  await setLanguage('en')
  const backToEn = relativeTime(Date.now() - 2 * 3_600_000)

  assert.notEqual(zhRelative, enRelative, '切換語言後相對時間必須改變')
  assert.equal(backToEn, enRelative, '切回來必須回到原本的呈現')
})

test('collator 在語言改變後重建', async () => {
  // 實測：`en` 把漢字排在拉丁字母**之後**，`zh-TW` 排在**之前**。
  // 純 ASCII 的輸入在兩個 locale 下順序相同 —— 這組值刻意含漢字，否則這條斷言恆真。
  const input = ['zebra', '中文', 'apple']
  const inEnglish = [...input].sort((a, b) => collator().compare(a, b))
  await setLanguage('zh-TW')
  const inChinese = [...input].sort((a, b) => collator().compare(a, b))
  await setLanguage('en')

  assert.notDeepEqual(inChinese, inEnglish, 'collator 未隨語言重建')
})

test('數字以當前語言格式化', async () => {
  assert.equal(formatNumber(1234567), (1234567).toLocaleString('en'))
  await setLanguage('zh-TW')
  assert.equal(formatNumber(1234567), (1234567).toLocaleString('zh-TW'))
  await setLanguage('en')
})

test('時刻與日期的格式隨語言改變，而它所指的時刻不變', async () => {
  // **時區與 locale 是兩件不同的事。** 時區的正確來源是作業系統（它就是使用者所在的位置），
  // 格式的正確來源是介面的語言 —— 一個在台北工作的人把介面切成英文，他要的仍然是台北時間，
  // 只是換一種寫法。
  //
  // 這條是 `status-bar` 那條「重置時刻的格式取自 UI 語言而非執行環境」的載體：
  // 該欄位只在 agent 回報用量上限時出現，驅動它需要一整份 status payload fixture，
  // 而「它真的走這個模組」由 `scripts/locale-source.test.mjs` 結構性地保證。
  const at = new Date('2026-09-18T14:05:00Z')
  const options = { hour: '2-digit', minute: '2-digit' } as const

  const enTime = formatTime(at, options)
  const enDate = formatDate(at, { month: 'numeric', day: 'numeric' })
  await setLanguage('zh-TW')
  const zhTime = formatTime(at, options)
  const zhDate = formatDate(at, { month: 'numeric', day: 'numeric' })
  await setLanguage('en')

  assert.notEqual(zhTime, enTime, '時刻的格式必須隨語言改變')

  // **日期在這兩個 locale 下恰好相同**（`{month:'numeric', day:'numeric'}` 兩邊都是 `9/18`）。
  // 因此這裡**不能**斷言「它會變」—— 那會是一條假的要求。要斷言的是「它確實以當前語言的
  // locale 求值」：與直接指名該 locale 的結果逐字元相同。一個沿用執行環境預設的實作在
  // 這台機器上會得到 `zh-TW` 的結果，於是英文那一行會紅。
  assert.equal(enTime, at.toLocaleTimeString('en', options))
  assert.equal(zhTime, at.toLocaleTimeString('zh-TW', options))
  assert.equal(enDate, at.toLocaleDateString('en', { month: 'numeric', day: 'numeric' }))
  assert.equal(zhDate, at.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' }))
})
