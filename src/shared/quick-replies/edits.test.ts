import assert from 'node:assert/strict'
import test from 'node:test'

import { applyQuickReplyEdit, editProblem } from './edits'
import { cleanQuickReplies, sentenceProblem } from './rules'

const three = ['a', 'b', 'c']

test('edits name rows by sentence and apply to the list they run on', () => {
  assert.deepEqual(applyQuickReplyEdit(three, { kind: 'add', sentence: '  d ' }), ['a', 'b', 'c', 'd'])
  assert.deepEqual(applyQuickReplyEdit(three, { kind: 'replace', from: 'b', to: 'B' }), ['a', 'B', 'c'])
  assert.deepEqual(applyQuickReplyEdit(three, { kind: 'remove', sentence: 'b' }), ['a', 'c'])
  assert.deepEqual(applyQuickReplyEdit(three, { kind: 'move', sentence: 'c', by: -1 }), ['a', 'c', 'b'])
  assert.equal(applyQuickReplyEdit(three, { kind: 'move', sentence: 'a', by: -1 }), null)
})

test('a quick "move up" then "remove", each applied to the result of the one before, applies both', () => {
  // Control: computing the second from the list on screen (`three`) would bring "c" back to its old place.
  const afterMove = applyQuickReplyEdit(three, { kind: 'move', sentence: 'c', by: -1 })!
  const afterRemove = applyQuickReplyEdit(afterMove, { kind: 'remove', sentence: 'a' })
  assert.deepEqual(afterRemove, ['c', 'b'])
})

test('a duplicate, an over-long sentence, a line break and a thirteenth are refused', () => {
  assert.equal(editProblem(three, 'b'), 'duplicate')
  assert.equal(editProblem(three, ' b '), 'duplicate')
  assert.equal(editProblem(three, 'b', 'b'), null, 'a sentence replacing itself is not a duplicate')
  assert.equal(editProblem(three, 'x'.repeat(201)), 'tooLong')
  assert.equal(editProblem(three, 'x'.repeat(200)), null)
  assert.equal(editProblem(three, 'two\nlines'), 'control')
  assert.equal(editProblem(three, '   '), 'empty')
  assert.equal(editProblem(Array.from({ length: 12 }, (_, i) => `s${i}`), 'new'), 'full')
  assert.equal(applyQuickReplyEdit(three, { kind: 'replace', from: 'a', to: 'c' }), null)
})

test('a stored list breaking any rule is unset, never repaired in part', () => {
  assert.deepEqual(cleanQuickReplies(['a', ' b ']), ['a', 'b'])
  assert.deepEqual(cleanQuickReplies([]), [])
  for (const bad of [null, 'a', {}, [1], [''], ['  '], ['a\nb'], ['a\tb'], ['x'.repeat(201)], Array.from({ length: 13 }, (_, i) => `s${i}`), ['a', 'a'], ['a', ' a']]) {
    assert.equal(cleanQuickReplies(bad), undefined, JSON.stringify(bad))
  }
  assert.equal(sentenceProblem('\u2028'), 'empty', 'a line separator alone trims to nothing')
  assert.equal(sentenceProblem('a\u2028b'), 'control')
})

test('the list in effect: the defaults in the current language while unset, the stored list once set', async () => {
  const { effectiveQuickReplies } = await import('./rules')
  const en = (key: string) => `en:${key}`
  const zh = (key: string) => `zh:${key}`
  assert.deepEqual(effectiveQuickReplies(undefined, en), ['en:quickReplies.default.close', 'en:quickReplies.default.risk', 'en:quickReplies.default.remaining'])
  assert.deepEqual(effectiveQuickReplies(undefined, zh)[0], 'zh:quickReplies.default.close')
  // Control: always returning the defaults turns these red.
  assert.deepEqual(effectiveQuickReplies(['mine'], zh), ['mine'])
  assert.deepEqual(effectiveQuickReplies([], zh), [])
})
