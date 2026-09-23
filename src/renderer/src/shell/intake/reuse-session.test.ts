import assert from 'node:assert/strict'
import test from 'node:test'

import { sessionToReuse } from './reuse-session'

const LIVE = [
  { id: 's1', folderId: 'A' },
  { id: 's2', folderId: 'B' },
]

test('逾時之後再次處理不建立第二個 session', () => {
  assert.equal(sessionToReuse('s1', LIVE, 'A'), 's1')
})

test('那個 session 已經被關掉時才建新的', () => {
  assert.equal(sessionToReuse('s9', LIVE, 'A'), null)
})

test('從未建立過時建新的', () => {
  assert.equal(sessionToReuse(undefined, LIVE, 'A'), null)
})

test('逾時之後改選別的 folder 再次處理 ⇒ 不沿用原 folder 的那一個', () => {
  // s1 在 A；使用者這次確認的是 B。沿用它等於把本文送進他剛改掉的 repo。
  assert.equal(sessionToReuse('s1', LIVE, 'B'), null)
})
