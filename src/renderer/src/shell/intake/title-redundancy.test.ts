import assert from 'node:assert/strict'
import test from 'node:test'

import { showTitleSeparately } from './title-redundancy'

test('本文已包含標題時不另外呈現（Slack：標題是被提及那一則的第一行）', () => {
  const body = '#server 的討論串，直到提及你的那一則：\n\nAlex Chen: @kewang 有一件事\n第二行'
  assert.equal(showTitleSeparately('@kewang 有一件事', body), false)
})

test('標題被截短（以 … 結尾）時比對去掉它的部分', () => {
  assert.equal(showTitleSeparately('@kewang 有一件很長的…', 'Alex: @kewang 有一件很長的事情要說'), false)
})

test('標題不在本文裡時照常呈現（交接：標題是一句摘要）', () => {
  assert.equal(showTitleSeparately('交接測試：確認管道可用', '請在這個 repo 裡跑一次測試'), true)
})

test('空標題不呈現', () => {
  assert.equal(showTitleSeparately('', 'body'), false)
  assert.equal(showTitleSeparately('…', 'body'), false)
})
