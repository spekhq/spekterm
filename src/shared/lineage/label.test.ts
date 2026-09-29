import assert from 'node:assert/strict'
import test from 'node:test'

import { preferredTitle } from './label'

const brief = (title: string) => ({ brief: { title, receivedAt: 0 } })

test('交接的標題是預設：高於 pty 宣告的標題', () => {
  // **對照組**：把 `title` 排到交接標題前面 → 這條必須變紅。
  assert.equal(preferredTitle({ title: '✳ spekterm-2506', lineage: brief('Fix login') }), 'Fix login')
})

test('使用者指定的名稱高於交接的標題；清空之後立即回到交接的標題', () => {
  assert.equal(preferredTitle({ customTitle: 'Mine', title: 'pty', lineage: brief('Fix login') }), 'Mine')
  assert.equal(preferredTitle({ customTitle: undefined, title: 'pty', lineage: brief('Fix login') }), 'Fix login')
})

test('空白的交接標題不參與，退回 pty 的標題', () => {
  assert.equal(preferredTitle({ title: 'pty', lineage: brief('') }), 'pty')
  assert.equal(preferredTitle({ title: 'pty', lineage: brief('   ') }), 'pty')
})

test('沒有交接單的 session 照舊：使用者名稱 > pty 標題 > 缺席', () => {
  assert.equal(preferredTitle({ customTitle: 'Mine', title: 'pty' }), 'Mine')
  assert.equal(preferredTitle({ title: 'pty' }), 'pty')
  assert.equal(preferredTitle({}), undefined)
})
