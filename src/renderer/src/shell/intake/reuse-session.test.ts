import assert from 'node:assert/strict'
import test from 'node:test'

import { sessionToReuse } from './reuse-session'

test('逾時之後再次處理不建立第二個 session', () => {
  assert.equal(sessionToReuse('s1', ['s1', 's2']), 's1')
})

test('那個 session 已經被關掉時才建新的', () => {
  assert.equal(sessionToReuse('s1', ['s2']), null)
})

test('從未建立過時建新的', () => {
  assert.equal(sessionToReuse(undefined, ['s1']), null)
})
